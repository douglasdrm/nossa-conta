alter table public.nc_households add column savings_buffer bigint not null default 0
  check (savings_buffer between 0 and 1000000000);

create table public.nc_savings_goals (
  id uuid primary key,
  household_id uuid not null references public.nc_households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  target bigint not null check (target between 1 and 1000000000),
  deadline date not null check (deadline >= '2000-01-01' and deadline < '2100-01-01'),
  priority integer not null check (priority between 1 and 999),
  created_at timestamptz not null default now()
);
create index nc_savings_goals_household_idx on public.nc_savings_goals(household_id);

create table public.nc_savings_movements (
  id uuid primary key,
  goal_id uuid not null references public.nc_savings_goals(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  kind text not null check (kind in ('deposit','withdraw')),
  amount bigint not null check (amount between 1 and 1000000000),
  status text not null check (status in ('planned','saved','canceled')),
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  check ((status='saved')=(saved_at is not null)),
  check (kind='deposit' or status='saved')
);
create index nc_savings_movements_goal_idx on public.nc_savings_movements(goal_id);

alter table public.nc_savings_goals enable row level security;
alter table public.nc_savings_movements enable row level security;
create policy savings_goals_read on public.nc_savings_goals for select to authenticated
  using (((select auth.jwt()->>'is_anonymous')::boolean is false)
    and household_id=(select nossa_conta_private.current_household()));
create policy savings_movements_read on public.nc_savings_movements for select to authenticated
  using (((select auth.jwt()->>'is_anonymous')::boolean is false)
    and exists (select 1 from public.nc_savings_goals g where g.id=goal_id));
revoke all on public.nc_savings_goals, public.nc_savings_movements from public,anon,authenticated;
grant select on public.nc_savings_goals, public.nc_savings_movements to authenticated;

create function nossa_conta_private.mutate_savings(p_action jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  h uuid := nossa_conta_private.current_household();
  action text := p_action->>'action';
  goal uuid := (p_action->>'goalId')::uuid;
  movement uuid := (p_action->>'movementId')::uuid;
  amount bigint := (p_action->>'amount')::bigint;
  movement_kind text := p_action->>'kind';
  movement_status text := p_action->>'status';
  existing public.nc_savings_movements;
  total bigint;
begin
  if h is null then raise exception 'membership_required'; end if;

  if action='buffer' then
    if amount is null or amount not between 0 and 1000000000 then raise exception 'invalid_savings'; end if;
    update public.nc_households set savings_buffer=amount where id=h;
    return;
  end if;

  if action='goal' then
    insert into public.nc_savings_goals(id,household_id,name,target,deadline,priority)
    values(goal,h,trim(p_action->>'name'),(p_action->>'target')::bigint,
      (p_action->>'deadline')::date,(p_action->>'priority')::integer)
    on conflict(id) do update set name=excluded.name,target=excluded.target,
      deadline=excluded.deadline,priority=excluded.priority
    where nc_savings_goals.household_id=h;
    if not found then raise exception 'goal_not_found'; end if;
    return;
  end if;

  -- A goal lock serializes withdrawals, deposits and confirmations.
  perform 1 from public.nc_savings_goals where id=goal and household_id=h for update;
  if not found then raise exception 'goal_not_found'; end if;

  if action='movement' then
    if movement_status not in ('planned','saved') then raise exception 'invalid_savings'; end if;
    select * into existing from public.nc_savings_movements where id=movement;
    if found then
      if existing.goal_id=goal and existing.actor_id=auth.uid() and
         existing.amount=amount and existing.kind=movement_kind and
         existing.status=movement_status then return; end if;
      raise exception 'movement_already_processed';
    end if;
    if movement_kind='withdraw' then
      select coalesce(sum(case when kind='deposit' then m.amount else -m.amount end),0)
        into total from public.nc_savings_movements m where goal_id=goal and status='saved';
      if amount>total then raise exception 'insufficient_savings'; end if;
    end if;
    insert into public.nc_savings_movements(id,goal_id,actor_id,kind,amount,status,saved_at)
    values(movement,goal,auth.uid(),movement_kind,amount,movement_status,
      case when movement_status='saved' then now() end);
    return;
  end if;

  if action in ('confirm','cancel') then
    select * into existing from public.nc_savings_movements where id=movement and goal_id=goal;
    if not found then raise exception 'movement_not_found'; end if;
    movement_status:=case when action='confirm' then 'saved' else 'canceled' end;
    if existing.status=movement_status then return; end if;
    if existing.status<>'planned' then raise exception 'movement_already_processed'; end if;
    update public.nc_savings_movements set status=movement_status,
      saved_at=case when movement_status='saved' then now() end where id=movement;
    return;
  end if;
  raise exception 'invalid_savings';
end $$;

create function public.nc_mutate_savings(p_action jsonb) returns void
language sql security invoker set search_path='' as $$
  select nossa_conta_private.mutate_savings(p_action);
$$;

create function public.nc_savings_overview(p_month date) returns jsonb
language sql stable security invoker set search_path='' as $$
  with context as (
    select h.id, h.savings_buffer, public.nc_payer_labels() as labels,
      p_month::timestamp at time zone 'America/Sao_Paulo' as month_start,
      (p_month+interval '1 month') at time zone 'America/Sao_Paulo' as month_end
    from public.nc_households h where h.id=(select nossa_conta_private.current_household())
  )
  select jsonb_build_object(
    'buffer', c.savings_buffer,
    'goals', coalesce((
      select jsonb_agg(to_jsonb(g) - 'household_id' || jsonb_build_object(
        'saved', coalesce(t.saved,0), 'savedBeforeMonth',coalesce(t.before_month,0),
        'savedInMonth',coalesce(t.in_month,0), 'planned',coalesce(t.planned,0),
        'movements',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', x.id, 'amount',x.amount, 'status',x.status, 'kind',x.kind,
            'date',coalesce(x.saved_at,x.created_at), 'actor',coalesce(c.labels->>x.actor_id::text,'Participante')
          ) order by (x.status='planned') desc, coalesce(x.saved_at,x.created_at) desc)
          from (
            select * from public.nc_savings_movements where goal_id=g.id and status='planned'
            union all
            (select * from public.nc_savings_movements where goal_id=g.id and status='saved' order by saved_at desc,id limit 8)
          ) x
        ),'[]'::jsonb)
      ) order by g.priority,g.created_at,g.id)
      from public.nc_savings_goals g
      cross join lateral (
        select sum(delta) filter(where m.status='saved') as saved,
          sum(delta) filter(where m.saved_at<c.month_start) as before_month,
          sum(delta) filter(where m.saved_at>=c.month_start and m.saved_at<c.month_end) as in_month,
          sum(m.amount) filter(where m.status='planned') as planned
        from public.nc_savings_movements m
        cross join lateral (select case when m.kind='deposit' then m.amount else -m.amount end as delta) d
        where m.goal_id=g.id
      ) t where g.household_id=c.id
    ),'[]'::jsonb)
  ) from context c;
$$;
revoke all on function nossa_conta_private.mutate_savings(jsonb),public.nc_mutate_savings(jsonb),
  public.nc_savings_overview(date) from public,anon,authenticated;
grant execute on function nossa_conta_private.mutate_savings(jsonb),public.nc_mutate_savings(jsonb),
  public.nc_savings_overview(date) to authenticated;
