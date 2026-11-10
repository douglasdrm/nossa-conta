alter table public.nc_categories add column default_name text;
create unique index nc_categories_default_name_unique on public.nc_categories(household_id,kind,default_name)
  where default_name is not null;

create or replace function nossa_conta_private.rename_category(p_kind text, p_old_name text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := nossa_conta_private.current_household();
  c public.nc_categories;
  builtins text[];
  clean text := trim(p_name);
begin
  if h is null then raise exception 'membership_required'; end if;
  if clean is null or length(clean) not between 1 and 60 then
    raise exception 'invalid_category';
  end if;

  builtins := case p_kind
    when 'expense' then array['Mercado','Moradia','Alimentação','Transporte','Saúde','Lazer','Compras','Educação','Contas e serviços','Outros']
    when 'income' then array['Salário','Freelance','Rendimentos','Outras receitas']
    else array[]::text[] end;

  perform 1 from public.nc_households where id = h for update;
  select * into c from public.nc_categories
    where household_id = h and kind = p_kind and name = p_old_name for update;
  if p_old_name = any(builtins) then
    if exists (select 1 from public.nc_categories
      where household_id = h and kind = p_kind and default_name = p_old_name and name <> p_old_name)
    then raise exception 'category_not_found'; end if;
    insert into public.nc_categories(household_id,kind,name,created_by,default_name,budget_group)
    values(h,p_kind,p_old_name,auth.uid(),p_old_name,case
      when p_kind = 'income' then null
      when p_old_name = 'Educação' then 'development'
      when p_old_name in ('Lazer','Compras','Outros') then 'leisure'
      else 'essentials' end)
    on conflict do nothing;
    update public.nc_categories set default_name = p_old_name
      where household_id = h and kind = p_kind and lower(name) = lower(p_old_name)
      returning * into c;
  end if;
  if c.id is null then raise exception 'category_not_found'; end if;
  if exists (select 1 from unnest(builtins) label
     where lower(label) = lower(clean) and label is distinct from c.default_name)
  then raise exception 'category_name_taken'; end if;
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

create function nossa_conta_private.edit_category(p_kind text,p_old_name text,p_name text,p_budget_group text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  h uuid := nossa_conta_private.current_household();
begin
  if p_budget_group is not null and
     (p_kind <> 'expense' or p_budget_group not in ('essentials','future','leisure','development'))
  then raise exception 'invalid_budget_group'; end if;

  result := nossa_conta_private.rename_category(p_kind,p_old_name,p_name);
  if p_budget_group is not null then
    update public.nc_categories set budget_group = p_budget_group
      where household_id = h and kind = p_kind and name = result->>'name';
    update public.nc_budget_plan set categories = categories - (result->>'name')
      where household_id = h and categories ? (result->>'name');
  end if;
  return result;
end $$;
revoke all on function nossa_conta_private.edit_category(text,text,text,text) from public,anon,authenticated;
grant execute on function nossa_conta_private.edit_category(text,text,text,text) to authenticated;

create function public.nc_edit_category(p_kind text,p_old_name text,p_name text,p_budget_group text)
returns jsonb language sql security invoker set search_path = '' as $$
  select nossa_conta_private.edit_category(p_kind,p_old_name,p_name,p_budget_group)
$$;
revoke all on function public.nc_edit_category(text,text,text,text) from public,anon,authenticated;
grant execute on function public.nc_edit_category(text,text,text,text) to authenticated;

-- Open forms can still submit a built-in category's original label.
create function nossa_conta_private.resolve_default_category()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.category := coalesce(
    (select c.name from public.nc_categories c
      where c.household_id = new.household_id and c.kind = new.kind
        and c.default_name = new.category),
    new.category
  );
  return new;
end $$;
revoke all on function nossa_conta_private.resolve_default_category() from public,anon,authenticated;

create trigger nc_resolve_default_entry_category
before insert or update of category on public.nc_entries
for each row execute function nossa_conta_private.resolve_default_category();

create trigger nc_resolve_default_rule_category
before insert or update of category on public.nc_recurring_rules
for each row execute function nossa_conta_private.resolve_default_category();
