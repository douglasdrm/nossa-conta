create or replace function nossa_conta_private.entry_profile_colors(p_start date,p_end date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with household as (select nossa_conta_private.current_household() as id),
  colors as (
    select m.user_id, coalesce(p.color,
      (array['green','blue','violet','rose','amber','teal'])[
        ((row_number() over (order by m.created_at,m.user_id)-1)%6+1)::int
      ]) as color,
      coalesce(
        case when lower(trim(p.display_name)) not in (
          coalesce(lower(p.username),''), lower(split_part(coalesce(u.email,''),'@',1))
        ) then nullif(trim(p.display_name),'') end,
        nullif(trim(u.raw_user_meta_data->>'full_name'),''),
        nullif(trim(u.raw_user_meta_data->>'name'),''),
        nullif(trim(u.raw_user_meta_data->>'display_name'),''),
        nullif(trim(p.display_name),'')
      ) as name
    from public.nc_household_members m
    join household h on h.id=m.household_id
    join auth.users u on u.id=m.user_id
    left join public.nc_user_profiles p on p.user_id=m.user_id
  ), entries as (
    select e.id,e.person,e.payer,e.payer_user_id,e.household_id
    from public.nc_entries e join household h on h.id=e.household_id
    where e.date>=p_start and e.date<p_end and e.deleted_at is null
      and p_end=p_start+interval '1 month' and extract(day from p_start)=1
  ), aliases as (
    select distinct e.household_id, label
    from entries e cross join lateral unnest(array[e.person,e.payer]) label
    where label is not null
  ), resolved as materialized (
    select label,nossa_conta_private.resolve_payer(household_id,label) as user_id
    from aliases
  )
  select coalesce(jsonb_object_agg(e.id,jsonb_build_object(
    'person',person_color.color,
    'payer',payer_color.color,
    'person_name',person_color.name,
    'payer_name',payer_color.name,
    'same_person',person_color.user_id=payer_color.user_id
  )),'{}'::jsonb)
  from entries e
  left join resolved person on person.label=e.person
  left join resolved payer on payer.label=e.payer
  left join colors person_color on person_color.user_id=person.user_id
  left join colors payer_color on payer_color.user_id=coalesce(e.payer_user_id,payer.user_id);
$$;
