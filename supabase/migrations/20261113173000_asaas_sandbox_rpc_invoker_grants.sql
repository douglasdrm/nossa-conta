-- Both public wrappers are SECURITY INVOKER. The caller needs EXECUTE
-- on the internal token-gated functions too; the original migration granted
-- it only on the public wrapper, so invocation failed.
-- Keep the private schema outside the Data API and enforce the separate
-- webhook token hash in both SECURITY DEFINER bodies.
grant execute on function nossa_conta_private.billing_link_subscription(text,uuid,text,text)
  to anon, authenticated;
grant execute on function nossa_conta_private.billing_lifecycle_event(text,text,text,text,text,text,integer)
  to anon, authenticated;
