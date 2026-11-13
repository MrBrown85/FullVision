-- Printed by scripts/db-baseline.sql from gradebook-prod's system catalogs.
-- Don't edit by hand: refresh it with the Database baseline workflow (docs/database-rebuild.md).
create type public.score_result as (
  kind text,
  value numeric
);
