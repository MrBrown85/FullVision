-- Undo for migrations/2026111310_list_course_submissions_since.sql.
-- The function is read-only and nothing else depends on it; a browser that
-- still calls it gets "function not found" and must be on a release that
-- reads with list_course_submissions (release the client change's revert
-- first).
drop function if exists public.list_course_submissions_since(uuid, text);
