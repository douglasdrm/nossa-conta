-- Production Premium storage foundation. Deliberately READ-ONLY and NOT LIVE.
-- Existing public.nc_billing_orders remains sandbox-only.
-- Existing public.nc_subscriptions remains courtesy-only.
-- No production checkout, webhook, write RPC, entitlement enforcement or migration
-- from sandbox data is introduced by this migration.

create table nossa_conta_private.nc_production_charges (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.nc_households(id) on delete restrict,
  provider_payment_id text not null unique
    check(provider_payment_id ~ '^pay_[a-zA-Z0-9_-]{3,120}$'),
  provider_subscription_id text
    check(provider_subscription_id is null or
          provider_subscription_id ~ '^sub_[a-zA-Z0-9_-]{6,100}$'),
  provider_environment text not null default 'production'
    check(provider_environment = 'production'),
  provider_name text not null default 'asaas'
    check(provider_name = 'asaas'),
  cycle text not null check(cycle in ('monthly','quarterly','yearly')),
  status text not null check(status in (
    'PENDING','CONFIRMED','RECEIVED','OVERDUE',
    'REFUNDED','PARTIALLY_REFUNDED','CHARGEBACK_REQUESTED',
    'CANCELED','CREDIT_CARD_CAPTURE_REFUSED'
  )),
  amount_cents integer not null check(amount_cents>0),
  due_date date not null,
  paid_until timestamptz,
  provider_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_confirmed_requires_verification
    check (
      status not in ('CONFIRMED','RECEIVED') or
      (provider_verified_at is not null and paid_until is not null)
    )
);
create index nc_production_charges_household_idx
  on nossa_conta_private.nc_production_charges(household_id,paid_until desc);
alter table nossa_conta_private.nc_production_charges enable row level security;
-- No policies, no client grants, and no write function.
revoke all on nossa_conta_private.nc_production_charges
  from public,anon,authenticated;

-- Safe read-only hypothetical entitlement status for the CURRENT signed-in
-- household member. It does not authorize anything and does not change
-- existing access, even when hypothetical_paid is true.
create function nossa_conta_private.production_premium_shadow_status()
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare
  h uuid;
  courtesy_until timestamptz;
  paid_until timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false)
  ) then
    return jsonb_build_object(
      'mode','shadow','member',false,'courtesy_active',false,
      'hypothetical_paid',false,'enforced',false,'billing_enabled',false
    );
  end if;

  select m.household_id into h
  from public.nc_household_members m
  where m.user_id = auth.uid()
  order by m.created_at desc limit 1;

  if h is null then
    return jsonb_build_object(
      'mode','shadow','member',false,'courtesy_active',false,
      'hypothetical_paid',false,'enforced',false,'billing_enabled',false
    );
  end if;

  select s.valid_until into courtesy_until
  from public.nc_subscriptions s
  where s.household_id=h and s.kind='courtesy';

  select max(p.paid_until) into paid_until
  from nossa_conta_private.nc_production_charges p
  where p.household_id=h
    and p.provider_environment='production'
    and p.provider_name='asaas'
    and p.status in ('CONFIRMED','RECEIVED')
    and p.provider_verified_at is not null
    and p.paid_until>now();

  return jsonb_build_object(
    'mode','shadow','member',true,
    'courtesy_active',coalesce(courtesy_until>now(),false),
    'hypothetical_paid',paid_until is not null,
    'enforced',false,'billing_enabled',false
  );
end $$;

-- Executable only by confirmed, signed-in members; the definer function
-- verifies auth.uid and membership rather than trusting caller-supplied IDs.
create function public.nc_production_premium_shadow_status()
returns jsonb language sql stable security invoker set search_path=''
as $$
  select nossa_conta_private.production_premium_shadow_status()
$$;
revoke all on function
  nossa_conta_private.production_premium_shadow_status(),
  public.nc_production_premium_shadow_status()
  from public,anon,authenticated;
grant execute on function
  nossa_conta_private.production_premium_shadow_status(),
  public.nc_production_premium_shadow_status()
  to authenticated;
