alter table public.nc_entries add column payment_method text
  check (payment_method is null or (kind='expense' and payment_method in ('pix','cash','credit_card','debit_card','bank_slip','transfer','other')));
alter table public.nc_recurring_amounts add column payment_method text
  check (payment_method in ('pix','cash','credit_card','debit_card','bank_slip','transfer','other'));

create or replace function nossa_conta_private.add_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid;rid uuid;eid text;d date;outrow public.nc_entries;paid boolean;paid_by text;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for share;
 perform nossa_conta_private.validate_entry(p_entry);d:=(p_entry->>'date')::date;
 eid:=gen_random_uuid()::text;
 paid:=coalesce((p_entry->>'confirmed')::boolean,true);
 paid_by:=case when paid and p_entry->>'kind'='expense' then coalesce(nullif(trim(p_entry->>'payer'),''),(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
 if coalesce((p_entry->>'repeats')::boolean,false) then
   insert into public.nc_recurring_rules(household_id,kind,description,category,person,start_month,due_day,created_by)
   values(h,p_entry->>'kind',trim(p_entry->>'description'),trim(p_entry->>'category'),trim(p_entry->>'person'),date_trunc('month',d)::date,extract(day from d)::integer,auth.uid()) returning id into rid;
   insert into public.nc_recurring_amounts(rule_id,effective_month,amount,payment_method) values(rid,date_trunc('month',d)::date,(p_entry->>'amount')::bigint,p_entry->>'paymentMethod');
   eid:=rid::text||':'||to_char(d,'YYYY-MM');
 end if;
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed,confirmed_at,payer,payment_method)
 values(eid,h,p_entry->>'kind',trim(p_entry->>'description'),(p_entry->>'amount')::bigint,trim(p_entry->>'category'),trim(p_entry->>'person'),d,rid,auth.uid(),paid,case when paid then now() else null end,paid_by,p_entry->>'paymentMethod') returning * into outrow;
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
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed,payment_method)
 select r.id::text||':'||to_char(m,'YYYY-MM'),h,r.kind,r.description,a.amount,r.category,r.person,
   m+(least(r.due_day,extract(day from (m+interval '1 month - 1 day'))::integer)-1),r.id,auth.uid(),false,a.payment_method
 from public.nc_recurring_rules r
 cross join lateral(select amount,payment_method from public.nc_recurring_amounts v where v.rule_id=r.id and v.effective_month<=m order by v.effective_month desc limit 1) a
 where r.household_id=h and r.start_month<=m and (r.end_month is null or r.end_month>=m)
 on conflict(id) do nothing;
end $$;

create or replace function nossa_conta_private.edit_entry(p_id text,p_entry jsonb,p_future boolean) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;e public.nc_entries;d date;paid boolean;paid_by text;next_month date;next_method text;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 perform nossa_conta_private.validate_entry(p_entry||jsonb_build_object('kind',e.kind));
 d:=(p_entry->>'date')::date;
 paid:=coalesce((p_entry->>'confirmed')::boolean,e.confirmed);
 paid_by:=case when paid and e.kind='expense' then coalesce(nullif(trim(p_entry->>'payer'),''),e.payer,(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
 if date_trunc('month',d)<>date_trunc('month',e.date) then raise exception 'keep_original_month';end if;
 update public.nc_entries set description=trim(p_entry->>'description'),amount=(p_entry->>'amount')::bigint,category=trim(p_entry->>'category'),person=trim(p_entry->>'person'),date=d,payer=paid_by,payment_method=case when p_entry ? 'paymentMethod' then p_entry->>'paymentMethod' else e.payment_method end,confirmed=paid,confirmed_at=case when not paid then null when not e.confirmed then now() else e.confirmed_at end where id=e.id;
 if coalesce(p_future,false) and e.rule_id is not null then
   -- New defaults start NEXT month. Historical months retain their correct default,
   -- including historical occurrences which have never been opened/materialized.
   perform 1 from public.nc_recurring_rules where id=e.rule_id for update;
   next_month:=(date_trunc('month',e.date)+interval '1 month')::date;
   if p_entry ? 'paymentMethod' then
     next_method:=p_entry->>'paymentMethod';
   else
     select payment_method into next_method from public.nc_recurring_amounts
     where rule_id=e.rule_id and effective_month<=next_month
     order by effective_month desc limit 1;
   end if;
   insert into public.nc_recurring_amounts(rule_id,effective_month,amount,payment_method)
   values(e.rule_id,next_month,(p_entry->>'amount')::bigint,next_method)
   on conflict(rule_id,effective_month) do update set amount=excluded.amount,payment_method=excluded.payment_method;
 end if;
end $$;

create or replace function nossa_conta_private.add_installments(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid;g uuid;n integer;mode text;total bigint;base bigint;extra integer;
  first_date date;m date;due_date date;i integer;paid boolean;paid_by text;existing text;
begin
  h:=nossa_conta_private.current_household();
  if h is null then raise exception 'membership_required';end if;
  perform nossa_conta_private.validate_entry(p_entry);
  if p_entry->>'kind'<>'expense' or coalesce((p_entry->>'repeats')::boolean,false)
    or coalesce(p_entry->>'installmentCount','') !~ '^[0-9]{1,3}$'
    or coalesce(p_entry->>'installmentMode','') not in ('total','per_installment')
    or p_entry->>'installmentGroup' is null then raise exception 'invalid_installments';end if;
  n:=(p_entry->>'installmentCount')::integer;
  if n not between 2 and 120 then raise exception 'invalid_installments';end if;
  g:=(p_entry->>'installmentGroup')::uuid;
  mode:=p_entry->>'installmentMode';
  total:=(p_entry->>'amount')::bigint * case when mode='per_installment' then n else 1 end;
  if total<n or total>1000000000 then raise exception 'invalid_installment_total';end if;
  first_date:=(p_entry->>'date')::date;
  if date_trunc('month',first_date)+(n-1)*interval '1 month'>='2100-01-01'::date then raise exception 'invalid_installment_date';end if;
  -- Serialize with shared-household membership changes and duplicate submissions.
  perform 1 from public.nc_households where id=h for update;
  select id into existing from public.nc_entries where household_id=h and installment_group=g and installment_number=1;
  if existing is not null then return jsonb_build_object('id',existing,'already_created',true);end if;
  base:=total/n;extra:=(total%n)::integer;
  paid:=coalesce((p_entry->>'confirmed')::boolean,false);
  paid_by:=case when paid then coalesce(nullif(trim(p_entry->>'payer'),''),(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
  for i in 1..n loop
    -- Always use the original day: Jan 31 -> Feb 28 -> Mar 31 (no day drift).
    m:=(date_trunc('month',first_date)+(i-1)*interval '1 month')::date;
    due_date:=m+(least(extract(day from first_date)::integer,extract(day from m+interval '1 month - 1 day')::integer)-1);
    insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,created_by,
      confirmed,confirmed_at,payer,installment_group,installment_number,installment_count,payment_method)
    values(g::text||'-'||i,h,'expense',trim(p_entry->>'description'),base+case when i<=extra then 1 else 0 end,
      trim(p_entry->>'category'),trim(p_entry->>'person'),due_date,auth.uid(),
      paid and i=1,case when paid and i=1 then now() else null end,case when paid and i=1 then paid_by else null end,g,i,n,p_entry->>'paymentMethod');
  end loop;
  return jsonb_build_object('id',g::text||'-1','installment_count',n,'total',total);
end $$;
