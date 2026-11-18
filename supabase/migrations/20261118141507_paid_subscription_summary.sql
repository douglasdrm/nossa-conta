create function nossa_conta_private.paid_subscription_summary() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cycle',c.cycle,'amount_cents',c.amount_cents,
    'method',case when c.provider_subscription_id is null then 'pix' else 'card' end,
    'valid_until',c.paid_until
  )
  from nossa_conta_private.nc_production_charges c
  where c.household_id=nossa_conta_private.current_household()
    and c.provider_environment='production' and c.provider_name='asaas'
    and c.status in ('CONFIRMED','RECEIVED') and c.provider_verified_at is not null
    and c.paid_until>now()
  order by c.paid_until desc,c.created_at desc
  limit 1
$$;
create function public.nc_paid_subscription_summary() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select nossa_conta_private.paid_subscription_summary()
$$;
revoke all on function nossa_conta_private.paid_subscription_summary(),public.nc_paid_subscription_summary()
  from public,anon,authenticated,service_role;
grant execute on function nossa_conta_private.paid_subscription_summary(),public.nc_paid_subscription_summary() to authenticated;
