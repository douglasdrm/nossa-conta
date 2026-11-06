-- Additive change confined to Nossa Conta. Existing entries remain unchanged.
alter table public.nc_entries
  add column installment_group uuid,
  add column installment_number integer,
  add column installment_count integer;
alter table public.nc_entries add constraint nc_installment_metadata check (
  (installment_group is null and installment_number is null and installment_count is null)
  or (installment_group is not null and installment_number is not null and installment_count is not null
      and installment_count between 2 and 120 and installment_number between 1 and installment_count
      and kind='expense' and rule_id is null)
);
create unique index nc_entries_installment_unique on public.nc_entries(household_id,installment_group,installment_number)
  where installment_group is not null;

create function nossa_conta_private.add_installments(p_entry jsonb) returns jsonb
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
      confirmed,confirmed_at,payer,installment_group,installment_number,installment_count)
    values(g::text||'-'||i,h,'expense',trim(p_entry->>'description'),base+case when i<=extra then 1 else 0 end,
      trim(p_entry->>'category'),trim(p_entry->>'person'),due_date,auth.uid(),
      paid and i=1,case when paid and i=1 then now() else null end,case when paid and i=1 then paid_by else null end,g,i,n);
  end loop;
  return jsonb_build_object('id',g::text||'-1','installment_count',n,'total',total);
end $$;
revoke all on function nossa_conta_private.add_installments(jsonb) from public,anon,authenticated;
grant execute on function nossa_conta_private.add_installments(jsonb) to authenticated;
create function public.nc_add_installments(p_entry jsonb) returns jsonb
language sql security invoker set search_path='' as $$select nossa_conta_private.add_installments(p_entry)$$;
revoke all on function public.nc_add_installments(jsonb) from public,anon,authenticated;
grant execute on function public.nc_add_installments(jsonb) to authenticated;
