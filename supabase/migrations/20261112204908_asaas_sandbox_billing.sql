-- Sandbox records never grant entitlements or alter courtesy subscriptions.
create table public.nc_billing_orders (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.nc_households(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 environment text not null default 'sandbox' check(environment='sandbox'),
 cycle text not null check(cycle in ('monthly','quarterly','yearly')),
 method text not null check(method in ('card','pix')),
 amount integer not null check(amount>0),
 checkout_id text unique,
 status text not null default 'creating' check(status in ('creating','pending','paid','canceled','expired','failed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '60 minutes'
);
create index nc_billing_orders_household_idx on public.nc_billing_orders(household_id);
create index nc_billing_orders_user_idx on public.nc_billing_orders(user_id);
alter table public.nc_billing_orders enable row level security;
revoke all on public.nc_billing_orders from public,anon,authenticated;
grant select on public.nc_billing_orders to authenticated;
create policy billing_admin_read on public.nc_billing_orders for select to authenticated using((select nossa_conta_private.is_system_admin()));

create table nossa_conta_private.billing_config(singleton boolean primary key default true check(singleton),token_hash text not null check(length(token_hash)=64));
create table nossa_conta_private.billing_events(id text primary key,order_id uuid not null references public.nc_billing_orders(id) on delete cascade,status text not null,created_at timestamptz not null default now());
revoke all on nossa_conta_private.billing_config,nossa_conta_private.billing_events from public,anon,authenticated;

create function nossa_conta_private.billing_reserve(p_cycle text,p_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid; o public.nc_billing_orders; price integer;
begin
 if not nossa_conta_private.is_system_admin() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then raise exception 'admin_required';end if;
 select id into h from public.nc_households where owner_id=auth.uid();
 if h is null then raise exception 'household_owner_required';end if;
 price:=case p_cycle when 'monthly' then 1490 when 'quarterly' then 3990 when 'yearly' then 11990 end;
 if price is null or p_method not in ('card','pix') or p_method is null then raise exception 'invalid_plan';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,42));
 -- A single unresolved attempt avoids duplicate recurrent subscriptions.
 select * into o from public.nc_billing_orders where user_id=auth.uid() and status in ('creating','pending') and expires_at>now() order by created_at desc limit 1;
 if o.id is not null then
  if o.cycle<>p_cycle or o.method<>p_method then raise exception 'checkout_already_pending';end if;
  return to_jsonb(o)||jsonb_build_object('reused',true);
 end if;
 insert into public.nc_billing_orders(household_id,user_id,cycle,method,amount) values(h,auth.uid(),p_cycle,p_method,price) returning * into o;
 return to_jsonb(o)||jsonb_build_object('reused',false);
end $$;
create function public.nc_billing_reserve(p_cycle text,p_method text) returns jsonb language sql security invoker set search_path='' as $$select nossa_conta_private.billing_reserve(p_cycle,p_method)$$;
revoke all on function nossa_conta_private.billing_reserve(text,text),public.nc_billing_reserve(text,text) from public,anon;
grant execute on function nossa_conta_private.billing_reserve(text,text),public.nc_billing_reserve(text,text) to authenticated;

grant usage on schema nossa_conta_private to anon;
alter table nossa_conta_private.billing_config enable row level security;
alter table nossa_conta_private.billing_events enable row level security;

-- Only server-held token authorizes provider results. No service-role key in the app.
create function nossa_conta_private.billing_result(p_token text,p_order uuid,p_checkout text,p_status text,p_event text default null,p_amount integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare o public.nc_billing_orders;
begin
 if p_token is null or length(p_token)<32 or not exists(select 1 from nossa_conta_private.billing_config where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) then raise exception 'invalid_billing_token';end if;
 if p_status not in ('pending','paid','canceled','expired','failed') or p_status is null then raise exception 'invalid_status';end if;
 select * into o from public.nc_billing_orders where (p_order is not null and id=p_order) or (p_order is null and checkout_id=p_checkout) for update;
 if o.id is null then return true;end if;
 if o.checkout_id is not null and o.checkout_id is distinct from p_checkout then raise exception 'checkout_mismatch';end if;
 if p_amount is distinct from o.amount then raise exception 'amount_mismatch';end if;
 if p_event is not null and o.checkout_id is null then return false;end if;
 if p_event is not null then
  if length(p_event)>250 then raise exception 'invalid_event';end if;
  insert into nossa_conta_private.billing_events(id,order_id,status) values(p_event,o.id,p_status) on conflict do nothing;
  if not found then return true;end if;
 end if;
 -- Redirects cannot call this function; stale notifications cannot undo a paid checkout.
 update public.nc_billing_orders set checkout_id=coalesce(checkout_id,p_checkout),status=case when status='paid' then 'paid' else p_status end,updated_at=now() where id=o.id;
 return true;
end $$;
create function public.nc_billing_result(p_token text,p_order uuid,p_checkout text,p_status text,p_event text default null,p_amount integer default null) returns boolean language sql security invoker set search_path='' as $$select nossa_conta_private.billing_result(p_token,p_order,p_checkout,p_status,p_event,p_amount)$$;
revoke all on function nossa_conta_private.billing_result(text,uuid,text,text,text,integer),public.nc_billing_result(text,uuid,text,text,text,integer) from public;
grant execute on function nossa_conta_private.billing_result(text,uuid,text,text,text,integer),public.nc_billing_result(text,uuid,text,text,text,integer) to anon,authenticated;
