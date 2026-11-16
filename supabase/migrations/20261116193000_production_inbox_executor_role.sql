-- Dedicated no-login privilege boundary for future production webhook storage.
-- IMPORTANT: this role is NOT a network credential and is NOT granted to
-- anon, authenticated, service_role, authenticator or any user.
-- The HTTP production route remains unconditionally HTTP 503.

create role nc_production_inbox_executor nologin noinherit
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

grant usage on schema nossa_conta_private to nc_production_inbox_executor;

-- A single narrow SECURITY DEFINER gateway invokes the owner-only,
-- validated and transactionally idempotent enqueue function.
-- There is no access to raw inbox rows, other production payment functions,
-- courtesy subscriptions or financial data.
create function nossa_conta_private.enqueue_production_event_gateway(
  p_event_id text,p_event_type text,p_payment_id text
) returns text
language sql volatile security definer set search_path=''
as $$
  select nossa_conta_private.enqueue_production_event_internal(
    p_event_id,p_event_type,p_payment_id
  )
$$;

revoke all on function nossa_conta_private.enqueue_production_event_gateway(
  text,text,text) from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.enqueue_production_event_gateway(
  text,text,text) to nc_production_inbox_executor;

-- The role is deliberately NOT granted SELECT or DML on private tables.
-- Do not grant this role to any application or API role. PostgreSQL may\n-- automatically register the creating owner (postgres) as a member.
-- Creating an application login/connection requires a separate review and
-- explicit launch authorization. Never use the owner or service role
-- in an internet-facing webhook route.
