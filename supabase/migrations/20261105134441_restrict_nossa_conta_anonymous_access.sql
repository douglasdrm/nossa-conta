-- Junto permits anonymous accounts. Finance data explicitly requires a permanent account.
alter policy household_read on public.nc_households using (((select auth.jwt()->>'is_anonymous')::boolean is false) and id=(select nossa_conta_private.current_household()));
alter policy members_read on public.nc_household_members using (((select auth.jwt()->>'is_anonymous')::boolean is false) and household_id=(select nossa_conta_private.current_household()));
alter policy rules_read on public.nc_recurring_rules using (((select auth.jwt()->>'is_anonymous')::boolean is false) and household_id=(select nossa_conta_private.current_household()));
alter policy amounts_read on public.nc_recurring_amounts using (((select auth.jwt()->>'is_anonymous')::boolean is false) and exists(select 1 from public.nc_recurring_rules r where r.id=rule_id and r.household_id=(select nossa_conta_private.current_household())));
alter policy entries_read on public.nc_entries using (((select auth.jwt()->>'is_anonymous')::boolean is false) and household_id=(select nossa_conta_private.current_household()));
alter policy invites_read on public.nc_household_invites using (((select auth.jwt()->>'is_anonymous')::boolean is false) and exists(select 1 from public.nc_households h where h.id=household_id and h.owner_id=(select auth.uid())));
