create or replace function nossa_conta_private.admin_data(p_search text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; search text:='%'||left(coalesce(p_search,''),120)||'%'; off integer:=(greatest(1,least(coalesce(p_page,1),100000))-1)*25;
begin
 if auth.uid() is null or not nossa_conta_private.is_system_admin() then raise exception 'admin_required';end if;
 select jsonb_build_object(
  'summary',jsonb_build_object(
   'users',(select count(*) from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false)),
   'households',(select count(*) from public.nc_households),
   'leads',(select count(*) from public.nc_leads),
   'interested',(select count(*) from public.nc_leads where cycle is not null),
   'courtesies',(select count(*) from public.nc_subscriptions where valid_until>now()),
   'activated',(select count(distinct created_by) from public.nc_entries where deleted_at is null),
   'accepted_invites',(select count(*) from public.nc_household_invites where accepted_at is not null)
  ),
  'leads',coalesce((select jsonb_agg(to_jsonb(l)) from (select * from public.nc_leads where name ilike search or email ilike search or source ilike search order by created_at desc,id limit 25 offset off)l),'[]'::jsonb),
  'lead_count',(select count(*) from public.nc_leads where name ilike search or email ilike search or source ilike search),
  'users',coalesce((select jsonb_agg(to_jsonb(u)) from (
   select u.id,u.email,coalesce(p.display_name,split_part(u.email,'@',1)) as name,u.created_at,m.household_id,
   exists(select 1 from public.nc_entries e where e.created_by=u.id and e.deleted_at is null) as activated
   from auth.users u left join public.nc_user_profiles p on p.user_id=u.id left join public.nc_household_members m on m.user_id=u.id
   where u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.email ilike search or p.display_name ilike search)
   order by u.created_at desc,u.id limit 25 offset off
  )u),'[]'::jsonb),
  'user_count',(select count(*) from auth.users u left join public.nc_user_profiles p on p.user_id=u.id where u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.email ilike search or p.display_name ilike search)),
  'households',coalesce((select jsonb_agg(to_jsonb(h)) from (
   select h.id,h.name,u.email as owner_email,h.created_at,(select count(*) from public.nc_household_members m where m.household_id=h.id) as members,
   case when a.user_id is not null then null when paid.valid_until>now() then paid.valid_until when s.valid_until>now() then s.valid_until when trial.expires_at>now() then trial.expires_at else s.valid_until end as valid_until,
   s.reason,
   case when a.user_id is not null then 'admin' when paid.valid_until>now() then 'paid' when s.valid_until>now() then 'courtesy' when trial.expires_at>now() then 'trial' when s.valid_until is not null then 'expired' else 'free' end as status
   from public.nc_households h join auth.users u on u.id=h.owner_id
   left join public.nc_subscriptions s on s.household_id=h.id
   left join public.nc_system_admins a on a.user_id=h.owner_id
   left join nossa_conta_private.nc_account_trials trial on trial.user_id=h.owner_id
   left join lateral (
     select max(c.paid_until) as valid_until from nossa_conta_private.nc_production_charges c
     where c.household_id=h.id and c.provider_environment='production' and c.provider_name='asaas'
       and c.status in ('CONFIRMED','RECEIVED') and c.provider_verified_at is not null and c.paid_until>now()
   ) paid on true
   where h.name ilike search or u.email ilike search order by h.created_at desc,h.id limit 25 offset off
  )h),'[]'::jsonb),
  'household_count',(select count(*) from public.nc_households h join auth.users u on u.id=h.owner_id where h.name ilike search or u.email ilike search),
  'sources',coalesce((select jsonb_agg(to_jsonb(s)) from (select source,count(*) as registrations,count(*) filter(where cycle is not null) as interested from public.nc_leads group by source order by count(*) desc limit 20)s),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(to_jsonb(a)) from (select a.action,a.target_id,a.created_at,u.email as actor from public.nc_admin_audit a left join auth.users u on u.id=a.actor_id order by a.created_at desc limit 20)a),'[]'::jsonb)
 ) into result;
 return result;
end $$;
