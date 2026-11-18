-- Courtesies can have a long finite validity chosen by the administrator.
create or replace function nossa_conta_private.admin_courtesy(p_household uuid,p_until timestamptz,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not nossa_conta_private.is_system_admin() then raise exception 'admin_required';end if;
 if p_until is null or not pg_catalog.isfinite(p_until) then raise exception 'invalid_expiration';end if;
 insert into public.nc_subscriptions(household_id,valid_until,reason,granted_by) values(p_household,p_until,trim(p_reason),auth.uid())
 on conflict(household_id) do update set valid_until=excluded.valid_until,reason=excluded.reason,granted_by=excluded.granted_by,updated_at=now();
 insert into public.nc_admin_audit(actor_id,action,target_id) values(auth.uid(),case when p_until>now() then 'courtesy_granted' else 'courtesy_revoked' end,p_household);
end $$;
