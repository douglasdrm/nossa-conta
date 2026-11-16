alter table nossa_conta_private.nc_production_checkout_orders
  add column provider_payment_id text unique references
    nossa_conta_private.nc_production_charges(provider_payment_id) on delete restrict;

create function nossa_conta_private.production_checkout_confirmation_order(p_token text, p_order uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'checkout_id', o.checkout_id, 'amount_cents', o.amount_cents, 'cycle', o.cycle,
    'method', o.method, 'payment_id', o.provider_payment_id
  )
  from nossa_conta_private.nc_production_checkout_orders o
  join public.nc_households h on h.id = o.household_id and h.owner_id = auth.uid()
  join public.nc_household_members m on m.household_id = h.id and m.user_id = auth.uid()
  join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  where o.id = p_order and o.checkout_id is not null
    and nossa_conta_private.production_checkout_authorized(p_token);
$$;

create function nossa_conta_private.confirm_production_checkout_payment(
  p_token text, p_order uuid, p_checkout text, p_payment text, p_subscription text,
  p_amount integer, p_due_date date, p_status text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o nossa_conta_private.nc_production_checkout_orders%rowtype;
  c nossa_conta_private.nc_production_charges%rowtype;
  paid_through timestamptz;
  outcome text;
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if nossa_conta_private.production_checkout_confirmation_order(p_token,p_order) is null then
    return jsonb_build_object('status','unavailable');
  end if;
  perform 1 from public.nc_households h
    where h.id = (select household_id from nossa_conta_private.nc_production_checkout_orders where id=p_order)
      and h.owner_id = auth.uid() for update;
  if not found or nossa_conta_private.production_checkout_confirmation_order(p_token,p_order) is null then
    return jsonb_build_object('status','unavailable');
  end if;
  select * into strict o from nossa_conta_private.nc_production_checkout_orders where id=p_order for update;

  if p_checkout is distinct from o.checkout_id or p_amount is distinct from o.amount_cents
    or p_payment is null or p_payment !~ '^pay_[A-Za-z0-9_-]{3,120}$'
    or p_due_date is null or p_due_date > local_today
    or p_due_date < (o.created_at at time zone 'America/Sao_Paulo')::date
    or (o.method = 'pix' and (p_status is distinct from 'RECEIVED' or p_subscription is not null))
    or (o.method = 'card' and (p_status is null or p_status not in ('CONFIRMED','RECEIVED')
      or p_subscription is null or p_subscription !~ '^sub_[A-Za-z0-9_-]{6,100}$')) then
    return jsonb_build_object('status','manual_review');
  end if;

  if o.provider_payment_id is not null then
    if o.provider_payment_id is distinct from p_payment then
      return jsonb_build_object('status','manual_review');
    end if;
    select * into strict c from nossa_conta_private.nc_production_charges where provider_payment_id=p_payment;
    if c.status not in ('CONFIRMED','RECEIVED') then return jsonb_build_object('status','manual_review'); end if;
    return jsonb_build_object('status','confirmed','valid_until',c.paid_until);
  end if;

  if exists (select 1 from nossa_conta_private.nc_production_charges
    where provider_payment_id = p_payment
      or (household_id=o.household_id and status in ('CONFIRMED','RECEIVED') and paid_until > now()))
    or exists (select 1 from nossa_conta_private.nc_production_subscription_links
      where provider_subscription_id = p_subscription or
        (household_id=o.household_id and status in ('prepared','active'))) then
    return jsonb_build_object('status','manual_review');
  end if;

  if o.method = 'card' then
    insert into nossa_conta_private.nc_production_subscription_links
      (provider_subscription_id,household_id,cycle,amount_cents,next_due_date,status)
      values (p_subscription,o.household_id,o.cycle,p_amount,p_due_date,'active');
    outcome := nossa_conta_private.reconcile_production_payment_internal(
      'checkout:' || o.id::text,p_payment,p_subscription,p_amount,p_due_date,p_status
    );
    if outcome is distinct from 'applied' then
      raise exception 'Unable to apply verified initial subscription payment';
    end if;
    select paid_until into strict paid_through from nossa_conta_private.nc_production_charges where provider_payment_id=p_payment;
  else
    paid_through := ((p_due_date + case o.cycle when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months' else interval '12 months' end)::date::timestamp
      at time zone 'America/Sao_Paulo');
    insert into nossa_conta_private.nc_production_charges
      (household_id,provider_payment_id,cycle,status,amount_cents,due_date,paid_until,provider_verified_at)
      values (o.household_id,p_payment,o.cycle,p_status,p_amount,p_due_date,paid_through,now());
    insert into nossa_conta_private.nc_production_reconciliation_events (event_id,payment_id,outcome)
      values ('checkout:' || o.id::text,p_payment,'applied');
  end if;
  update nossa_conta_private.nc_production_checkout_orders set provider_payment_id=p_payment where id=p_order;
  return jsonb_build_object('status','confirmed','valid_until',paid_through);
end $$;

create function public.nc_production_checkout_confirmation_order(p_token text,p_order uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select nossa_conta_private.production_checkout_confirmation_order(p_token,p_order) $$;

create function public.nc_confirm_production_checkout_payment(
  p_token text,p_order uuid,p_checkout text,p_payment text,p_subscription text,p_amount integer,p_due_date date,p_status text
) returns jsonb language sql security invoker set search_path = ''
as $$ select nossa_conta_private.confirm_production_checkout_payment(
  p_token,p_order,p_checkout,p_payment,p_subscription,p_amount,p_due_date,p_status
) $$;

revoke all on function nossa_conta_private.production_checkout_confirmation_order(text,uuid),
  nossa_conta_private.confirm_production_checkout_payment(text,uuid,text,text,text,integer,date,text),
  public.nc_production_checkout_confirmation_order(text,uuid),
  public.nc_confirm_production_checkout_payment(text,uuid,text,text,text,integer,date,text)
  from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.production_checkout_confirmation_order(text,uuid),
  nossa_conta_private.confirm_production_checkout_payment(text,uuid,text,text,text,integer,date,text),
  public.nc_production_checkout_confirmation_order(text,uuid),
  public.nc_confirm_production_checkout_payment(text,uuid,text,text,text,integer,date,text)
  to authenticated;

create function nossa_conta_private.production_paid_premium_until()
returns timestamptz language sql stable security definer set search_path = ''
as $$
  select max(c.paid_until)
  from public.nc_household_members m
  join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
  join nossa_conta_private.nc_production_charges c on c.household_id=m.household_id
  where m.user_id=auth.uid() and c.provider_environment='production' and c.provider_name='asaas'
    and c.status in ('CONFIRMED','RECEIVED') and c.provider_verified_at is not null and c.paid_until > now()
$$;

create function public.nc_production_paid_premium_until()
returns timestamptz language sql stable security invoker set search_path = ''
as $$ select nossa_conta_private.production_paid_premium_until() $$;

revoke all on function nossa_conta_private.production_paid_premium_until(),
  public.nc_production_paid_premium_until() from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.production_paid_premium_until(),
  public.nc_production_paid_premium_until() to authenticated;
