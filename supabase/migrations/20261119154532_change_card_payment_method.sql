create or replace function nossa_conta_private.card_entry_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.nc_card_invoices; paid boolean;
begin
 if tg_op='UPDATE' and old.card_invoice_id is not null then
  select paid_at is not null into paid from public.nc_card_invoices where id=old.card_invoice_id;
  if paid and (new.description,new.amount,new.category,new.person,new.date,new.credit_card_id,new.card_invoice_id,new.purchase_date,new.deleted_at)
     is distinct from (old.description,old.amount,old.category,old.person,old.date,old.credit_card_id,old.card_invoice_id,old.purchase_date,old.deleted_at) then raise exception 'invoice_paid';end if;
  if new.card_invoice_id is null and (new.credit_card_id is not null or new.purchase_date is not null or new.payment_method='credit_card') then raise exception 'card_link_required';end if;
 end if;
 if new.card_invoice_id is not null then
  select * into i from public.nc_card_invoices where id=new.card_invoice_id;
  if not found or i.card_id<>new.credit_card_id or i.household_id<>new.household_id or i.due_date<>new.date then raise exception 'invalid_invoice';end if;
  if new.confirmed and new.payer is distinct from i.payer then raise exception 'pay_invoice_instead';end if;
  if new.confirmed is distinct from (i.paid_at is not null) then raise exception 'pay_invoice_instead';end if;
  if tg_op='INSERT' and i.paid_at is not null then raise exception 'invoice_paid';end if;
 end if;
 return new;
end $$;

create function nossa_conta_private.edit_entry_payment(p_id text,p_entry jsonb,p_future boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();e public.nc_entries;paid boolean;paid_by text;origin_card uuid;
begin
 if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for update;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 if e.rule_id is not null then select credit_card_id into origin_card from public.nc_recurring_rules where id=e.rule_id and household_id=h;end if;
 if origin_card is not null and coalesce(p_future,false) then raise exception 'payment_change_current_only';end if;
 if e.card_invoice_id is null then
  perform nossa_conta_private.edit_entry(p_id,p_entry,p_future);
 else
  if p_entry->>'paymentMethod'='credit_card' then raise exception 'card_link_required';end if;
  if exists(select 1 from public.nc_card_invoices where id=e.card_invoice_id and paid_at is not null) then raise exception 'invoice_paid';end if;
  perform nossa_conta_private.validate_entry(p_entry||jsonb_build_object('kind',e.kind));
  if p_entry->>'paymentMethod' is not null and p_entry->>'paymentMethod' not in ('pix','cash','debit_card','bank_slip','transfer','other') then raise exception 'invalid_payment_method';end if;
  paid:=coalesce((p_entry->>'confirmed')::boolean,false);
  paid_by:=case when paid then coalesce(nullif(trim(p_entry->>'payer'),''),(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
  update public.nc_entries set description=trim(p_entry->>'description'),amount=(p_entry->>'amount')::bigint,
   category=trim(p_entry->>'category'),person=trim(p_entry->>'person'),date=(p_entry->>'date')::date,
   payment_method=p_entry->>'paymentMethod',credit_card_id=null,card_invoice_id=null,purchase_date=null,
   confirmed=paid,confirmed_at=case when paid then now() else null end,payer=paid_by where id=e.id;
 end if;
 return (select to_jsonb(row) from public.nc_entries row where id=e.id);
end $$;
create function public.nc_edit_entry_payment(p_id text,p_entry jsonb,p_future boolean default false) returns jsonb language sql security invoker set search_path='' as $$select nossa_conta_private.edit_entry_payment(p_id,p_entry,p_future)$$;
revoke all on function nossa_conta_private.edit_entry_payment(text,jsonb,boolean),public.nc_edit_entry_payment(text,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.edit_entry_payment(text,jsonb,boolean),public.nc_edit_entry_payment(text,jsonb,boolean) to authenticated;
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
  if e.kind<>'expense' or (e.rule_id is not null and not exists(select 1 from public.nc_recurring_rules where id=e.rule_id and household_id=h and credit_card_id is not null)) then raise exception 'invalid_card_purchase';end if;
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


create or replace function nossa_conta_private.edit_card_recurrence(p_id text,p_entry jsonb) returns jsonb
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
  m:=(date_trunc('month',coalesce(e.purchase_date,(split_part(e.id,':',2)||'-01')::date))+interval '1 month')::date;
  insert into public.nc_recurring_amounts(rule_id,effective_month,amount,payment_method)
  values(e.rule_id,m,(p_entry->>'amount')::bigint,'credit_card') on conflict(rule_id,effective_month) do update set amount=excluded.amount;
  update public.nc_entries set amount=(p_entry->>'amount')::bigint where rule_id=e.rule_id and purchase_date>=m and not confirmed and deleted_at is null;
 end if;
 return result;
end $$;
create or replace function nossa_conta_private.stop_recurring(p_id text) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();e public.nc_entries;m date;origin_card uuid;
begin
 if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for update;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null;
 if not found or e.rule_id is null then raise exception 'recurrence_not_found';end if;
 select credit_card_id into origin_card from public.nc_recurring_rules where id=e.rule_id and household_id=h;
 m:=case when origin_card is not null then (split_part(e.id,':',2)||'-01')::date else date_trunc('month',e.date)::date end;
 update public.nc_recurring_rules set end_month=least(coalesce(end_month,m),m) where id=e.rule_id and household_id=h;
 if origin_card is not null then
  update public.nc_entries set deleted_at=now() where rule_id=e.rule_id and (split_part(id,':',2)||'-01')::date>=(m+interval '1 month')::date and not confirmed and deleted_at is null;
 end if;
end $$;
