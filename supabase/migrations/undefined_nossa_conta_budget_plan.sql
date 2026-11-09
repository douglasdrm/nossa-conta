create table public.nc_budget_plan (
  household_id uuid primary key references public.nc_households(id) on delete cascade,
  enabled boolean not null,
  essentials smallint not null check (essentials between 0 and 100),
  future smallint not null check (future between 0 and 100),
  leisure smallint not null check (leisure between 0 and 100),
  development smallint not null check (development between 0 and 100),
  categories jsonb not null default '{}'::jsonb check (
    jsonb_typeof(categories) = 'object'
    and not jsonb_path_exists(categories, 'strict $.* ? (@ != "essentials" && @ != "future" && @ != "leisure" && @ != "development")')
  ),
  check (essentials + future + leisure + development = 100)
);

alter table public.nc_budget_plan enable row level security;

create policy budget_plan_household on public.nc_budget_plan
  for all to authenticated
  using (
    ((select auth.jwt()->>'is_anonymous')::boolean is false)
    and household_id = (select nossa_conta_private.current_household())
  )
  with check (
    ((select auth.jwt()->>'is_anonymous')::boolean is false)
    and household_id = (select nossa_conta_private.current_household())
  );

revoke all on public.nc_budget_plan from public, anon, authenticated;
grant select, insert, update on public.nc_budget_plan to authenticated;
