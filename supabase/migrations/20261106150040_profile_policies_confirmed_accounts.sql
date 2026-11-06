-- Explicit JWT guard complements the permanent-account check in current_household().
alter policy profile_read on public.nc_user_profiles
 using(((select auth.jwt()->>'is_anonymous')::boolean is false) and user_id=(select auth.uid()) and (select nossa_conta_private.current_household()) is not null);
alter policy nc_avatars_own_read on storage.objects
 using(bucket_id='nc-avatars' and ((select auth.jwt()->>'is_anonymous')::boolean is false) and split_part(name,'/',1)=(select auth.uid())::text and (select nossa_conta_private.current_household()) is not null);
alter policy nc_avatars_own_insert on storage.objects
 with check(bucket_id='nc-avatars' and ((select auth.jwt()->>'is_anonymous')::boolean is false) and split_part(name,'/',1)=(select auth.uid())::text and (select nossa_conta_private.current_household()) is not null);
alter policy nc_avatars_own_delete on storage.objects
 using(bucket_id='nc-avatars' and ((select auth.jwt()->>'is_anonymous')::boolean is false) and split_part(name,'/',1)=(select auth.uid())::text and (select nossa_conta_private.current_household()) is not null);
