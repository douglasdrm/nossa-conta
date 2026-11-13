-- Track mock Premium validity without granting paid access or touching courtesy subscriptions.
-- Sandbox checkout confirmation remains the only source of a "paid" transition.
alter table public.nc_billing_orders
  add column paid_at timestamptz,
  add column sandbox_valid_until timestamptz;

-- Preserve the already confirmed Sandbox tests with an approximate historic paid timestamp.
update public.nc_billing_orders
set paid_at = updated_at,
    sandbox_valid_until = updated_at +
      case cycle
        when 'monthly' then interval '1 month'
        when 'quarterly' then interval '3 months'
        when 'yearly' then interval '12 months'
      end
where environment = 'sandbox' and status = 'paid';

create function nossa_conta_private.set_sandbox_paid_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.environment = 'sandbox'
     and new.status = 'paid'
     and old.status is distinct from 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
    new.sandbox_valid_until := new.paid_at +
      case new.cycle
        when 'monthly' then interval '1 month'
        when 'quarterly' then interval '3 months'
        when 'yearly' then interval '12 months'
      end;
  end if;
  return new;
end
$$;

create trigger nc_billing_sandbox_paid_dates
before update of status on public.nc_billing_orders
for each row execute function nossa_conta_private.set_sandbox_paid_dates();

-- A household member may see only a short, read-only simulation status for
-- their own household. No payment details, card or personally identifying data.
create function nossa_conta_private.sandbox_premium_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h uuid;
  o record;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false)
  ) then
    return jsonb_build_object('state', 'inactive');
  end if;

  select m.household_id into h
  from public.nc_household_members m
  where m.user_id = auth.uid();

  if h is null then
    return jsonb_build_object('state', 'inactive');
  end if;

  select b.cycle, b.sandbox_valid_until into o
  from public.nc_billing_orders b
  where b.household_id = h
    and b.environment = 'sandbox'
    and b.status = 'paid'
    and b.sandbox_valid_until is not null
  order by b.sandbox_valid_until desc, b.id desc
  limit 1;

  if not found then
    return jsonb_build_object('state', 'inactive');
  end if;
  return jsonb_build_object(
    'state', case when o.sandbox_valid_until > now() then 'active' else 'expired' end,
    'cycle', o.cycle,
    'valid_until', o.sandbox_valid_until
  );
end
$$;
revoke all on function nossa_conta_private.sandbox_premium_status() from public, anon;
grant usage on schema nossa_conta_private to authenticated;
grant execute on function nossa_conta_private.sandbox_premium_status() to authenticated;

create function public.nc_sandbox_premium_status()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select nossa_conta_private.sandbox_premium_status()
$$;
revoke all on function public.nc_sandbox_premium_status() from public, anon;
grant execute on function public.nc_sandbox_premium_status() to authenticated;
