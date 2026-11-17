-- Run as project database administrator after enabling Supabase Cron and pg_net.
-- Store the Vercel NC_PRODUCTION_PAYMENT_WORKER_TOKEN as a private Vault secret
-- named nc_production_payment_worker_token. Never put the token in this file.
-- To stop dispatch: select cron.unschedule('nc-asaas-payment-retries');

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets
    where name='nc_production_payment_worker_token' and length(decrypted_secret) between 32 and 255
      and decrypted_secret !~ '[[:space:]]')
  then raise exception 'Configure the worker credential in Vault before scheduling'; end if;
end $$;

select cron.schedule('nc-asaas-payment-retries', '* * * * *', $job$
  select net.http_post(
    url := 'https://nossaconta.unodev.com.br/api/internal/production-payment-worker',
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.decrypted_secret,
                                  'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets s
  where s.name = 'nc_production_payment_worker_token'
    and exists (select 1 from nossa_conta_private.nc_production_inbox_control where singleton and enabled)
    and exists (select 1 from nossa_conta_private.nc_production_reconciliation_control where singleton and enabled)
    and exists (
      select 1 from nossa_conta_private.nc_production_event_inbox
      where (state in ('pending','retry') and available_at<=now())
        or (state='processing' and leased_until<now())
    )
$job$);
