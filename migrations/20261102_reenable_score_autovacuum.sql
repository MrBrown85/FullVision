-- Routine clean-up (autovacuum) is back on for the six score tables
-- (2026-11-01, with Colin's OK).
--
-- It was turned off by hand on 2026-10-28, after a misclicked Delete
-- Assignment, to keep the deleted rows on disk in case the lost marks could
-- be read back. They can't be without superuser access, and the project is
-- now on Supabase Pro with daily backups, so the tables go back to the
-- default settings.

alter table public.assessment reset (autovacuum_enabled);
alter table public.assessment_tag reset (autovacuum_enabled);
alter table public.rubric_check_score reset (autovacuum_enabled);
alter table public.rubric_score reset (autovacuum_enabled);
alter table public.score reset (autovacuum_enabled);
alter table public.tag_score reset (autovacuum_enabled);
