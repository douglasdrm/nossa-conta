-- One private household per user. All amounts are integer centavos.
-- Privileged routines live in the non-exposed private schema, with explicit auth checks.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id),
  name text not null default 'Finanças da casa',
  created_at timestamptz not null default now()
);
create table public.household_members (
  user_id uuid primary key references auth.users(id),
  household_id uuid not null references public.households(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index household_members_household_idx on public.household_members(household_id);
create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  description text not null check(length(trim(description)) between 1 and 120),
  category text not null check(length(trim(category)) between 1 and 60),
  person text not null check(length(trim(person)) between 1 and 60),
  start_month date not null check(extract(day from start_month)=1),
  end_month date,
  due_day integer not null check(due_day between 1 and 31),
  created_by uuid not null references auth.users(id),
  check(end_month is null or end_month>=start_month)
);
create index recurring_rules_household_idx on public.recurring_rules(household_id);
create table public.recurring_amounts (
  rule_id uuid not null references public.recurring_rules(id) on delete cascade,
  effective_month date not null check(extract(day from effective_month)=1),
  amount bigint not null check(amount between 1 and 1000000000),
  primary key(rule_id,effective_month)
);
create table public.entries (
  id text primary key default gen_random_uuid()::text,
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null check(kind in ('income','expense')),
  description text not null check(length(trim(description)) between 1 and 120),
  amount bigint not null check(amount between 1 and 1000000000),
  category text not null check(length(trim(category)) between 1 and 60),
  person text not null check(length(trim(person)) between 1 and 60),
  date date not null check(date>='2000-01-01' and date<'2100-01-01'),
  rule_id uuid references public.recurring_rules(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(rule_id,date)
);
create index entries_household_date_idx on public.entries(household_id,date);
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null check(length(email)<=254),
  token_hash text not null unique,
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index household_invites_household_idx on public.household_invites(household_id);

create function private.current_household() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  return (select household_id from public.household_members where user_id=auth.uid());
end $$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.recurring_amounts enable row level security;
alter table public.entries enable row level security;
alter table public.household_invites enable row level security;
create policy household_read on public.households for select to authenticated using(id=(select private.current_household()));
create policy members_read on public.household_members for select to authenticated using(household_id=(select private.current_household()));
create policy rules_read on public.recurring_rules for select to authenticated using(household_id=(select private.current_household()));
create policy amounts_read on public.recurring_amounts for select to authenticated using(exists(select 1 from public.recurring_rules r where r.id=rule_id and r.household_id=(select private.current_household())));
create policy entries_read on public.entries for select to authenticated using(household_id=(select private.current_household()));
create policy invites_read on public.household_invites for select to authenticated using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=(select auth.uid())));
revoke all on public.households,public.household_members,public.recurring_rules,public.recurring_amounts,public.entries,public.household_invites from public,anon,authenticated;
grant select on public.households,public.household_members,public.recurring_rules,public.recurring_amounts,public.entries to authenticated;
-- token hashes are never exposed in SELECT grants.
grant select(id,household_id,email,expires_at,accepted_at,revoked_at,created_at) on public.household_invites to authenticated;

create function private.ensure_household() returns uuid
language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 h:=private.current_household();if h is not null then return h;end if;
 insert into public.households(owner_id) values(auth.uid()) returning id into h;
 insert into public.household_members(user_id,household_id) values(auth.uid(),h);
 return h;
end $$;

create function private.validate_entry(p jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p->>'kind' not in ('income','expense') or p->>'kind' is null
   or length(trim(coalesce(p->>'description',''))) not between 1 and 120
   or length(trim(coalesce(p->>'category',''))) not between 1 and 60
   or length(trim(coalesce(p->>'person',''))) not between 1 and 60
   or coalesce(p->>'amount','') !~ '^[0-9]+$'
   or (p->>'amount')::bigint not between 1 and 1000000000
   or coalesce(p->>'date','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$'
 then raise exception 'invalid_entry';end if;
 -- PostgreSQL date cast also rejects non-existent calendar dates.
 perform (p->>'date')::date;
end $$;

create function private.add_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid;rid uuid;eid text;d date;outrow public.entries;
begin
 h:=private.current_household();if h is null then raise exception 'membership_required';end if;
 perform 1 from public.households where id=h for share;
 perform private.validate_entry(p_entry);d:=(p_entry->>'date')::date;
 eid:=gen_random_uuid()::text;
 if coalesce((p_entry->>'repeats')::boolean,false) then
   if p_entry->>'kind'<>'expense' then raise exception 'only_expenses_repeat';end if;
   insert into public.recurring_rules(household_id,description,category,person,start_month,due_day,created_by)
   values(h,trim(p_entry->>'description'),trim(p_entry->>'category'),trim(p_entry->>'person'),date_trunc('month',d)::date,extract(day from d)::integer,auth.uid()) returning id into rid;
   insert into public.recurring_amounts(rule_id,effective_month,amount) values(rid,date_trunc('month',d)::date,(p_entry->>'amount')::bigint);
   eid:=rid::text||':'||to_char(d,'YYYY-MM');
 end if;
 insert into public.entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by)
 values(eid,h,p_entry->>'kind',trim(p_entry->>'description'),(p_entry->>'amount')::bigint,trim(p_entry->>'category'),trim(p_entry->>'person'),d,rid,auth.uid()) returning * into outrow;
 return to_jsonb(outrow);
end $$;

create function private.sync_month(p_month date) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;m date;
begin
 h:=private.current_household();if h is null then raise exception 'membership_required';end if;
 m:=date_trunc('month',p_month)::date;
 if p_month is null or p_month<>m or m<'2000-01-01' or m>='2100-01-01' then raise exception 'invalid_month';end if;
 -- A deterministic ID makes concurrent reloads safe, and preserves deleted occurrences.
 insert into public.entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by)
 select r.id::text||':'||to_char(m,'YYYY-MM'),h,'expense',r.description,a.amount,r.category,r.person,
   m+(least(r.due_day,extract(day from (m+interval '1 month - 1 day'))::integer)-1),r.id,auth.uid()
 from public.recurring_rules r
 cross join lateral(select amount from public.recurring_amounts v where v.rule_id=r.id and v.effective_month<=m order by v.effective_month desc limit 1) a
 where r.household_id=h and r.start_month<=m and (r.end_month is null or r.end_month>=m)
 on conflict(id) do nothing;
end $$;

create function private.edit_entry(p_id text,p_entry jsonb,p_future boolean) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;e public.entries;d date;
begin
 h:=private.current_household();if h is null then raise exception 'membership_required';end if;
 select * into e from public.entries where id=p_id and household_id=h and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 perform private.validate_entry(p_entry||jsonb_build_object('kind',e.kind));
 d:=(p_entry->>'date')::date;
 if date_trunc('month',d)<>date_trunc('month',e.date) then raise exception 'keep_original_month';end if;
 update public.entries set description=trim(p_entry->>'description'),amount=(p_entry->>'amount')::bigint,category=trim(p_entry->>'category'),person=trim(p_entry->>'person'),date=d where id=e.id;
 if coalesce(p_future,false) and e.rule_id is not null then
   -- New defaults start NEXT month. Historical months retain their correct default,
   -- including historical occurrences which have never been opened/materialized.
   perform 1 from public.recurring_rules where id=e.rule_id for update;
   insert into public.recurring_amounts(rule_id,effective_month,amount)
   values(e.rule_id,(date_trunc('month',e.date)+interval '1 month')::date,(p_entry->>'amount')::bigint)
   on conflict(rule_id,effective_month) do update set amount=excluded.amount;
 end if;
end $$;

create function private.delete_entry(p_id text) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
 h:=private.current_household();if h is null then raise exception 'membership_required';end if;
 update public.entries set deleted_at=now() where id=p_id and household_id=h and deleted_at is null;
 if not found then raise exception 'entry_not_found';end if;
end $$;

create function private.stop_recurring(p_id text) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;e public.entries;
begin
 h:=private.current_household();if h is null then raise exception 'membership_required';end if;
 select * into e from public.entries where id=p_id and household_id=h and deleted_at is null;
 if not found or e.rule_id is null then raise exception 'recurrence_not_found';end if;
 update public.recurring_rules set end_month=date_trunc('month',e.date)::date where id=e.rule_id and household_id=h;
 -- Previously materialized future records are preserved, as explained in the UI.
end $$;

create function private.create_household_invite(p_email text) returns text
language plpgsql security definer set search_path='' as $$
declare h uuid;t text;
begin
 h:=private.current_household();
 if h is null or not exists(select 1 from public.households where id=h and owner_id=auth.uid()) then raise exception 'owner_required';end if;
 if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email';end if;
 perform 1 from public.households where id=h for update;
 if (select count(*) from public.household_invites where household_id=h and accepted_at is null and revoked_at is null and expires_at>now())>=20 then raise exception 'too_many_invites';end if;
 update public.household_invites set revoked_at=now() where household_id=h and email=lower(trim(p_email)) and accepted_at is null and revoked_at is null;
 t:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.household_invites(household_id,email,token_hash)
 values(h,lower(trim(p_email)),encode(sha256(convert_to(t,'UTF8')),'hex'));
 return t;
end $$;

create function private.accept_household_invite(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.household_invites;h uuid;uemail text;
begin
 if auth.uid() is null then raise exception 'authentication_required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'invalid_invite';end if;
 select lower(email) into uemail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into i from public.household_invites where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or i.email is distinct from uemail or i.revoked_at is not null or i.expires_at<=now() then raise exception 'invalid_invite';end if;
 h:=private.current_household();
 if i.accepted_at is not null then
   if h=i.household_id then return h;end if;
   raise exception 'invalid_invite';
 end if;
 if h is not null and h<>i.household_id then
   perform 1 from public.households where id=h for update;
   -- Permit joining from a newly created empty personal space, but never discard finance records.
   if not exists(select 1 from public.households where id=h and owner_id=auth.uid())
     or exists(select 1 from public.entries where household_id=h)
     or exists(select 1 from public.recurring_rules where household_id=h)
     or (select count(*) from public.household_members where household_id=h)>1
   then raise exception 'existing_household';end if;
   delete from public.households where id=h;
 end if;
 insert into public.household_members(user_id,household_id) values(auth.uid(),i.household_id)
 on conflict(user_id) do update set household_id=excluded.household_id;
 update public.household_invites set accepted_at=now() where id=i.id;
 return i.household_id;
end $$;

create function private.revoke_household_invite(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
 h:=private.current_household();if h is null or not exists(select 1 from public.households where id=h and owner_id=auth.uid()) then raise exception 'owner_required';end if;
 update public.household_invites set revoked_at=now() where id=p_id and household_id=h and accepted_at is null;
 if not found then raise exception 'invite_not_found';end if;
end $$;

-- Thin invoker wrappers expose only the intended RPC contract to PostgREST.
create function public.ensure_household() returns uuid language sql security invoker set search_path='' as $$select private.ensure_household()$$;
create function public.add_entry(p_entry jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.add_entry(p_entry)$$;
create function public.sync_month(p_month date) returns void language sql security invoker set search_path='' as $$select private.sync_month(p_month)$$;
create function public.edit_entry(p_id text,p_entry jsonb,p_future boolean default false) returns void language sql security invoker set search_path='' as $$select private.edit_entry(p_id,p_entry,p_future)$$;
create function public.delete_entry(p_id text) returns void language sql security invoker set search_path='' as $$select private.delete_entry(p_id)$$;
create function public.stop_recurring(p_id text) returns void language sql security invoker set search_path='' as $$select private.stop_recurring(p_id)$$;
create function public.create_household_invite(p_email text) returns text language sql security invoker set search_path='' as $$select private.create_household_invite(p_email)$$;
create function public.accept_household_invite(p_token text) returns uuid language sql security invoker set search_path='' as $$select private.accept_household_invite(p_token)$$;
create function public.revoke_household_invite(p_id uuid) returns void language sql security invoker set search_path='' as $$select private.revoke_household_invite(p_id)$$;

revoke execute on all functions in schema private from public,anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function public.ensure_household(),public.add_entry(jsonb),public.sync_month(date),public.edit_entry(text,jsonb,boolean),public.delete_entry(text),public.stop_recurring(text),public.create_household_invite(text),public.accept_household_invite(text),public.revoke_household_invite(uuid) from public,anon;
grant execute on function public.ensure_household(),public.add_entry(jsonb),public.sync_month(date),public.edit_entry(text,jsonb,boolean),public.delete_entry(text),public.stop_recurring(text),public.create_household_invite(text),public.accept_household_invite(text),public.revoke_household_invite(uuid) to authenticated;
