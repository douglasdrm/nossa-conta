alter table public.nc_categories add column budget_group text
  check (budget_group is null or (
    kind = 'expense' and budget_group in ('essentials','future','leisure','development')
  ));

create function nossa_conta_private.add_category(p_kind text, p_name text, p_budget_group text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  category jsonb;
begin
  if (p_kind = 'expense' and (p_budget_group is null or p_budget_group not in ('essentials','future','leisure','development')))
     or (p_kind = 'income' and p_budget_group is not null)
  then raise exception 'invalid_budget_group'; end if;

  category := nossa_conta_private.add_category(p_kind, p_name);
  if p_kind = 'expense' then
    update public.nc_categories
    set budget_group = p_budget_group
    where household_id = nossa_conta_private.current_household()
      and kind = p_kind and name = category->>'name' and budget_group is null;
  end if;
  return category;
end $$;
revoke all on function nossa_conta_private.add_category(text,text,text) from public,anon,authenticated;
grant execute on function nossa_conta_private.add_category(text,text,text) to authenticated;

create function public.nc_add_category(p_kind text, p_name text, p_budget_group text)
returns jsonb language sql security invoker set search_path = '' as $$
  select nossa_conta_private.add_category(p_kind, p_name, p_budget_group)
$$;
revoke all on function public.nc_add_category(text,text,text) from public,anon,authenticated;
grant execute on function public.nc_add_category(text,text,text) to authenticated;
