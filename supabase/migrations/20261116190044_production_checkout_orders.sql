create table nossa_conta_private.nc_production_checkout_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  token_hash text check (token_hash ~ '^[a-f0-9]{64}$'),
  check (not enabled or token_hash is not null)
);
insert into nossa_conta_private.nc_production_checkout_control default values;
alter table nossa_conta_private.nc_production_checkout_control enable row level security;
revoke all on nossa_conta_private.nc_production_checkout_control from public, anon, authenticated, service_role;

create table nossa_conta_private.nc_production_checkout_orders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.nc_households(id) on delete restrict,
  cycle text not null check (cycle in ('monthly','quarterly','yearly')),
  method text not null check (method in ('pix','card')),
  amount_cents integer not null check (amount_cents > 0),
  checkout_id text unique check (checkout_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  expires_at timestamptz not null default (now() + interval '65 minutes'),
  created_at timestamptz not null default now()
);
create index nc_production_checkout_orders_household_idx
  on nossa_conta_private.nc_production_checkout_orders(household_id, expires_at desc);
alter table nossa_conta_private.nc_production_checkout_orders enable row level security;
revoke all on nossa_conta_private.nc_production_checkout_orders from public, anon, authenticated, service_role;

create function nossa_conta_private.production_checkout_authorized(p_token text)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select coalesce((
    select enabled and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    from nossa_conta_private.nc_production_checkout_control where singleton
  ), false)
  and coalesce((select enabled from nossa_conta_private.nc_production_inbox_control where singleton), false)
  and coalesce((select enabled from nossa_conta_private.nc_production_reconciliation_control where singleton), false);
$$;
revoke all on function nossa_conta_private.production_checkout_authorized(text)
  from public, anon, authenticated, service_role;

create function nossa_conta_private.reserve_production_checkout(p_token text, p_cycle text, p_method text)
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

create function nossa_conta_private.attach_production_checkout(p_token text, p_order uuid, p_checkout text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not nossa_conta_private.production_checkout_authorized(p_token)
    or p_checkout is null or p_checkout !~ '^[A-Za-z0-9_-]{10,100}$' then return false; end if;
  update nossa_conta_private.nc_production_checkout_orders o set checkout_id = p_checkout
    where o.id = p_order and o.expires_at > now()
      and (o.checkout_id is null or o.checkout_id = p_checkout)
      and exists (select 1 from public.nc_households h join public.nc_household_members m
        on m.household_id=h.id and m.user_id=auth.uid()
        join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
        where h.id=o.household_id and h.owner_id=auth.uid());
  return found;
end $$;

create function public.nc_reserve_production_checkout(p_token text, p_cycle text, p_method text)
returns jsonb language sql security invoker set search_path = ''
as $$ select nossa_conta_private.reserve_production_checkout(p_token,p_cycle,p_method) $$;

create function public.nc_attach_production_checkout(p_token text, p_order uuid, p_checkout text)
returns boolean language sql security invoker set search_path = ''
as $$ select nossa_conta_private.attach_production_checkout(p_token,p_order,p_checkout) $$;

revoke all on function nossa_conta_private.reserve_production_checkout(text,text,text),
  nossa_conta_private.attach_production_checkout(text,uuid,text),
  public.nc_reserve_production_checkout(text,text,text),
  public.nc_attach_production_checkout(text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function nossa_conta_private.reserve_production_checkout(text,text,text),
  nossa_conta_private.attach_production_checkout(text,uuid,text),
  public.nc_reserve_production_checkout(text,text,text),
  public.nc_attach_production_checkout(text,uuid,text) to authenticated;
