# Rebuilding the database from the repo

An empty PostgreSQL 17 on your own computer, loaded from files in this repo,
ends up with the same structure as `gradebook-prod`. Structure means schemas,
tables, columns, keys, indexes, triggers, row security policies, functions,
procedures and grants. No data.

This is the base for tests of the security rules (who can read which rows)
and for a rehearsed restore. Never run any of it against `gradebook-prod` or
any Supabase project. `scripts/db-rebuild.mjs` refuses any host but
`127.0.0.1`.

## Where the structure comes from

Two committed sources, both read from the live database's system catalogs,
never from a row of an app table:

- **`docs/schema.generated.sql`**, the snapshot CI keeps equal to live. It
  gives the tables: columns, defaults, constraints, indexes and triggers.
- **`migrations/baseline/`**, printed by `scripts/db-baseline.sql` and run by
  the Database baseline workflow (`.github/workflows/db-baseline.yml`) as the
  read-only `fv_schema_reader` role. It gives what the snapshot cannot:

| File                    | What it holds                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-supabase-stubs.sql` | Written by hand: the pieces Supabase gives every project that the app's SQL names (below). The only file not printed from live.                                                               |
| `05-schemas.sql`        | `student_submit` and `fv_private`.                                                                                                                                                            |
| `10-types.sql`          | Types (`public.score_result`), enums and domains.                                                                                                                                             |
| `20-sequences.sql`      | Sequences an identity column does not make for itself.                                                                                                                                        |
| `30-functions.sql`      | Every function and procedure in `public`, `student_submit` and `fv_private`, whole, as `pg_get_functiondef` prints it.                                                                        |
| `40-views.sql`          | Views, each after the views it reads.                                                                                                                                                         |
| `50-table-extras.sql`   | Policies (permissive or restrictive), identity columns, the realtime publication's table, the trigger on `auth.users`, the policies on `storage.objects`, and the event trigger `ensure_rls`. |
| `60-grants.sql`         | Grants to `anon`, `authenticated`, `service_role` and `public` on the app's schemas, tables, sequences, columns, routines and types.                                                          |
| `function-md5.txt`      | One line per function and procedure: its signature, the md5 of its definition, and the definition's length. For the proof.                                                                    |
| `checks.txt`            | Information only, not loaded: extensions, schemas, event triggers, default privileges, and anything the baseline does not rebuild.                                                            |

Left out on purpose: `fv_legacy` (old calculation code no role can reach)
and `fv_backup` (copies of rows).

The stubs give an empty PostgreSQL: the roles `anon`, `authenticated`,
`service_role` and `authenticator`; `auth.uid()`, `auth.jwt()`, `auth.role()`
and `auth.users`; `storage.buckets`, `storage.objects` and
`storage.foldername()`; `pgcrypto` and `uuid-ossp` in `extensions`; the
`supabase_realtime` publication; and empty stand-ins for pg_cron, pg_net and
Vault. They are written from what the app names, not copied from Supabase.

## The order a rebuild loads

`scripts/db-rebuild.mjs` loads each step in one transaction and stops at the
first error, printing the statement that failed:

1. the stubs, the schemas, the types and the sequences;
2. the tables from the snapshot, with bare columns;
3. the functions and procedures (`check_function_bodies` is off: a body is
   read when it runs, so the order needs nothing else first);
4. from the snapshot: defaults, constraints (foreign keys last), indexes,
   triggers, and row security on;
5. views, then `50-table-extras.sql`, then grants.

## Rebuild on this Mac

This Mac has no Postgres, `psql` or Docker. A local PostgreSQL 17 runs from
an npm package, in a folder outside the repo. Nothing is added to
`package.json`.

```bash
mkdir -p ~/align-db-scratch && cd ~/align-db-scratch
npm init -y && npm install embedded-postgres@17.11.0-beta.19   # newest 17.x; the untagged latest is 18
B=$PWD/node_modules/@embedded-postgres/darwin-arm64/native/bin
$B/initdb -D $PWD/data -U postgres -A trust -E UTF8
$B/pg_ctl -D $PWD/data -o "-p 54417 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l $PWD/pg.log start
```

The package has no `psql`. `db-rebuild.mjs` runs whatever `PSQL` names, so on
this Mac point it at a small stand-in that talks to Postgres through the
`pg8000` Python package (`python3 -m pip install --target <dir> pg8000`). It
needs to handle only `-f`, `-c`, `-1`, `-A`, `-t` and `-q`, in the order
given, and to report an error as `psql:<file>:<line>: ERROR: ...`. On a
computer with `psql`, leave `PSQL` unset.

Then, from the repo:

```bash
$PSQL postgresql://postgres@127.0.0.1:54417/postgres -c "create database fv_rebuild"
DATABASE_URL=postgresql://postgres@127.0.0.1:54417/fv_rebuild node scripts/db-rebuild.mjs --check
```

Stop the server when you finish: `$B/pg_ctl -D $PWD/data stop`. Roles belong
to the whole server, so a second database on it reuses them. The stubs make
a role only when it is missing.

## What the proof compares

`--check` proves the rebuild three ways.

1. **The snapshot.** It runs `scripts/schema-snapshot.sql`, the query CI
   runs against live, on the rebuilt database, and compares the answer with
   `docs/schema.generated.sql`. The policies in that answer come from
   `50-table-extras.sql`, not from the snapshot, so they are checked against
   a second source. The query runs with a search path of `pg_catalog` alone,
   which prints every name with its schema, as the live answer does.
2. **The functions.** It runs `scripts/db-baseline.sql` on the rebuilt
   database and compares its `function-md5.txt` with the committed one.
3. **The grants.** The same run's `60-grants.sql` against the committed one.
   The other printed parts are compared too.

**Result (2026-11-13, PostgreSQL 17.11):** all three match. The one
difference the check accepts, by name: `rubric_score_modifier_check` and
`tag_score_modifier_check`. Live stores them with a nested `AND` (they were
written with `between`), and printed and loaded again PostgreSQL flattens it.
The two allow the same rows. The check accepts a difference only on those
two constraints, and only when the lines are equal once every bracket is
taken out.

## The security rule tests

`npm run test:db` (`tests/db/run.mjs`) rebuilds the structure into a fresh
database, with `--check`, and then tests who can see what on it. Point
`DATABASE_URL` at any database on a local PostgreSQL 17 server; the run
makes its own database beside it and drops it at the end (`KEEP_DB=1` keeps
it). CI runs it on every pull request, in the Database Rules job, against a
`postgres:17` container. No secrets, no data.

It seeds two teachers, A and B, through the app's own write functions where
it can (`tests/db/seed.sql`). Then, with every table and function read from
the catalogs at that moment:

- **Tables.** Each table must have an owner in `tests/db/table-owners.mjs`,
  so a new table fails the run until someone decides whose rows it holds.
  Acting as A, no read returns a row of B's, no update or delete reaches
  one, and a copy of B's row is refused. A visitor who is not signed in
  reads and writes nothing.
- **Functions.** A visitor may run none. Each function A may run is called
  with B's ids and again with A's own (`tests/db/function-args.mjs` builds
  the arguments). B's rows must not change, A's rows must not take in B's
  words, and nothing of B's may come back. The run prints how each call was
  refused, and lists the few it could not prove.
- **The student page.** Only `service_role`, the edge functions' key, may
  run anything in `student_submit`. A teacher and a visitor are refused.

What this proves: the row security policies, grants and functions, as last
refreshed into `migrations/baseline/`, keep the two teachers apart. What it
does not cover: the files in Storage, the edge functions' own code, Supabase's
settings (sign-in, the API server, keys), or any change made to
`gradebook-prod` since the baseline was refreshed. On this Mac, run it with
the `PSQL` stand-in above.

## What is not covered

- **Data.** No rows, ever. No student data leaves `gradebook-prod`.
- **Storage files** and the `student-photos` bucket's row in
  `storage.buckets`. They are data, held by Supabase's Storage service.
- **Sign-in accounts** (`auth.users` rows) and the rest of Supabase's own
  `auth` schema.
- **Secrets**: Vault entries, API keys, the edge functions' environment.
- **Edge functions** (`supabase/functions/`). They deploy separately.
- **Scheduled jobs.** pg_cron's jobs are rows in `cron.job`. The functions
  they call are in the baseline.
- **Default privileges** (what a new object gets). `checks.txt` lists them.
  Every object that exists has its grants in `60-grants.sql`.
- **Comments** on tables and functions.
- **Supabase's own pieces** beyond the stubs: the real `auth`, `storage` and
  `realtime` schemas, its event triggers and its extensions.

## Refreshing the baseline when a migration lands

When a migration is applied to `gradebook-prod`, CI's snapshot check makes
the same PR update `docs/schema.generated.sql`. Then refresh the baseline:

1. Run the workflow: Actions, Database baseline, Run workflow (or
   `gh workflow run db-baseline.yml --ref <branch>`).
2. Download its output:
   `gh run download <run id> -n db-baseline -D /tmp/fv-baseline`.
3. Write it into `migrations/baseline/`:
   `node scripts/db-rebuild.mjs --import /tmp/fv-baseline/db-baseline.out`.
4. Rebuild a fresh local database with `--check`. All three must match.
5. Commit the changed files.

A baseline left stale shows itself: `--check` fails on the snapshot or on the
functions as soon as `docs/schema.generated.sql` moves on.
