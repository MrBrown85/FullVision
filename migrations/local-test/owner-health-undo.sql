-- Undo of migrations/2026112603_owner_health.sql: removes the owner-only
-- counts function and its one-table owner list. Nothing else used either.
begin;
set local lock_timeout = '5s';
drop function if exists public.fv_owner_health();
drop table if exists fv_private.owner;
commit;
