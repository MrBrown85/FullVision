# Testing report-form migrations on a throwaway Postgres

`harness.sql` is a stand-in for the parts of `gradebook-prod` the three
report-form migrations touch: the `anon` / `authenticated` / `service_role` roles, `auth.uid()`
read from `request.jwt.claim.sub`, the `teacher`, `course`, `student` and
`enrollment` tables with RLS, `fv_idempotency` with `fv_idem_check` /
`fv_idem_store`, `fv_owns_course` / `fv_owns_enrollment`, and two seeded
teachers (A owns course `aaaaaaaa-…` with two students, B owns `bbbbbbbb-…`
with one).

`run.py file.sql…` splits each file into statements and runs them in order.
`functional.py` runs every RPC as Teacher A, then as Teacher B, then with no
JWT, then as `anon`, inside one transaction that is rolled back.

```bash
PGPORT=54329 python3 run.py harness.sql ../20261020_report_template.sql ../20261020_report_issue.sql ../20261020_guardian.sql
PGPORT=54329 python3 functional.py
```

Needs the `pg8000` package (pure Python; point `PG8000_PATH` at it if it is
not installed) and an empty database (`PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, `PGPASSWORD`). Never point it at `gradebook-prod`.

Result on 2026-10-20 (Postgres 17.10, local): 46 of 46 checks pass. The run
found one defect, fixed before the apply: `jsonb_typeof(form->'front') =
'array'` is NULL when `front` is missing, and a NULL check passes, so a form
with no `front` array was accepted. The check now wraps it in `coalesce`.

## Student questionnaires (2026-10-25)

`questionnaires.py` exercises `20261025_questionnaires_tables_and_functions.sql`
and `_templates.sql` the same way:

```bash
PGPORT=54331 python3 run.py harness.sql ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql
PGPORT=54331 python3 questionnaires.py
```

Roles are shared by every database in a Postgres instance, so in a second
fresh database load `harness.sql` without its three `create role` lines.

## Student submissions (2026-10-25)

`student_submit.py` exercises `20261025_student_submit.sql`: `open` and
`submit` as the edge function calls them (service_role), what anon,
authenticated and Teacher B can reach, single use, dates in the class's time
zone, revoked and withdrawn, token expiry and the double tap, every answer
check, the copy to `core_self_assessment`, the three rate limits, and what the
log keeps. `student-submit-prelude.sql` adds the prod columns the harness
leaves out.

```bash
PGPORT=54331 PGDATABASE=fv_ss python3 run.py harness.sql student-submit-prelude.sql \
  ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql \
  ../20261025_student_submit.sql ../20261025_student_submit_phone.sql ../20261025_student_submit_token_80.sql
PGPORT=54331 PGDATABASE=fv_ss python3 student_submit.py
```

With `20261025_student_submit_phone.sql` (PR 7: typed-in choices, a why per
competency, the grade, the block and the course goal), 77 of 77 pass on
2026-10-25. With `20261025_student_submit_token_80.sql` (tokens last a
class block, 80 minutes), 78 of 78.

Result on 2026-10-24 (Postgres 17, local): 69 of 69 pass, and
`questionnaires.py` still passes 42 of 42 against the rewritten
`issue_access_codes`.
Result on 2026-10-25 (Postgres 17.10, local): 42 of 42 checks pass.

## Phone reports (2026-10-25)

`phone_reports.py` exercises `20261025_phone_reports.sql`: sending, report
codes, the birthday check (no birthday, wrong birthdays and the lockout),
the reply (once, after the check, the code still working for reading),
update, close and the last day, as Teacher A, Teacher B and anon. Load every
file in `student_submit.py`'s list, then:

```bash
PGPORT=54331 PGDATABASE=fv_ss python3 phone_reports.py
```

Result on 2026-10-25: 37 of 37, with `student_submit.py` at 79 of 79 (its
lockout test now expects 60 misses per address) and `questionnaires.py` at
42 of 42.

## Term rating habits and approval (2026-10-28)

`term_rating_habits.py` exercises `20261028_term_rating_habits_approval.sql`.
`term-rating-prelude.sql` adds `term_rating`, its audit and link tables, and
`save_term_rating` and a `get_class_bundle` stand-in whose term_ratings block
is the live one, so the migration's in-place patch runs against the real
anchor. Habits (stored, replaced whole, Not Seen, every bad value refused,
audited), approval (set, kept on a second approve, cleared by an edited
comment or `approved: false`, audited), the old fields, the bundle's
read-back, and what Teacher B and no JWT can do.

```bash
PGPORT=54331 PGDATABASE=fv_tq python3 run.py harness.sql term-rating-prelude.sql ../20261028_term_rating_habits_approval.sql
PGPORT=54331 PGDATABASE=fv_tq python3 term_rating_habits.py
```

Result on 2026-10-28 (Postgres 17.10, local): 37 of 37.

## Re-approval date (2026-11-02)

`term_rating_reapprove.py` exercises `20261102_term_rating_reapprove_date.sql`:
the first approval, a re-approve with the same or no narrative (keeps the
date), a re-approve with a changed narrative (dated now, audited),
`approved: false`, approving after a clear, and an edit with no `approved`
key (clears). Earlier approvals are backdated by hand, since `now()` is fixed
inside the test's one transaction.

```bash
PGPORT=54331 PGDATABASE=fv_tq python3 run.py harness.sql term-rating-prelude.sql \
  ../20261028_term_rating_habits_approval.sql ../20261031_term_rating_reporting_basis.sql \
  ../20261031_term_rating_draft_meta.sql ../20261102_term_rating_reapprove_date.sql
PGPORT=54331 PGDATABASE=fv_tq python3 term_rating_reapprove.py
```

Result on 2026-11-01 (Postgres 16.2, local): 9 of 9 pass; before the
migration 7 of 9 (the changed-narrative re-approve kept the old date).
`term_rating_habits.py` still passes 37 of 37.

## Reports are read-only (2026-11-07)

`20261107_no_report_reply.sql` was tested on `gradebook-prod` inside a
transaction that always rolls back (it ends by raising an error): the four
teacher functions, `student_submit.check` and `student_submit.submit` were
replaced, the reply questionnaire and template deleted, the column dropped
and both kind checks rebuilt. `_phone_report_json` came back without
`reply_questionnaire_id` or `replied_at`, no function still named the
column, a `report_reply` template insert failed the check, and an unknown
token to `submit` still returned `expired`. A read afterwards showed nothing
had changed. `phone_reports.py` and `questionnaires.py` test the Oct 25
migrations as they were and still expect the reply.

## Score RPCs (2026-11-09)

`score_rpcs.py` pins what the twelve score RPCs do today, before Draft and
Returned puts triggers under them (student page build plan, `S0-P1`):
`upsert_score`, `upsert_tag_score`, `upsert_rubric_score`, `fill_rubric`,
`set_rubric_check`, `save_score_comment`, `save_score_report_note`,
`set_score_status`, `clear_score`, `clear_row_scores`, `clear_column_scores`
and `move_rubric_scores`. For each: the rows that result as Teacher A (value,
`modifier`, `status`, comments, the overwrite on a second call, clearing, the
audit rows), then that Teacher B, no JWT and `anon` change nothing.

Two files build the score paths on top of `harness.sql`:

- `score-prelude.sql`: the functions, each copied from the migration that
  last defined it (named above each one). `set_score_status`,
  `save_score_comment`, `clear_row_scores` and `clear_column_scores` have no
  migration; theirs are the live bodies, read from `gradebook-prod` on
  2026-11-09.
- `live-function-md5.txt`: `md5(pg_get_functiondef)` of 22 live functions.
  `score_rpcs.py` compares every function it loads that is in the table (the
  twelve RPCs and `fv_owns_course`, `fv_owns_enrollment`,
  `fv_owns_assessment`), so each is the live one byte for byte. The check
  found one difference from the repo: the live `save_score_report_note` is
  its migration's body with the five blank lines removed.
- `score-tables.sql`: nineteen tables with their constraints, indexes,
  triggers and policies, written by `make-score-tables.py` from
  `docs/schema.generated.sql`. Run the script again when the snapshot
  changes one of them; the first checks in `score_rpcs.py` fail until then.
  They run `scripts/schema-snapshot.sql` here and compare each table, and
  every loaded function's signature, with the live snapshot.

```bash
PGPORT=54329 PGDATABASE=fv_score python3 run.py harness.sql score-prelude.sql score-tables.sql
PGPORT=54329 PGDATABASE=fv_score python3 score_rpcs.py
```

Result on 2026-11-09 (Postgres 18.6, local; production is 17): 175 of 175.

Checks named "today:" pin a gap as it is. Batch A closes two and flips their
checks to "refused": `upsert_rubric_score` takes a criterion that is not on
the assessment's rubric, and `set_score_status` takes Missing on scored
work. The others it found, left as they are:

- Row security on the score tables checks the enrollment only. A teacher
  can save a score for their own student against another teacher's
  assessment, competency or criterion by id. Nothing reads such a row back
  to the other teacher.
- `upsert_tag_score` takes a competency the assessment is not linked to.
- `upsert_score` takes points over the assessment's maximum, and a score on
  Excused or Missing work.
- `clear_score`, `clear_row_scores` and `clear_column_scores` leave ticked
  Advanced Rubric checkboxes (`rubric_check_score`) behind.
- `clear_row_scores` and `clear_column_scores` delete the whole score row,
  so the Overall Comment, the Note for the Report and the status go too;
  `clear_score` has kept them since Nov 3.
- `save_score_comment` stores an empty comment as `''`, not null, and
  `set_score_status(null)` leaves an empty score row.

`import_json_restore`, `duplicate_course` and `duplicate_assessment` are not
loaded: they need most of the schema. Batch A's tests load them.

## The bundle sends created_at (S0-M4, 2026-11-10)

`../2026111001_assessment_created_at_in_bundle.sql` patches `get_class_bundle`
and `get_gradebook` in place so each assessment carries its `created_at`.
Tested here only (no Supabase branch, never `gradebook-prod`).

Two more files build what it needs on top of the score paths:

- `bundle-prelude.sql`: `get_class_bundle` and `get_gradebook`. No one
  migration holds either whole. Each is the migration that last wrote it in
  full, then every later in-place patch run as its migration wrote it, in
  file order, and printed with `pg_get_functiondef` (the file's header lists
  them: 17 patches for the bundle, 3 for `get_gradebook`). The bundle comes
  out as the live function, byte for byte (`live-function-md5.txt`).
  `get_gradebook` comes out as md5 `2876cd40c373b8a59bff4464008c8601`, length
  6816, which the orchestrator confirmed against `gradebook-prod` on Nov 10;
  it is in `live-function-md5.txt` too. Also
  `fv_owns_term_rating`, and four stand-ins for the server's old grade
  calculation that `get_gradebook` calls for its cells (`fv_assessment_overall`
  and three more): they have the live signatures and return nothing, because
  the migration does not touch that part.
- `bundle-tables.sql`: the 17 other tables `get_class_bundle` reads, from the
  live snapshot (`python3 make-score-tables.py bundle`).

```bash
PGPORT=54329 PGDATABASE=fv_bundle python3 run.py harness.sql score-prelude.sql score-tables.sql \
  bundle-prelude.sql bundle-tables.sql
PGPORT=54329 PGDATABASE=fv_bundle python3 bundle_created_at.py
```

`bundle_created_at.py` makes a class with five pieces (two with one date and
one display order, made a second apart), reads both payloads as Teacher A,
Teacher B, with no JWT and as anon, applies the migration and reads them
again. Every assessment then has `created_at`, equal to the table's to the
microsecond; every other key of both payloads is the same, compared key by
key; the other callers get what they got; owner, grants, SECURITY DEFINER,
volatility and `search_path` are unchanged and each body is the old one plus
the one key; no row changes and no class's sync version moves; a browser
sending the version it holds is still told `not_modified`; a second run
changes nothing; and a body that is not the expected one stops the file at
its first check with nothing changed.

Result on 2026-11-10 (Postgres 18.6, local; production is 17): 40 of 40.
`score_rpcs.py` is unchanged at 175 of 175, and `make-score-tables.py` still
writes `score-tables.sql` byte for byte.

## SECURITY DEFINER functions name pg_temp last (S0-M5, 2026-11-10)

`../2026111002_security_definer_search_path.sql` adds `pg_temp` to the end of
the `search_path` of sixteen SECURITY DEFINER functions, so a caller's
temporary table can never stand in for a real one. It replaces no body.
Tested here only (no Supabase branch, never `gradebook-prod`).

It must be applied after S0-M4 (PR 985, applied and merged on Nov 10) and
Batch A (PR 966) and refuses to run before them, so `search_path.py build`
loads the database in that order: Batch A's own list (the harness with
S0-M4's file applied, as live is), then `search-path-prelude.sql`, then
Batch A's four files. S0-M4b (PR 989) may be applied before this file or
after it: the file neither checks for it nor needs it. Until those two PRs
are merged it reads their files from their branches with `git show` and says
so.

Where each of the sixteen comes from:

| Function                                                          | Loaded by                 | Copied from                                                                                                |
| ----------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `fv_owns_course`, `fv_owns_enrollment`, `fv_owns_assessment`      | `score-prelude.sql`       | `20261012_course_soft_delete.sql`                                                                          |
| `get_class_bundle`                                                | `bundle-prelude.sql`      | `20261019_withdraw_students.sql` and 17 later patches, then S0-M4's file                                   |
| `_touch_course_sync_cursor`                                       | `score-prelude.sql`       | `20261103_import_json_restore_full_class.sql`                                                              |
| `_touch_course_sync_cursor_from_trigger`                          | `score-prelude.sql`       | `20261015_course_sync_version.sql`                                                                         |
| `_score_audit_diff`                                               | `score-prelude.sql`       | `20261102_audit_helpers_owner_check.sql`                                                                   |
| `fv_owns_term_rating`                                             | `bundle-prelude.sql`      | `20261012_course_soft_delete.sql`                                                                          |
| `fv_idem_check`                                                   | `search-path-prelude.sql` | `20261016_idempotency_key_lock.sql`                                                                        |
| `fv_idem_store`                                                   | `search-path-prelude.sql` | `20260423_write_path_idempotency.sql`                                                                      |
| `_fv_teacher_sign_in_deleted`, `_fv_release_orphan_teacher_email` | `search-path-prelude.sql` | `20261108_teacher_outlives_sign_in.sql`                                                                    |
| `_term_rating_audit_field`                                        | `search-path-prelude.sql` | `20261102_audit_helpers_owner_check.sql`                                                                   |
| `_touch_teacher_sync_cursor_from_trigger`                         | `search-path-prelude.sql` | `20261022_teacher_sentence_starters.sql`                                                                   |
| `fv_retention_cleanup`                                            | `search-path-prelude.sql` | `20261012_course_soft_delete.sql`                                                                          |
| `rls_auto_enable`                                                 | `search-path-prelude.sql` | **no migration: the repo has none.** The live definition, as `pg_get_functiondef` printed it on 2026-11-10 |

**All sixteen are the live functions, byte for byte.** The migration's header
has one read-only query ("Before the apply") carrying the fingerprint of each
as loaded here; it lists every function whose live definition differs, and
prints it. It was run on `gradebook-prod` on 2026-11-10, after S0-M4 was
applied, and returned one row: `rls_auto_enable`, tested until then from a
stand-in. Its live body (md5 `846ec2fbff751d24b890656d63c3a9bf`, 1223) is
what `search-path-prelude.sql` loads now, and `search_path.py` checks that
fingerprint. The other fifteen matched, and no other SECURITY DEFINER function
in the three schemas lacked `pg_temp`.
`search-path-prelude.sql` also adds `auth.users`, `auth.jwt()`,
`term_rating_audit` (the snapshot's lines), the sentence-starter trigger the
table files leave out, and the event trigger that runs `rls_auto_enable`.

```bash
PGPORT=54331 PGDATABASE=m5_pre python3 search_path.py build
PGPORT=54331 PGDATABASE=m5_pre python3 search_path.py
# and a second database with the migration applied, for the other suites:
PGPORT=54331 PGDATABASE=m5_post python3 search_path.py build
PGPORT=54331 PGDATABASE=m5_post python3 run.py ../2026111002_security_definer_search_path.sql
```

What `search_path.py` checks. Every scenario runs on a connection of its own,
in a transaction that is rolled back.

- **Every caller gets what they got.** 123 calls and trigger firings, as
  Teacher A, Teacher B, with no JWT and as anon: each ownership helper on
  both teachers' records and a deleted class's, the idempotency helpers, the
  two audit writers, the class bundle (whole, compared key for key, and
  `not_modified`), the email release, the five functions no caller may run,
  then a save, each table's route to its class through the cursor trigger, a
  sentence starter, a restore, a deleted sign-in, the purge and a new table.
  Run, then the migration, then run again from the same rows: 123 equal.
- **The temporary-table trick, without the migration and with it.** As
  Teacher B with a temporary `course`, `enrollment`, `assessment` or
  `term_rating`: before, each ownership helper says A's record is B's, and B
  reads A's assessments, a student's note and report comment, removes an
  assessment's competency links and renames it; after, none of that. Before,
  B writes a line into the change history of A's score and A's report
  (`_score_audit_diff`, `_term_rating_audit_field`); after, none. Before,
  `fv_idem_check` returns a result planted in a temporary `fv_idempotency`
  and `fv_idem_store` writes there; after, both use the real table. A
  temporary `score_audit`, `term_rating_audit` or `teacher` took the write
  of an audit writer, the sign-in trigger and the email release; a session
  with temporary copies of the purge's six tables had `fv_retention_cleanup`
  purge those and leave the real class. After, every write lands in the real
  table. `get_class_bundle` and the three cursor functions name every table
  with its schema and were never fooled that way (38 tables shadowed, same
  bundle); what was open in them is type names: a temporary table called
  `jsonb`, `text`, `uuid` or `record` made the call fail before, and does
  nothing after (13 cases across eight functions). The four ownership helpers,
  `_score_audit_diff`, `_term_rating_audit_field` and
  `_fv_teacher_sign_in_deleted` name no type.
- **`rls_auto_enable`, the live body.** It is an event trigger's function
  and runs after every CREATE TABLE in the session, a temporary table's own
  included. Its one table is written `pg_catalog.pg_class` (a temporary
  `pg_class` changes nothing, before or after) and the functions it calls
  are never looked up in `pg_temp`. Its two declared types were open. With
  a temporary table called `name` in the session, a new table in public was
  left **without row security while the function logged that it had enabled
  it**; with one called `record`, every later CREATE TABLE in the session
  failed. After, neither does anything. Only a session that can make tables
  in public could be caught by the first; no migration in the repo makes a
  temporary table with either name. For a later migration that makes a
  table it does what it did: the 123 calls include CREATE TABLE, CREATE
  TABLE AS, SELECT INTO, a quoted name, a partitioned table and its
  partition in public (row security on), a table in `student_submit` and
  temporary ones (off), equal before and after. The harness's `ensure_rls`
  fires on the three table-making commands; the live trigger's filter was
  not read, so one check has it fire on every command: the file's own ALTERs
  then run it sixteen times, the file applies, and a table made afterwards
  in the same transaction gets row security.
- **Nothing else changes.** Each function's row in `pg_proc`, column for
  column: only `proconfig` differs (body, owner, grants, volatility,
  SECURITY DEFINER, parallel, arguments, result, the same; same oid). Each
  printed definition differs in its `SET search_path` line alone. No other
  function, no trigger, no policy and no row of any table changes.
- **The apply path.** Each check stops the file with nothing changed: a
  function missing, with other arguments, not SECURITY DEFINER, with another
  `search_path` or a second setting; each of Batch A's four files missing;
  S0-M4 missing (`get_class_bundle` with today's fingerprint) or the bundle
  with any fingerprint but the one S0-M4 leaves; a seventeenth SECURITY
  DEFINER function without `pg_temp` last in any of the three schemas (the
  last check, after the ALTERs). The wrong order, made by hand: S0-M4 stops
  at its fingerprint check; `python3 search_path.py wrong-order`, on an empty
  database, makes the ALTERs before Batch A, whose four files still apply. A
  lock it cannot get: gives up at five seconds, nothing changed. It takes no
  table lock: it runs at once with six tables locked whole by another
  session. A second run changes nothing.
- **Who applies it.** ALTER FUNCTION needs the function's owner. Applied by a
  role that owns fifteen of the sixteen and not `rls_auto_enable`, the file
  stops at that ALTER ("must be owner of function") with nothing changed;
  the header's "Before the apply" query expects `postgres` as the owner of
  each and lists one that is not, with the owner it found. Applied by a role that owns all sixteen and is not a superuser, it
  applies. (The two roles are made and rolled back inside the check.)
- **S0-M4b (PR 989) on either side.** S0-M4b then this file, and this file
  then S0-M4b: both apply and can be run again, no SECURITY DEFINER function
  is left without `pg_temp` last, and the 144 functions in the three schemas
  end up the same either way.
- **Taking it back out.** `s0-m5-undo.sql` (not a migration) sets each
  `search_path` back. After it all sixteen rows of `pg_proc` are what they
  were, column for column, so all sixteen fingerprints are too, and nothing
  else has changed; a second run, and a run where S0-M5 was never applied,
  change nothing; it stops with nothing changed on a function that is
  missing, not SECURITY DEFINER, has a third setting, or (for the four with
  a fingerprint on file) has another body. It reopens the trick: Teacher B's
  temporary `course` works again. S0-M4's undo (`s0-m4-undo.sql`) stops
  while S0-M5 is applied and runs once it is undone, so the order out is
  S0-M5's undo, then S0-M4's. S0-M5 applies again afterwards to the same
  result. Both files were also run for real with `run.py` on `m5_post`
  (undo, undo again, apply, apply again): every function fingerprint in the
  three schemas went back to `m5_pre`'s and forward again.

Result on 2026-11-10, PostgreSQL 17.11 (production's version) and 18.6:
**348 of 348 on each**, the two outputs identical line for line, fingerprints
included.

The other suites, on `m5_pre` and on `m5_post`, checks compared line by line
(same checks, same results, on both versions). They are Batch A's copies,
with `live-function-md5.txt` as it will be after each apply:

| Suite                       | Without the migration | With it    |
| --------------------------- | --------------------- | ---------- |
| `score_rpcs.py`             | 236 of 236            | 236 of 236 |
| `student_submit.py`         | 79 of 79              | 79 of 79   |
| `questionnaire_identity.py` | 47 of 47              | 47 of 47   |
| `phone_reports.py`          | 37 of 37              | 37 of 37   |
| `questionnaires.py`         | 42 of 42              | 42 of 42   |
| `grade_return.py`           | 280 of 280            | 280 of 280 |
| `student_page.py`           | 216 of 216            | 216 of 216 |

Every count is Batch A's own, from its branch as of Nov 10 (file 01 in plpgsql,
the harness with S0-M4 applied).
(`grade_return.py` counts every function named `_fv_` that a signed-in
teacher may run, so `search-path-prelude.sql` does not grant
`_fv_release_orphan_teacher_email` to `authenticated`; `search_path.py`
grants it, as its migration does, inside its own transactions.) With the
fingerprint file as it is today,
`score_rpcs.py` on `m5_post` fails four checks, by design: the three
ownership helpers and the bundle are no longer the fingerprints on file.

Main's own harness databases have no Batch A and not all sixteen functions,
so the file rightly refuses to run there. `python3 search_path.py alters`
runs its ALTER statements alone, for the functions a database has. Before
and after, on both versions: `score_rpcs.py` 175 of 175 (main's copy),
`functional.py` 46 of 46, `student_submit.py` 79, `questionnaire_identity.py`
47, `phone_reports.py` 37, `questionnaires.py` 42, `term_rating_reapprove.py`
9 of 9, `term_rating_habits.py` 36 or 37 of 37. That last one passes or
fails by chance with no change applied (4 of 10 runs failed): "each habits
change is audited, old and new" orders two rows made in one transaction by
`changed_at, id`, and `id` is random.

Fingerprints, `md5(pg_get_functiondef)` and length, the same on 17.11 and
18.6. The four in `live-function-md5.txt` are marked; the PR that follows the
apply updates those lines and the copies of these functions in the preludes
and `harness.sql`.

| Function                                                | Before                                   | After                                    |
| ------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `_fv_release_orphan_teacher_email()`                    | `845a373f326ad7067193bf36960e3185` 751   | `d1786f4b0205b700167758f4bb61e32e` 762   |
| `_fv_teacher_sign_in_deleted()`                         | `e303a42f8cd1f9a1859483a84f074cbe` 293   | `f81c14dec41dcf6d95377905e08ed58d` 304   |
| `_score_audit_diff(uuid,numeric,numeric,text,text)`     | `97b29bd4079fc3326b70b29f55bdeeda` 794   | `2f5d1bb44e726f189f029c3e955a84ea` 805   |
| `_term_rating_audit_field(uuid,text,text,text)`         | `f29ec6599566b90f276ea8fb9e32a4b9` 526   | `23b66de03546627aa5583ca093946147` 537   |
| `_touch_course_sync_cursor(uuid,text)`                  | `ddf717ce0125ec2c0ebb5a45ad0a6c03` 1254  | `b0b9eb6dbbe09e9edc5640cde262248d` 1265  |
| `_touch_course_sync_cursor_from_trigger()`              | `706bc29fddc40bf689d719d3883e7cd7` 2561  | `225aac90e5534c2826298d084e77991c` 2572  |
| `_touch_teacher_sync_cursor_from_trigger()`             | `388d425e8dddc9517759e98c8cc91f0c` 526   | `01bc5ab445b01366dc915cd8ee57c1ec` 537   |
| `fv_idem_check(uuid,text)`                              | `83e3c5590eee5fcb5c2cd8690fe42aa7` 716   | `1c7b546434bee4b774557e0e6b16024f` 727   |
| `fv_idem_store(uuid,text,jsonb)`                        | `afcca752df1bae8350db6f636e4aaa09` 488   | `6d0b48c458d273a332db39e1a4b68626` 499   |
| `fv_owns_assessment(uuid)` (on file)                    | `852322ca22024d49dcc4f88a6863a4cf` 378   | `9f4c680c35f9f3ac32e8290824707673` 389   |
| `fv_owns_course(uuid)` (on file)                        | `61fa41c6c4e94a1e27b606e454262baf` 334   | `e3afeca06043a6e907e6f4ae777c85da` 345   |
| `fv_owns_enrollment(uuid)` (on file)                    | `9c1d01d07ad0e2402784a2257e13aecb` 378   | `728526648388367393162be706f7f9ea` 389   |
| `fv_owns_term_rating(uuid)`                             | `1d3c31d45026472c3d3055a6b8718ea6` 448   | `000876617e013acb95c56932b42d1f02` 459   |
| `fv_retention_cleanup()`                                | `3133ad798bfe7c82d9d203abc3826a94` 2088  | `a8da46d6664ba5956f4215ba3b2ada39` 2099  |
| `get_class_bundle(uuid,bigint)` (on file, as `119165…`) | `845b42513d1f556dc941a1cc11cf9567` 22591 | `116294a41f043458e3ddec694520cf0d` 22612 |
| `rls_auto_enable()`                                     | `846ec2fbff751d24b890656d63c3a9bf` 1223  | `37475132a56d7604318a225ce900ae7f` 1234  |

`get_class_bundle`'s "before" is with S0-M4 applied; before S0-M4 it was
`119165287207814181c5875d81451147` (22538). Every "before" value was
confirmed on `gradebook-prod` on 2026-11-10 (live is PostgreSQL 17.6).

Not verified: which commands the live `ensure_rls` event trigger fires on
(tested both ways, above); whether the API roles can make a table in public
on `gradebook-prod` (here they cannot).
