alter table public.nc_entries drop constraint nc_income_always_confirmed;

create or replace function nossa_conta_private.add_entry(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid;rid uuid;eid text;d date;outrow public.nc_entries;paid boolean;paid_by text;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 perform 1 from public.nc_households where id=h for share;
 perform nossa_conta_private.validate_entry(p_entry);d:=(p_entry->>'date')::date;
 eid:=gen_random_uuid()::text;
 paid:=coalesce((p_entry->>'confirmed')::boolean,true);
 paid_by:=case when paid and p_entry->>'kind'='expense' then coalesce(nullif(trim(p_entry->>'payer'),''),(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
 if coalesce((p_entry->>'repeats')::boolean,false) then
   if p_entry->>'kind'<>'expense' then raise exception 'only_expenses_repeat';end if;
   insert into public.nc_recurring_rules(household_id,description,category,person,start_month,due_day,created_by)
   values(h,trim(p_entry->>'description'),trim(p_entry->>'category'),trim(p_entry->>'person'),date_trunc('month',d)::date,extract(day from d)::integer,auth.uid()) returning id into rid;
   insert into public.nc_recurring_amounts(rule_id,effective_month,amount) values(rid,date_trunc('month',d)::date,(p_entry->>'amount')::bigint);
   eid:=rid::text||':'||to_char(d,'YYYY-MM');
 end if;
 insert into public.nc_entries(id,household_id,kind,description,amount,category,person,date,rule_id,created_by,confirmed,confirmed_at,payer)
 values(eid,h,p_entry->>'kind',trim(p_entry->>'description'),(p_entry->>'amount')::bigint,trim(p_entry->>'category'),trim(p_entry->>'person'),d,rid,auth.uid(),paid,case when paid then now() else null end,paid_by) returning * into outrow;
 return to_jsonb(outrow);
end $$;

create or replace function nossa_conta_private.edit_entry(p_id text,p_entry jsonb,p_future boolean) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;e public.nc_entries;d date;paid boolean;paid_by text;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 perform nossa_conta_private.validate_entry(p_entry||jsonb_build_object('kind',e.kind));
 d:=(p_entry->>'date')::date;
 paid:=coalesce((p_entry->>'confirmed')::boolean,e.confirmed);
 paid_by:=case when paid and e.kind='expense' then coalesce(nullif(trim(p_entry->>'payer'),''),e.payer,(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end;
 if date_trunc('month',d)<>date_trunc('month',e.date) then raise exception 'keep_original_month';end if;
 update public.nc_entries set description=trim(p_entry->>'description'),amount=(p_entry->>'amount')::bigint,category=trim(p_entry->>'category'),person=trim(p_entry->>'person'),date=d,payer=paid_by,confirmed=paid,confirmed_at=case when not paid then null when not e.confirmed then now() else e.confirmed_at end where id=e.id;
 if coalesce(p_future,false) and e.rule_id is not null then
   -- New defaults start NEXT month. Historical months retain their correct default,
   -- including historical occurrences which have never been opened/materialized.
   perform 1 from public.nc_recurring_rules where id=e.rule_id for update;
   insert into public.nc_recurring_amounts(rule_id,effective_month,amount)
   values(e.rule_id,(date_trunc('month',e.date)+interval '1 month')::date,(p_entry->>'amount')::bigint)
   on conflict(rule_id,effective_month) do update set amount=excluded.amount;
 end if;
end $$;

create or replace function nossa_conta_private.confirm_entry(p_id text,p_confirmed boolean,p_payer text default null) returns void
language plpgsql security definer set search_path='' as $$
declare h uuid;e public.nc_entries;
begin
 h:=nossa_conta_private.current_household();if h is null then raise exception 'membership_required';end if;
 if p_confirmed is null then raise exception 'invalid_confirmation';end if;
 select * into e from public.nc_entries where id=p_id and household_id=h and deleted_at is null for update;
 if not found then raise exception 'entry_not_found';end if;
 update public.nc_entries set confirmed=p_confirmed,payer=case when p_confirmed and e.kind='expense' then coalesce(nullif(trim(p_payer),''),e.payer,(select left(split_part(email,'@',1),60) from auth.users where id=auth.uid())) else null end,confirmed_at=case when p_confirmed then now() else null end where id=e.id and confirmed is distinct from p_confirmed;
end $$;

alter table public.nc_entries add column payer_user_id uuid;

create function nossa_conta_private.resolve_payer(p_household uuid, p_label text)
returns uuid language sql stable security definer set search_path='' as $$
  select case when count(*)=1 then (array_agg(m.user_id))[1] end
  from public.nc_household_members m
  join auth.users u on u.id=m.user_id
  left join public.nc_user_profiles p on p.user_id=m.user_id
  where m.household_id=p_household
    and nullif(regexp_replace(lower(p_label),'[^[:alnum:]]','','g'),'') in (
      select regexp_replace(lower(alias),'[^[:alnum:]]','','g')
      from unnest(array[p.display_name,p.username,u.raw_user_meta_data->>'display_name',
        u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',split_part(u.email,'@',1)]) alias
    );
$$;

create function nossa_conta_private.link_entry_payer()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind<>'expense' or not new.confirmed then
    new.payer_user_id:=null;
  elsif tg_op='UPDATE' and old.payer_user_id is not null
    and old.payer is not distinct from new.payer and old.household_id=new.household_id then
    new.payer_user_id:=old.payer_user_id;
  else
    new.payer_user_id:=nossa_conta_private.resolve_payer(new.household_id,new.payer);
  end if;
  return new;
end $$;
revoke all on function nossa_conta_private.resolve_payer(uuid,text),nossa_conta_private.link_entry_payer() from public,anon,authenticated;
create trigger nc_link_entry_payer before insert or update of payer,confirmed,household_id,payer_user_id
 on public.nc_entries for each row execute function nossa_conta_private.link_entry_payer();

update public.nc_entries set payer=payer
where kind='expense' and confirmed and payer is not null and deleted_at is null;

create function nossa_conta_private.payer_labels() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(m.user_id::text,left(coalesce(
    nullif(trim(p.display_name),''),nullif(trim(u.raw_user_meta_data->>'display_name'),''),
    nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(p.username,''),
    nullif(split_part(u.email,'@',1),''),'Participante'),60)),'{}'::jsonb)
  from public.nc_household_members m
  join auth.users u on u.id=m.user_id
  left join public.nc_user_profiles p on p.user_id=m.user_id
  where m.household_id=(select nossa_conta_private.current_household());
$$;
create function public.nc_payer_labels() returns jsonb
language sql stable security invoker set search_path='' as $$select nossa_conta_private.payer_labels()$$;
revoke all on function nossa_conta_private.payer_labels(),public.nc_payer_labels() from public,anon,authenticated;
grant execute on function nossa_conta_private.payer_labels(),public.nc_payer_labels() to authenticated;
