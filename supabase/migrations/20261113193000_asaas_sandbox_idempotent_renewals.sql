-- Sandbox only. Never grants paid access and never modifies real Premium/courtesy.
-- One credit per unique provider charge, within an atomic transaction.
create table public.nc_billing_sandbox_renewals (
  payment_id text primary key check (payment_id ~ '^pay_[a-zA-Z0-9_-]{3,120}$'),
  order_id uuid not null references public.nc_billing_orders(id) on delete cascade,
  due_date date not null,
  previous_valid_until timestamptz not null,
  new_valid_until timestamptz not null,
  applied_at timestamptz not null default now(),
  unique (order_id,due_date)
);
create index nc_billing_sandbox_renewals_order_idx
  on public.nc_billing_sandbox_renewals(order_id,applied_at desc);
alter table public.nc_billing_sandbox_renewals enable row level security;
revoke all on public.nc_billing_sandbox_renewals from public,anon,authenticated;
grant select on public.nc_billing_sandbox_renewals to authenticated;
create policy billing_sandbox_renewals_admin_read on public.nc_billing_sandbox_renewals
  for select to authenticated
  using ((select nossa_conta_private.is_system_admin()));

-- p_verified_status and p_due_date must come from a fresh, server-side Asaas
-- GET /payments/{id}. Caller authenticates using the existing separate token.
-- Even if the token is leaked this function only extends a linked, already-paid
-- Sandbox checkout by one correctly due period. Never affects real access.
create function nossa_conta_private.billing_apply_sandbox_renewal(
  p_token text, p_subscription text, p_payment text,
  p_amount integer, p_due_date date, p_verified_status text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  o public.nc_billing_orders%rowtype;
  next_valid_until timestamptz;
  months_to_add integer;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from nossa_conta_private.billing_config
    where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex')
  ) then raise exception 'invalid_billing_token'; end if;
  if p_payment is null or p_payment !~ '^pay_[a-zA-Z0-9_-]{3,120}$'
     or p_subscription is null or p_subscription !~ '^sub_[a-zA-Z0-9_-]{6,100}$'
     or p_verified_status not in ('CONFIRMED','RECEIVED')
     or p_due_date is null
    then return 'rejected'; end if;
  select * into o from public.nc_billing_orders
  where provider_subscription_id = p_subscription
    and environment = 'sandbox' and method = 'card'
    and status = 'paid' and sandbox_valid_until is not null
  for update;
  if not found then return 'unmatched'; end if;
  if exists (select 1 from public.nc_billing_sandbox_renewals where payment_id = p_payment)
    then return 'duplicate'; end if;
  -- The initial checkout payment is for the preceding cycle, not a renewal.
  -- A payment for any other period must not skip dates or extend early.
  if p_amount is distinct from o.amount
    or p_due_date <> (o.sandbox_valid_until at time zone 'America/Sao_Paulo')::date
    then return 'not_next_cycle'; end if;
  months_to_add := case o.cycle
    when 'monthly' then 1 when 'quarterly' then 3
    when 'yearly' then 12 else null end;
  if months_to_add is null then return 'rejected'; end if;
  next_valid_until := o.sandbox_valid_until + make_interval(months => months_to_add);
  insert into public.nc_billing_sandbox_renewals
    (payment_id,order_id,due_date,previous_valid_until,new_valid_until)
  values (p_payment,o.id,p_due_date,o.sandbox_valid_until,next_valid_until);
  update public.nc_billing_orders
    set sandbox_valid_until = next_valid_until
    where id = o.id;
  return 'applied';
end $$;

create function public.nc_billing_apply_sandbox_renewal(
  p_token text, p_subscription text, p_payment text,
  p_amount integer, p_due_date date, p_verified_status text
) returns text language sql security invoker set search_path = ''
as $$ select nossa_conta_private.billing_apply_sandbox_renewal(
  p_token,p_subscription,p_payment,p_amount,p_due_date,p_verified_status) $$;

revoke all on function nossa_conta_private.billing_apply_sandbox_renewal(text,text,text,integer,date,text),
  public.nc_billing_apply_sandbox_renewal(text,text,text,integer,date,text)
  from public,anon,authenticated;
grant execute on function nossa_conta_private.billing_apply_sandbox_renewal(text,text,text,integer,date,text)
  to anon,authenticated;
grant execute on function public.nc_billing_apply_sandbox_renewal(text,text,text,integer,date,text)
  to anon,authenticated;
