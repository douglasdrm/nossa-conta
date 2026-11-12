-- Commercial records are separate from household financial entries.
create table public.nc_system_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.nc_system_admins enable row level security;
revoke all on public.nc_system_admins from public,anon,authenticated;
grant select on public.nc_system_admins to authenticated;
create policy admins_self on public.nc_system_admins for select to authenticated using(user_id=(select auth.uid()));

create function nossa_conta_private.is_system_admin() returns boolean
language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.nc_system_admins where user_id=auth.uid());
$$;
create function public.nc_is_system_admin() returns boolean language sql stable security invoker set search_path='' as $$select nossa_conta_private.is_system_admin()$$;
revoke all on function nossa_conta_private.is_system_admin(),public.nc_is_system_admin() from public,anon;
grant execute on function nossa_conta_private.is_system_admin(),public.nc_is_system_admin() to authenticated;

create table public.nc_leads (
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references auth.users(id) on delete set null,
 name text not null check(length(name) between 1 and 120),
 email text not null check(length(email) between 3 and 254),
 phone text not null default '' check(length(phone)<=40),
 stage text not null default 'new' check(stage in ('new','contacted','interested','subscriber','closed')),
 cycle text check(cycle in ('monthly','quarterly','yearly')),
 source text not null default 'direct' check(length(source)<=120),
 medium text not null default '' check(length(medium)<=120),
 campaign text not null default '' check(length(campaign)<=120),
 landing_path text not null default '/' check(length(landing_path)<=200),
 notes text not null default '' check(length(notes)<=2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 interested_at timestamptz
);
create unique index nc_leads_email_idx on public.nc_leads(lower(email));
create index nc_leads_created_idx on public.nc_leads(created_at desc);
alter table public.nc_leads enable row level security;
revoke all on public.nc_leads from public,anon,authenticated;
grant select on public.nc_leads to authenticated;
create policy leads_admin_read on public.nc_leads for select to authenticated using((select nossa_conta_private.is_system_admin()));

create table public.nc_subscriptions (
 household_id uuid primary key references public.nc_households(id) on delete cascade,
 kind text not null default 'courtesy' check(kind='courtesy'),
 valid_until timestamptz not null,
 reason text not null check(length(reason) between 3 and 300),
 granted_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create index nc_subscriptions_granted_by_idx on public.nc_subscriptions(granted_by);
alter table public.nc_subscriptions enable row level security;
revoke all on public.nc_subscriptions from public,anon,authenticated;
grant select on public.nc_subscriptions to authenticated;
create policy subscription_read on public.nc_subscriptions for select to authenticated using(
 (select nossa_conta_private.is_system_admin()) or household_id=(select nossa_conta_private.current_household())
);

create table public.nc_admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id) on delete set null,
 action text not null, target_id uuid, created_at timestamptz not null default now()
);
create index nc_admin_audit_actor_idx on public.nc_admin_audit(actor_id);
alter table public.nc_admin_audit enable row level security;
revoke all on public.nc_admin_audit from public,anon,authenticated;
grant select on public.nc_admin_audit to authenticated;
create policy audit_admin_read on public.nc_admin_audit for select to authenticated using((select nossa_conta_private.is_system_admin()));

create function nossa_conta_private.capture_lead(p_source text default 'direct',p_medium text default '',p_campaign text default '',p_landing text default '/',p_cycle text default null) returns void
language plpgsql security definer set search_path='' as $$
declare u auth.users; existing public.nc_leads;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 select * into u from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false);
 if u.id is null then raise exception 'confirmed_account_required'; end if;
 if p_cycle is not null and p_cycle not in ('monthly','quarterly','yearly') then raise exception 'invalid_cycle';end if;
 -- Serialize capture for the same account and normalize email for manual lead linking.
 perform pg_advisory_xact_lock(hashtextextended(u.id::text,1));
 select * into existing from public.nc_leads where user_id=u.id or lower(email)=lower(u.email) order by (user_id=u.id) desc nulls last limit 1;
 if existing.id is null then
  insert into public.nc_leads(user_id,name,email,source,medium,campaign,landing_path,cycle,stage,interested_at)
  values(u.id,left(coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'),''),split_part(u.email,'@',1)),120),lower(u.email),left(coalesce(nullif(trim(p_source),''),'direct'),120),left(coalesce(p_medium,''),120),left(coalesce(p_campaign,''),120),left(coalesce(p_landing,'/'),200),p_cycle,case when p_cycle is null then 'new' else 'interested' end,case when p_cycle is not null then now() end);
 else
  update public.nc_leads set user_id=u.id,email=lower(u.email),cycle=coalesce(p_cycle,cycle),
   stage=case when p_cycle is not null and stage='new' then 'interested' else stage end,
   interested_at=case when p_cycle is not null then now() else interested_at end,
   updated_at=case when p_cycle is not null or user_id is distinct from u.id then now() else updated_at end
  where id=existing.id;
 end if;
end $$;
create function public.nc_capture_lead(p_source text default 'direct',p_medium text default '',p_campaign text default '',p_landing text default '/',p_cycle text default null) returns void
language sql security invoker set search_path='' as $$select nossa_conta_private.capture_lead(p_source,p_medium,p_campaign,p_landing,p_cycle)$$;
revoke all on function nossa_conta_private.capture_lead(text,text,text,text,text),public.nc_capture_lead(text,text,text,text,text) from public,anon;
grant execute on function nossa_conta_private.capture_lead(text,text,text,text,text),public.nc_capture_lead(text,text,text,text,text) to authenticated;

create function nossa_conta_private.admin_data(p_search text default '',p_page integer default 1) returns jsonb
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
   select h.id,h.name,u.email as owner_email,h.created_at,(select count(*) from public.nc_household_members m where m.household_id=h.id) as members,s.valid_until,s.reason,
   case when s.valid_until>now() then 'courtesy' when s.valid_until is not null then 'expired' else 'free' end as status
   from public.nc_households h join auth.users u on u.id=h.owner_id left join public.nc_subscriptions s on s.household_id=h.id
   where h.name ilike search or u.email ilike search order by h.created_at desc,h.id limit 25 offset off
  )h),'[]'::jsonb),
  'household_count',(select count(*) from public.nc_households h join auth.users u on u.id=h.owner_id where h.name ilike search or u.email ilike search),
  'sources',coalesce((select jsonb_agg(to_jsonb(s)) from (select source,count(*) as registrations,count(*) filter(where cycle is not null) as interested from public.nc_leads group by source order by count(*) desc limit 20)s),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(to_jsonb(a)) from (select a.action,a.target_id,a.created_at,u.email as actor from public.nc_admin_audit a left join auth.users u on u.id=a.actor_id order by a.created_at desc limit 20)a),'[]'::jsonb)
 ) into result;
 return result;
end $$;
create function public.nc_admin_data(p_search text default '',p_page integer default 1) returns jsonb language sql stable security invoker set search_path='' as $$select nossa_conta_private.admin_data(p_search,p_page)$$;
revoke all on function nossa_conta_private.admin_data(text,integer),public.nc_admin_data(text,integer) from public,anon;
grant execute on function nossa_conta_private.admin_data(text,integer),public.nc_admin_data(text,integer) to authenticated;

create function nossa_conta_private.admin_save_lead(p_id uuid,p_name text,p_email text,p_phone text,p_stage text,p_notes text,p_source text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not nossa_conta_private.is_system_admin() then raise exception 'admin_required';end if;
 if p_id is null then
  insert into public.nc_leads(name,email,phone,stage,notes,source) values(trim(p_name),lower(trim(p_email)),trim(p_phone),p_stage,p_notes,coalesce(nullif(trim(p_source),''),'manual')) returning id into result;
 else
  update public.nc_leads set name=trim(p_name),email=lower(trim(p_email)),phone=trim(p_phone),stage=p_stage,notes=p_notes,updated_at=now() where id=p_id returning id into result;
  if result is null then raise exception 'lead_not_found';end if;
 end if;
 insert into public.nc_admin_audit(actor_id,action,target_id) values(auth.uid(),case when p_id is null then 'lead_created' else 'lead_updated' end,result);
 return result;
end $$;
create function public.nc_admin_save_lead(p_id uuid,p_name text,p_email text,p_phone text,p_stage text,p_notes text,p_source text) returns uuid language sql security invoker set search_path='' as $$select nossa_conta_private.admin_save_lead(p_id,p_name,p_email,p_phone,p_stage,p_notes,p_source)$$;
revoke all on function nossa_conta_private.admin_save_lead(uuid,text,text,text,text,text,text),public.nc_admin_save_lead(uuid,text,text,text,text,text,text) from public,anon;
grant execute on function nossa_conta_private.admin_save_lead(uuid,text,text,text,text,text,text),public.nc_admin_save_lead(uuid,text,text,text,text,text,text) to authenticated;

create function nossa_conta_private.admin_courtesy(p_household uuid,p_until timestamptz,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not nossa_conta_private.is_system_admin() then raise exception 'admin_required';end if;
 if p_until is null or p_until>now()+interval '5 years' then raise exception 'invalid_expiration';end if;
 insert into public.nc_subscriptions(household_id,valid_until,reason,granted_by) values(p_household,p_until,trim(p_reason),auth.uid())
 on conflict(household_id) do update set valid_until=excluded.valid_until,reason=excluded.reason,granted_by=excluded.granted_by,updated_at=now();
 insert into public.nc_admin_audit(actor_id,action,target_id) values(auth.uid(),case when p_until>now() then 'courtesy_granted' else 'courtesy_revoked' end,p_household);
end $$;
create function public.nc_admin_courtesy(p_household uuid,p_until timestamptz,p_reason text) returns void language sql security invoker set search_path='' as $$select nossa_conta_private.admin_courtesy(p_household,p_until,p_reason)$$;
revoke all on function nossa_conta_private.admin_courtesy(uuid,timestamptz,text),public.nc_admin_courtesy(uuid,timestamptz,text) from public,anon;
grant execute on function nossa_conta_private.admin_courtesy(uuid,timestamptz,text),public.nc_admin_courtesy(uuid,timestamptz,text) to authenticated;
