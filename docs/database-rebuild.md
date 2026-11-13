# Rebuilding the database from the repo

The goal: an empty PostgreSQL 17 on your own computer, loaded from files in
this repo, ends up with the same structure as `gradebook-prod`. Structure
means schemas, tables, columns, keys, indexes, triggers, row security
policies, functions and grants. No data.

This is the base for tests of the security rules (who can read which rows)
and for a rehearsed restore. Never run any of it against `gradebook-prod` or
any Supabase project. `scripts/db-rebuild.mjs` refuses any host but
`127.0.0.1`.

## Where it stands

**The repo cannot rebuild the database yet.** Two things are missing:

1. **No baseline.** `docs/schema.generated.sql` is a readable summary, not
   loadable SQL. It lists function signatures without their bodies, and it
   leaves out grants, procedures, composite types (for example
   `public.score_result`), event triggers, views and sequences. The real
   baseline has to be a schema-only dump of the live database
   ([below](#getting-the-baseline-dump)). It goes in
   `migrations/baseline/10-schema.sql`.
2. **The migrations cannot be replayed.** The tables were first made in April
   2026 by migrations applied outside the repo. The first file in
   `migrations/`, `20260423_color_format_validation.sql`, alters `course`,
   and no file creates it. Replay stops there (checked 2026-11-12).

What is here and proved:

- `migrations/baseline/00-supabase-stubs.sql`: the roles, schemas and
  functions Supabase gives every project that the app's SQL names. They are
  small stand-ins, not Supabase's code: `anon`, `authenticated`,
  `service_role`, `authenticator`; `auth.uid()`, `auth.jwt()`, `auth.role()`
  and `auth.users`; `storage.buckets`, `storage.objects` and
  `storage.foldername()`; `pgcrypto` and `uuid-ossp` in `extensions`; the
  `supabase_realtime` publication; and empty stand-ins for pg_cron, pg_net
  and Vault.
- `scripts/db-rebuild.mjs`: loads the stubs, then the baseline. Each file
  loads in one transaction. It stops at the first error and prints the
  statement that failed.
- `--from-snapshot`: loads a **shell** made from `docs/schema.generated.sql`
  instead of a baseline. The shell has every table, column, constraint,
  index, trigger and policy the snapshot lists, and every function with a
  body that only raises an error. It cannot run the app. It proves that the
  stubs hold what the structure needs, and that the loader works.

## Rebuild on this Mac

This Mac has no Postgres, `psql` or Docker. A local PostgreSQL 17 runs from
an npm package, in a folder outside the repo. Nothing here is added to
`package.json`.

```bash
mkdir -p ~/align-db-scratch && cd ~/align-db-scratch
npm init -y && npm install embedded-postgres@17.11.0-beta.19   # newest 17.x; the untagged latest is 18
B=$PWD/node_modules/@embedded-postgres/darwin-arm64/native/bin
$B/initdb -D $PWD/data -U postgres -A trust -E UTF8
$B/pg_ctl -D $PWD/data -o "-p 54417 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l $PWD/pg.log start
```

The package has no `psql`. `db-rebuild.mjs` runs whatever `PSQL` names, so on
this Mac point it at a small stand-in that speaks to Postgres through the
`pg8000` Python package (`python3 -m pip install --target <dir> pg8000`). It
needs to handle only `-f`, `-c`, `-1`, `-A`, `-t` and `-q`, and to report an
error as `psql:<file>:<line>: ERROR: ...`. On a computer with `psql`, leave
`PSQL` unset.

Then, from the repo:

```bash
# make an empty database (with psql, or the stand-in)
$PSQL postgresql://postgres@127.0.0.1:54417/postgres -c "create database fv_rebuild"

# the shell, and the comparison with the snapshot
DATABASE_URL=postgresql://postgres@127.0.0.1:54417/fv_rebuild node scripts/db-rebuild.mjs --from-snapshot --check

# once migrations/baseline/10-schema.sql exists, in a fresh empty database
DATABASE_URL=postgresql://postgres@127.0.0.1:54417/fv_rebuild2 node scripts/db-rebuild.mjs --check
```

Stop the server when you finish: `$B/pg_ctl -D $PWD/data stop`. Roles belong
to the whole server, so a second database on it reuses them. The stubs make
a role only when it is missing.

## What the proof compares

`--check` runs `scripts/schema-snapshot.sql`, the query CI runs against
`gradebook-prod`, on the rebuilt database. It puts the same header on the
answer that `scripts/schema-snapshot.mjs` does, and compares the result with
`docs/schema.generated.sql`. It prints every line found on only one side.

The live reader's answer names everything with its schema (`public.course`),
so the check runs the query with an empty search path (`pg_catalog` only) to
print names the same way.

**Result with the shell (2026-11-12, PostgreSQL 17.11):** every line matches
but two. In `rubric_score_modifier_check` and `tag_score_modifier_check`,
the live text is `(((a AND b) AND c AND d))` and the rebuilt text is
`((a AND b AND c AND d))`. The live check was written with `between`, which
PostgreSQL stores as a nested `AND`. Reloading the printed text flattens it.
The two checks allow exactly the same rows. A real dump should give the
same two lines, because `pg_dump` prints checks with the same function. That
is not yet seen.

The shell also makes `public.score_result` as an empty type. The snapshot
names it in a function's result but does not list its fields. The snapshot
cannot see the difference.

## What is not covered

- **Data.** No rows, ever. No student data leaves `gradebook-prod`.
- **Storage files** and the `student-photos` bucket's row in `storage.buckets`.
  They are data, held by Supabase's Storage service.
- **Sign-in accounts** (`auth.users` rows) and everything else in Supabase's
  own `auth` schema.
- **Secrets**: Vault entries, API keys, the edge functions' environment.
- **Edge functions** (`supabase/functions/`). They deploy separately.
- **Scheduled jobs.** pg_cron's jobs are rows in `cron.job`, so they are
  data. The functions that schedule them are in the baseline.
- **Supabase's own pieces** beyond the stubs: the real `auth`, `storage` and
  `realtime` schemas, `supautils`, and Supabase's event triggers.

## Getting the baseline dump

Someone with the database password runs this once, on a computer with
PostgreSQL 17 client tools. It reads structure only. It needs a role that
may lock every table for reading (for example `postgres`); the CI role
`fv_schema_reader` cannot.

```bash
pg_dump "$LIVE_URL" \
  --schema-only \
  --schema=public --schema=student_submit \
  --no-owner \
  --no-tablespaces --no-security-labels --no-subscriptions \
  --file=migrations/baseline/10-schema.sql
```

- `--schema-only`: structure, no rows.
- `--schema=public --schema=student_submit`: the app's two schemas. Leave out
  `fv_backup` (copies of rows) and `fv_legacy` (old code no role can reach).
- `--no-owner`: every object ends up owned by whoever loads it. Owners on
  Supabase are Supabase's roles (`postgres`, `supabase_admin`).
- Grants stay in: they are what the security tests check.

Then edit the file, by hand or with a short script, before committing it:

1. Remove any `GRANT` or `REVOKE` that names a role the stubs do not make
   (for example `postgres`, `supabase_admin`, `dashboard_user`), and any
   `ALTER DEFAULT PRIVILEGES FOR ROLE` line. The stubs make the roles the
   app grants to: `anon`, `authenticated`, `service_role`.
2. Remove `CREATE SCHEMA public;` if it is there. Every database has it.
3. Remove `CREATE PUBLICATION supabase_realtime` if it is there. The stubs
   make it. Keep `ALTER PUBLICATION ... ADD TABLE`.
4. Check that the file holds no `COPY` or `INSERT` lines. It should not:
   `--schema-only` writes none.

Three things live outside the two schemas and are not in that dump: the
trigger on `auth.users` (`fv_teacher_sign_in_deleted`), the policies on
`storage.objects`, and the event trigger `ensure_rls`. Add them in
`migrations/baseline/20-outside-public.sql`, copied from
`pg_dump --schema-only --schema=storage --table=storage.objects` and
`pg_dump --schema-only` (for the event trigger), keeping only those
statements.

Run `node scripts/db-rebuild.mjs --check` on a fresh empty database. Every
line that differs is listed. The two `modifier_check` lines above are
expected.

## Refreshing the baseline when a migration lands

The baseline is the structure on the day it was dumped. When a migration is
applied to `gradebook-prod`, CI's schema snapshot check makes the same PR
update `docs/schema.generated.sql`. From then on `--check` on a fresh
rebuild lists the new lines as missing, so a stale baseline shows itself.

To refresh it, dump again as above after the apply, redo the four edits,
and replace `10-schema.sql` in its own PR. `--check` on a fresh database
must then match `docs/schema.generated.sql` again, apart from the two
`modifier_check` lines.
