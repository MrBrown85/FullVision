# Writing and applying a migration

What must be true before a migration goes to Colin to apply, and how it reaches `gradebook-prod`. The rule itself is CLAUDE.md rule 1: never test against `gradebook-prod`, show Colin the SQL, apply only on his OK. Each item below was learned the hard way, most of them on the first migration batch (Batch A, PR 966) and the first Bulletins migration.

Related: `docs/database-rebuild.md` (an empty PostgreSQL 17 loaded to live's structure) and `migrations/local-test/README.md` (the test harness).

## Only through Supabase's own tools

Student data privacy decides this (DECISIONS, Nov 17 2026). A migration is applied with the Supabase MCP `apply_migration` or, for a file too big for one call, in the Supabase SQL editor signed in as Colin.

- Never store a database credential at GitHub or any other new service: a GitHub Actions workflow that applies migrations would need one, so there is none.
- Don't have the database fetch the file itself (the `pg_net` fetch-from-GitHub method).
- Keep each migration small enough to send whole. Split the work rather than write one large file. A rule repeated across many functions belongs in one shared function.

## Ready to apply means

The repo's chain of migrations is not a full record of live: some live functions differ from their only migration in comments or white space, and some have no migration file at all. So:

1. **Fingerprints from live.** Every existing function the migration patches, and every one the test harness copies, is checked against live `md5(pg_get_functiondef(...))`. Build the expected values locally and send one read-only query with them embedded as a `VALUES` list that returns only the rows that differ. Never copy hashes by hand.
2. **Guards first.** Patch a function in place only behind a guard that stops, with nothing changed, if the live body is not the expected one. Guards first, one transaction, a lock timeout, safe to run twice.
3. **PostgreSQL 17, collated like live.** Live runs PostgreSQL 17 with ICU collation (`datlocprovider = 'i'`, `datlocale = 'en-US'`). Test on 17, in a database made the same way: `create database … template template0 locale_provider icu icu_locale 'en-US' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8'`. macOS's libc `en_US.UTF-8` does not sort like ICU. Any fingerprint built with an aggregate orders by `collate "C"`.
4. **Nothing depends on the server.** Nothing in the file may depend on collation, locale, time zone, version, search path or the role that runs it (`apply_migration` runs as `postgres`, which is not a superuser on Supabase). Every review answers that question.
5. **No `\uXXXX` in SQL sent through the Supabase tool.** `apply_migration` and `execute_sql` turn `\uXXXX` into the real character before PostgreSQL sees it, so the body that lands differs from the file and an md5 guard refuses it. Use `chr()` or the eight-digit `\UXXXXXXXX` form. When a self-checking migration refuses on live, measure the route with a read-only `select length('…')` before guessing at a cause.
6. **A tested undo.** A fast stop (drop the new triggers so saves behave exactly as before) and a full removal, both proven to leave the catalog and the rows as they were.
7. **Pre-checks.** Counts of anything the migration would hide or refuse, run on live, written into the file's header with the query.
8. **A concurrency test** that loads the real definitions of every function that writes the affected tables and runs them against each other. Batch A's three deadlocks had one cause (two locks per class taken in different orders); the fix was one lock per class.
9. **What the app already sends.** Never tighten a server rule until it is known what the app already running in teachers' browsers sends: a write the server refuses becomes a dead letter in that teacher's outbox.
10. **Readable.** Comments in the SQL are re-read after the last round of fixes. The pull request body is one review a non-specialist can read: what each file does, what it does to existing rows, the results, how to apply it, and "what you accept by applying this".

A migration that deletes or rewrites existing rows, or changes a grade, also needs Colin's review in the pull request (CLAUDE.md rule 2).

## Edge functions

`student-submit` and `teacher-cards` are deployed with Supabase's CLI from a checkout at the commit, never by sending the text through the Supabase tool (which rewrites `\uXXXX`, and some released files rely on those escapes):

```bash
npx --yes supabase@latest functions deploy student-submit --project-ref novsfeqjhbleyyaztmlh --no-verify-jwt --use-api --yes
```

After every deploy, download the live function (`functions download`) into a scratch folder and compare each file with the commit (`cmp`).
