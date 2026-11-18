-- Card purchases remain ordinary expense rows, dated by invoice maturity.
-- Paying an invoice settles its rows; it never inserts a second expense.
create table public.nc_credit_cards (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.nc_households(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 60), closing_day integer not null check(closing_day between 1 and 31),
 due_day integer not null check(due_day between 1 and 31), closing_estimated boolean not null default false,
 archived boolean not null default false, created_by uuid not null, created_at timestamptz not null default now(), unique(id,household_id)
);
create table public.nc_card_invoices (
 id uuid primary key default gen_random_uuid(), household_id uuid not null,
 card_id uuid not null, invoice_month date not null check(invoice_month=date_trunc('month',invoice_month)::date and invoice_month>='2000-01-01' and invoice_month<'2100-01-01'),
 due_date date not null check(date_trunc('month',due_date)::date=invoice_month), paid_at timestamptz, payer text,
 foreign key(card_id,household_id) references public.nc_credit_cards(id,household_id) on delete cascade,
 unique(card_id,invoice_month), unique(id,card_id,household_id)
);
alter table public.nc_entries add column credit_card_id uuid, add column card_invoice_id uuid, add column purchase_date date;
alter table public.nc_entries add constraint nc_entry_card_invoice_fk foreign key(card_invoice_id,credit_card_id,household_id) references public.nc_card_invoices(id,card_id,household_id);
alter table public.nc_entries add constraint nc_entry_card_fields check(
 (credit_card_id is null and card_invoice_id is null and purchase_date is null) or
 (credit_card_id is not null and card_invoice_id is not null and purchase_date is not null and purchase_date>='2000-01-01' and purchase_date<'2100-01-01' and kind='expense' and payment_method='credit_card' and rule_id is null)
);
create index nc_cards_household on public.nc_credit_cards(household_id);
create index nc_invoices_household on public.nc_card_invoices(household_id,invoice_month);
create index nc_entry_invoice on public.nc_entries(card_invoice_id) where card_invoice_id is not null;
create index nc_entry_card_household on public.nc_entries(credit_card_id,household_id) where credit_card_id is not null;
alter table public.nc_credit_cards enable row level security;
alter table public.nc_card_invoices enable row level security;
revoke all on public.nc_credit_cards,public.nc_card_invoices from public,anon,authenticated;
grant select on public.nc_credit_cards,public.nc_card_invoices to authenticated;
create policy cards_read on public.nc_credit_cards for select to authenticated using(household_id=(select nossa_conta_private.current_household()));
create policy invoices_read on public.nc_card_invoices for select to authenticated using(household_id=(select nossa_conta_private.current_household()));

create function nossa_conta_private.card_day(p_month date,p_day integer) returns date
language sql immutable set search_path='' as $$
 select date_trunc('month',p_month)::date+(least(p_day,extract(day from date_trunc('month',p_month)+interval '1 month - 1 day')::integer)-1)
$$;
create function nossa_conta_private.card_first_due(p_purchase date,p_close integer,p_due integer) returns date
language plpgsql immutable set search_path='' as $$
declare m date:=date_trunc('month',p_purchase)::date;
begin
 if p_purchase>nossa_conta_private.card_day(m,p_close) then m:=(m+interval '1 month')::date; end if;
 if p_due<=p_close then m:=(m+interval '1 month')::date; end if;
 return nossa_conta_private.card_day(m,p_due);
end $$;
create function nossa_conta_private.card_invoice(p_card uuid,p_month date) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.nc_credit_cards; i public.nc_card_invoices; h uuid:=nossa_conta_private.current_household();
begin
 if h is null then raise exception 'membership_required';end if;
 select * into c from public.nc_credit_cards where id=p_card and household_id=h;
 if not found then raise exception 'card_not_found';end if;
 insert into public.nc_card_invoices(household_id,card_id,invoice_month,due_date)
 values(h,c.id,p_month,nossa_conta_private.card_day(p_month,c.due_day)) on conflict(card_id,invoice_month) do nothing;
 select * into i from public.nc_card_invoices where card_id=c.id and invoice_month=p_month for update;
 if i.paid_at is not null then raise exception 'invoice_paid';end if;
 return i.id;
end $$;
create function nossa_conta_private.save_credit_card(p_card jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();c public.nc_credit_cards;
begin
 if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for update;
 if length(trim(coalesce(p_card->>'name',''))) not between 1 and 60 or
    coalesce(p_card->>'dueDay','') !~ '^[0-9]{1,2}$' or coalesce(p_card->>'closingDay','') !~ '^[0-9]{1,2}$' then raise exception 'invalid_card';end if;
 if nullif(p_card->>'id','') is null then
  insert into public.nc_credit_cards(household_id,name,due_day,closing_day,closing_estimated,created_by)
  values(h,trim(p_card->>'name'),(p_card->>'dueDay')::integer,(p_card->>'closingDay')::integer,coalesce((p_card->>'closingEstimated')::boolean,false),auth.uid()) returning * into c;
 else
  update public.nc_credit_cards set name=trim(p_card->>'name'),due_day=(p_card->>'dueDay')::integer,
   closing_day=(p_card->>'closingDay')::integer,closing_estimated=coalesce((p_card->>'closingEstimated')::boolean,false),archived=coalesce((p_card->>'archived')::boolean,false)
  where id=(p_card->>'id')::uuid and household_id=h returning * into c;
  if not found then raise exception 'card_not_found';end if;
 end if;
 return to_jsonb(c);
end $$;

create function nossa_conta_private.card_entry_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.nc_card_invoices; paid boolean;
begin
 if tg_op='UPDATE' and old.card_invoice_id is not null then
  select paid_at is not null into paid from public.nc_card_invoices where id=old.card_invoice_id;
  if paid and (new.description,new.amount,new.category,new.person,new.date,new.credit_card_id,new.card_invoice_id,new.purchase_date,new.deleted_at)
     is distinct from (old.description,old.amount,old.category,old.person,old.date,old.credit_card_id,old.card_invoice_id,old.purchase_date,old.deleted_at) then raise exception 'invoice_paid';end if;
  if new.card_invoice_id is null then raise exception 'card_link_required';end if;
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
create trigger nc_card_entry_guard before insert or update on public.nc_entries for each row execute function nossa_conta_private.card_entry_guard();

create function nossa_conta_private.save_card_purchase(p_entry jsonb,p_id text default null) returns jsonb
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
  if e.kind<>'expense' or e.rule_id is not null then raise exception 'invalid_card_purchase';end if;
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

create function nossa_conta_private.update_card_invoice(p_id uuid,p_action text,p_due date default null,p_payer text default null) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid:=nossa_conta_private.current_household();i public.nc_card_invoices;
begin
 if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for update;
 select * into i from public.nc_card_invoices where id=p_id and household_id=h for update;
 if not found then raise exception 'invoice_not_found';end if;
 if p_action='pay' then
  if i.paid_at is not null then return;end if;
  if length(trim(coalesce(p_payer,''))) not between 1 and 60 then raise exception 'invalid_payer';end if;
  if not exists(select 1 from public.nc_entries where card_invoice_id=i.id and deleted_at is null) then raise exception 'empty_invoice';end if;
  update public.nc_card_invoices set paid_at=now(),payer=trim(p_payer) where id=i.id;
  update public.nc_entries set confirmed=true,confirmed_at=now(),payer=trim(p_payer) where card_invoice_id=i.id and deleted_at is null;
 elsif p_action='reopen' then
  update public.nc_card_invoices set paid_at=null,payer=null where id=i.id;
  update public.nc_entries set confirmed=false,confirmed_at=null,payer=null where card_invoice_id=i.id and deleted_at is null;
 elsif p_action='due' then
  if i.paid_at is not null then raise exception 'invoice_paid';end if;
  if p_due is null or date_trunc('month',p_due)::date<>i.invoice_month then raise exception 'keep_invoice_month';end if;
  update public.nc_card_invoices set due_date=p_due where id=i.id;
  update public.nc_entries set date=p_due where card_invoice_id=i.id and deleted_at is null;
 else raise exception 'invalid_invoice_action';end if;
end $$;

create function public.nc_save_credit_card(p_card jsonb) returns jsonb language sql security invoker set search_path='' as $$select nossa_conta_private.save_credit_card(p_card)$$;
create function public.nc_save_card_purchase(p_entry jsonb,p_id text default null) returns jsonb language sql security invoker set search_path='' as $$select nossa_conta_private.save_card_purchase(p_entry,p_id)$$;
create function public.nc_update_card_invoice(p_id uuid,p_action text,p_due date default null,p_payer text default null) returns void language sql security invoker set search_path='' as $$select nossa_conta_private.update_card_invoice(p_id,p_action,p_due,p_payer)$$;
revoke all on function nossa_conta_private.card_day(date,integer),nossa_conta_private.card_first_due(date,integer,integer),nossa_conta_private.card_invoice(uuid,date),nossa_conta_private.card_entry_guard() from public,anon,authenticated,service_role;
revoke all on function nossa_conta_private.save_credit_card(jsonb),nossa_conta_private.save_card_purchase(jsonb,text),nossa_conta_private.update_card_invoice(uuid,text,date,text),public.nc_save_credit_card(jsonb),public.nc_save_card_purchase(jsonb,text),public.nc_update_card_invoice(uuid,text,date,text) from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.save_credit_card(jsonb),nossa_conta_private.save_card_purchase(jsonb,text),nossa_conta_private.update_card_invoice(uuid,text,date,text),public.nc_save_credit_card(jsonb),public.nc_save_card_purchase(jsonb,text),public.nc_update_card_invoice(uuid,text,date,text) to authenticated;
