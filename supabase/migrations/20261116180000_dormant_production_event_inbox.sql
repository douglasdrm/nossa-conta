-- Persistent, owner-only PRODUCTION inbox foundation.
-- No production webhook endpoint, no public grant and no active ingestion.
-- Never stores raw webhook payloads, customer data, payment method or credentials.
-- Activation is separate from the reconciliation switch and defaults to FALSE.
create table nossa_conta_private.nc_production_inbox_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into nossa_conta_private.nc_production_inbox_control(singleton,enabled)
values (true,false);
alter table nossa_conta_private.nc_production_inbox_control enable row level security;
revoke all on nossa_conta_private.nc_production_inbox_control from public,anon,authenticated;

create table nossa_conta_private.nc_production_event_inbox (
  event_id text primary key check(length(event_id) between 3 and 250),
  event_type text not null check(event_type in (
    'PAYMENT_CREATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED',
    'PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED',
    'PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
  )),
  payment_id text not null check(payment_id ~ '^pay_[A-Za-z0-9_-]{3,120}$'),
  state text not null default 'pending'
    check(state in ('pending','processing','processed','retry','manual_review')),
  attempts integer not null default 0 check(attempts between 0 and 20),
  received_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  processed_at timestamptz,
  last_result text check(last_result is null or length(last_result) <= 100),
  constraint inbox_state_consistent check(
    (state='processing' and leased_until is not null and processed_at is null)
    or (state in ('pending','retry') and leased_until is null and processed_at is null)
    or (state in ('processed','manual_review') and leased_until is null and processed_at is not null)
  )
);
create index nc_production_inbox_due on nossa_conta_private.nc_production_event_inbox
  (available_at,received_at) where state in ('pending','retry','processing');
alter table nossa_conta_private.nc_production_event_inbox enable row level security;
revoke all on nossa_conta_private.nc_production_event_inbox from public,anon,authenticated;

-- Owner-only, SECURITY INVOKER. A future trusted server must authenticate
-- the Asaas token before calling. No client/API role has permission.
-- An event ID can NEVER be repointed to a different payment/type.
create function nossa_conta_private.enqueue_production_event_internal(
  p_event_id text,p_event_type text,p_payment_id text
) returns text language plpgsql security invoker set search_path=''
as $$
declare old record;
begin
  if not coalesce((select enabled from nossa_conta_private.nc_production_inbox_control
      where singleton),false) then return 'production_inbox_disabled'; end if;
  if p_event_id is null or length(p_event_id) not between 3 and 250
    or p_event_type is null or p_event_type not in (
      'PAYMENT_CREATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED',
      'PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED',
      'PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
    )
    or p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_-]{3,120}$'
  then return 'invalid'; end if;
  insert into nossa_conta_private.nc_production_event_inbox
    (event_id,event_type,payment_id)
  values (p_event_id,p_event_type,p_payment_id)
  on conflict (event_id) do nothing;
  if found then return 'queued'; end if;
  select event_type,payment_id into old from nossa_conta_private.nc_production_event_inbox
    where event_id=p_event_id;
  if old.event_type=p_event_type and old.payment_id=p_payment_id
    then return 'duplicate'; end if;
  return 'event_id_conflict';
end $$;
revoke all on function nossa_conta_private.enqueue_production_event_internal(text,text,text)
  from public,anon,authenticated;

-- Owner-only lease claim with bounded retries; does NOT fetch Asaas or credit
-- payments. Locks prevent two workers claiming the same event. Expired leases
-- can be recovered; retryable records are preserved rather than dropped.
create function nossa_conta_private.claim_production_event_internal()
returns jsonb language plpgsql volatile security invoker set search_path=''
as $$
declare item record;
begin
  if not coalesce((select enabled from nossa_conta_private.nc_production_inbox_control
      where singleton),false) then
    return jsonb_build_object('result','production_inbox_disabled'); end if;
  -- Expired last-attempt leases go to review instead of remaining stuck.
  update nossa_conta_private.nc_production_event_inbox
  set state='manual_review',leased_until=null,processed_at=now(),
    last_result='max_attempts_exhausted'
  where state='processing' and leased_until<now() and attempts>=5;
  select event_id,event_type,payment_id,attempts into item
  from nossa_conta_private.nc_production_event_inbox
  where (
    (state in ('pending','retry') and available_at<=now())
    or (state='processing' and leased_until<now())
  )
    and attempts<5
  order by received_at,event_id
  for update skip locked
  limit 1;
  if not found then return jsonb_build_object('result','empty'); end if;
  update nossa_conta_private.nc_production_event_inbox
  set state='processing',attempts=attempts+1,
    leased_until=now()+interval '5 minutes',last_result=null
  where event_id=item.event_id;
  return jsonb_build_object(
    'result','claimed','event_id',item.event_id,
    'event_type',item.event_type,'payment_id',item.payment_id,
    'attempts',item.attempts+1
  );
end $$;
revoke all on function nossa_conta_private.claim_production_event_internal()
  from public,anon,authenticated;

-- Commit outcome only when currently leased; no paid/access changes.
-- A failed verification stays available for a bounded retry, while a
-- provider reversal requires a separate manual review.
create function nossa_conta_private.complete_production_event_internal(
  p_event_id text,p_attempt integer,p_outcome text,p_reason text default null
) returns text language plpgsql security invoker set search_path=''
as $$
declare item record;
begin
  if not coalesce((select enabled from nossa_conta_private.nc_production_inbox_control
      where singleton),false) then return 'production_inbox_disabled'; end if;
  if p_event_id is null or p_attempt is null or p_attempt<1 or
    p_outcome not in ('processed','retry','manual_review')
    or p_outcome is null or p_reason is not null and length(p_reason)>100
  then return 'invalid'; end if;
  select state,leased_until,attempts into item
  from nossa_conta_private.nc_production_event_inbox
  where event_id=p_event_id for update;
  if not found then return 'not_found'; end if;
  if item.state<>'processing' or item.leased_until<=now()
    or item.attempts<>p_attempt
    then return 'not_leased'; end if;
  if p_outcome='retry' and item.attempts>=5 then
    p_outcome:='manual_review'; end if;
  update nossa_conta_private.nc_production_event_inbox
  set state=p_outcome,leased_until=null,
    available_at=case when p_outcome='retry'
      then now()+make_interval(secs=>30*item.attempts) else available_at end,
    processed_at=case when p_outcome='retry' then null else now() end,
    last_result=p_reason
  where event_id=p_event_id;
  return p_outcome;
end $$;
revoke all on function nossa_conta_private.complete_production_event_internal(text,integer,text,text)
  from public,anon,authenticated;

-- Existing admin-only diagnostics enriched with aggregate inbox counters.
-- Not a permission to ingest, claim, retry or enable payment processing.
create or replace function nossa_conta_private.production_reconciliation_diagnostics()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null or not nossa_conta_private.is_system_admin()
    then raise exception 'admin_required'; end if;
  return jsonb_build_object(
    'enabled',coalesce((select enabled from
      nossa_conta_private.nc_production_reconciliation_control where singleton),false),
    'linked_subscriptions',(select count(*) from
      nossa_conta_private.nc_production_subscription_links),
    'recorded_payments',(select count(*) from
      nossa_conta_private.nc_production_charges),
    'audit_events',(select count(*) from
      nossa_conta_private.nc_production_reconciliation_events),
    'inbox_enabled',coalesce((select enabled from
      nossa_conta_private.nc_production_inbox_control where singleton),false),
    'inbox_pending',(select count(*) from
      nossa_conta_private.nc_production_event_inbox where state in ('pending','retry','processing')),
    'inbox_processed',(select count(*) from
      nossa_conta_private.nc_production_event_inbox where state='processed'),
    'inbox_manual_review',(select count(*) from
      nossa_conta_private.nc_production_event_inbox where state='manual_review')
  );
end $$;
