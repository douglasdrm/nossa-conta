create function nossa_conta_private.rename_category(p_kind text, p_old_name text, p_name text)
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
    or (c.kind = 'expense' and exists (select 1 from public.nc_recurring_rules
      where household_id = h and lower(category) = lower(clean)))
  ) then raise exception 'category_name_taken'; end if;

  update public.nc_categories set name = clean where id = c.id;
  update public.nc_entries set category = clean
    where household_id = h and kind = c.kind and lower(category) = lower(c.name);
  if c.kind = 'expense' then
    update public.nc_recurring_rules set category = clean
      where household_id = h and lower(category) = lower(c.name);
    update public.nc_budget_plan
      set categories = (categories - c.name) || jsonb_build_object(clean, categories->c.name)
      where household_id = h and categories ? c.name;
  end if;

  return jsonb_build_object('kind', c.kind, 'name', clean);
end $$;
revoke all on function nossa_conta_private.rename_category(text,text,text) from public,anon,authenticated;
grant execute on function nossa_conta_private.rename_category(text,text,text) to authenticated;

create function public.nc_rename_category(p_kind text, p_old_name text, p_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select nossa_conta_private.rename_category(p_kind, p_old_name, p_name)
$$;
revoke all on function public.nc_rename_category(text,text,text) from public,anon,authenticated;
grant execute on function public.nc_rename_category(text,text,text) to authenticated;
