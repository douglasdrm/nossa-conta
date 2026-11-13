-- Sandbox lifecycle monitoring only. Never changes courtesy or real Premium.
alter table public.nc_billing_orders
  add column provider_subscription_id text unique;

create table public.nc_billing_lifecycle_events (
  id text primary key,
  order_id uuid not null references public.nc_billing_orders(id) on delete cascade,
  resource_type text not null check (resource_type in ('payment','subscription')),
  resource_id text not null,
  event_type text not null,
  amount integer,
  created_at timestamptz not null default now()
);
create index nc_billing_lifecycle_events_order_idx
  on public.nc_billing_lifecycle_events(order_id,created_at desc);
alter table public.nc_billing_lifecycle_events enable row level security;
revoke all on public.nc_billing_lifecycle_events from public,anon,authenticated;
grant select on public.nc_billing_lifecycle_events to authenticated;
create policy billing_lifecycle_admin_read on public.nc_billing_lifecycle_events
  for select to authenticated using ((select nossa_conta_private.is_system_admin()));

-- Only the server's separate webhook token can link a subscription.
create function nossa_conta_private.billing_link_subscription(
  p_token text, p_order uuid, p_checkout text, p_subscription text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from nossa_conta_private.billing_config
    where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex')
  ) then raise exception 'invalid_billing_token'; end if;
  if p_subscription is null or p_subscription !~ '^sub_[a-zA-Z0-9_-]{6,100}$'
    then raise exception 'invalid_subscription'; end if;
  update public.nc_billing_orders
    set provider_subscription_id = p_subscription
    where id = p_order and checkout_id = p_checkout
      and environment = 'sandbox' and method = 'card' and status = 'paid'
      and (provider_subscription_id is null or provider_subscription_id = p_subscription);
  return found;
end $$;
create function public.nc_billing_link_subscription(
  p_token text, p_order uuid, p_checkout text, p_subscription text
) returns boolean language sql security invoker set search_path = ''
as $$ select nossa_conta_private.billing_link_subscription(p_token,p_order,p_checkout,p_subscription) $$;
revoke all on function nossa_conta_private.billing_link_subscription(text,uuid,text,text),
 public.nc_billing_link_subscription(text,uuid,text,text) from public;
grant execute on function public.nc_billing_link_subscription(text,uuid,text,text) to anon,authenticated;

-- Ignore unrelated events from other sites on the shared Asaas account.
-- Only record matched and amount-checked lifecycle notifications; never grant access here.
create function nossa_conta_private.billing_lifecycle_event(
  p_token text, p_event_id text, p_resource text, p_resource_id text,
  p_subscription text, p_event_type text, p_amount integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare o public.nc_billing_orders;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from nossa_conta_private.billing_config
    where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex')
  ) then raise exception 'invalid_billing_token'; end if;
  if p_event_id is null or length(p_event_id) not between 3 and 250
    or p_resource not in ('payment','subscription')
    or p_resource_id is null or length(p_resource_id) not between 3 and 150
    or p_subscription is null or length(p_subscription) not between 3 and 150
    or p_event_type is null or length(p_event_type) not between 5 and 80
    then raise exception 'invalid_event'; end if;
  select * into o from public.nc_billing_orders
    where provider_subscription_id = p_subscription and environment = 'sandbox';
  if o.id is null then return false; end if;
  if p_resource = 'payment' and p_amount is distinct from o.amount
    then return false; end if;
  insert into public.nc_billing_lifecycle_events
    (id,order_id,resource_type,resource_id,event_type,amount)
  values (p_event_id,o.id,p_resource,p_resource_id,p_event_type,p_amount)
  on conflict (id) do nothing;
  return true;
end $$;
create function public.nc_billing_lifecycle_event(
  p_token text, p_event_id text, p_resource text, p_resource_id text,
  p_subscription text, p_event_type text, p_amount integer
) returns boolean language sql security invoker set search_path = ''
as $$select nossa_conta_private.billing_lifecycle_event(
  p_token,p_event_id,p_resource,p_resource_id,p_subscription,p_event_type,p_amount)$$;
revoke all on function nossa_conta_private.billing_lifecycle_event(text,text,text,text,text,text,integer),
 public.nc_billing_lifecycle_event(text,text,text,text,text,text,integer) from public;
grant execute on function public.nc_billing_lifecycle_event(text,text,text,text,text,text,integer)
  to anon,authenticated;
