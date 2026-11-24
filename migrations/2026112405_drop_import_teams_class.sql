-- Drop the unused import_teams_class RPC (2026-11-24).
--
-- No client has called it since the Teams import wizard was removed on
-- 2026-04-23 (commit f618f9b): that wizard never sent its data through
-- this function and lost data on sync. The function stayed for a future
-- Teams import (docs/ROADMAP.md 3.1), but its payload no longer matches
-- the gradebook it would write to, so that import will be designed fresh.
-- Nothing depends on it in the database (pg_depend), and Colin approved the
-- drop on 2026-11-24. No data changes.
--
-- Undo: restore public.import_teams_class(jsonb, uuid) from
-- migrations/baseline/30-functions.sql as of commit 5bbc2ba4 and its grants
-- (authenticated, service_role).

begin;

drop function public.import_teams_class(jsonb, uuid);

commit;
