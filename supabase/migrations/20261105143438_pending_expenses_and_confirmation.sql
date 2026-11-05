-- Preserve the status of all existing records. No existing expense is silently reopened.
alter table public.nc_entries add column confirmed boolean not null default true;
alter table public.nc_entries add column confirmed_at timestamptz;
alter table public.nc_entries add column payer text check(payer is null or length(trim(payer)) between 1 and 60);
alter table public.nc_entries add constraint nc_income_always_confirmed check(kind<>'income' or confirmed);
create index nc_entries_unconfirmed_due_idx on public.nc_entries(household_id,date) where kind='expense' and not confirmed and deleted_at is null;

create or replace function nossa_conta_private.add_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid;rid uuid;eid text;d date;outrow public.nc_entries;paid boolean;paid_by text;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for share;
 perform nossa_conta_private.validate_entry(p_entry);d:=(p_entry->>'date')::date;
 eid:=gen_random_uuid()::text;
 paid:=case when p_entry->>'kind'='income' then true else coalesce((p_entry->>'confirmed')::boolean,true) end;
 paid_by:=case when paid and p_entry->>'kind'='expense' then coalesce(nullif(trim(p_entry->>'payer'),''),(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
 if coalesce((p_entry->>'repeats')::boolean,false) then
   if p_entry->>'kind'<>'expense' then raise exception 'only_expenses_repeat';end if;
   insert into public.nc_recurring_rules(household_id,description,category,person,start_month,due_day,created_by)
   values(h,trim(p_entry->>'description'),trim(p_entry->>'category'),trim(p_entry->>'person'),date_trunc('month',d)::date,extract(day from d)::integer,auth.uid()) returning id into rid;
   insert into public.nc_recurring_amounts(rule_id,effective_month,amount) values(rid,date_trunc('month',d)::date,(p_entry->>'amount')::bigint);
   eid:=rid::text||':'||to_char(d,'YYYY-MM');
 end if;
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed,confirmed_at,payer)
 values(eid,h,p_entry->>'kind',trim(p_entry->>'description'),(p_entry->>'amount')::bigint,trim(p_entry->>'category'),trim(p_entry->>'person'),d,rid,auth.uid(),paid,case when paid then now() else null end,paid_by) returning * into outrow;
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
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed)
 select r.id::text||':'||to_char(m,'YYYY-MM'),h,'expense',r.description,a.amount,r.category,r.person,
   m+(least(r.due_day,extract(day from (m+interval '1 month - 1 day'))::integer)-1),r.id,auth.uid(),false
 from public.nc_recurring_rules r
 cross join lateral(select amount from public.nc_recurring_amounts v where v.rule_id=r.id and v.effective_month<=m order by v.effective_month desc limit 1) a
 where r.household_id=h and r.start_month<=m and (r.end_month is null or r.end_month>=m)
 on conflict(id) do nothing;
end $$;

create or replace function nossa_conta_private.edit_entry(p_id text,p_entry jsonb,p_future boolean) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;e public.nc_entries;d date;paid boolean;paid_by text;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 perform nossa_conta_private.validate_entry(p_entry||jsonb_build_object('kind',e.kind));
 d:=(p_entry->>'date')::date;
 paid:=case when e.kind='income' then true else coalesce((p_entry->>'confirmed')::boolean,e.confirmed) end;
 paid_by:=case when paid and e.kind='expense' then coalesce(nullif(trim(p_entry->>'payer'),''),e.payer,(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
 if date_trunc('month',d)<>date_trunc('month',e.date) then raise exception 'keep_original_month';end if;
 update public.nc_entries set description=trim(p_entry->>'description'),amount=(p_entry->>'amount')::bigint,category=trim(p_entry->>'category'),person=trim(p_entry->>'person'),date=d,payer=paid_by,confirmed=paid,confirmed_at=case when not paid then null when not e.confirmed then now() else e.confirmed_at end where id=e.id;
 if coalesce(p_future,false) and e.rule_id is not null then
   -- New defaults start NEXT month. Historical months retain their correct default,
   -- including historical occurrences which have never been opened/materialized.
   perform 1 from public.nc_recurring_rules where id=e.rule_id for update;
   insert into public.nc_recurring_amounts(rule_id,effective_month,amount)
   values(e.rule_id,(date_trunc('month',e.date)+interval '1 month')::date,(p_entry->>'amount')::bigint)
   on conflict(rule_id,effective_month) do update set amount=excluded.amount;
 end if;
end $$;

create function nossa_conta_private.confirm_entry(p_id text,p_confirmed boolean,p_payer text default null) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;e public.nc_entries;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 if p_confirmed is null then raise exception 'invalid_confirmation';end if;
 select * into e from public.nc_entries where id=p_id and household_id=h and kind='expense' and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 update public.nc_entries set confirmed=p_confirmed,payer=case when p_confirmed then coalesce(nullif(trim(p_payer),''),e.payer,(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end,confirmed_at=case when p_confirmed then now() else null end where id=e.id and confirmed is distinct from p_confirmed;
end $$;
create function public.nc_confirm_entry(p_id text,p_confirmed boolean default true,p_payer text default null) returns void language sql security invoker set search_path='' as $$select nossa_conta_private.confirm_entry(p_id,p_confirmed,p_payer)$$;
revoke execute on function nossa_conta_private.confirm_entry(text,boolean,text) from public,anon;
grant execute on function nossa_conta_private.confirm_entry(text,boolean,text) to authenticated;
revoke execute on function public.nc_confirm_entry(text,boolean,text) from public,anon;
grant execute on function public.nc_confirm_entry(text,boolean,text) to authenticated;
