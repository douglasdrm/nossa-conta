-- A private, single-purchase monthly Pix offer, scoped to an explicitly selected owner.
create table nossa_conta_private.nc_pilot_checkout_offers (
  user_id uuid primary key references auth.users(id),
  amount_cents integer not null default 500 check (amount_cents=500),
  expires_at timestamptz not null default (now()+interval '7 days')
);
alter table nossa_conta_private.nc_pilot_checkout_offers enable row level security;
revoke all on nossa_conta_private.nc_pilot_checkout_offers from public, anon, authenticated, service_role;

create function nossa_conta_private.pilot_offer_amount() returns integer
language sql stable security definer set search_path = '' as $$
  select o.amount_cents from nossa_conta_private.nc_pilot_checkout_offers o
  join auth.users u on u.id=o.user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  join public.nc_households h on h.owner_id=u.id
  join public.nc_household_members m on m.household_id=h.id and m.user_id=u.id
  where u.id=auth.uid() and o.expires_at>now()
    and not exists(select 1 from nossa_conta_private.nc_production_charges c where c.household_id=h.id)
$$;
create function public.nc_pilot_offer_amount() returns integer
language sql stable security invoker set search_path = '' as $$select nossa_conta_private.pilot_offer_amount()$$;
revoke all on function nossa_conta_private.pilot_offer_amount(),public.nc_pilot_offer_amount() from public, anon, authenticated, service_role;
grant execute on function nossa_conta_private.pilot_offer_amount(),public.nc_pilot_offer_amount() to authenticated;

create or replace function nossa_conta_private.reserve_production_checkout(p_token text, p_cycle text, p_method text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  household uuid;
  order_row nossa_conta_private.nc_production_checkout_orders%rowtype;
  amount integer;
  reused boolean := false;
begin
  if not nossa_conta_private.production_checkout_authorized(p_token) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if not exists(select 1 from auth.users u where u.id = auth.uid()
     and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select h.id into household from public.nc_households h
    join public.nc_household_members m on m.household_id = h.id and m.user_id = auth.uid()
    where h.owner_id = auth.uid()
    for update of h;
  if not found then return jsonb_build_object('status', 'forbidden'); end if;

  amount := case p_cycle when 'monthly' then 1490 when 'quarterly' then 3990 when 'yearly' then 11990 end;
  if p_cycle='monthly' and p_method='pix' then
    amount := coalesce(nossa_conta_private.pilot_offer_amount(),amount);
  end if;
  if amount is null or p_method is null or p_method not in ('pix','card') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from nossa_conta_private.nc_production_subscription_links
    where household_id = household and status in ('prepared','active'))
    or exists (select 1 from nossa_conta_private.nc_production_charges
      where household_id = household and status in ('CONFIRMED','RECEIVED') and paid_until > now()) then
    return jsonb_build_object('status', 'already_subscribed');
  end if;

  select * into order_row from nossa_conta_private.nc_production_checkout_orders
    where household_id = household and expires_at > now()
    order by expires_at desc limit 1;
  if found then
    if order_row.cycle <> p_cycle or order_row.method <> p_method then
      return jsonb_build_object('status', 'other_checkout');
    end if;
    reused := true;
  else
    insert into nossa_conta_private.nc_production_checkout_orders (household_id, cycle, method, amount_cents)
      values (household, p_cycle, p_method, amount) returning * into order_row;
  end if;
  return jsonb_build_object('status', 'ready', 'id', order_row.id, 'checkout_id', order_row.checkout_id,
    'amount_cents', order_row.amount_cents, 'reused', reused);
end $$;

