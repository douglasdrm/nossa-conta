-- Existing recurrence rules remain expenses. New income rules use the same
-- versioned amounts, date clipping, household isolation and stop behavior.
alter table public.nc_recurring_rules
  add column kind text not null default 'expense'
  check (kind in ('income', 'expense'));

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
 select r.id::text||':'||to_char(m,'YYYY-MM'),h,r.kind,r.description,a.amount,r.category,r.person,
   m+(least(r.due_day,extract(day from (m+interval '1 month - 1 day'))::integer)-1),r.id,auth.uid(),false
 from public.nc_recurring_rules r
 cross join lateral(select amount from public.nc_recurring_amounts v where v.rule_id=r.id and v.effective_month<=m order by v.effective_month desc limit 1) a
 where r.household_id=h and r.start_month<=m and (r.end_month is null or r.end_month>=m)
 on conflict(id) do nothing;
end $$;

create or replace function nossa_conta_private.rename_category(p_kind text, p_old_name text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := nossa_conta_private.current_household();
  c public.nc_categories;
  clean text := trim(p_name);
begin
  if h is null then raise exception 'membership_required'; end if;
  if clean is null or length(clean) not between 1 and 60 then
    raise exception 'invalid_category';
  end if;

  perform 1 from public.nc_households where id = h for update;
  select * into c from public.nc_categories
    where household_id = h and kind = p_kind and name = p_old_name for update;
  if not found then raise exception 'category_not_found'; end if;
  if c.name = clean then
    return jsonb_build_object('kind', c.kind, 'name', c.name);
  end if;

  if lower(c.name) <> lower(clean) and (
    exists (select 1 from public.nc_categories
      where household_id = h and kind = c.kind and lower(name) = lower(clean))
    or exists (select 1 from public.nc_entries
      where household_id = h and kind = c.kind and lower(category) = lower(clean))
    or exists (select 1 from public.nc_recurring_rules
      where household_id = h and kind = c.kind and lower(category) = lower(clean))
  ) then raise exception 'category_name_taken'; end if;

  update public.nc_categories set name = clean where id = c.id;
  update public.nc_entries set category = clean
    where household_id = h and kind = c.kind and lower(category) = lower(c.name);
  update public.nc_recurring_rules set category = clean
    where household_id = h and kind = c.kind and lower(category) = lower(c.name);
  if c.kind = 'expense' then
    update public.nc_budget_plan
      set categories = (categories - c.name) || jsonb_build_object(clean, categories->c.name)
      where household_id = h and categories ? c.name;
  end if;

  return jsonb_build_object('kind', c.kind, 'name', clean);
end $$;
