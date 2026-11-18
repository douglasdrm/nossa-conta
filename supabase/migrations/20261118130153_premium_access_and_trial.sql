-- One trial per owner account, retained if an empty personal space is replaced by an invitation.
create table nossa_conta_private.nc_account_trials (
  user_id uuid primary key references auth.users(id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  check (expires_at > started_at)
);
alter table nossa_conta_private.nc_account_trials enable row level security;
revoke all on nossa_conta_private.nc_account_trials from public, anon, authenticated, service_role;

-- Existing spaces receive seven days from rollout instead of losing access immediately.
insert into nossa_conta_private.nc_account_trials(user_id)
select owner_id from public.nc_households on conflict (user_id) do nothing;

create function nossa_conta_private.start_account_trial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into nossa_conta_private.nc_account_trials(user_id)
  values (new.owner_id) on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function nossa_conta_private.start_account_trial() from public, anon, authenticated, service_role;
create trigger nc_start_account_trial after insert on public.nc_households
for each row execute function nossa_conta_private.start_account_trial();

create function nossa_conta_private.household_premium_until(p_household uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(valid_until) from (
    select t.expires_at as valid_until
      from nossa_conta_private.nc_account_trials t
      join public.nc_households h on h.owner_id=t.user_id where h.id=p_household
    union all
    select s.valid_until from public.nc_subscriptions s where s.household_id=p_household and s.kind='courtesy'
    union all
    select c.paid_until from nossa_conta_private.nc_production_charges c
      where c.household_id=p_household and c.provider_environment='production' and c.provider_name='asaas'
        and c.status in ('CONFIRMED','RECEIVED') and c.provider_verified_at is not null
  ) periods
$$;
create function nossa_conta_private.household_has_premium(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(nossa_conta_private.household_premium_until(p_household)>now(),false)
    or exists(select 1 from public.nc_households h join public.nc_system_admins a on a.user_id=h.owner_id where h.id=p_household)
$$;
revoke all on function nossa_conta_private.household_premium_until(uuid),
  nossa_conta_private.household_has_premium(uuid) from public, anon, authenticated, service_role;

create function nossa_conta_private.access_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.nc_households; trial_until timestamptz; paid_until timestamptz; courtesy_until timestamptz;
  access_kind text; premium boolean;
begin
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
    raise exception 'confirmed_account_required';
  end if;
  select space.* into h from public.nc_household_members m join public.nc_households space on space.id=m.household_id
    where m.user_id=auth.uid();
  if h.id is null then return jsonb_build_object('kind','free','premium',false,'can_access',false,'is_owner',false,'trial_until',null,'valid_until',null); end if;
  select expires_at into trial_until from nossa_conta_private.nc_account_trials where user_id=h.owner_id;
  select max(c.paid_until) into paid_until from nossa_conta_private.nc_production_charges c
    where c.household_id=h.id and c.status in ('CONFIRMED','RECEIVED') and c.provider_verified_at is not null
      and c.provider_environment='production' and c.provider_name='asaas' and c.paid_until>now();
  select s.valid_until into courtesy_until from public.nc_subscriptions s where s.household_id=h.id and s.kind='courtesy' and s.valid_until>now();
  access_kind := case
    when exists(select 1 from public.nc_system_admins where user_id=h.owner_id) then 'admin'
    when paid_until is not null then 'paid'
    when courtesy_until is not null then 'courtesy'
    when trial_until>now() then 'trial'
    else 'free' end;
  premium := access_kind<>'free';
  return jsonb_build_object('kind',access_kind,'premium',premium,'can_access',premium or h.owner_id=auth.uid(),
    'is_owner',h.owner_id=auth.uid(),'trial_until',trial_until,
    'valid_until',case access_kind when 'paid' then paid_until when 'courtesy' then courtesy_until when 'trial' then trial_until end);
end $$;
create function public.nc_access_status() returns jsonb
language sql stable security invoker set search_path = '' as $$select nossa_conta_private.access_status()$$;
revoke all on function nossa_conta_private.access_status(), public.nc_access_status() from public, anon, authenticated, service_role;
grant execute on function nossa_conta_private.access_status(), public.nc_access_status() to authenticated;

-- All existing finance RLS policies and privileged mutations reuse this boundary.
create or replace function nossa_conta_private.current_household() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare h public.nc_households;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
    raise exception 'confirmed_account_required';
  end if;
  select space.* into h from public.nc_household_members m join public.nc_households space on space.id=m.household_id where m.user_id=auth.uid();
  if h.owner_id=auth.uid() or nossa_conta_private.household_has_premium(h.id) then return h.id; end if;
  return null;
end $$;

-- A paused invited member keeps their membership instead of creating a conflicting personal space.
create or replace function nossa_conta_private.ensure_household() returns uuid
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
    raise exception 'confirmed_account_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select household_id into h from public.nc_household_members where user_id=auth.uid();
  if h is not null then return h; end if;
  insert into public.nc_households(owner_id) values(auth.uid()) returning id into h;
  insert into public.nc_household_members(user_id,household_id) values(auth.uid(),h);
  return h;
end $$;

create function nossa_conta_private.enforce_premium_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h uuid; advanced boolean := true;
begin
  -- Administrative maintenance and provider reconciliation have separate restricted roles.
  if auth.uid() is null then return new; end if;
  if tg_table_name='nc_recurring_amounts' then
    select household_id into h from public.nc_recurring_rules where id=new.rule_id;
  elsif tg_table_name='nc_savings_movements' then
    select household_id into h from public.nc_savings_goals where id=new.goal_id;
  elsif tg_table_name='nc_households' then
    h := new.id;
    advanced := new.savings_buffer is distinct from old.savings_buffer;
  else
    h := new.household_id;
  end if;
  if tg_table_name='nc_entries' then
    -- Basic mode retains normal expense/receipt entry and settlement of existing bills.
    advanced := tg_op='INSERT' and (new.rule_id is not null or new.installment_group is not null);
    if tg_op='UPDATE' then
      advanced := (old.rule_id is not null or old.installment_group is not null or new.rule_id is not null or new.installment_group is not null)
        and (new.description,new.amount,new.category,new.person,new.date,new.rule_id,new.installment_group,new.installment_count)
          is distinct from (old.description,old.amount,old.category,old.person,old.date,old.rule_id,old.installment_group,old.installment_count);
    end if;
  elsif tg_table_name='nc_recurring_rules' and tg_op='UPDATE' then
    advanced := to_jsonb(new)-'end_month' is distinct from to_jsonb(old)-'end_month';
  elsif tg_table_name='nc_household_invites' and tg_op='UPDATE' then
    advanced := new.accepted_at is distinct from old.accepted_at;
  end if;
  if advanced and not nossa_conta_private.household_has_premium(h) then
    raise exception 'premium_required' using errcode='P0001';
  end if;
  return new;
end $$;
revoke all on function nossa_conta_private.enforce_premium_write() from public, anon, authenticated, service_role;
create trigger nc_premium_entries before insert or update on public.nc_entries for each row execute function nossa_conta_private.enforce_premium_write();
create trigger nc_premium_rules before insert or update on public.nc_recurring_rules for each row execute function nossa_conta_private.enforce_premium_write();
create trigger nc_premium_amounts before insert or update on public.nc_recurring_amounts for each row execute function nossa_conta_private.enforce_premium_write();
create trigger nc_premium_goals before insert or update on public.nc_savings_goals for each row execute function nossa_conta_private.enforce_premium_write();
create trigger nc_premium_movements before insert or update on public.nc_savings_movements for each row execute function nossa_conta_private.enforce_premium_write();
create trigger nc_premium_plan before insert or update on public.nc_budget_plan for each row execute function nossa_conta_private.enforce_premium_write();
create trigger nc_premium_buffer before update of savings_buffer on public.nc_households for each row execute function nossa_conta_private.enforce_premium_write();
create trigger nc_premium_invites before insert or update on public.nc_household_invites for each row execute function nossa_conta_private.enforce_premium_write();

create function nossa_conta_private.enforce_shared_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.nc_households where id=new.household_id and owner_id=new.user_id) then return new; end if;
  if not nossa_conta_private.household_has_premium(new.household_id) then raise exception 'premium_required'; end if;
  return new;
end $$;
revoke all on function nossa_conta_private.enforce_shared_membership() from public, anon, authenticated, service_role;
create trigger nc_premium_membership before insert or update of household_id on public.nc_household_members
for each row execute function nossa_conta_private.enforce_shared_membership();

-- Joining a shared space never discards populated personal goals, plans or billing history.
create or replace function nossa_conta_private.accept_household_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.nc_household_invites; h uuid; uemail text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then raise exception 'confirmed_account_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'invalid_invite'; end if;
  select lower(email) into uemail from auth.users where id=auth.uid();
  select * into i from public.nc_household_invites where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or i.email is distinct from uemail or i.revoked_at is not null or i.expires_at<=now() then raise exception 'invalid_invite'; end if;
  select household_id into h from public.nc_household_members where user_id=auth.uid();
  if i.accepted_at is not null then
    if h=i.household_id then return h; end if;
    raise exception 'invalid_invite';
  end if;
  perform 1 from public.nc_households where id=i.household_id for update;
  if not nossa_conta_private.household_has_premium(i.household_id) then raise exception 'premium_required'; end if;
  if h is not null and h<>i.household_id then
    perform 1 from public.nc_households where id=h for update;
    if not exists(select 1 from public.nc_households where id=h and owner_id=auth.uid() and savings_buffer=0)
      or exists(select 1 from public.nc_entries where household_id=h)
      or exists(select 1 from public.nc_recurring_rules where household_id=h)
      or exists(select 1 from public.nc_savings_goals where household_id=h)
      or exists(select 1 from public.nc_budget_plan where household_id=h)
      or exists(select 1 from public.nc_categories where household_id=h)
      or exists(select 1 from public.nc_subscriptions where household_id=h)
      or exists(select 1 from public.nc_billing_orders where household_id=h)
      or exists(select 1 from nossa_conta_private.nc_production_checkout_orders where household_id=h)
      or (select count(*) from public.nc_household_members where household_id=h)>1 then
      raise exception 'existing_household';
    end if;
    delete from public.nc_households where id=h;
  end if;
  insert into public.nc_household_members(user_id,household_id) values(auth.uid(),i.household_id)
    on conflict(user_id) do update set household_id=excluded.household_id;
  update public.nc_household_invites set accepted_at=now() where id=i.id;
  return i.household_id;
end $$;
