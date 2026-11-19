-- Keep recurring bills and subscriptions distinct; both may use a card.
alter table public.nc_recurring_rules add column interval_months integer not null default 1 check(interval_months in (1,12)),
 add column expense_type text check(expense_type in ('recurring','subscription')),
 add column credit_card_id uuid references public.nc_credit_cards(id),
 add column invoice_shift integer not null default 0 check(invoice_shift between -2 and 2);
create index nc_rules_credit_card on public.nc_recurring_rules(credit_card_id) where credit_card_id is not null;
alter table public.nc_entries add column expense_type text check(expense_type in ('recurring','subscription')),
 add column recurrence_interval integer check(recurrence_interval in (1,12));
alter table public.nc_entries drop constraint nc_entry_card_fields;
alter table public.nc_entries add constraint nc_entry_card_fields check(
 (credit_card_id is null and card_invoice_id is null and purchase_date is null) or
 (credit_card_id is not null and card_invoice_id is not null and purchase_date is not null and purchase_date>='2000-01-01' and purchase_date<'2100-01-01' and kind='expense' and payment_method='credit_card')
);

-- Deterministic charge IDs preserve edited/deleted occurrences and prevent duplicates.
-- A paid invoice is never silently extended with another charge.
create function nossa_conta_private.materialize_card_charge(p_rule uuid,p_month date) returns integer
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();r public.nc_recurring_rules;c public.nc_credit_cards;
 a public.nc_recurring_amounts; inv public.nc_card_invoices; d date;m date;i uuid;eid text;distance integer;
begin
 if h is null then raise exception 'membership_required';end if;
 select * into r from public.nc_recurring_rules where id=p_rule and household_id=h;
 if not found or r.credit_card_id is null then raise exception 'recurrence_not_found';end if;
 distance:=(extract(year from p_month)::integer-extract(year from r.start_month)::integer)*12+extract(month from p_month)::integer-extract(month from r.start_month)::integer;
 if distance<0 or distance%r.interval_months<>0 or (r.end_month is not null and p_month>r.end_month) then return 0;end if;
 eid:=r.id::text||':'||to_char(p_month,'YYYY-MM');
 if exists(select 1 from public.nc_entries where id=eid) then return 0;end if;
 select * into c from public.nc_credit_cards where id=r.credit_card_id and household_id=h and not archived;
 if not found then return 0;end if;
 d:=nossa_conta_private.card_day(p_month,r.due_day);
 m:=(date_trunc('month',nossa_conta_private.card_first_due(d,c.closing_day,c.due_day))+r.invoice_shift*interval '1 month')::date;
 if m<'2000-01-01' or m>='2100-01-01' then return 0;end if;
 if exists(select 1 from public.nc_card_invoices where card_id=c.id and invoice_month=m and paid_at is not null) then return 1;end if;
 i:=nossa_conta_private.card_invoice(c.id,m);
 select * into inv from public.nc_card_invoices where id=i;
 select * into a from public.nc_recurring_amounts where rule_id=r.id and effective_month<=p_month order by effective_month desc limit 1;
 if not found then raise exception 'recurrence_amount_not_found';end if;
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed,payment_method,credit_card_id,card_invoice_id,purchase_date,expense_type,recurrence_interval)
 values(eid,h,'expense',r.description,a.amount,r.category,r.person,inv.due_date,r.id,auth.uid(),false,'credit_card',c.id,i,d,r.expense_type,r.interval_months);
 return 0;
end $$;

create function nossa_conta_private.sync_card_month(p_month date) returns integer
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();r record;offset_month integer;charge_month date;due_month date;blocked integer:=0;
begin
 if h is null then raise exception 'membership_required';end if;
 if not nossa_conta_private.household_has_premium(h) then return 0;end if;
 perform 1 from public.nc_households where id=h for update;
 for r in select rule.*,c.closing_day,c.due_day as card_due from public.nc_recurring_rules rule join public.nc_credit_cards c on c.id=rule.credit_card_id
  where rule.household_id=h and not c.archived loop
  for offset_month in -4..2 loop
   charge_month:=(p_month+offset_month*interval '1 month')::date;
   due_month:=(date_trunc('month',nossa_conta_private.card_first_due(nossa_conta_private.card_day(charge_month,r.due_day),r.closing_day,r.card_due))+r.invoice_shift*interval '1 month')::date;
   if due_month=p_month then blocked:=blocked+nossa_conta_private.materialize_card_charge(r.id,charge_month);end if;
  end loop;
 end loop;
 return blocked;
end $$;
create function nossa_conta_private.card_forecast() returns integer
language plpgsql security definer set search_path='' as $$
declare m date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date;i integer;blocked integer:=0;
begin
 for i in -1..12 loop blocked:=blocked+nossa_conta_private.sync_card_month((m+i*interval '1 month')::date);end loop;
 return blocked;
end $$;
create function public.nc_sync_card_forecast() returns integer language sql security invoker set search_path='' as $$select nossa_conta_private.card_forecast()$$;
revoke all on function nossa_conta_private.materialize_card_charge(uuid,date),nossa_conta_private.sync_card_month(date),nossa_conta_private.card_forecast(),public.nc_sync_card_forecast() from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.card_forecast(),public.nc_sync_card_forecast() to authenticated;
create or replace function nossa_conta_private.add_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid;rid uuid;eid text;d date;outrow public.nc_entries;paid boolean;paid_by text;c public.nc_credit_cards;charge date;natural_month date;chosen_month date;shift integer;period integer:=coalesce((p_entry->>'intervalMonths')::integer,1);
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for share;
 perform nossa_conta_private.validate_entry(p_entry);d:=(p_entry->>'date')::date;
 if period not in (1,12) then raise exception 'invalid_frequency';end if;
 if coalesce((p_entry->>'repeats')::boolean,false) and nullif(p_entry->>'cardId','') is not null then
  if p_entry->>'kind'<>'expense' or p_entry->>'paymentMethod'<>'credit_card' then raise exception 'invalid_card_purchase';end if;
  perform 1 from public.nc_households where id=h for update;
  select * into c from public.nc_credit_cards where id=(p_entry->>'cardId')::uuid and household_id=h and not archived;
  if not found then raise exception 'card_not_found';end if;
  charge:=(p_entry->>'purchaseDate')::date;
  if charge is null or charge<'2000-01-01' or charge>='2100-01-01' then raise exception 'invalid_purchase_date';end if;
  natural_month:=date_trunc('month',nossa_conta_private.card_first_due(charge,c.closing_day,c.due_day))::date;
  chosen_month:=coalesce((nullif(p_entry->>'invoiceMonth','')||'-01')::date,natural_month);
  if chosen_month<date_trunc('month',charge)::date or chosen_month>(date_trunc('month',charge)+interval '2 months')::date then raise exception 'invalid_recurring_invoice';end if;
  shift:=(extract(year from chosen_month)::integer-extract(year from natural_month)::integer)*12+extract(month from chosen_month)::integer-extract(month from natural_month)::integer;
  insert into public.nc_recurring_rules(household_id,kind,description,category,person,start_month,due_day,created_by,interval_months,expense_type,credit_card_id,invoice_shift)
  values(h,'expense',trim(p_entry->>'description'),trim(p_entry->>'category'),trim(p_entry->>'person'),date_trunc('month',charge)::date,extract(day from charge)::integer,auth.uid(),period,coalesce(p_entry->>'expenseType','recurring'),c.id,shift) returning id into rid;
  insert into public.nc_recurring_amounts(rule_id,effective_month,amount,payment_method) values(rid,date_trunc('month',charge)::date,(p_entry->>'amount')::bigint,'credit_card');
  if nossa_conta_private.materialize_card_charge(rid,date_trunc('month',charge)::date)>0 then raise exception 'invoice_paid';end if;
  select * into outrow from public.nc_entries where id=rid::text||':'||to_char(charge,'YYYY-MM');
  return to_jsonb(outrow);
 end if;
 eid:=gen_random_uuid()::text;
 paid:=coalesce((p_entry->>'confirmed')::boolean,true);
 paid_by:=case when paid and p_entry->>'kind'='expense' then coalesce(nullif(trim(p_entry->>'payer'),''),(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
 if coalesce((p_entry->>'repeats')::boolean,false) then
   insert into public.nc_recurring_rules(household_id,kind,description,category,person,start_month,due_day,created_by,interval_months,expense_type)
   values(h,p_entry->>'kind',trim(p_entry->>'description'),trim(p_entry->>'category'),trim(p_entry->>'person'),date_trunc('month',d)::date,extract(day from d)::integer,auth.uid(),period,case when p_entry->>'kind'='expense' then coalesce(p_entry->>'expenseType','recurring') else null end) returning id into rid;
   insert into public.nc_recurring_amounts(rule_id,effective_month,amount,payment_method) values(rid,date_trunc('month',d)::date,(p_entry->>'amount')::bigint,p_entry->>'paymentMethod');
   eid:=rid::text||':'||to_char(d,'YYYY-MM');
 end if;
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed,confirmed_at,payer,payment_method,expense_type,recurrence_interval)
 values(eid,h,p_entry->>'kind',trim(p_entry->>'description'),(p_entry->>'amount')::bigint,trim(p_entry->>'category'),trim(p_entry->>'person'),d,rid,auth.uid(),paid,case when paid then now() else null end,paid_by,p_entry->>'paymentMethod',case when rid is not null then p_entry->>'expenseType' else null end,case when rid is not null then period else null end) returning * into outrow;
 return to_jsonb(outrow);
end $$;

create or replace function nossa_conta_private.sync_month(p_month date) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;m date;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 m:=date_trunc('month',p_month)::date;
 if p_month is null or p_month<>m or m<'2000-01-01' or m>='2100-01-01' then raise exception 'invalid_month';end if;
 -- A deterministic ID makes concurrent reloads safe, and preserves deleted occurrences.
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed,payment_method,expense_type,recurrence_interval)
 select r.id::text||':'||to_char(m,'YYYY-MM'),h,r.kind,r.description,a.amount,r.category,r.person,
   m+(least(r.due_day,extract(day from (m+interval '1 month - 1 day'))::integer)-1),r.id,auth.uid(),false,a.payment_method,r.expense_type,r.interval_months
 from public.nc_recurring_rules r
 cross join lateral(select amount,payment_method from public.nc_recurring_amounts v where v.rule_id=r.id and v.effective_month<=m order by v.effective_month desc limit 1) a
 where r.household_id=h and r.credit_card_id is null and ((extract(year from m)::integer-extract(year from r.start_month)::integer)*12+extract(month from m)::integer-extract(month from r.start_month)::integer)%r.interval_months=0 and r.start_month<=m and (r.end_month is null or r.end_month>=m)
 on conflict(id) do nothing;
 perform nossa_conta_private.sync_card_month(m);
end $$;

create or replace function nossa_conta_private.save_card_purchase(p_entry jsonb,p_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();c public.nc_credit_cards;e public.nc_entries;i public.nc_card_invoices;
 purchase date;first_due date;m date;invoice uuid;result jsonb;g uuid;
begin
 if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for update;
 select * into c from public.nc_credit_cards where id=(p_entry->>'cardId')::uuid and household_id=h and (not archived or exists(select 1 from public.nc_entries where id=p_id and household_id=h and credit_card_id=(p_entry->>'cardId')::uuid));
 if not found then raise exception 'card_not_found';end if;
 if p_entry->>'kind'<>'expense' or p_entry->>'paymentMethod'<>'credit_card' or coalesce((p_entry->>'repeats')::boolean,false) or coalesce((p_entry->>'future')::boolean,false) then raise exception 'invalid_card_purchase';end if;
 purchase:=(p_entry->>'purchaseDate')::date;
 if purchase is null or purchase<'2000-01-01' or purchase>='2100-01-01' then raise exception 'invalid_purchase_date';end if;
 first_due:=nossa_conta_private.card_first_due(purchase,c.closing_day,c.due_day);
 m:=coalesce((nullif(p_entry->>'invoiceMonth','')||'-01')::date,date_trunc('month',first_due)::date);
 invoice:=nossa_conta_private.card_invoice(c.id,m);
 select * into i from public.nc_card_invoices where id=invoice;
 -- Existing routines validate the financial fields and preserve installment rounding.
 p_entry:=p_entry||jsonb_build_object('date',i.due_date,'confirmed',false,'repeats',false);
 perform nossa_conta_private.validate_entry(p_entry);
 if p_id is not null then
  select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null for update;
  if not found then raise exception 'entry_not_found';end if;
  if e.kind<>'expense' or (e.rule_id is not null and e.credit_card_id is null) then raise exception 'invalid_card_purchase';end if;
  update public.nc_entries set description=trim(p_entry->>'description'),amount=(p_entry->>'amount')::bigint,
   category=trim(p_entry->>'category'),person=trim(p_entry->>'person'),date=i.due_date,
   payment_method='credit_card',confirmed=false,confirmed_at=null,payer=null,
   credit_card_id=c.id,card_invoice_id=i.id,purchase_date=purchase where id=e.id;
  return jsonb_build_object('id',e.id,'date',i.due_date);
 elsif p_entry ? 'installmentCount' then
  g:=(p_entry->>'installmentGroup')::uuid;
  select * into e from public.nc_entries where household_id=h and installment_group=g and installment_number=1;
  if found then
   if e.credit_card_id is distinct from c.id then raise exception 'duplicate_purchase';end if;
   return jsonb_build_object('id',e.id,'date',e.date,'already_created',true);
  end if;
  result:=nossa_conta_private.add_installments(p_entry);
  for e in select * from public.nc_entries where household_id=h and installment_group=g order by installment_number loop
   invoice:=nossa_conta_private.card_invoice(c.id,(m+(e.installment_number-1)*interval '1 month')::date);
   select * into i from public.nc_card_invoices where id=invoice;
   update public.nc_entries set date=i.due_date,credit_card_id=c.id,card_invoice_id=i.id,purchase_date=purchase where id=e.id;
  end loop;
 else
  result:=nossa_conta_private.add_entry(p_entry);
  update public.nc_entries set credit_card_id=c.id,card_invoice_id=i.id,purchase_date=purchase where id=result->>'id';
 end if;
 return result||jsonb_build_object('date',(select date from public.nc_entries where id=result->>'id'));
end $$;


create function nossa_conta_private.edit_card_recurrence(p_id text,p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();e public.nc_entries;result jsonb;m date;
begin
 if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for update;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 result:=nossa_conta_private.save_card_purchase(p_entry||jsonb_build_object('future',false,'repeats',false),p_id);
 if e.rule_id is not null and coalesce((p_entry->>'future')::boolean,false) then
  if not nossa_conta_private.household_has_premium(h) then raise exception 'premium_required';end if;
  m:=(date_trunc('month',e.purchase_date)+interval '1 month')::date;
  insert into public.nc_recurring_amounts(rule_id,effective_month,amount,payment_method)
  values(e.rule_id,m,(p_entry->>'amount')::bigint,'credit_card') on conflict(rule_id,effective_month) do update set amount=excluded.amount;
  update public.nc_entries set amount=(p_entry->>'amount')::bigint where rule_id=e.rule_id and purchase_date>=m and not confirmed and deleted_at is null;
 end if;
 return result;
end $$;
create function public.nc_edit_card_recurrence(p_id text,p_entry jsonb) returns jsonb language sql security invoker set search_path='' as $$select nossa_conta_private.edit_card_recurrence(p_id,p_entry)$$;
revoke all on function nossa_conta_private.edit_card_recurrence(text,jsonb),public.nc_edit_card_recurrence(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.edit_card_recurrence(text,jsonb),public.nc_edit_card_recurrence(text,jsonb) to authenticated;

create or replace function nossa_conta_private.stop_recurring(p_id text) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();e public.nc_entries;m date;
begin
 if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for update;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null;
 if not found or e.rule_id is null then raise exception 'recurrence_not_found';end if;
 m:=date_trunc('month',coalesce(e.purchase_date,e.date))::date;
 update public.nc_recurring_rules set end_month=least(coalesce(end_month,m),m) where id=e.rule_id and household_id=h;
 if e.credit_card_id is not null then
  update public.nc_entries set deleted_at=now() where rule_id=e.rule_id and purchase_date>=(m+interval '1 month')::date and not confirmed and deleted_at is null;
 end if;
end $$;
