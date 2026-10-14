-- Signed-out callers can no longer run database functions (2026-10-13).
--
-- Every function in public was executable by anon through PUBLIC's default
-- EXECUTE, so /rest/v1/rpc/* answered without a session; the security
-- advisor flagged eight SECURITY DEFINER helpers, among them the audit
-- writers _score_audit_diff and _term_rating_audit_field. The app calls
-- functions only after sign-in (bootstrap_teacher and restore_teacher run
-- once the session exists), and anon has no table grants.
--
-- authenticated keeps its explicit grants: the SECURITY INVOKER RPCs need
-- EXECUTE on helpers such as fv_idem_check and _score_audit_diff.
-- service_role relied on PUBLIC, so it gets an explicit grant. Trigger
-- functions don't check EXECUTE when they fire.

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to service_role;

-- Functions created later start the same way.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
