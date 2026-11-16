-- Production payment reconciliation FOUNDATION. Disabled on deployment.
-- There is no checkout, webhook, public RPC, secret or provider client for production.
-- No Sandbox order or courtesy record is read or modified.
create table nossa_conta_private.nc_production_subscription_links (
  provider_subscription_id text primary key
    check(provider_subscription_id ~ '^sub_[A-Za-z0-9_-]{6,100}$'),
  household_id uuid not null references public.nc_households(id) on delete restrict,
  cycle text not null check(cycle in ('monthly','quarterly','yearly')),
  amount_cents integer not null check(amount_cents > 0),
  next_due_date date not null,
  status text not null default 'prepared' check(status in ('prepared','active','stopped')),
  created_at timestamptz not null default now()
);
create index nc_production_links_household_idx on
  nossa_conta_private.nc_production_subscription_links(household_id);
alter table nossa_conta_private.nc_production_subscription_links enable row level security;
revoke all on nossa_conta_private.nc_production_subscription_links
  from public,anon,authenticated;

create table nossa_conta_private.nc_production_reconciliation_events (
  event_id text primary key check(length(event_id) between 3 and 250),
  payment_id text not null check(payment_id ~ '^pay_[A-Za-z0-9_-]{3,120}$'),
  outcome text not null check(outcome in ('applied','duplicate_payment','reversed')),
  created_at timestamptz not null default now()
);
create index nc_production_reconciliation_payment_idx on
  nossa_conta_private.nc_production_reconciliation_events(payment_id);
alter table nossa_conta_private.nc_production_reconciliation_events enable row level security;
revoke all on nossa_conta_private.nc_production_reconciliation_events
  from public,anon,authenticated;

create table nossa_conta_private.nc_production_reconciliation_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into nossa_conta_private.nc_production_reconciliation_control(singleton,enabled)
values (true,false);
alter table nossa_conta_private.nc_production_reconciliation_control enable row level security;
revoke all on nossa_conta_private.nc_production_reconciliation_control
  from public,anon,authenticated;

-- A settled charge can credit at most one subscription period.
create unique index nc_production_one_payment_per_cycle on
  nossa_conta_private.nc_production_charges(provider_subscription_id,due_date)
  where provider_subscription_id is not null
  and status in ('CONFIRMED','RECEIVED');

-- IMPORTANT: PostgreSQL owner-only function, never available to API roles.
-- The future trusted production server must first GET the real provider payment,
-- independently verify ownership, amount, cycle, date and environment, and
-- obtain explicit permission to enable the separate reconciliation gate.
-- Even a forged provider payload cannot change anything while disabled.
create function nossa_conta_private.reconcile_production_payment_internal(
  p_event_id text,p_payment_id text,p_subscription_id text,
  p_amount_cents integer,p_due_date date,p_status text
) returns text
language plpgsql security invoker set search_path=''
as $$
declare
  binding nossa_conta_private.nc_production_subscription_links%rowtype;
  existing nossa_conta_private.nc_production_charges%rowtype;
  next_date date;
  period_end timestamptz;
begin
  if not coalesce((select enabled from
    nossa_conta_private.nc_production_reconciliation_control
    where singleton=true),false) then
    return 'production_disabled';
  end if;
  if p_event_id is null or length(p_event_id) not between 3 and 250
    or p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_-]{3,120}$'
    or p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9_-]{6,100}$'
    or p_amount_cents is null or p_amount_cents <= 0
    or p_due_date is null or p_status not in
      ('CONFIRMED','RECEIVED','REFUNDED','PARTIALLY_REFUNDED','CHARGEBACK_REQUESTED')
    then return 'invalid'; end if;
  -- Serializes events for the same linked subscription.
  select * into binding from nossa_conta_private.nc_production_subscription_links
    where provider_subscription_id=p_subscription_id for update;
  if not found or binding.status <> 'active'
    or binding.amount_cents <> p_amount_cents then return 'unmatched'; end if;
  if exists (select 1 from nossa_conta_private.nc_production_reconciliation_events
    where event_id=p_event_id) then return 'duplicate_event'; end if;

  select * into existing from nossa_conta_private.nc_production_charges
    where provider_payment_id=p_payment_id for update;
  if found and (
    existing.household_id <> binding.household_id
    or existing.provider_subscription_id is distinct from p_subscription_id
    or existing.amount_cents <> p_amount_cents
    or existing.due_date <> p_due_date
    or existing.cycle <> binding.cycle
  ) then return 'payment_mismatch'; end if;

  if p_status in ('REFUNDED','PARTIALLY_REFUNDED','CHARGEBACK_REQUESTED') then
    if not found then return 'reversal_without_payment'; end if;
    if existing.status <> p_status then
      update nossa_conta_private.nc_production_charges
      set status=p_status,updated_at=now()
      where provider_payment_id=p_payment_id;
    end if;
    insert into nossa_conta_private.nc_production_reconciliation_events
      (event_id,payment_id,outcome) values(p_event_id,p_payment_id,'reversed');
    return 'manual_review';
  end if;

  if found then
    -- Never credit an already-credited payment again, nor resurrect reversed ones.
    insert into nossa_conta_private.nc_production_reconciliation_events
      (event_id,payment_id,outcome) values(p_event_id,p_payment_id,'duplicate_payment');
    return case when existing.status in ('CONFIRMED','RECEIVED')
      then 'duplicate_payment' else 'manual_review' end;
  end if;
  if binding.next_due_date <> p_due_date then return 'not_next_cycle'; end if;
  next_date := case binding.cycle when 'monthly' then
    (p_due_date + interval '1 month')::date when 'quarterly' then
    (p_due_date + interval '3 months')::date when 'yearly' then
    (p_due_date + interval '12 months')::date end;
  if next_date is null or next_date <= p_due_date then return 'invalid'; end if;
  period_end := (next_date::timestamp at time zone 'America/Sao_Paulo');
  insert into nossa_conta_private.nc_production_charges (
    household_id,provider_payment_id,provider_subscription_id,
    provider_environment,provider_name,cycle,status,
    amount_cents,due_date,paid_until,provider_verified_at
  ) values (
    binding.household_id,p_payment_id,p_subscription_id,
    'production','asaas',binding.cycle,p_status,
    p_amount_cents,p_due_date,period_end,now()
  );
  update nossa_conta_private.nc_production_subscription_links
    set next_due_date=next_date where provider_subscription_id=p_subscription_id;
  insert into nossa_conta_private.nc_production_reconciliation_events
    (event_id,payment_id,outcome) values(p_event_id,p_payment_id,'applied');
  return 'applied';
end $$;

revoke all on function nossa_conta_private.reconcile_production_payment_internal(
  text,text,text,integer,date,text) from public,anon,authenticated;
-- Deliberately no grant to service_role: commercial reconciliation requires
-- a separate security-reviewed migration and production provider verification.
