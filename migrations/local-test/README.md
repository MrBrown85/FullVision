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
- `live-function-md5.txt`: `md5(pg_get_functiondef)` of 21 live functions.
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

Result on 2026-11-09 (Postgres 18.6, local; production is 17): 176 of 176.
Against a database with Batch A loaded (below) the same script finds it and
expects the two gaps Batch A closes to be refused: 234 of 234.

Checks named "today:" pin a gap as it is. Batch A closes two and its
database flips their checks to "refused": `set_score_status` takes Missing
on scored work; and row security on the score tables checks the enrollment
only, so a teacher can save a score for their own student against another
teacher's assessment, competency or criterion by id. The others it found,
left as they are:

- `upsert_rubric_score` takes a criterion that is not on the assessment's
  rubric. Batch A leaves it: the outbox can send a score ahead of the rubric
  change it belongs to, so a refusal would lose real grades.

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

## Batch A: Draft and Returned, student cards, sessions and the page (2026-11-09)

Four migrations, tested here only (no Supabase branch, never
`gradebook-prod`): `2026110901_score_rows_same_class.sql`,
`2026110902_grade_return.sql`, `2026110903_student_card.sql`,
`2026110904_student_sessions_page.sql`.

Two more files build what they need on top of the score paths:

- `batch-a-tables.sql`: six more tables from the live snapshot
  (`python3 make-score-tables.py batch-a`).
- `batch-a-prelude.sql`: `update_course`, `import_json_restore`,
  `create_course`, `duplicate_course` and `duplicate_assessment`. No one
  migration holds any of them whole; each is the migration that last wrote
  it in full plus every later in-place patch, in order.
  `live-function-md5.txt` proves each result is the live function.

Two databases, one without the four migrations (for `batch_a_apply.py`,
which applies them itself) and one with:

```bash
BASE="harness.sql score-prelude.sql score-tables.sql student-submit-prelude.sql \
  ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql \
  ../20261025_student_submit.sql ../20261025_student_submit_phone.sql \
  ../20261025_student_submit_token_80.sql ../20261025_phone_reports.sql \
  ../20261101_questionnaire_identity_check.sql ../20261101_questionnaire_slip_fixes.sql \
  ../20261103_slip_password_kept_for_live_slips.sql batch-a-tables.sql batch-a-prelude.sql"
PGPORT=54329 PGDATABASE=fv_a_pre python3 run.py $BASE
PGPORT=54329 PGDATABASE=fv_a python3 run.py $BASE ../2026110901_score_rows_same_class.sql \
  ../2026110902_grade_return.sql ../2026110903_student_card.sql ../2026110904_student_sessions_page.sql

PGPORT=54329 PGDATABASE=fv_a_pre python3 batch_a_apply.py
PGPORT=54329 PGDATABASE=fv_a python3 grade_return.py
PGPORT=54329 PGDATABASE=fv_a python3 student_page.py
PGPORT=54329 PGDATABASE=fv_a python3 score_rpcs.py
PGPORT=54329 PGDATABASE=fv_a python3 grade_return_race.py
```

What each covers:

- `batch_a_apply.py` meets the migrations the way production will: scores
  first, then the four files. Each file is one transaction that sets a lock
  timeout and runs its checks first; a function that is not the live one, a
  score row in another class or files out of order stop it there with
  nothing created. Every function the batch patches or copies starts as the
  live one (20 fingerprints); the backfill makes every existing grade
  Returned and changes no score row (a checksum of the four score tables
  before and after); every class has the student page off and no Return
  Grades choice; a second run of all four files changes nothing.
- `grade_return.py` runs every case in `tests/fixtures/grade-state-cases.json`
  through the score RPCs, the triggers and `student_submit._returned_grade`
  (the same file runs through `shared/grade-state.js`). Then: the two server
  check on Missing, against what shipped clients send; `return_grades`; the class
  settings, and a class leaving When I Return Them returning what was
  waiting; each bulk path by name (the restore from a new backup, an old one
  and a 30 by 40 class, `move_rubric_scores`, Duplicate Class, Copy
  Assessment, the two bulk clears); deleting a criterion that has a ticked
  box in each order the cascades can run, a checkbox, a competency, a rubric
  and a student; a statement that adds and changes rows of one grade; an id
  re-pointed by hand; what a student is sent when the work's scoring has
  changed; a planted scratch row that must not be trusted, and the scratch
  table empty between statements; a restore over a class that exists; then
  who can reach what.
- `student_page.py` runs the card RPCs and `card`, `verify_card`, `page`,
  `seen` and `done` as the edge function calls them: five wrong tries in a
  row and the slow lock (fifteen in 7 days), Unlock and Unlock All, Reissue
  with a new password, Cards Work Until, a fresh session
  from the start screen and Add Another Card joining one, midnight in the
  class's time zone, Done, the per-address limit of 300 in 15 minutes, a
  slip's code answered as unknown and not counted toward it, housekeeping,
  the log. A draft never comes back from
  `page`: by hand, then for 300 seeded random saves, edits, clears, returns
  and setting changes. Missing and Excused show no result. Last, no function
  in `student_submit` but `_returned_grade` names a score table.
- `score_rpcs.py` with Batch A loaded: everything it pinned still holds for
  a teacher's own class, and every way in against another class's
  assessment, competency, criterion or checkbox is refused (each RPC, then a
  direct insert and update on each table), for Teacher B's records and for
  another class of Teacher A's own.
- `grade_return_race.py` uses several connections and commits (it cleans up
  after itself). Two saves on one grade: the second waits and the draft
  stays a draft. 150 saves on each of two students against 150 returns: no
  call fails. The same with setting changes, rubric fills and card calls:
  no call fails; as a control, with the release trigger renamed so it fires
  after the sync-cursor trigger, the run deadlocks. A level saved for a
  criterion while it is being deleted, 150 times: no deadlock.

Result on 2026-11-09 (Postgres 18.6, local; production is 17):
`batch_a_apply.py` 80 of 80, `grade_return.py` 282 of 282, `student_page.py`
216 of 216, `score_rpcs.py` 234 of 234 (176 of 176 without Batch A),
`grade_return_race.py` 9 of 9 (three runs). With Batch A loaded the earlier suites pass
as before: `student_submit.py` 79 of 79, `questionnaire_identity.py` 47 of
47, `phone_reports.py` 37 of 37, `questionnaires.py` 42 of 42.

Timing: a rubric fill for 30 students with 5 criteria (30 `fill_rubric`
calls, 150 rows) took about 15 ms before the batch, 20 ms with the
same-class policies and 40 to 45 ms with the Draft and Returned triggers
too. A restore of a 30 by 40 class (4,800 score rows) took between 0.3 and
0.7 s; the triggers stand aside during a restore and it sets the state in a
few statements.
