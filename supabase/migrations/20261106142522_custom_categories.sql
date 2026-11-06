-- Categories belong only to a Nossa Conta household, separated by entry kind.
create table public.nc_categories (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.nc_households(id) on delete cascade,
 kind text not null check(kind in ('income','expense')),
 name text not null check(length(trim(name)) between 1 and 60),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create unique index nc_categories_household_kind_name on public.nc_categories(household_id,kind,lower(name));
alter table public.nc_categories enable row level security;
create policy categories_read on public.nc_categories for select to authenticated
 using (((select auth.jwt()->>'is_anonymous')::boolean is false) and household_id=(select nossa_conta_private.current_household()));
revoke all on public.nc_categories from public,anon,authenticated;
grant select on public.nc_categories to authenticated;
create function nossa_conta_private.add_category(p_kind text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid;c public.nc_categories;clean text:=trim(p_name);
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 if p_kind is null or p_kind not in ('income','expense') or clean is null or length(clean) not between 1 and 60 then raise exception 'invalid_category';end if;
 perform 1 from public.nc_households where id=h for share;
 insert into public.nc_categories(household_id,kind,name,created_by) values(h,p_kind,clean,auth.uid()) on conflict do nothing;
 select * into c from public.nc_categories where household_id=h and kind=p_kind and lower(name)=lower(clean);
 return jsonb_build_object('kind',c.kind,'name',c.name);
end $$;
revoke all on function nossa_conta_private.add_category(text,text) from public,anon,authenticated;
grant execute on function nossa_conta_private.add_category(text,text) to authenticated;
create function public.nc_add_category(p_kind text,p_name text) returns jsonb
language sql security invoker set search_path='' as $$select nossa_conta_private.add_category(p_kind,p_name)$$;
revoke all on function public.nc_add_category(text,text) from public,anon,authenticated;
grant execute on function public.nc_add_category(text,text) to authenticated;
