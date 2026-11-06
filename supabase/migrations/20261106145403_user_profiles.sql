-- Nossa Conta personal details are isolated from the Junto public profiles table.
create table public.nc_user_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=60),
 username text unique check(username is null or username ~ '^[a-z0-9_]{3,30}$'),
 avatar_path text,
 updated_at timestamptz not null default now(),
 check(avatar_path is null or avatar_path ~ ('^'||user_id::text||'/[a-f0-9-]+[.]webp$'))
);
alter table public.nc_user_profiles enable row level security;
create policy profile_read on public.nc_user_profiles for select to authenticated
 using(user_id=(select auth.uid()) and (select nossa_conta_private.current_household()) is not null);
revoke all on public.nc_user_profiles from public,anon,authenticated;
grant select on public.nc_user_profiles to authenticated;
create function nossa_conta_private.save_profile(p_name text,p_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n text:=trim(p_name);u text:=nullif(lower(trim(p_username)),'');r public.nc_user_profiles;
begin
 if nossa_conta_private.current_household() is null then raise exception 'membership_required';end if;
 if n is null or length(n) not between 1 and 60 or (u is not null and u !~ '^[a-z0-9_]{3,30}$') then raise exception 'invalid_profile';end if;
 insert into public.nc_user_profiles(user_id,display_name,username) values(auth.uid(),n,u)
 on conflict(user_id) do update set display_name=excluded.display_name,username=excluded.username,updated_at=now() returning * into r;
 return jsonb_build_object('display_name',r.display_name,'username',r.username);
end $$;
create function nossa_conta_private.set_avatar(p_path text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if nossa_conta_private.current_household() is null then raise exception 'membership_required';end if;
 if p_path is not null and p_path !~ ('^'||auth.uid()::text||'/[a-f0-9-]+[.]webp$') then raise exception 'invalid_avatar';end if;
 insert into public.nc_user_profiles(user_id,avatar_path) values(auth.uid(),p_path)
 on conflict(user_id) do update set avatar_path=excluded.avatar_path,updated_at=now();
end $$;
create function public.nc_save_profile(p_name text,p_username text default null) returns jsonb
language sql security invoker set search_path='' as $$select nossa_conta_private.save_profile(p_name,p_username)$$;
create function public.nc_set_avatar(p_path text) returns void
language sql security invoker set search_path='' as $$select nossa_conta_private.set_avatar(p_path)$$;
revoke all on function nossa_conta_private.save_profile(text,text),nossa_conta_private.set_avatar(text),public.nc_save_profile(text,text),public.nc_set_avatar(text) from public,anon,authenticated;
grant execute on function nossa_conta_private.save_profile(text,text),nossa_conta_private.set_avatar(text),public.nc_save_profile(text,text),public.nc_set_avatar(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('nc-avatars','nc-avatars',false,3145728,array['image/webp']);
create policy nc_avatars_own_read on storage.objects for select to authenticated
 using(bucket_id='nc-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select nossa_conta_private.current_household()) is not null);
create policy nc_avatars_own_insert on storage.objects for insert to authenticated
 with check(bucket_id='nc-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select nossa_conta_private.current_household()) is not null);
create policy nc_avatars_own_delete on storage.objects for delete to authenticated
 using(bucket_id='nc-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select nossa_conta_private.current_household()) is not null);
