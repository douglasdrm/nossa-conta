create role nc_production_payment_worker noinherit nologin;
grant usage on schema nossa_conta_private to nc_production_payment_worker;

create function nossa_conta_private.payment_worker_claim()
returns jsonb language sql security definer set search_path = ''
as $$
  select case when exists (
    select 1 from nossa_conta_private.nc_production_reconciliation_control where singleton and enabled
  ) then nossa_conta_private.claim_production_event_internal()
  else jsonb_build_object('result','production_disabled') end
$$;

create function nossa_conta_private.payment_worker_context(
  p_event text,p_attempt integer,p_checkout text,p_reference text,p_subscription text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  i nossa_conta_private.nc_production_event_inbox%rowtype;
  o nossa_conta_private.nc_production_checkout_orders%rowtype;
  c nossa_conta_private.nc_production_charges%rowtype;
  b nossa_conta_private.nc_production_subscription_links%rowtype;
begin
  select * into i from nossa_conta_private.nc_production_event_inbox
    where event_id=p_event and state='processing' and attempts=p_attempt and leased_until>now();
  if not found then return jsonb_build_object('kind','lease_lost'); end if;
  select * into c from nossa_conta_private.nc_production_charges where provider_payment_id=i.payment_id;
  if found then return jsonb_build_object('kind','known'); end if;
  select * into o from nossa_conta_private.nc_production_checkout_orders
    where checkout_id is not null and provider_payment_id is null
      and (checkout_id=p_checkout or (p_checkout is null and id::text=p_reference));
  if found then
    return jsonb_build_object('kind','initial','order_id',o.id,'checkout_id',o.checkout_id,
      'payment_id',o.provider_payment_id,'cycle',o.cycle,'method',o.method,'amount_cents',o.amount_cents);
  end if;
  select * into b from nossa_conta_private.nc_production_subscription_links
    where provider_subscription_id=p_subscription and status='active';
  if found then return jsonb_build_object('kind','renewal','cycle',b.cycle); end if;
  return jsonb_build_object('kind','unmatched');
end $$;

create function nossa_conta_private.payment_worker_finish(
  p_event text,p_attempt integer,p_decision text,p_evidence jsonb
) returns text language plpgsql security definer set search_path = ''
as $$
declare
  i nossa_conta_private.nc_production_event_inbox%rowtype;
  c nossa_conta_private.nc_production_charges%rowtype;
  result text;
  kind text := p_evidence->>'kind';
  payment_status text := p_evidence->>'status';
  payment_id text := p_evidence->>'paymentId';
  subscription_id text := p_evidence->>'subscriptionId';
  amount integer := (p_evidence->>'amountCents')::integer;
  due_date date := (p_evidence->>'dueDate')::date;
begin
  if not exists(select 1 from nossa_conta_private.nc_production_inbox_control where singleton and enabled)
    or not exists(select 1 from nossa_conta_private.nc_production_reconciliation_control where singleton and enabled) then
    return 'production_disabled';
  end if;
  select * into i from nossa_conta_private.nc_production_event_inbox
    where event_id=p_event and state='processing' and attempts=p_attempt and leased_until>now() for update;
  if not found then return 'not_leased'; end if;

  if p_decision in ('retry','manual_review','processed') and p_evidence is null then
    return nossa_conta_private.complete_production_event_internal(p_event,p_attempt,p_decision,'provider_' || p_decision);
  end if;
  if p_decision is distinct from 'apply' or payment_id is distinct from i.payment_id then
    return nossa_conta_private.complete_production_event_internal(p_event,p_attempt,'manual_review','invalid_evidence');
  end if;

  if kind='initial' then
    result := nossa_conta_private.apply_initial_production_checkout_payment(
      (p_evidence->>'orderId')::uuid,p_evidence->>'checkoutId',payment_id,subscription_id,amount,due_date,payment_status
    )->>'status';
    if result='confirmed' then result := 'applied'; end if;
  elsif kind='renewal' and payment_status in ('CONFIRMED','RECEIVED') then
    if exists (select 1 from nossa_conta_private.nc_production_subscription_links
      where provider_subscription_id=subscription_id and cycle=p_evidence->>'cycle') then
      result := nossa_conta_private.reconcile_production_payment_internal(
        p_event,payment_id,subscription_id,amount,due_date,payment_status
      );
    end if;
  elsif kind='reversal' and payment_status in ('REFUNDED','PARTIALLY_REFUNDED','CHARGEBACK_REQUESTED') then
    select * into c from nossa_conta_private.nc_production_charges
      where provider_payment_id=i.payment_id for update;
    if found and c.provider_subscription_id is not distinct from subscription_id
      and c.amount_cents=amount and c.due_date=due_date then
      update nossa_conta_private.nc_production_charges set status=payment_status,updated_at=now()
        where id=c.id and status is distinct from payment_status;
      insert into nossa_conta_private.nc_production_reconciliation_events(event_id,payment_id,outcome)
        values(p_event,payment_id,'reversed') on conflict (event_id) do nothing;
      result := 'reversed';
    end if;
  end if;

  if result in ('applied','reversed','duplicate_payment','duplicate_event') then
    return nossa_conta_private.complete_production_event_internal(p_event,p_attempt,'processed',result);
  end if;
  if result='not_next_cycle' then
    return nossa_conta_private.complete_production_event_internal(p_event,p_attempt,'retry',result);
  end if;
  return nossa_conta_private.complete_production_event_internal(p_event,p_attempt,'manual_review',coalesce(result,'payment_mismatch'));
end $$;

revoke all on function nossa_conta_private.payment_worker_claim(),
  nossa_conta_private.payment_worker_context(text,integer,text,text,text),
  nossa_conta_private.payment_worker_finish(text,integer,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.payment_worker_claim(),
  nossa_conta_private.payment_worker_context(text,integer,text,text,text),
  nossa_conta_private.payment_worker_finish(text,integer,text,jsonb)
  to nc_production_payment_worker;
