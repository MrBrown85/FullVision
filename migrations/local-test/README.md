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
had changed. `phone_reports.py` and `questionnaires.py` were written for the
Oct 25 migrations and expected the reply. Since 2026-11-10 they read which
database they are given: with this migration loaded (as live has it)
`phone_reports.py` checks the reply is gone (35 checks; 37 where it still
exists) and `questionnaires.py` counts 17 templates, not 18 (42 either way).
See "S3-M1" below for why the harness now loads this file.

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
- `live-function-md5.txt`: `md5(pg_get_functiondef)` of 22 live functions (and, further down, of the class writers Batch A's race test loads).
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
expects the one gap Batch A closes to be refused: 236 of 236 (234 before
that database also held `get_class_bundle` and `get_gradebook`).

Checks named "today:" pin a gap as it is. Batch A closes one and its
database flips those checks to "refused": row security on the score tables
checks the enrollment only, so a teacher can save a score for their own
student against another teacher's assessment, competency or criterion by
id. The others it found, left as they are:

- `set_score_status` takes Missing on work that has a score. Batch A leaves
  it: the shipped app sends Missing on cells the server still holds a score
  for, and a refused write is a dead letter for a teacher.
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

Three more files build what they need on top of the score paths:

- `batch-a-tables.sql`: two more tables from the live snapshot,
  `teacher_preference` and `dibels_score`
  (`python3 make-score-tables.py batch-a`). It held seven until S0-M4 was
  merged; the other five are in `bundle-tables.sql` (below), which now
  loads first.
- `batch-a-prelude.sql`: `update_course`, `import_json_restore`,
  `create_course`, `duplicate_course` and `duplicate_assessment`. No one
  migration holds any of them whole; each is the migration that last wrote
  it in full plus every later in-place patch, in order.
  `live-function-md5.txt` proves each result is the live function.
- `class-writers-prelude.sql`: the other 21 RPCs that write a class's
  tables, for `grade_return_race.py`: assessments (`create_`, `update_`,
  `delete_assessment`, `save_assessment_tags`), rubrics (`upsert_rubric`,
  `delete_rubric`), subjects, folders, sections and competencies (an
  `upsert_` and a `delete_` each, `remove_section`, `restore_section`) and
  students (`create_student_and_enroll`, `update_enrollment`,
  `withdraw_student`, `reenrol_student`, `delete_withdrawn_student`). Each is
  copied whole and unchanged from the migration that last defined it, or is
  the live definition itself where the repo has no copy of that. Five are
  the live definitions, as `pg_get_functiondef` printed them on 2026-11-09:
  `delete_rubric`, `save_assessment_tags` and `update_enrollment` (no
  migration; the April design file, `docs/backend-design/write-paths.sql`,
  differs from live in a comment and white space) and `upsert_section` and
  `upsert_subject` (their only migration differs from live in white space).
  `delete_assessment` has no migration either; the April file's copy matches
  live. `grade_return_race.py` compares all 21 with `live-function-md5.txt`
  (the lines marked `class-writer`) on every run: **all 21 are the live
  functions.**

Two databases, one without the four migrations (for `batch_a_apply.py`,
which applies them itself) and one with. Both start from the live database
as it is now, which since 2026-11-10 has S0-M4 applied (see "The bundle
sends created_at" below): they load `get_class_bundle` and `get_gradebook`
as they were before it and then that migration, so the two come out as the
live functions of today and `live-function-md5.txt` holds those
fingerprints.

```bash
BASE="harness.sql score-prelude.sql score-tables.sql bundle-prelude.sql bundle-tables.sql \
  ../2026111001_assessment_created_at_in_bundle.sql student-submit-prelude.sql \
  ../20261025_questionnaires_tables_and_functions.sql ../20261025_questionnaires_templates.sql \
  ../20261025_student_submit.sql ../20261025_student_submit_phone.sql \
  ../20261025_student_submit_token_80.sql ../20261025_phone_reports.sql \
  ../20261101_questionnaire_identity_check.sql ../20261101_questionnaire_slip_fixes.sql \
  ../20261103_slip_password_kept_for_live_slips.sql batch-a-tables.sql batch-a-prelude.sql \
  class-writers-prelude.sql"
PGPORT=54329 PGDATABASE=fv_a_pre python3 run.py $BASE
PGPORT=54329 PGDATABASE=fv_a python3 run.py $BASE ../2026110901_score_rows_same_class.sql \
  ../2026110902_grade_return.sql ../2026110903_student_card.sql ../2026110904_student_sessions_page.sql

PGPORT=54329 PGDATABASE=fv_a_pre python3 batch_a_apply.py
PGPORT=54329 PGDATABASE=fv_a python3 grade_return.py
PGPORT=54329 PGDATABASE=fv_a python3 student_page.py
PGPORT=54329 PGDATABASE=fv_a python3 score_rpcs.py
PGPORT=54329 PGDATABASE=fv_a python3 grade_return_race.py        # about four minutes
PGPORT=54329 PGDATABASE=fv_a_pre python3 grade_return_race.py    # the baseline: the same calls with no Batch A
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
  (the same file runs through `shared/grade-state.js`). Then: Missing on
  scored work accepted as before and hidden from the student, and what is
  sent for an Overall level on each kind of work; `return_grades`; the class
  settings, and a class leaving When I Return Them returning what was
  waiting; each bulk path by name (the restore from a new backup, an old one
  and a 30 by 40 class, `move_rubric_scores`, Duplicate Class, Copy
  Assessment, the two bulk clears); deleting a criterion that has a ticked
  box in each order the cascades can run, a checkbox, a competency, a rubric
  and a student; a statement that adds and changes rows of one grade; an id
  re-pointed by hand; what a student is sent when the work's scoring has
  changed; the working copy `grade_return` keeps (what a save changed is
  read from it, a write with the triggers off leaves it behind, the
  migration's last two statements repair it); the class's sync-cursor row
  made when it is missing; `grade_return`'s rows going with their student,
  assessment or class though it has no foreign keys; a restore over a class
  that exists; then who can reach what. At several points and at the end
  every `grade_return` row must hold the grade as the score tables have it.
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
  stays a draft. A Return and a tick both waiting on a level being saved:
  the student is given the level, whichever goes first. Then the matrix:
  each of 45 RPCs, 300 calls on its own connection aimed at the rows the
  others are using, against two connections of score saves, against two of
  `return_grades`, and against both; then all of them at once. The delete
  scenarios work down a pool of 300 rows while the saves and returns follow
  on the same rows. After every run each `grade_return` row must hold the
  grade as the score tables have it, in a state the table allows, with its
  student and assessment still there, and no draft may be left in a class
  that does not hold grades.

Result on 2026-11-10, on Postgres 17.11 (what production runs) and on 18.6,
the same on both: `batch_a_apply.py` 84 of 84, `grade_return.py` 280 of 280,
`student_page.py` 216 of 216, `score_rpcs.py` 236 of 236 (176 of 176 without
Batch A), `grade_return_race.py` 435 of 435. With Batch A loaded the earlier
suites pass as before: `student_submit.py` 79 of 79,
`questionnaire_identity.py` 47 of 47, `phone_reports.py` 37 of 37,
`questionnaires.py` 42 of 42. (Before S0-M4 was applied live and the two
bundle functions joined these databases, `batch_a_apply.py` was 82 of 82
and `score_rpcs.py` 234 of 234: the two more checks in each are that
`get_class_bundle` and `get_gradebook` are the live functions.)

File 04 also raises the slip route's per-address limit from 60 unknown codes
in 15 minutes to 300, as for cards (one number in `student_submit.open`,
patched in place). `student_submit.py` reads which is loaded: its two checks
on that limit run with 299 misses and miss number 300 on a Batch A database,
and with 59 and 60 on one without.

### The matrix: deadlocks per RPC, three runs added up

One lock per class: the class's `course_sync_cursor` row, which every writer
already takes through the sync-cursor triggers after its statement's rows.
Batch A takes it in that position and nowhere earlier, and reads and writes
`grade_return` only while holding it (`2026110902_grade_return.sql`, header,
4). Each cell is deadlocks (calls that died with 40P01) of calls made. The
last column is the same calls on the database without the four migrations.

| RPC                                           | against saves  | against returns | against both    | today, no Batch A (saves) |
| --------------------------------------------- | -------------- | --------------- | --------------- | ------------------------- |
| `upsert_score`                                | 0 of 2,810     | 0 of 2,823      | 0 of 3,677      | 0 of 2,743                |
| `upsert_tag_score`                            | 0 of 2,650     | 0 of 2,869      | 0 of 3,503      | 0 of 2,572                |
| `upsert_rubric_score`                         | 0 of 2,678     | 0 of 2,817      | 0 of 3,479      | 0 of 2,540                |
| `set_rubric_check`                            | 0 of 2,135     | 0 of 2,399      | 0 of 2,538      | 0 of 2,480                |
| `save_score_comment`                          | 0 of 2,662     | 0 of 2,734      | 0 of 3,474      | 0 of 2,606                |
| `save_score_report_note`                      | 0 of 2,420     | 0 of 2,760      | 0 of 3,675      | 0 of 2,647                |
| `set_score_status`                            | 0 of 2,403     | 0 of 2,745      | 0 of 3,778      | 0 of 2,631                |
| `clear_score`                                 | 14 of 2,707    | 0 of 2,820      | 12 of 3,585     | 3 of 2,738                |
| `clear_row_scores`                            | 12 of 2,380    | 0 of 2,314      | 11 of 2,636     | 10 of 2,791               |
| `clear_column_scores`                         | 4 of 2,351     | 0 of 2,291      | 3 of 2,618      | 3 of 2,552                |
| `fill_rubric`                                 | 38 of 2,942    | 0 of 2,756      | 38 of 3,781     | 14 of 2,925               |
| `return_grades`                               | 0 of 2,580     | 0 of 2,713      | 0 of 3,964      | -                         |
| `update_course`                               | 0 of 2,555     | 0 of 2,739      | 0 of 3,667      | 0 of 2,433                |
| `create_assessment`                           | 0 of 3,845     | 0 of 4,978      | 0 of 4,966      | 0 of 4,878                |
| `update_assessment`                           | 0 of 2,436     | 0 of 2,735      | 0 of 3,748      | 0 of 2,669                |
| `save_assessment_tags`                        | 0 of 2,387     | 0 of 2,756      | 0 of 3,692      | 0 of 2,746                |
| `duplicate_assessment`                        | 0 of 3,736     | 0 of 4,735      | 0 of 4,893      | 0 of 4,923                |
| `delete_assessment`                           | 0 of 2,988     | 0 of 2,855      | 0 of 4,542      | 0 of 2,803                |
| `upsert_rubric (nothing removed)`             | 0 of 2,777     | 0 of 2,701      | 0 of 3,037      | 0 of 2,932                |
| `upsert_rubric (criteria and boxes removed)`  | 73 of 3,706    | 0 of 4,189      | 78 of 4,929     | 57 of 4,680               |
| `delete_rubric`                               | 136 of 3,015   | 0 of 2,526      | 345 of 4,411    | 134 of 3,375              |
| `update_assessment + move_rubric_scores`      | 60 of 4,073    | 0 of 4,989      | 63 of 5,119     | 28 of 3,741               |
| `upsert_subject`                              | 0 of 2,671     | 0 of 3,229      | 0 of 3,766      | 0 of 2,824                |
| `upsert_competency_group`                     | 0 of 2,686     | 0 of 3,225      | 0 of 4,116      | 0 of 2,923                |
| `upsert_section`                              | 0 of 2,651     | 0 of 3,217      | 0 of 3,884      | 0 of 3,005                |
| `upsert_tag`                                  | 0 of 2,409     | 0 of 2,768      | 0 of 3,709      | 0 of 3,453                |
| `remove_section`                              | 0 of 2,394     | 0 of 2,752      | 0 of 3,923      | 0 of 2,543                |
| `delete_tag`                                  | 0 of 3,501     | 0 of 3,126      | 0 of 5,107      | 0 of 3,056                |
| `delete_section`                              | 229 of 3,080   | 0 of 3,004      | 339 of 3,781    | 84 of 2,829               |
| `delete_subject`                              | 278 of 3,100   | 0 of 2,985      | 363 of 3,723    | 100 of 2,886              |
| `delete_competency_group`                     | 0 of 2,254     | 0 of 2,682      | 0 of 3,503      | 0 of 2,546                |
| `create_student_and_enroll`                   | 0 of 2,216     | 0 of 2,974      | 0 of 3,536      | 0 of 2,743                |
| `update_enrollment`                           | 0 of 2,233     | 0 of 2,517      | 0 of 3,618      | 0 of 2,539                |
| `withdraw_student`                            | 0 of 2,387     | 0 of 2,720      | 0 of 3,797      | 0 of 2,545                |
| `delete_withdrawn_student`                    | 0 of 3,223     | 0 of 2,670      | 0 of 4,878      | 0 of 3,281                |
| `import_json_restore`                         | 0 of 3,961     | 0 of 4,091      | 0 of 4,938      | 0 of 4,329                |
| `issue_student_cards`                         | 0 of 1,700     | 0 of 2,452      | 0 of 1,582      | -                         |
| `set_cards_work_until`                        | 0 of 2,376     | 0 of 2,727      | 0 of 3,912      | -                         |
| `mark_student_cards_printed`                  | 0 of 2,076     | 0 of 3,238      | 0 of 1,951      | -                         |
| `unlock_student_card`                         | 0 of 2,123     | 0 of 3,052      | 0 of 1,945      | -                         |
| `unlock_all_student_cards`                    | 0 of 1,418     | 0 of 1,969      | 0 of 1,399      | -                         |
| `reissue_student_card`                        | 0 of 2,244     | 0 of 3,012      | 0 of 2,083      | -                         |
| `student: seen`                               | 0 of 2,383     | 0 of 2,777      | 0 of 3,590      | -                         |
| `student: page`                               | 0 of 4,720     | 0 of 8,233      | 0 of 4,712      | -                         |
| `student: card and verify_card`               | 0 of 1,719     | 0 of 2,482      | 0 of 1,730      | -                         |
| **all that are clean against saves, at once** |                |                 | 335 of 169,675  | 207 of 64,516             |
| **all at once**                               |                |                 | 1047 of 161,372 | 826 of 97,145             |
| **total**                                     | 844 of 121,761 | 0 of 139,146    | 2634 of 493,942 | 1466 of 267,568           |

After every run, deadlocks included, every `grade_return` row was right: 0
rows wrong.

Every RPC is clean against returns alone. Thirty-six of the 45 are clean
against saves. **Nine are not, with or without Batch A**: the three clears,
`fill_rubric`, a rubric save that removes a criterion or a checkbox,
`delete_rubric`, `move_rubric_scores`, `delete_section` and
`delete_subject`. A save locks its score row and then the class's cursor
row. Each of the nine already holds the cursor row when it goes for a score
row a save has, because the cursor triggers fire after every statement and
after the first level of a cascade. Batch A changes none of the nine and
adds no lock they could meet in a new order: no dead call was waiting on a
`grade_return` row in any run, and every one of the 3,382 deadlocks the
server logged in the three full runs was between live RPCs (a Return or a card call appears in a
few only as a third call waiting in line). It does make them collide more
often under this load, about twice as often here: every call now does the
triggers' work while holding the cursor row (the table under Timing, below),
so more saves are waiting in line when one of the nine arrives. A reviewer
checked that time alone explains it: a trigger that only burns about 0.6 ms
and takes no lock reproduces the doubling. Ending them means the cursor triggers firing at
commit instead of after each statement, on all 38 tables that have one;
that is a change to the live schema outside this batch.

The two all-at-once rows also pit the RPCs against each other, and some of
those pairs deadlock today too (`update_assessment` and
`save_assessment_tags` both rewrite one assessment's links), so the row of
RPCs that are clean against saves is not clean against itself.

A Return or a student's `seen()` waiting in line when two such calls collide
could be the one Postgres stops; it holds nothing they want, so it waits
again (`_grade_return_lock_first`). In these runs no Return died.

Five rows (`delete_rubric`, `save_assessment_tags`, `update_enrollment`,
`upsert_section`, `upsert_subject`) and the two all-at-once rows were run
again, three times each way, once the live bodies were loaded, so every row
of the table is for live functions. Nothing changed: `delete_rubric` still
deadlocks with saves, the other four are still clean, and the count of RPCs
that are not clean is still nine.

Timing on Postgres 17.11, which is what production runs, measured with
`batch_a_cost.py` on a production-sized class (32 students, 70 pieces), one
quiet call each as a signed-in teacher, the best of up to three runs (the
machine is shared, and a run now and then comes out two or three times
slower). The script commits the class it makes, so it wants a database of
its own:

```bash
PGPORT=54331 PGDATABASE=fv_cost_pre python3 run.py $BASE          # without Batch A
PGPORT=54331 PGDATABASE=fv_cost python3 run.py $BASE $MIGRATIONS  # with the four files
PGPORT=54331 PGDATABASE=fv_cost_pre python3 batch_a_cost.py
PGPORT=54331 PGDATABASE=fv_cost python3 batch_a_cost.py
```

| One quiet call                                | without Batch A | with, helpers as SQL (as first verified) | with, helpers as plpgsql (now) | Postgres 18.6: without, with |
| --------------------------------------------- | --------------- | ---------------------------------------- | ------------------------------ | ---------------------------- |
| `upsert_score`                                | 0.46 ms         | 0.88 ms                                  | 0.68 ms                        | 0.28, 0.42 ms                |
| `upsert_tag_score`                            | 0.37 ms         | 1.13 ms                                  | 0.71 ms                        | 0.25, 0.42 ms                |
| `upsert_rubric_score`                         | 0.33 ms         | 1.12 ms                                  | 0.70 ms                        | 0.27, 0.45 ms                |
| `clear_score` on one rubric grade             | 0.31 ms         | 0.70 ms                                  | 0.70 ms                        | 0.33, 0.47 ms                |
| `fill_rubric`, 5 criteria                     | 0.84 ms         | 3.85 ms                                  | 1.74 ms                        | 0.47, 1.44 ms                |
| `clear_row_scores`, one student               | 5.2 ms          | 11.4 ms                                  | 11.6 ms                        | 4.9, 9.7 ms                  |
| `clear_column_scores`, 32 students            | 2.7 ms          | 5.6 ms                                   | 5.7 ms                         | 2.7, 5.4 ms                  |
| deleting a section                            | 4.2 ms          | 15.3 ms                                  | 15.1 ms                        | 4.5, 11.8 ms                 |
| deleting a rubric used by 24 pieces           | 503 ms          | 717 ms                                   | 720 ms                         | 519, 699 ms                  |
| a fill for 30 students, 5 criteria (30 calls) | 28 ms           | 117 ms                                   | 56 ms                          | 19, 44 ms                    |

Every save does a little more work: a quarter to a third of a millisecond on a
single score, and a rubric fill takes about twice as long. Bulk clears and
deletes take 1.4 to 3.6 times as long, all still under a second.

**The figures this README and the PR gave before were measured on Postgres
18 only.** File 01's four helpers were SQL-language functions, and Postgres
17 plans an SQL-language function again in every statement that calls it,
where 18 keeps the plan. On 17 that made a 30-student fill take 81 ms with
file 01 alone, against 28 ms without it. The helpers are plpgsql now (the
owner's ruling: rewrite before applying), which keeps its plan for the life
of the connection on both versions:

| File 01 alone, Postgres 17.11      | without | helpers as SQL | helpers as plpgsql |
| ---------------------------------- | ------- | -------------- | ------------------ |
| `upsert_score`                     | 0.46 ms | 0.53 ms        | 0.33 ms            |
| `upsert_tag_score`                 | 0.37 ms | 0.85 ms        | 0.30 ms            |
| `upsert_rubric_score`              | 0.33 ms | 0.82 ms        | 0.28 ms            |
| `fill_rubric`, 5 criteria          | 0.84 ms | 2.75 ms        | 0.66 ms            |
| a fill for 30 students, 5 criteria | 28 ms   | 81 ms          | 23 ms              |

With the helpers in plpgsql, a save with file 01 costs what it costs today,
on either version.

**A read through row security does not.** The new policies make a longer
check for every row read. The same class, read as its teacher, the best of
three rounds of 20:

| A read as the class's teacher, 17.11      | today   | Batch A, helpers as SQL | Batch A now (plpgsql) |
| ----------------------------------------- | ------- | ----------------------- | --------------------- |
| every `score` row of the class (736)      | 2.3 ms  | 4.2 ms                  | 4.0 ms                |
| every `tag_score` row (2,496)             | 7.2 ms  | 11.7 ms                 | 13.1 ms               |
| every `rubric_score` row (3,840)          | 10.5 ms | 18.1 ms                 | 20.4 ms               |
| every tick (3,840)                        | 10.6 ms | 18.0 ms                 | 20.4 ms               |
| `get_gradebook`, the fallback class load  | 49.4 ms | 63.9 ms                 | 68.1 ms               |
| `get_class_bundle`, the normal class load | 11.4 ms | 11.6 ms                 | 11.6 ms               |

A read through the policies costs about twice what it costs today, with
either form of the helpers, and plpgsql about a tenth more than SQL on
reads (the reverse of saves, where SQL was three times slower). The normal
class load is unaffected: `get_class_bundle` is SECURITY DEFINER and does
not run the policies. The fallback load (`get_gradebook`) and anything else
that reads a class-sized score table as the teacher pays about 10 ms for
each such table; the bulk clears' share of that is already in the table of
calls above. The plan of the read is the same with either form (the helper
called once a row, in the filter; the SQL form was never inlined, being
SECURITY DEFINER with a search_path of its own).

This paragraph used to say that reads "cost the same as before". That
compared the two forms of the helpers with each other, not with today, and
its figures do not reproduce. The reviewer of the helper rewrite measured
the numbers above first; they came out the same here.

File 02's own SQL-language helpers (`_grade_copy`, `_grade_copy_of`,
`_grade_copy_entry`, `_grade_return_holds`, `_grade_copy_in_use`) and file
04's `_returned_grade` are slower on 17 than on 18 for the same reason
(`_grade_copy` of a rubric grade: 0.36 ms a call on 17 against 0.24 on 18,
both with a 0.2 ms round trip in them). Each was tried as plpgsql on 17 and
none got reliably faster (the copy is built by nested calls, and the gain
on one is lost on the next), so they are left as they were verified.

A restore of a 30 by 40 class
(4,800 score rows) took between 0.3 and 0.7 s on 18.6; the triggers stand aside
during a restore and it sets the state in a few statements. `grade_return`
holds a second copy of every grade: 851 kB at 2,240 graded cells, 389 bytes
a cell on average, beside 2.0 MB for the four score tables together.

What the last verify pass found and the SQL does not fix: the repair
statements at the end of file 02 do not add a `grade_return` row that is
missing (running the whole file again does, through its backfill); a
hand-made restore with `grade_returns` and no `courses` row, into an As Soon
As I Save class, can leave a draft; orphan rows left by a delete with
triggers off are skipped by the two read RPCs but visible to a direct
select; and after five caught deadlocks `_grade_return_lock_first` lets the
sixth fail, with nothing in the server log for the five.

Not verified: the live server itself (everything here ran on a local
Postgres 17.11, the version production runs, and on 18.6; the live
server's settings and hardware are not this machine's), cascades from the
tables this harness does not carry, and how often a collision happens in
real use.

## The bundle sends created_at (S0-M4, 2026-11-10)

`../2026111001_assessment_created_at_in_bundle.sql` patches `get_class_bundle`
and `get_gradebook` in place so each assessment carries its `created_at`.
Tested here only (no Supabase branch, never `gradebook-prod`).

Two more files build what it needs on top of the score paths:

- `bundle-prelude.sql`: `get_class_bundle` and `get_gradebook`. No one
  migration holds either whole. Each is the migration that last wrote it in
  full, then every later in-place patch run as its migration wrote it, in
  file order, and printed with `pg_get_functiondef` (the file's header lists
  them: 17 patches for the bundle, 3 for `get_gradebook`). Both come out as
  the live functions were before S0-M4 (md5 `119165287207814181c5875d81451147`,
  length 22538, and `2876cd40c373b8a59bff4464008c8601`, length 6816; the
  orchestrator confirmed both against `gradebook-prod` on Nov 10 before the
  migration was applied), which is what the migration's own check expects.
  S0-M4 was applied the same day, so `live-function-md5.txt` now holds the
  two as they are after it, and a harness that wants today's live functions
  loads this file and then the migration. Also
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
its first check with nothing changed. It starts from the two functions as
the migration's check expects them and, after the migration, compares both
with the live fingerprints of today.

Result on 2026-11-10, on Postgres 17.11 and on 18.6: 39 of 39 (40 while the
fingerprint file still held the functions from before the migration; four
checks on the starting point became two, and one on the result was added).
On a database with the score paths alone `score_rpcs.py` is unchanged, and `make-score-tables.py` still
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

## S0-M4b: three known limits of Batch A's grade_return, and DIBELS (2026-11-10)

`../2026110905_grade_return_limits.sql` applies after Batch A. It closes the
three limits the last verify pass on Batch A named, and makes three changes
the owner ruled on:

- (a) the repair (`_grade_return_repair_class`, one class) settles every cell
  that has a grade or a row by the rule a save follows, so a grade written
  with the triggers off is made a Draft or Returned as a save would have
  left it, whether its cell had no row or an empty one;
- (b) a restore with `grade_returns` and no `courses` row can no longer
  leave a draft in a class that does not hold grades;
- (c) `TRUNCATE` on `enrollment` or `assessment` takes the `grade_return`
  rows with it, and `grade_return_repair_nightly()`, called once a day by a
  pg_cron job where pg_cron is installed, repairs class by class, goes on
  past a class it cannot do, and records it in
  `public.grade_return_repair_log`;
- (d) `student_submit.page` sends each assessment's `created_at`;
- (e) `list_course_grade_returns` no longer sends `seen_at`;
- (f) DIBELS work has no Draft and no Returned (ruling 15). A DIBELS piece's
  `grade_return` rows are dormant: kept, and read or written by nothing
  while the piece is DIBELS. Changed back, each cell is settled by the same
  rule the repair uses.

The file runs no repair and changes no row when it is applied. Eight of
Batch A's functions are patched in place, each accepted only if its
fingerprint is exactly Batch A's or exactly this file's.

It is tested on the live database as it is since Nov 10: S0-M4, then Batch
A (applied 15:28 to 15:33 UTC), then S0-M5 (15:37 UTC; PR 991's
`2026111002_security_definer_search_path.sql`, with its
`search-path-prelude.sql` loaded last in the base, as `search_path.py`
loads it). "Batch A alone" below means that database, without this file.
`live-function-md5.txt` holds the fingerprints after S0-M5; a database
with the score paths alone, or from before Batch A, is no longer the live
one, and `score_rpcs.py` on the score-only database now fails its
comparison with the live snapshot, as it should.

```bash
LIVE="$BASE search-path-prelude.sql ../2026110901_score_rows_same_class.sql ../2026110902_grade_return.sql \
  ../2026110903_student_card.sql ../2026110904_student_sessions_page.sql \
  ../2026111002_security_definer_search_path.sql"                 # BASE as under "Batch A" above
PGPORT=54331 PGDATABASE=fv_a python3 run.py $LIVE
PGPORT=54331 PGDATABASE=fv_a4b python3 run.py $LIVE ../2026110905_grade_return_limits.sql
PGPORT=54331 PGDATABASE=fv_a python3 grade_return_limits.py    # without the file: shows each limit, applies the file twice, shows it closed
PGPORT=54331 PGDATABASE=fv_a4b python3 grade_return_limits.py  # with the file loaded: also the nightly procedure, which commits
PGPORT=54331 PGDATABASE=fv_repair python3 run.py $LIVE ../2026110905_grade_return_limits.sql   # its own: the next script commits
PGPORT=54331 PGDATABASE=fv_repair python3 grade_return_repair_race.py
RACE_REPAIR=nightly PGPORT=54331 PGDATABASE=fv_a4b python3 grade_return_race.py   # or RACE_REPAIR=class
PGPORT=54331 PGDATABASE=fv_undo4b python3 run.py $LIVE                            # without the file, for the undo's proof
PGPORT=54331 PGDATABASE=fv_undo4b python3 grade_return_limits_undo.py
```

- `grade_return_limits.py`. On a database with Batch A alone it first shows
  each limit as it is (checks named "today"), checks the guards (no Batch
  A; four of the patched functions altered; a function that carries this
  file's mark but not this file's patch), applies the file where pg_cron is
  missing and where a stand-in for it exists, and checks that it changed no
  row (a DIBELS piece's among them), left each patched function exactly as
  its header says, took no lock on `enrollment` or `assessment` that stops
  a read, and that a second run changes nothing and takes no lock the first
  did not. Then, and on a database with the file loaded: the page's
  `created_at`; `seen_at` kept from the teacher; the repair on a grade
  written with triggers off into an opened cell, a cleared cell and a cell
  with no row, in a class that holds grades and in one that does not, and
  on a returned grade changed with triggers off; the restore; TRUNCATE and
  orphans; a piece to DIBELS and back in both kinds of class, with a grade
  unchanged, changed and first given while it was DIBELS; who can run what.
  With the file loaded it also runs the nightly procedure as the job does,
  on its own connections: a clean run; a run with the second of three
  classes locked by someone else (the first and third are repaired, the
  log names the second, the procedure ends with an error); and a class
  deleted while the repair waits to lock it.
- `grade_return_repair_race.py`: classes made, graded and deleted (two in
  one statement; a student enrolled in two) while the nightly procedure
  and the one-class repair loop. No deadlock, no error, nothing in the log,
  no orphan, no row that does not hold its grade.
- `grade_return_race.py` with the file loaded has one more RPC row (a
  points piece flipping to DIBELS and back) and, with `RACE_REPAIR`, a
  repair looping beside every run, which must never fail and never find
  anything to do.
- `s0-m4b-undo.sql` (not a migration) and its proof,
  `grade_return_limits_undo.py`: PART 1 unschedules the job and drops the
  three triggers; PART 2 puts Batch A's eight functions back by fingerprint
  and drops everything the file made. After PART 2 the catalog of the three
  schemas is identical to before the file, line by line (1,163 lines on
  17.11 and 1,470 on 18.6), no
  row of `grade_return` or a score table changed, Batch A's suites pass as
  on Batch A alone, and the file applies again to the same catalog.
- `tests/fixtures/grade-state-cases.json` has one case for (f), the last:
  `"work": "dibels"`, named in the file's legend. `grade_return.py` runs it
  where this file is loaded and pins what Batch A alone does where it is
  not; `tests/grade-state-cases.test.js` runs it in the browser's rule.

Result on 2026-11-10, on Postgres 17.11 (port 54331) and on 18.6 (port
54329), the same on both: `grade_return_limits.py` 92 of 92 on Batch A
alone and 74 of 74 with the file loaded; `grade_return_repair_race.py` 8 of
8; `grade_return_limits_undo.py` 20 of 20. The Batch A suites on top of the
file: `grade_return.py` 284 (281 on Batch A alone), `student_page.py` 216,
`score_rpcs.py` 236, `student_submit.py` 79, `questionnaire_identity.py`
47, `phone_reports.py` 37, `questionnaires.py` 42, `batch_a_apply.py` 84.
`grade_return_race.py` 447 of 447, three runs on each version (the nightly
procedure looping in two, the one-class repair in one): the same nine RPCs
collide with saves and no other, the DIBELS flip never does, no
`grade_return` row is wrong after any run, and the repair never failed and
never found anything to do. `npm test`: " + sys.argv[2] + ".

## Batch A: the way back (2026-11-10)

`batch-a-undo.sql` undoes Batch A (`../2026110901` to `../2026110904`), which
was applied to `gradebook-prod` on Nov 10. S0-M5 (`../2026111002`) and then
S0-M4b (`../2026110905`) were applied after it the same day, and the script
is written and proved for the database as that leaves it. It is **not a
migration** and is kept here, not in `migrations/`, so CI's drift check does
not wait for it to be applied. Its header is the operator's page: what each
part does, what students see after it, what still runs, what it leaves.

S0-M4b stands on Batch A and has its own undo, `s0-m4b-undo.sql`. PART 1 and
PART 1B here run as they are and touch nothing of S0-M4b; PART 1A needs
S0-M4b's fast stop first; PART 2 needs the whole of S0-M4b's undo first.
Each refuses without it. S0-M5 is left alone throughout.

S3-M1 (`../2026111003_card_codes_keyed.sql`, card codes the database cannot
read; see the section below) stands on Batch A too once it is applied, and
has its own undo, `s3-m1-undo.sql`. PART 1, 1A and 1B run with it applied
and touch nothing of it; PART 2 refuses, says so first, and names what it
found of S3-M1. The order is S3-M1's undo, then S0-M4b's, then PART 2
(scenario `s3-m1`). In short:

- **PART 1, the fast stop:** drops Batch A's 18 triggers and nothing else,
  one table at a time (`course` first), each in its own transaction that
  waits at most 200 ms for its table and tries again, so it never holds two
  tables and a save is never the one Postgres kills. An ordinary save then
  no longer touches `grade_return`. Batch A's functions, file 01's policies
  and all of S0-M4b stay and still run: its three triggers (PART 1's last
  query lists them) and its nightly repair, which brings `grade_return` up
  to date once a day. Between a save and the next repair, in a class with
  the Student Page on, students are shown some grades early and not shown
  others (the header lists the cases).
- **PART 1A, the Student Page off:** for every class that has it on, and it
  answers with the list. It refuses, with nothing changed, while any of
  Batch A's triggers is left (with `grade_return_release` still on `course`,
  turning the page off returns every waiting draft to the students), and
  while S0-M4b's repair still runs by itself, its nightly job or its
  `grade_return_mode` trigger (the repair settles a grade saved since PART 1
  as a save would in the class as it is then, and with the page off that is
  Returned: shown when the page comes back on). So: both fast stops, then
  PART 1A.
- **Back on after PART 1:** the classes on again if PART 1A turned them off,
  `call public.grade_return_repair_nightly();`, file 02 again, then
  `2026110905` again (file 02 puts five functions back as Batch A made
  them, without S0-M4b's changes). The database is then line for line what
  live is now, and nothing a teacher was holding has been shown.
- **PART 1B:** the five score-table policies as they were before file 01.
  Only for a save refused by row security.
- **PART 2, the full removal:** everything the four files made or changed,
  with the seven patched functions put back by making each edit backwards
  and then checked against their fingerprints from before. One transaction.
  It deletes `grade_return`, the cards, the sessions, the sign-in log's card
  rows and the three class settings. It stops, with nothing changed and the
  whole list, if anything else depends on what Batch A made, sits on one of
  its tables, or is a function or cron job whose text names one of its
  objects. S0-M4b is such a thing and is applied: PART 2 says so, apart from
  anything else it finds, and S0-M4b's own undo goes first.
  The header carries the same check as one read-only query, whose first
  row says whether S0-M4b is on top. It does not
  touch the migration record; the header has the one optional statement for
  that.

No part touches a score table.

`batch_a_undo.py` proves it. The database it is given is only a template:
each scenario runs on a copy (`<PGDATABASE>_<scenario>`, made and dropped by
the script), so it can be run again and again.

```bash
PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo.py build   # an empty database: everything but the four files
PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo.py         # the proof
PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo.py partial repair   # or only some scenarios
PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo_load.py    # PART 1 against looping saves, about three minutes
```

What it compares. `catalog.py` lists everything the database holds outside
the system schemas, one line each (2,089 lines here): schemas, functions
(md5 of the definition, owner, grants, and separately language, volatility,
SECURITY DEFINER, settings, argument defaults, comment), tables, views and
their definitions, rules, columns, dropped-column slots, constraints,
indexes, triggers, policies, types, sequences, default privileges, comments
on every kind of object, event triggers, extensions, publications, the
shape of `pg_depend`, and, where they exist, pg_cron's jobs and the
migration record. The `notices` scenario makes one of each of 14 kinds and
checks the catalog sees it. Roles are left out: they belong to the whole
server. Rows are a checksum of every row of every table, columns by name.
`live-function-md5.txt` records the sixteen fingerprints S0-M5 left (lines
marked `after-s0-m5`).
The harness has no pg_cron and no Supabase migration record. The proof makes
a stand-in for each: `cron.job` with `cron.schedule` and `cron.unschedule`
by job name, which is all S0-M4b and its undo use, holding one unrelated
job; and a migration record with three earlier rows, then one per file as
it is applied.

The scenarios ("applied" means the four files, then S0-M5, then S0-M4b, as
on live):

- **main.** Catalog and rows before anything; everything applied (Batch A's
  18 triggers, S0-M4b's three, its nightly job); a teacher and a student
  use it (returned grades, drafts, a draft on a returned grade, a rubric
  piece, cards, two signed-in phones, in a When I Return Them class and an
  As Soon As I Save one). Applying the files changes no row of any table
  that was there.
  - After **PART 1**: Batch A's 18 triggers are gone and no other catalog
    line differs; its last query lists S0-M4b's three and says whose they
    are. What the student is shown, case by case: a Returned 7 changed to 3
    is shown at once; a first grade on a new piece is not shown, in either
    kind of class; a draft stays hidden; a draft on a returned grade stays
    as returned. Return Grades on that first grade answers "returned: 0"
    and shows the student nothing; the teacher's draft count and Returned
    list answer from what was there at the stop.
  - **PART 1A** after PART 1 alone is refused, naming S0-M4b's nightly job
    and its trigger, and turns nothing off. S0-M4b's fast stop then runs
    (job unscheduled, three triggers gone; PART 1's last query lists
    nothing), and PART 1A turns the two classes off: the page and a card
    scan are refused, no draft is returned; on again, students see what
    they saw.
  - What still runs after PART 1: file 01's policies, Return Grades, a
    rubric move (still rewrites the returned copy), a restore (still writes
    `grade_return`), Duplicate Class (still copies the setting), the cards
    and the student's functions; a class leaving When I Return Them no
    longer returns what was waiting; a deleted piece leaves its row behind.
    `score_rpcs.py` passes as with Batch A loaded (236 of 236). A second
    run takes no lock: it goes through with all seven tables locked by
    another session.
  - After **PART 1B**: the five policies are the ones from before.
  - **PART 2** with S0-M4b on top stops before it changes anything (catalog
    and rows compared): it says S0-M4b is applied and to run its undo
    first, names what it found of it and nothing else; the pre-check says
    the same in its first row and lists nothing more. S0-M4b's own undo
    then runs and changes no row of any table from before Batch A.
  - After **PART 2**: the catalog is the one from before Batch A, line for
    line, but for S0-M5, which it leaves (the sixteen functions are line for
    line what they were just before PART 2, `pg_temp` last), and two things
    of its own: **three dropped-column slots on `course`** (where the three
    class settings were; a dropped column keeps its slot, which holds
    nothing and which nothing reads) and the migration record's four rows,
    which the header's optional statement then removes, and no other. Rows:
    compared with just before PART 2, nothing changed but the sign-in log,
    which lost its card rows and nothing else; compared with **before Batch
    A**, the only tables that differ are the eleven the teacher's own saves,
    new pieces, rubric move and restore wrote in between. The suites from
    before Batch A pass (`student_submit.py` 79, `questionnaire_identity.py`
    47, `phone_reports.py` 35 since its template is built as live has it,
    37 before; `questionnaires.py` 42), and `score_rpcs.py`
    passes 182 of its 183 checks on this database: the one that fails
    compares the score tables with `docs/schema.generated.sql`, which
    describes the live database with Batch A in it. That is the snapshot
    the header says to regenerate after PART 2. Every part run again
    changes nothing. Everything applies again, S0-M4b included, and gives
    the same database as the first time, every grade Returned (the
    backfill).
- **apply-only.** Everything applied; PART 2 stops for S0-M4b; S0-M4b's
  undo, then PART 2, nothing in between: every row of every table (56) is
  what it was before Batch A, and the catalog is the one from before but
  for S0-M5 and the three slots. **S0-M5 can stay.** If it is to go as
  well, its own undo (`s0-m5-undo.sql`) runs after PART 2 or before the
  other two: both orders end in the catalog from before all three, but for
  the three slots.
- **partial.** Only file 01, files 01 and 02, files 01 to 03 applied: PART
  1, 1B and 2 in turn, and PART 2 alone, each take it back out (no row
  differs; the catalog is the one from before but for the dropped slots of
  the columns that had been added).
- **repair.** What S0-M4b's repair does after PART 1 (its job is still
  scheduled; the proof calls it by hand). Before it: the changed Returned
  grade is shown, the first grades are not. After it, in the When I Return
  Them class: the changed grade is a draft and the student is back to the
  grade they were given; the first grade is a Draft, still hidden, and
  Return Grades now returns it; the drafts stay hidden. In the As Soon As I
  Save class the first grade is Returned and shown. The draft count moves,
  every working copy is up to date, the row a deleted piece left is gone;
  a class that left When I Return Them keeps its drafts. And why PART 1A is
  guarded: with the page turned off by a plain UPDATE and the repair run
  while it is off, a first grade and a changed draft the teacher never
  returned are made Returned, and shown when the page comes back on.
- **back-on.** Both fast stops and PART 1A, saves while it is off, then the
  way back on: the classes on, the repair, file 02, `2026110905`. All 21
  triggers and the job are back; the catalog is line for line the one from
  just after everything was applied; every `grade_return` row holds the
  grade as the score tables have it; the row a deleted piece left is gone;
  the student sees nothing the teacher did not return (the first grade
  saved in between is a Draft, and Return Grades returns it); a change to a
  Returned grade waits as a draft again. The same without the repair first:
  the catalog is the same, but file 02's backfill makes that first grade
  Returned and the student sees it at once.
- **half-way.** PART 1 stopped after each of its first six tables. At each
  point every kind of save goes through (points, a rubric criterion, a
  rubric fill, a comment, a clear, a class setting), by S0-M4b's trigger
  function where a trigger is left, and nothing a teacher is holding is
  shown, before S0-M4b's repair and after it is run at that point. Run
  again from the top, PART 1 finishes. With one table held by another
  session for good it tries 40 times (about twelve seconds), stops with a
  message naming the table, keeps what it had done, and finishes when run
  again. Sent as one message, the way a paste into the SQL editor arrives,
  it is still seven transactions: stopped at the fourth table, the first
  three stay done.
- **page-off.** With Batch A whole, a plain UPDATE turning the page off
  returns every waiting draft (3 of 3). PART 1A, run before PART 1 and
  after each of its first six tables, refuses each time, names the triggers
  left and changes nothing; its UPDATE pasted alone turns no class off
  either. Because `course` goes first, from PART 1's first table on even a
  plain UPDATE returns no draft. After the whole of PART 1 it still
  refuses, for S0-M4b's repair: with the job and the trigger, with the
  trigger alone (the UPDATE pasted alone turns nothing off in either case),
  with the job alone; a job switched off does not stop it. After S0-M4b's
  fast stop it turns the two classes off and lists them; no draft is
  returned and no row of `grade_return` changes.
- **fooled.** Fourteen things a later migration might build on Batch A, one
  at a time: a function that reads `student_card`, one that calls
  `return_grades`, one that reads `course.student_page_enabled`, a trigger
  on `score` whose function calls `_grade_copy`, a function in another
  schema calling `student_submit.page`, a view over `grade_return`, a view
  over the class setting, a SQL-standard function, a policy on another
  table, a foreign key to `student_card`, an index on a class setting, a
  column and an index added to Batch A's tables, another function in
  `fv_private`, a cron job. For each, with S0-M4b on top and again with it
  undone, PART 2 stops before it changes anything and names it, apart from
  what it says of S0-M4b, and the header's pre-check lists the same. A
  function that only mentions Batch A in a comment, or uses the words page,
  done, seen and card for its own things, does not stop it; with the
  fourteen gone PART 2 runs and a save still works.
- **without.** A database without S0-M4b (never applied, or already
  undone): PART 1 lists nothing, PART 1A runs straight after it, the
  pre-check says S0-M4b is not on top, PART 2 runs.
- **s3-m1.** Everything applied and used, then S3-M1 on top. The pre-check's
  first two rows say S0-M4b and S3-M1 are both on top, and it lists nothing
  else. PART 2 stops before it changes anything (catalog and rows
  compared): it says S3-M1 is applied and to run `s3-m1-undo.sql` first,
  names its functions, its key-id table and its columns, indexes and
  constraints on `student_card`, then says the same of S0-M4b, and names
  nothing else. PART 1, S0-M4b's fast stop, PART 1A and PART 1B run and
  leave every catalog line of S3-M1's as it was. After S3-M1's own undo the
  pre-check says S3-M1 is not on top and PART 2 stops for S0-M4b alone;
  after S0-M4b's undo PART 2 runs, and the catalog is the one from before
  Batch A but for S0-M5 and the three slots on `course`: S3-M1 and its undo
  leave no trace. Everything, S3-M1 included, applies again.

Result on 2026-11-10: **169 of 169 on PostgreSQL 17.11 (port 54331), which is what
production runs, and on 18.6 (port 54329)**, the same checks with the same
results (158 before the `s3-m1` scenario was added). Its template now loads
the two migrations live has and the earlier lists left out (see "S3-M1"
below), so `student_submit`'s `_norm`, `check` and `submit` are the live
functions here too.

`batch_a_undo_load.py`: six connections saving in a loop (points, a rubric
fill, one criterion, a comment, a clear, a change to the class itself: the
reviewer's mix), PART 1 run against them again and again, the saves paused
between runs while file 02 and then `2026110905` put everything back. The
table is three runs on 17.11 and one on 18.6 from before S0-M4b was
applied; the reviewer's own three runs are in the last column. The run on
each version with S0-M4b applied (so with its trigger function) is below
the table.

| PART 1                            | Runs finished             | Saves that failed         | PART 1 took                | Slowest save here | Reviewer's runs                                                      |
| --------------------------------- | ------------------------- | ------------------------- | -------------------------- | ----------------- | -------------------------------------------------------------------- |
| as it is now, a class at work     | 40 of 40 every time       | none                      | about 10 ms, at most 0.2 s | 0.1 s at most     | no save failed                                                       |
| as it is now, flat out            | 20 of 20 every time       | none                      | about 1 s, up to 8.3 s     | 0.3 s to 0.9 s    | no save failed; slowest save 0.6 s, 1.6 s, 4.6 s; PART 1 up to 5.8 s |
| as first written, a class at work | 40 of 40 every time       | none                      | a few ms                   | 0.4 s at most     |                                                                      |
| as first written, flat out        | 5, 6 and 11 of 20 (17.11) | 106 to 146 killed (40P01) | 3 s as a rule              | 3 s to 16 s       |                                                                      |

With nothing run against them the same saves ran at 900 to 1,200 a second
flat out, none failed and the slowest took 0.06 s: every wait and every
killed save above is the script's doing.

The 18.6 run agrees: as it is now, every run finished and no save failed
at either speed (slowest save 1.3 s flat out, PART 1 up to 3.7 s); as first
written, 5 of 20 flat out and 75 saves killed.

With S0-M4b applied, one run on each version: as it is now, every run
finished and no save failed at either speed (a class at work: 8 ms; flat
out: 0.6 s as a rule and 3.1 s at most on 17.11, 1.4 s and 4.8 s on 18.6;
slowest save 0.3 s and 1.1 s). As first written, flat out: 2 and 4 of 20,
72 and 102 saves killed.

PART 2 is one transaction on purpose and holds the score tables until it
commits. Six sets of ten runs here, the last two after S0-M4b's undo (run
with the saves paused). With a class at work 10 of 10 runs finished in the
first four sets, 9 of 10 and 8 of 10 in the last two; no save failed in the
four sets on 17.11, and in the two on 18.6 saves were killed by deadlocks
(7, and 17). Flat out it is the wrong tool: 0, 3, 3, 3, 3 and 2 of 10 runs
finished here (4 and 6 for the reviewer; the others were stopped by a
deadlock or the lock timeout, nothing changed), 42 to 77 saves were killed
in each set of ten (34 and 42 for the reviewer), and eight times a save
caught in flight failed with "column does not exist". It is for a moment
when nobody is saving.

Not verified: pg_cron and Supabase's real migration record (stand-ins
here); S0-M4b's own undo against looping saves (its own tests' business); the edge function and the app against a database after PART 2;
anything on `gradebook-prod` itself.

## S4-M1: what a student's page can also be told (2026-11-11)

(This section sits ahead of S3-M1's so that it and Batch B's section, which
another pull request adds at the end of this file, do not collide.)

`../2026111103_student_page_fields.sql` replaces two functions,
`student_submit.page` and `student_submit._session_classes`, and nothing
else: no table, column, row, trigger or policy, and who may run the two is
as it was. The reply gains keys
to read (the contract, with a worked example, is `s4-m1-contract.md`): the
teacher's name, each competency's I Can statements, the competencies each
rubric row counts toward, and for each assessment its description, module,
category, what the category counts for, and its Core Competencies; and
beside each class in the session's list, how many pieces wait (`to_do`).
Every key the reply had before keeps its value. It changes no grade and
deletes nothing; it is tested here only and waits for the owner.

**The edge function does not pass the new keys on.** `student-submit`
copies a reply field by field (`card-routes.ts`), so until its lists are
extended and it is redeployed a phone is sent what it is sent today.

It is tested on the database as live is since S3-M1 was applied: everything
`card_codes_common.LIVE` loads, then `../2026111003_card_codes_keyed.sql`.
`student_page_fields.py build` loads exactly that into an empty database,
and every scenario runs on a copy of it. The four functions the file checks
come out of that build with the fingerprints live has (`e744f2a2…` for
`page`, `6ef848f9…` for `_session_classes`, `21706ae9…` for
`_returned_grade`, `1ae94981…` for `_session_class`).

```bash
PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields.py build     # an empty database: live as it is now, without S4-M1
PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields.py           # the migration, a little over a minute
PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields_undo.py      # its undo
PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields_mutate.py    # 33 wrong versions of the file, about a quarter of an hour
PGPORT=54351 PGDATABASE=s4m1_live python3 student_page_fields.py fingerprints write   # after any edit to either function
```

`batchb` needs Batch B's two files and its storage stand-in. They are in
this checkout once Batch B is merged; until then name a checkout that has
them: `BATCH_B_DIR=<path to a checkout of batch-b-submissions>`. Without
them the scenario prints `SKIPPED` and checks nothing.

**How "nothing about grades changes" is shown.** Before the file is applied
to a scenario's copy, the two functions as live has them are kept beside
the new ones under other names (`page_old`, `_session_classes_old`: their
definitions as `pg_get_functiondef` prints them, only the names changed).
One statement then asks both for the same page, and the new reply with the
nine new keys taken out must be the old reply: every key and every value, a
number compared as it is printed (7 and 7.0 differ). A new key that is
missing fails the comparison too. Alongside it, each class's `to_do` must
equal three other counts: the one `shared/student-view.js` gives for the
same reply (`counts.toDo + counts.missing`), from the real file, run in
node on the database's own reply (`student_view_counts.mjs`; skipped with
a `SKIPPED` line where there is no node); that same rule written out in
Python; and a count read straight from `score` and `grade_return` as the
owner.

`student_page_fields.py`, by scenario:

- **apply.** The file's shape (one transaction, a lock timeout, the check
  first; it makes two functions and drops, alters and deletes nothing). The
  two read-only queries for the live database (`s4-m1-live-precheck.sql`)
  and the one for afterwards (`s4-m1-live-postcheck.sql`) are run here:
  nothing listed before, the counts right, the two functions listed by the
  post-check before the apply and nothing after it; and each notices what
  it should (a function changed, a column missing or of another type, a
  grant, a lost `pg_temp`). The twenty columns the pre-check lists are the
  ones the file itself checks for, each with the type
  `docs/schema.generated.sql` gives it. Each of the file's checks stops it
  at the check with nothing changed: each of the four functions with one space more in
  its body; `page` missing; Batch A, S0-M4b, S0-M5 or S3-M1 missing; each of
  five columns the new lines read renamed (`page` is PL/pgSQL, which would
  otherwise fail only when a student opened their page). **What it waits
  for:** making `_session_classes`, an SQL function, reads the definitions
  of the six tables it names, so while another session holds one of them
  whole the file gives up after five seconds with nothing changed; an
  ordinary save in progress does not hold it up. Then the apply, on a class
  in use with two phones signed in: of about 2,400 catalog lines the only
  ones that differ are the two functions' own, and in those only the text
  (owner, grants, STABLE, SECURITY DEFINER, `search_path`, result and
  arguments are as they were); **no row of any table changes**; the phones
  stay signed in and their pages are what they were with the new keys
  added. A second run changes no catalog line and no row. A run after
  `page` was changed again stops and puts nothing back.
- **same.** Old reply against new, on a class that uses every kind of work
  and every new key (two weighted categories, two modules, I Can
  statements, a rubric whose rows are linked to competencies, a competency
  taken off the class, Core Competencies, descriptions, a DIBELS benchmark,
  a piece dated tomorrow, two pieces on one date in the class's own order),
  for both of its students and for the first student's second class: after
  **every step of every case in `tests/fixtures/grade-state-cases.json`**
  (all 45, each on a piece decorated with a different mix of the new
  things, the class's grading style turning through Both, Letter and
  Proficiency); through 300 seeded random saves, comments, clears, returns,
  statuses, setting changes, opens, and competencies removed and put back;
  with a returned piece changed to points, to DIBELS, to Complete, to a
  rubric, and the rubric, a category, a module and a piece then deleted;
  and for every refusal (`signed_out` five ways, `not_found` five ways,
  `closed`, `card_expired`, `card_stopped`). 1,548 whole pages compared,
  none different. Where a case turns the class's
  Student Page off, both functions refuse alike; the switch is then turned
  on for the comparison alone, with every trigger asleep so no grade's
  state moves, and put back. `verify_card`'s list of classes is the page's
  own list.
- **fields.** The exact set of keys at every level (the old ones, the new
  ones, no other). Each new key: what it holds; when it is `null` or `[]`;
  that text is sent as stored; that a competency taken off the class is in
  no list; that a criterion, a module or a category wrongly pointing at
  another class's row sends nothing of it. `category_percent` in a Both, a
  Letter and a Proficiency class, for a category that weighs 0, for a
  DIBELS benchmark, for a class whose weights do not total 100, and with a
  fraction. The seven Core Competencies in the Ministry's order, each once,
  named as `shared/constants.js` names them. A class with nothing in it.
- **todo.** What counts: a draft never moves the count (saved over
  nothing, saved over a returned grade, a returned grade cleared); with
  every `grade_return` row made a draft and then none, and with every
  score wiped behind the triggers, every count is what it was; Missing,
  Excused and Late on returned and on ungraded work; a DIBELS benchmark; a
  piece dated today and tomorrow; a piece that came back with nothing left
  to show; As Soon As I Save; the session's second class; another student.
  In a class fourteen hours ahead of UTC and one eleven hours behind, the
  count follows the class's own date, as the page does.
- **privacy.** Of every table and view in `public` and `student_submit`,
  `page` names fourteen and `_session_classes` six, and no other (comments
  and quoted text set aside first). Neither names a score table,
  `grade_return`, a stored copy, the draft flag or a copy maker, and in the
  whole schema `_returned_grade` is still the only function that does
  (`student_page.py`'s rule). Neither names any of 37 columns and tables a
  student is not shown. Of the teacher's row, one column. Then with real
  rows: a draft's comment, the Note for the Report, a teacher's note, goal
  and observation, another student's name, number, birthday, email and
  grade, another teacher's class, and every id of a teacher, student or
  class are nowhere in the reply; what one student has had returned moves
  nothing in another's page.
- **grants.** On a copy where a new function is runnable by everyone by
  default and anon and signed-in teachers are let into the schema: `page`
  is the service role's alone and `_session_classes` its owner's, before
  and after, to the letter; anon and a signed-in teacher who owns the class
  are refused both by the function itself. Temporary tables named
  `teacher`, `category`, `module` and `assessment`, made by the caller,
  change nothing in the reply.
- **batchb.** Batch B's two files first, then this one; and this one first,
  then Batch B's. Either way both apply, each leaves the other's functions
  exactly as they were, a second run of either changes nothing, the old
  reply and the new agree, the pre-check and the post-check list nothing,
  and this file's undo runs with Batch B applied and touches nothing of
  Batch B's.
- **suites.** `student_submit.py` 79, `questionnaire_identity.py` 47,
  `phone_reports.py` 35, `questionnaires.py` 42, `grade_return.py` 284,
  `grade_return_limits.py` 74 and `score_rpcs.py` 236 give the same result
  with the file applied as before it.
- **cost.** One page, timed before and after, for three sizes of session.
  The count beside each class asks `_returned_grade` once for every piece
  of every class in the session, and that function costs about a third of
  a millisecond a piece here, so the page costs more the more classes a
  student has. On this Mac, before and after: one class of 30 pieces, 13
  and 25 ms; two classes of 30, 13 and 37 ms; four classes of 60, 25 and
  123 ms. The cheaper ways (a count that reads `score` and `grade_return`
  itself, or a faster `_returned_grade`) each change the one-reader rule or
  Batch A's function, and are not done here.

`student_page_fields_mutate.py` makes 33 wrong versions of the file, one
change each (the To Do count forgetting Missing work, counting Excused
work, a DIBELS benchmark, pieces not yet dated, another class's or another
student's; the teacher's email sent for their name; a removed or a foreign
competency listed; a percent given where none is true; a draft coming
back; the list or its order changed; `v` changed), gives each its own
fingerprints so the file does not refuse itself for that alone, and runs
the suite. All 33 are noticed: 31 by a check of what the functions do
(from 1 check to 81), and two by the file itself, which refuses to apply
them (`page` without `pg_temp`; `page` granted to signed-in teachers).

`s4-m1-undo.sql` (not a migration) and its proof,
`student_page_fields_undo.py`: the undo refuses a database S4-M1 is not
applied to, a second run, and a database where either function has been
changed since; otherwise it puts both back, and **the catalog is the one
from before S4-M1, line for line**, the two fingerprints are live's, no
row differs, the phones are still signed in, and each page is the page
S4-M1 gave with the new keys gone. S4-M1 then applies again to the same
catalog as the first time. With a migration record, the optional statement
in the undo's header removes S4-M1's row and no other. **Order:** this undo
goes before S0-M4b's (`s0-m4b-undo.sql` PART 2 puts `page` back as Batch A
made it, and refuses while `page` is S4-M1's; proved both ways). S3-M1's
undo runs with S4-M1 applied and leaves these two functions alone.

After the apply, S3-M1's own post-check (`s3-m1-live-postcheck.sql`) lists
`page` and `_session_classes` as changed, because it was written for the
day S3-M1 was applied. That is expected; `s4-m1-live-postcheck.sql` is the
one to run.

Result on 2026-11-11, on PostgreSQL 17.11 (what production runs), from a
clean clone on a database built from empty: `student_page_fields.py` 259 of
259 (with Batch B's files named by `BATCH_B_DIR`; 240 of 240 and one
`SKIPPED` line without them); `student_page_fields_undo.py` 28 of 28;
`student_page_fields_mutate.py` 33 of 33 noticed. `npm test` gains
`tests/student-page-fields.test.js` (8 tests: the Core Competency names
are `shared/constants.js`'s, and the percent rule is what `calc.js` does).

Not verified here: anything on `gradebook-prod` itself (the pre-check is
written, with the expected answers, and has not been run); the edge
function, which this pull request does not change and which drops the new
keys until it is extended; `shared/student-view.js` building the same keys
from a teacher's cache (the contract gives the rule for each); the time
`page` takes on `gradebook-prod`'s own machine; and the first run of
`page`'s main statement on live, which happens when a student next opens a
page (the file checks that every column it reads is there, the pre-check
compares their types, and the stand-in's tables are generated from the
snapshot of live).

## S3-M1: card codes the database cannot read (2026-11-10)

`../2026111003_card_codes_keyed.sql` stops every card, drops the readable
`code`, `code_hash`, `salt` and `password` from `student_card`, and keeps a
keyed tag of each new card's code instead (`code_hmac`), made by the edge
functions with a key the database never sees. Cards are made by
`student_submit.issue_cards` and found by `student_submit.card` and
`verify_card`, all called with tags only. It **deletes data** (every card's
code and password), so it is tested here only and waits for the owner.

It is tested on the database as live is since 2026-11-10 17:12 UTC: the
harness, S0-M4, Batch A's four files, S0-M5, S0-M4b. `card_codes.py build`
loads exactly that into an empty database (`card_codes_common.LIVE`: the
list under "S0-M4b" above with that file added, and two more migrations,
below). That database is only a template: every scenario copies it
(`<PGDATABASE>_<scenario>`, made and dropped by the script), so the scripts
can be run again and again.

**Two migrations the earlier lists leave out.** The read-only pre-check
(`s3-m1-live-precheck.sql`) was run on `gradebook-prod` on 2026-11-10 by
the orchestrator. Everything the migration changes matched. It listed
three functions the migration does not touch, `student_submit._norm`,
`check` and `submit`, as differing from the harness. The cause was the
harness: the lists under "Batch A" and "S0-M4b" above never loaded
`../20261102_housekeeping_fk_indexes.sql` (it gives `_norm` an empty
`search_path`) or `../20261107_no_report_reply.sql` (it rewrites `check` and
`submit`: a report is for reading), both applied to live before Batch A.
`card_codes_common.LIVE` and `batch_a_undo.py`'s list now load both, after
`20261103_slip_password_kept_for_live_slips.sql`. Three statements of the
first are left out, by name, because they touch things this stand-in does
not have (two indexes on the report-issue tables, and
`fv_check_reporting_terms`). With them the three functions come out with
the live fingerprints exactly (`276ee00a…`, `cc54e80c…`, `90ace3c1…`,
recorded in `live-function-md5.txt`; `card_codes.py` checks them on every
run). No earlier record carried these three, so no recorded fingerprint was
wrong; but every database built from the earlier lists has the older
`check` and `submit`. Owed: the same two files in the lists under
"Batch A" and "S0-M4b" and in `search_path.py`'s own list, with those
suites rerun.

```bash
PGPORT=54331 PGDATABASE=s3m1_live python3 card_codes.py build    # an empty database: live as it is now, without S3-M1
PGPORT=54331 PGDATABASE=s3m1_live python3 card_codes.py          # the migration, about two minutes
PGPORT=54331 PGDATABASE=s3m1_live python3 card_codes_undo.py     # its undo
PGPORT=54331 PGDATABASE=fv_undo python3 batch_a_undo.py s3-m1    # Batch A's undo with S3-M1 on top (its own template)
```

**The edge functions' part is played in Python** (`card_codes_common.py`),
with a fixed fake key: a code is drawn from the slip alphabet, eight
characters; its tag is HMAC-SHA-256 of `fv.card.code.v1`, a newline and the
code; the password's tag is `fv.card.pass.v1`, the code and the four
digits; the key id is the first eight hex characters of the tag of
`fv.card.keyid.v1`. Those are the formats `card-codes-contract.md` fixes.
The database is sent tags and nothing else, as it will be.

`card_codes.py`, by scenario:

- **apply.** The file meets a database in use the old way: cards for two
  teachers' classes, one replaced once, a signed-in phone, a live slip,
  four remembered card answers. Its shape (one transaction, lock timeout,
  guard first; it never names pgcrypto's keyed-hash function). Each guard
  stops it at the guard with nothing changed: each of the nine functions it
  drops, replaces or patches with one space more in its body; one missing;
  one of its new names already taken; Batch A, S0-M4b or S0-M5 missing; a
  function the repo does not know that reads `student_card`, in `public`
  and in another schema (one that only mentions it in a comment does not
  stop it); an `auth.uid()` that would not answer with the id
  `issue_cards` sets; a card row held by another session (it gives up at
  five seconds). The two read-only queries written for the live database
  (`s3-m1-live-precheck.sql`) are run here: nothing listed, the counts
  right, and each kind of difference noticed. Then the apply: the four
  columns gone and the four new ones there; every live card stopped and
  the already-stopped one untouched; nothing else about a card changed; no
  old card given a tag; card numbers in the order cards were made; the
  signed-in phone told `card_stopped`; the remembered card answers deleted
  and no other; **no row of any other table changed**; every catalog line
  that changed is about the cards, the key-id table or the fifteen
  functions the header lists, and `open`, `verify`, `check`, `submit`,
  `page`, `seen`, `done` and `_returned_grade` are byte for byte what they
  were; the two slip issuers back at their fingerprints from before
  Batch A, the old slip still opening and new questionnaire and report
  slips issued; the old functions gone and an old edge function or the
  released site getting an error, not an answer; who can read and run what;
  the post-check (`s3-m1-live-postcheck.sql`) empty, and noticing a grant,
  a policy, a helper opened up and a changed function. **The table's file
  on disk** is read before and after (the script reads the server's own
  data directory; it skips these checks where it cannot): before, it holds
  the codes, hashes and salts; after, none of them, because the file
  rewrites the table; and after the same column drop without a rewrite
  they are still there. A card is then made the new way; **a second run
  changes no catalog line and no row, and the card made since is still
  live and still opens.** A second run on a database where one of the
  file's own functions was changed by hand stops.
- **cards.** The stand-in makes the same tags as the edge functions' own
  known answers (`tests/card-key.test.js` on their branch). `issue_cards`
  as the `teacher-cards` function calls it: the owner; results in the request's order; what is stored (the first
  candidate's tag, the key id, a password tag only for a student with
  nothing else on file); no tag in any reply and no code in any row of any
  table; a replay returns the first answer without `candidate`, makes
  nothing and returns no tag; another teacher's id, an id that is no
  teacher, a deleted teacher, a deleted class; anon, a signed-in teacher
  and even the service role kept from `_as_teacher`; the caller's id put
  back as it was found, after a call that made a card and after a replay
  (which returns early), with the harness's `auth.uid()`, with Supabase's
  own (it reads either setting) and with one that reads only
  `request.jwt.claims`; a stale `replaces` in four forms gives `changed`
  and changes nothing; a withdrawn student, another class's and nobody's
  give `not_found`; the second candidate used when the first one's tag is
  taken; both taken gives `failed` **and the old card is still live**;
  every malformed request refused whole (18 shapes, no items, four bad key
  ids); the table's own constraints refusing a plain code, a live card
  with no tag, a second live card; `needs_new` following the key id last
  seen, and stopping nothing.
- **lookup.** `card` and `verify_card` as `student-submit` calls them (its
  own statements, word for word, among them): found by tag; closed, withdrawn, deleted, expired; a caller that sends
  the wrong shape gets an error and nothing is logged; five wrong in a row
  and fifteen in 7 days; Unlock; the password by its tag only (the right
  digits tagged for another card, or under another key, do not open it); a
  password that outlives a birthday added later; nothing on file answers
  `reprint` and counts nothing; a replaced card answers `card_stopped`
  from both, is logged with its id and never counts as a guess (400 scans
  lock nobody out); 300 unknown codes from one address in 15 minutes, and
  no everyone-is-busy stop; Add Another Card, the start screen, Done,
  midnight; `page` and `seen` on a card made the new way, a draft never
  shown; housekeeping; what the log keeps; temporary tables named
  `teacher` and `course` fooling nothing; and a right answer on a card
  that is replaced while the check waits for its row: it waits, then
  `card_stopped`, and no session.
- **race.** On connections of their own: two first cards for one student
  at once, two replacements of one card at once, the first rolled back,
  the same idempotency key twice at once, and 25 rounds of four requests
  at once for two students listed in either order. One live card each,
  the rest told `changed`, no deadlock, no error.
- **grants.** The file's own revokes and grants, where nothing else would
  hide a missing one. This stand-in, like live, gives a new function to its
  owner alone by default, and anon and signed-in teachers cannot enter the
  `student_submit` schema at all; with both in place a dropped `revoke`
  changes nothing anyone can see. On this copy both are taken away first
  (a new function is runnable by everyone, as in a plain Postgres): the
  three helpers are still left to nobody, `card`, `verify_card` and
  `issue_cards` to the service role alone, and anon and a signed-in
  teacher are refused each of the six by the function itself.
- **suites.** `student_submit.py` 79, `questionnaire_identity.py` 47,
  `phone_reports.py` 35 and `questionnaires.py` 42 are run before the file
  and again with it applied: the same result each time. The first two are
  untouched; the other two now read whether the report reply exists (see
  above), and 35 is what `phone_reports.py` has on a database built as
  live. `score_rpcs.py` passes 235 of 236
  until `docs/schema.generated.sql` is refreshed after the apply (its one
  comparison with the live snapshot, which does not have the three new
  argument lists yet), then 236. `grade_return.py` 284 and
  `grade_return_limits.py` 74 pass: they now read which way the database
  makes cards (`batch_a_common.card_session`, `keyed_cards`), so they run
  with or without S3-M1.

`s3-m1-undo.sql` (not a migration) and its proof, `card_codes_undo.py`:

- **main.** Cards made and used the old way; the catalog (`catalog.py`,
  about 2,100 lines) and a checksum of every table. S3-M1 applied and used
  (new cards, a signed-in phone, a replaced card). Each of the undo's
  checks stops it at its guard with nothing changed: each of S3-M1's nine
  functions changed since; an old function back; a column, an index, a
  constraint, a trigger, a policy, a foreign key or a view added to
  `student_card` since; a function built on S3-M1 that reads the cards or
  the key id; a card row held by another session. Then the undo: **the
  catalog is the one from before S3-M1, line for line** (but for the
  migration record, which the header's optional statement clears); every
  card from before is there with what it had, stopped, with a stand-in for
  its code, hash and salt and no password; the only tables whose rows
  differ from before are the cards, the remembered answers and what using
  it wrote (the sign-in log, the sessions); the table's file holds none of
  the tags; S3-M1's functions are gone; Make Cards, a card scan, the page,
  Reissue and slips work the old way; the undo refuses a second run and
  changes nothing; **S3-M1 applies again to the same catalog as the first
  time**; the undo again.
- **apply-only.** Applied and undone with nothing in between: the catalog
  is identical, and of every table only two differ: `student_card` (every
  card stopped; the four columns of every row) and `fv_idempotency` (the
  three card calls' rows S3-M1 deleted).
- **suites.** After an apply and an undo, Batch A's own suites pass as
  before: `student_page.py` 216, `grade_return.py` 284, `score_rpcs.py`
  236, and the slip suites 79, 47, 35, 42.

The undo makes `student_card` again from Batch A's own `create table`
rather than adding the four columns back, so the table has the same columns
in the same order and no dropped-column slots: that is why the catalog
comes back identical, and why S3-M1 applied a second time gives exactly the
first catalog.

`batch-a-undo.sql` knows S3-M1 as it knows S0-M4b: PART 2 stops, says S3-M1
is applied and to run `s3-m1-undo.sql` first, and names what it found of it
apart from anything else; the header's pre-check has a second first row for
it. `batch_a_undo.py s3-m1` proves the order S3-M1's undo, S0-M4b's undo,
PART 2, and that PART 1, 1A and 1B run with S3-M1 applied and leave it
alone.

Result on 2026-11-10, on PostgreSQL 17.11 (port 54331, what production
runs) and on 18.6 (port 54329), the same on both, on databases built as
live has them (the two migrations above loaded): `card_codes.py` 306 of 306;
`card_codes_undo.py` 67 of 67; `batch_a_undo.py` 169 of 169 (158 before its `s3-m1`
scenario was added). Before the two migrations were loaded the same three
gave 278, 67 and 169; `card_codes.py` has since gained the `grants`
scenario and three checks on the replay path, after an independent review
showed two mutations no check saw (the `revoke` on `_as_teacher` removed;
the caller's id not put back on a replay). Both are caught now.

Which older suites still run where. `student_page.py`, `grade_return_race.py`
and `batch_a_undo.py`'s other scenarios make cards with `issue_student_cards`
and read codes from the table, so they run on a database **without** S3-M1
(the lists above still build one), and `student_page.py` passes again after
S3-M1's undo. On a database with S3-M1, `card_codes.py` (cards, lookup)
covers what `student_page.py` covers for cards, sessions, `page`, `seen`
and `done`. Owed once S3-M1 is applied to live: `grade_return_race.py`'s
six card rows moved to `issue_cards`, and `live-function-md5.txt` given
the nine new fingerprints.

Not verified here: the edge functions themselves (their own tests); the
real key; `auth.uid()` as gradebook-prod defines it (the file tries it
before it changes anything, and the pre-check reads it); Supabase's default
privileges in `student_submit` (the post-check lists who can run what);
how long the old values stay in gradebook-prod's write-ahead log and
backups; anything on `gradebook-prod` itself.

## Batch C: Mark Up, Reflect on Feedback, Revisions, group work, My Learning (2026-11-11)

Two files. `../2026111120_markup_reflect_revise.sql` (C1) only adds: three
tables (`markup`, `revision_request`, `feedback_reflection`), two class
switches (`reflect_on_feedback`, `show_my_learning`), nine teacher RPCs, nine
student functions and their helpers, two triggers each on assessment and
enrollment that delete the new rows with their student or piece, and one on
submission that settles a revision's request before the revision is deleted
(review round 3). It changes no existing row, function (but Batch B's
`_grading_started`), trigger, policy or grant.
`../2026111121_markup_revise_grade_changes.sql` (C2) adds two functions,
two triggers on `grade_return` and one on `course`: whenever a grade is
returned (a write that stamps a new returned date), the marks on that piece
are given and a finished revision request is stored as done; when a class
stops holding grades, marks waiting on returned work are given. It writes
no grade row. C2 waits for the owner. Hiding a grade during a revision is not in Batch C
(Colin, Nov 11): a request for it answers `hide_not_available` with either
file, and nothing of Hide is in either.
The contract for the edge routes and the browser is `batch-c-contract.md`.

Batch C applies only after Batch B, so the harness builds the database as
live will be when Batch C is applied, in the apply order: everything
`card_codes_common.LIVE` loads, S3-M1, S4-M1 (`../2026111103_student_page_fields.sql`,
applied on live), Batch B's storage stand-in, Batch B's two files and its
review fixes (`2026111104_student_work_review_fixes.sql`). Batch B and its
fixes are on `main` now but not on this branch, so its files are read from
`BATCH_B_DIR` (a folder holding the three migrations and
`local-test/storage-stand-in.sql`): an extract of `origin/main` (at
`6137c856`; every fingerprint list taken from `7f5f34e5`, Batch B at
`8c36fe48` plus the fixes file, is current on it):

```bash
mkdir -p /tmp/bb && git archive origin/main migrations | tar -x -C /tmp/bb
export BATCH_B_DIR=/tmp/bb/migrations
PGPORT=54361 PGDATABASE=bc python3 batch_c_common.py build        # an empty database: live as it will be with Batch B
PGPORT=54361 PGDATABASE=bc python3 batch_c.py                     # both files, about a minute
PGPORT=54361 PGDATABASE=bc python3 batch_c_undo.py                # both undo scripts
PGPORT=54361 PGDATABASE=bc python3 batch_c_mutate.py              # 93 wrong versions of the SQL, about fifteen minutes
PGPORT=54361 PGDATABASE=bc python3 batch_c_fingerprints.py check  # are the fingerprint lists in the eight files current
```

If Batch B changes before it is applied, run `batch_c_fingerprints.py`
(without `check`) against a template built from the new Batch B: C1's guard
compares the Batch B functions it calls, and stops on any difference.

Where the fingerprints come from (refreshed 2026-11-11, PostgreSQL 17.11,
from a template built as above): the Batch A, S0-M4b, S0-M5 and S3-M1
functions from this branch's `migrations/` (main at `f825be77` merged in);
the Batch B functions from `8c36fe48`; `finish_work_upload`, `send_finish`
and `unsend` from the fixes file at `7f5f34e5` (C1 lists them so it stops
unless the fixes are in first; it calls none of them). S4-M1 replaced
`student_submit.page` and `_session_classes`; C1 neither calls nor
replaces either. Every list in the eight files was current on this base but
for those three new rows.

`batch_c.py`, by scenario:

- **apply1** (C1 on a database in use: a signed-in phone, work sent, a
  returned grade, a draft). Each guard stops the file at the guard with
  nothing changed (Batch B missing; a Batch A or Batch B function it calls
  changed; a function, column or trigger name taken). The pre-check is
  clean, and notices a changed function. Then the apply: **no existing
  catalog line changes** (only counts grow: dependencies, comments, the
  internal triggers of the new foreign key to `submission_file`); every
  existing function keeps its fingerprint; exactly C1's functions are new;
  **no row of any existing table changes in any column it had**; the
  phone's page is as before; both switches are off. The post-check is
  clean, and notices seven kinds of damage. A second run changes no catalog
  line and no row; a second run after one of its functions was replaced
  stops. The file is one transaction with a lock timeout and its guard
  first, no top-level statement writes a row, and a transaction reading
  `course` makes it give up after five seconds with nothing applied.
- **teacher**. The switches RPC (a patch writes only what it names; shapes;
  replay; another teacher; nobody). `save_markup`: revs, replay, a stale
  screen answered `changed` with nothing written, ten wrong shapes, another
  teacher, nobody, a page not handed in; marks wait in a class that holds
  grades and are given at once in one that does not (or with the page off).
  `list_assessment_markup`, `list_course_feedback`. `return_work`: returns
  the draft and gives the marks, replay, nothing waiting, another teacher; a
  mark erased before Return is never given. Deleting an assessment takes
  its marks.
- **markup**. Before Return the student is given nothing; the teacher's
  working copy is in no student answer (page, feedback, markup, work);
  after Return the marks and the counts; a later change waits; another
  student, another class, no session, a wrong shape; Students See Your Mark
  Up off; Missing; the page off; the stored photo is untouched; Unsend and
  deleting a student take the marks.
- **started** (C1 2b, decided by the owner: ruling 109). Batch B's
  `_grading_started` replaced: no grade and no marks is not started; one
  mark on one page is (given or not), for that student and piece only;
  Unsend, Replace and a Replace finishing after the teacher marked answer
  `grading_started` and remove nothing; every mark erased, not started
  again; a group-mate's marks do not lock this student; a draft alone still
  counts; marks on a revision's pages make it `grading` (no
  `revision_unsend`, no second `revision_start`) until erased. apply1 also
  checks C1's body is Batch B's text with one condition added, and that
  only that function's body changes; the undo puts Batch B's back exactly.
- **contract** (the points the Demo screens' builders found unclear). (f)
  Demo Mode's marks are taken and kept exactly; 22 wrong places and shapes
  are refused (off the page, a missing place, flat points, a colour not
  offered, an unknown key, v 2); the page's edges are on it. (b) `given` is
  the marks everywhere; `save_markup` answers `given_rev` and `waiting`.
  (e) a page drawn on and erased before any Return does not wait and is not
  given; a change after Return waits; nothing waits while the piece shows
  no marks. (i) `pages` and `work_pages`. (h) `group_file_links` rows carry
  `file_id` and `page`. (a) Make My Plan through `reply` (its refusals; kept
  by a reply without a plan; the newest plan is Your Plan From Last Time).
  (k) `answer_new` and `answer_seen` (no session, another student, twice, no
  grade row changed). (g) Only Me: kept as the teacher's note, clears the
  question, in no student answer, no reply to it, a follow-up noted Only
  Me. (c, d) the switch
  off: `reply` and `answer_reflection` answer `reflect_off`, both sides list
  no reflection, nothing is deleted, all back when it is on.
- **gone** (what C1's delete triggers do). With a marked page, a
  reflection and a revision request for two students on two pieces:
  withdrawing a student deletes nothing; deleting the withdrawn student takes
  only theirs; Delete Assessment takes only that piece's; a piece with none
  deletes none; the 30-day purge of a deleted class takes all of that
  class's and none of another teacher's.
- **reflect**. Every refusal (not returned, no grade, the switch off,
  another student, another class, not yet on the page, no session, a locked
  card, eight wrong shapes); yes with a plan; the same twice; sent again
  before an answer; the teacher's question list, answer (refusals, replay),
  the waiting mark cleared; Your Teacher Answered; no change once answered;
  `reply` (shapes, a follow-up, a second one refused, its answer); Your Plan
  From Last Time; one student never sees another's; the student's calls
  change no grade row; deleting an assessment takes its reflections.
- **revision**. `return_for_revision`: another teacher, another class,
  nobody, eleven wrong shapes, DIBELS, Hide (not in Batch C); a refusal writes
  nothing; made: the work returned with it, the first version and its
  grade kept, replay, already open. `set_revision_request`. The student's
  revision: another student, a wrong shape, Batch B's `send_start` and
  `send_finish` still refuse it, version 2, replay, missing pages, another
  student cannot finish it; both versions listed by Batch B's `file_links`;
  Batch B's `unsend` will not take it; sent again before grading (the first
  revision's files queued); `revision_unsend`; grading noticed when the
  grade changes; the student keeps the first grade while the new one is a
  draft; **returned, the new grade replaces the old and the first stays as
  history**; a new request marks the old done; Take Back; twenty an hour
  shared with Batch B; Send Work off; late after Revise By; deleting a
  student; a rubric piece's criteria; work on paper.
- **group**. One per Group: counts with no names, a member's pages reach
  the group and not another group, Add a Page as the member's own send,
  each Unsend takes only its own, marks on the group's pages, Each
  Student, odd and withdrawn members, Pairs, no groups made.
- **grants**. Nothing runnable by `anon`; student functions for the
  service role only; helpers for nobody; row security on the three tables,
  unreadable by `anon` and signed-in teachers; every SECURITY DEFINER
  function names `pg_temp` last; no student function reads `markup.working`
  or a score table.
- **race**. The same request twice at once for `return_for_revision`,
  `save_markup`, `return_work`, `answer_reflection`: the second waits for
  the class lock and gets the first's answer; one row. A revision finishing
  while a grade is saved waits and sees it.
- **apply2** (C2). Without C1 it stops; each guard stops it with nothing
  changed (a function it relies on changed, a trigger name taken); the
  pre-check is clean. Then **no existing function changes, one is new, two
  triggers are added on `grade_return`, nothing else in the catalog
  changes, and the apply changes no row**. The post-check is clean and
  notices damage; a second run, and C1 run again after C2, change nothing.
- **given** (C2). Marks given by `return_grades` from an older screen, by a
  class leaving When I Return Them, by a save in a class that returns at
  once, and when a grade's row is first made returned; not by a draft or a
  `seen()` row; the trigger function is runnable by nobody but its owner.

Review round 1 (`batch-c-review.md`; each scenario was committed first and
failed on the reviewed code, `73ba899e`):

- **closes** (C1's (b) 1 and 2), with C1 alone and with C2. The revision's
  grade returned by `return_work`, by `return_grades` and by a save in a
  class that returns at once: both sides told returned; stored as done
  (with C2 at once, by the trigger; with C1 alone at `return_work` or the
  next Batch C call); the revision's photos then deleted, still returned
  and no new revision; the grade then cleared and the clear returned,
  still returned. One way is left open with C1 alone: a revision's grade
  returned by a save, its photos deleted and its grade cleared by saves,
  with no Batch C call between, reads open (C2's trigger closes it). A
  revision returned at the same grade: `return_work` returns no grade and
  changes no grade row but ends the request; `revision_unsend` then
  answers `grading_started` and removes nothing; a Return with no revision
  in leaves a request open.
- **only_me** (C1's (b) 3). A note is kept for the teacher, not as the
  answer, and clears the question. A student with a note and one with
  nothing are told the same, call by call (`feedback`, `reply` with and
  without a follow-up, `answer_seen`, the same reflection again, a changed
  one); a changed question waits again; a real answer can then be sent and
  reaches the student; a follow-up noted Only Me is not sent, and a real
  follow-up answer can follow it.
  (The first round's Hide checks, `hide` and `hide_round1`, went out with
  Hide.)

Review round 2 (`batch-c-review-2.md`; each scenario was committed first and
failed on the code before its fix):

- **round2**, with C1 alone and with C2. (b) 1: a Return that holds the
  class while a revision's send waits for it came before the revision (the
  revision is in, `sent`, to both sides, stored open, and the student can
  still Unsend it); a Return that started before the send but got the class
  after it returned it. (b) 2: a send finishing under a request taken back
  and asked again answers `request_changed`, stores nothing, and a fresh
  send is version 3. (b) 4: `return_work` answers the pages it gave, for a
  student whose grade it returned and one with marks only; nothing the
  second time; Return for Revision's `returned` counts its page. (c) 2: C2's
  pre-check without C1 answers a row; its post-check notices a trigger
  recreated to fire on every update, on every insert, or once a statement.
- **put_back** (the review's new (a) 1), with C1 alone and with C2. In a
  class that holds grades, a returned grade changed and changed back, or a
  comment typed and deleted, with marks waiting (and again with a revision
  in): the grade row is as it was, the marks are not given and the teacher
  is still told they wait, the request stays open with the revision `sent`;
  then Return gives them, and a changed grade returned by `return_grades`
  gives them with C2 and returns the revision. In a class that returns at
  once each such save is a Return (a new returned date) and returns the
  revision (review (b) 3, as built).
- **hide_out** (Hide out of Batch C). With C1 alone and with C2, in both
  kinds of class: Hide answers `hide_not_available` and writes nothing (no
  request, no grade row, no mark, nothing remembered); Keep and Take Back
  answer in the same shape (`keep_grade` true, `grade_hidden`, `hidden`,
  `unhidden` false). No hide column, function or setting is left, and C2's
  file writes no `grade_return` row.
- **same_rows** (the review's `p2b.py`). One script of marks, Keep requests,
  a Hide request, revisions, put-backs, `return_grades`, `return_work`, the
  class leaving When I Return Them, the page turned off and on, the nightly
  repair and a restore, run on C1 alone and on C1 and C2: every
  `grade_return` and score row is the same; the requests differ only in
  being stored done.

`batch_c_undo.py`: C2's undo changes no row (marks given stay given, a
request stored done stays done) and leaves the catalog C1 alone left, line
for line; marks are then given only by `return_work`; C2 applies again
after it. C1's PART 1 stops every Batch C function and changes no row, while
Return and sending work still work; PART 1b puts every permission back.
PART 2 refuses while C2 is in and while the tables hold rows unless told to
discard; then the catalog is the one before C1, line for line, but for the
two dropped columns' slots on `course`; no row of a table that existed
before changes; a revision a student sent stays as Batch B's version 2,
which Batch B reads as the latest version. C1 applies again after it.

Review round 3 (`batch-c-review-3.md`; each scenario was committed first and
failed on the reviewed code, `b26cf1c7`):

- **revision_deleted** (F1), with C1 alone and with C2, in a class that
  holds grades (Return by `return_work` and by `return_grades`) and one
  that returns at once. A revision in, the teacher deletes it
  (`delete_submission`): open again to both sides, stored open; a changed
  grade then returned leaves it open; the student sends a revision again
  (version 2), which reads `sent`; the next changed grade returned returns
  it. The teacher's Replace Them on a revision keeps it the revision in
  (version 2, `sent`), and a changed grade returned by `return_grades`
  returns it. (A revision deleted after its grade was returned stays
  returned: `closes`, which now passes through the new `revision_gone`
  trigger.)
- **leave_holds** (F2), with C1 alone and with C2, for the class leaving
  When I Return Them and for its Student Page turned off. Marks drawn after
  a grade was returned wait; after the switch, with C2, they are given and
  the teacher is no longer told they wait; on a piece with Students See
  Your Mark Up off, and on a Missing piece, they are given as a Return
  gives them and the student sees none; marks on a piece with no returned
  grade still wait (as built); another teacher's class is left alone; no
  grade row is written; back in When I Return Them a change waits, and a
  class staying in it gives nothing. With C1 alone nothing is given until
  `return_work` or a save of marks.

`batch_c_mutate.py`: 93 wrong versions (77 of C1, 16 of C2), each applied
with its fingerprint lists stood aside and run against the behaviour
scenarios. Hide's 26 went out with Hide; 12 are wrong versions of review
round 2's fixes, 12 of round 3's. One (C2's trigger firing on a draft)
behaves as the right one and is noticed only by the post-check's comparison
of the trigger. Round 1's "the state reads returned from the revision's
photos" is now noticed by `round2`'s race checks (the new trigger settles
a revision before its photos go, so `closes` no longer tells the two
apart). Round 1's "return_work does not settle before it returns" went
out: with the new trigger and a request read open only with no revision
in, the settle after `return_grades` closes whatever the first would, so
that wrong version behaves as the right one (the call stays, as a guard).

Review round 2 (2026-11-11, PostgreSQL 17.11, from a clean clone of
`b3e5ad13`, Batch B from `origin/main` at `6137c856`): `batch_c.py` 634 of
634, the undo 36 of 36, all 82 wrong versions noticed, every fingerprint
list current.

The earlier suites with Batch C applied (2026-11-11; `origin/main`'s
suites in a scratch copy, each with one hook that applies C1 and C2 after
Batch B and its fixes; the hook is not in any branch), against the same
suite on the same base without Batch C. Every behaviour check passes; what
fails is listed:

- `submissions.py` (Batch B, fixes in): 562 of 563 without Batch C (the
  one is `score_rpcs.py`'s live snapshot, which now passes on `main`); 561
  with it, the one more the inventory "only `_returned_grade` names a score
  table": C1's student `feedback` and `markup` read `score.status`
  (Missing, Excused) and `feedback` cuts Before and After's first grade
  through `_grade_copy_in_use`.
- `submissions_fixes.py`: 188 of 188 without and with.
- `student_page_fields.py` (S4-M1): 259 of 259 without; 255 with. The 4:
  the same inventory, and three `batchb` checks that apply Batch B to a
  base that already has it. Every key and refusal of `page` is as before.

Review round 3 (2026-11-11, PostgreSQL 17.11, from a clean clone of
`batch-c-round3`, Batch B from `origin/main` at `6137c856`): `batch_c.py`
723 of 723 (`revision_deleted` 46, 18 of them failing on `b26cf1c7`;
`leave_holds` 32, 8 failing on `b26cf1c7`), the undo 36 of 36, every
fingerprint list current, all 93 wrong versions noticed. The earlier
suites, with the same hook: `submissions.py` 562 of 563 without Batch C
and 561 with it, `submissions_fixes.py` 188 of 188 both ways,
`student_page_fields.py` 259 of 259 without and 255 with, the same
failures as listed above.

## Batch B: students send work (S5-M1, S5-M2, 2026-11-11)

`../2026111101_student_work_submissions.sql` adds `submission`,
`submission_file`, the removal queue, the Student Work columns on
`assessment`, Send Work and Keep Photos Until on `course`, eight teacher
RPCs and the `student_submit` functions the edge function calls.
`../2026111102_student_work_storage.sql` adds the bucket `student-photos`
and four policies on `storage.objects`. Unsend, Replace, the teacher's
delete and a send left unfinished for two hours **delete photos**, so both
are tested here only and wait for the owner. The contract for the edge
routes and the browser is `batch-b-contract.md`.

They are tested on the database as live is since 2026-11-11 02:02 UTC:
everything `card_codes_common.LIVE` loads, then S3-M1, then a stand-in for
Supabase's storage schema (`storage-stand-in.sql`).
`submissions_common.py build` loads exactly that into an empty database
(`submissions_common.LIVE_NOW`). That database is only a template: every
scenario copies it.

```bash
PGPORT=54341 PGDATABASE=bb python3 submissions_common.py build   # an empty database: live as it is now, without Batch B
PGPORT=54341 PGDATABASE=bb python3 submissions.py                # the two files, about six minutes
PGPORT=54341 PGDATABASE=bb python3 submissions_undo.py           # their undo
PGPORT=54341 PGDATABASE=bb python3 submissions_mutate.py         # 103 wrong versions of the SQL: does the suite notice? about twenty-five minutes
PGPORT=54341 PGDATABASE=bb python3 submissions_fingerprints.py check   # are the fingerprint lists in the five files current
```

**The storage stand-in is the shape gradebook-prod has.** The harness had no
`storage` schema, because nothing used storage. `storage-stand-in.sql` is
written from what gradebook-prod answered on 2026-11-10 (read-only, by the
orchestrator: its newest storage migration is
`lifecycle-writer-coordination`) and from the Storage service's own
published migrations (github.com/supabase/storage, `migrations/tenant`):
`storage.objects` with its fifteen columns (`archived_at`,
`is_delete_marker` and `is_versioned` among them: one name can have several
rows) and its ten indexes, `storage.buckets` with `versioning_status` and
the two lifecycle columns, row security on both, every privilege on both to
`anon`, `authenticated` and `service_role` (row security is the gate, as on
Supabase), the tables owned by `supabase_storage_admin`, and the triggers
that matter to this batch: a `DELETE` on either table is refused unless the
session has set `storage.allow_delete_query`; an insert into
`storage.buckets` that sets a lifecycle column is refused; versioning, once
on, cannot be turned off. What it leaves out, and why, is in its header.

**The Storage API's part is played in Python** (`submissions_common.Storage`),
written from the service's source (`src/http/routes/object/` and
`src/storage/object.ts`, `uploader.ts`):

- a signed upload link is a token bound to one bucket and path with a time
  limit; using it uploads **as the service's own role**, so no policy is
  asked, only the link's path, the bucket's size limit and the bucket's
  list of types, compared with the upload's `Content-Type` (the bytes are
  not looked at); a path that already holds a file is refused;
- an upload or a read by a signed-in teacher is an `INSERT` or a `SELECT`
  as that teacher, so the policies decide;
- a removal sets `storage.allow_delete_query` and deletes the rows.

`submissions.py`, by scenario:

- **apply** (69 checks). The files meet a database in use: the Student
  Page on, a card and a signed-in phone, a returned grade and a draft. Their
  shape (one transaction each, lock timeout, guard first). The fingerprint
  lists the five files carry are the ones a fresh apply gives. Each guard
  stops its file at the guard with nothing changed: each of the five
  functions the first file compares, with one space more; Batch A, S0-M4b,
  S0-M5 or S3-M1 missing; a function, helper, table, column or trigger name
  already taken; `storage.objects` without `metadata` or without
  `is_delete_marker`, or no storage schema; a role that cannot read
  `storage.objects` past its row security; the second file without the
  first, with a policy function changed, with row security off on
  `storage.objects`, with a bucket of that name that is public, has another
  limit, keeps old versions or already holds a file, or with a
  `storage.buckets` that has no `versioning_status`; an assessment row held
  by another session (it gives up at five seconds). The read-only queries
  written for the live database are run here: what they say on this
  database (storage as gradebook-prod's is), that a partial index alone
  does not count as the index on `(bucket_id, name)`, and each kind of
  difference noticed. **The first file alone is a safe state**: no upload
  link, no upload, nothing handed in with photos, Handed In on Paper works.
  Then the apply: **no row of any existing table changes in any column it
  had, and no existing function changes**; every new catalog line is about
  the new things; 44 functions are new, with the fingerprints the file
  lists; grades and the signed-in phone's page are as before; the post-check
  is empty, and notices each kind of damage (the bucket set to keep old
  versions and the assessment index gone among them). Work is then sent, and
  **a second run changes no catalog line and no row**. A second run after
  one of its functions was replaced (as Batch C will) stops and puts nothing
  back; so does one after the bucket's limit or versioning was changed.
- **teacher** (103). The two settings RPCs (a patch writes only what
  it names; shapes refused; replays; another teacher; nobody; anon).
  `start_work_upload` and `finish_work_upload`: the paths; a replay; nothing
  handed in until every file is up; a page left out; Add as More Pages (the
  pages go on the end, marked the teacher's, nothing is queued), Replace
  Them (the old files are queued), `already_sent`, `nothing_sent`,
  `on_paper`, `too_many_pages`; another teacher's assessment or student, a
  student of another class, a withdrawn student; a file storage holds too
  large, as a PDF, or whose thumbnail is a PNG; a student's unfinished send
  is not the teacher's to finish or delete. `mark_handed_in_paper` (a
  withdrawn student is passed over), `delete_submission`,
  `rotate_submission_page`, `list_course_submissions`. The tables refuse a
  submission across two classes and a paper hand-in "from a student".
  Nothing a teacher does here touches a grade.
- **student** (198). Every refusal, for each of the six functions: no
  session, a token never issued, another student's enrollment, another
  teacher's class, the Student Page off, a withdrawn student, a deleted
  class, a replaced card, a card past its last day, a session past
  midnight, a locked card, after Done; Send Work off; an assessment that
  takes nothing, of another class, or not yet on the page; the eight
  combinations of After the Due Date and the due date, by the class's own
  time zone; the wrong shapes (the call fails, 22023). Then a send from
  start to finish: paths, a replay, missing pages, the hand-in, what the
  teacher and the student each see, `file_links` for the student's own
  handed-in pages only; Unsend and the worker; Remove the Page and a new
  page order; starting again. **Two hours from the first start**: a repeat
  one minute before still answers and gives no longer; past it the page
  shows no send in progress, a repeat and a finish are both `expired`, the
  files are queued, and one student's call clears the class's other expired
  sends. **Open and late are asked again at the finish**: a send started on
  the last day and finished after it is refused; one started before the due
  date and finished after is Late. **Who added a page**: Unsend and Replace
  remove only the student's pages and keep the teacher's. **What a class may
  hold**: pages and bytes, unfinished pages counted, a file larger than was
  said refused. The switches changing between start and finish; Replace;
  work the teacher added; grading under When I Return Them and As Soon As I
  Save (a score, a comment, a Late mark, a cleared score, a draft on unsent
  work, DIBELS); Replace during grading; the teacher adding work under a
  student's send; twenty an hour; two classes in one session. **No function
  reads or writes a grade**: the four score tables and `grade_return` are
  byte for byte the same after the student's calls, and the source of all 44
  functions names no score table and no copy of a grade.
- **storage** (85). The bucket (private, 2 MB, JPEG only, versioning
  DISABLED, no lifecycle) and the four policies, word for word. A student's
  link, as modelled: another path, another student's folder, over 2 MB, a
  PNG, a PDF, after two hours, a second use. **A teacher reads handed-in
  work of their own classes and their own uploads, and nothing else**: not a
  file a student unsent (still in storage until the worker runs), not a page
  of a send a student has not finished, not a stray file in the class's
  folder; nobody signed in reads nothing; a teacher writes only a path the
  database named for their own unfinished upload, and not after its two
  hours; nobody changes, moves or deletes a file. **One careless policy
  added on top** (every role may do anything to `storage.objects`) opens
  another bucket and not this one. SQL cannot delete a file. The removal
  queue: not believed while the file is there; a file put back through a
  link that was still alive is removed again; newest first. Every way a row
  can go queues its files: Unsend, Replace, a teacher's delete, a page left
  out, an abandoned send, `delete_assessment`,
  `delete_withdrawn_student`, the 30-day purge, a row deleted by hand,
  `TRUNCATE`. After all of it and the worker run to the end, **storage holds
  exactly the files of the pages handed in**. Rows as a versioned bucket
  would have them (an archived version, a delete marker) are read right. The
  second file stops at a bucket that keeps old versions, at its first check
  and at its last step.
- **race** (33). On connections of their own, the first held open so the
  second is seen to wait: two sends at once, the same request twice, two
  finishes, Unsend against Replace, Unsend against a finish (both orders),
  **Unsend against a grade being saved** (both orders), **Replace during
  grading** (both orders), the student's finish against the teacher's Add
  Work, **the same teacher request twice at once for each of the five
  teacher writes that take the class** (the second waits and is given the
  first's answer), a student withdrawn as their send starts, a send against
  its assessment being deleted (both orders, then 30 unheld rounds), the
  trigger on assessment taking the class's lock itself, 30 sends at once
  against the hourly limit. Then twelve seconds of everything at once in one
  class (10,000 to 35,000 calls, depending on what else the machine is
  doing): two students, the grade RPCs, Add Work in its three modes,
  deletes, assessments made and deleted under a send, two workers. No error,
  no deadlock; every rule that must always hold, holds; Batch A's
  `working_copy` still matches the scores.
- **grants** (54). On a copy where a new function and a new table are
  given to everyone by default and the `student_submit` schema is open: the
  eleven functions for teachers, the eight for the service role and the
  twenty-five for nobody are exactly that, by the files' own revokes; the
  four tables cannot be read; and with `SELECT` granted by mistake a teacher
  still reads no row (row security, no policy).
- **suites** (14). `student_submit.py` 79, `questionnaire_identity.py`
  47, `phone_reports.py` 35, `questionnaires.py` 42, `grade_return.py` 284
  and `grade_return_limits.py` 74 pass before the two files and after.
  `grade_return.py` now knows the three functions storage's policies call
  (it lists what a signed-in teacher can run). `score_rpcs.py` passes 235
  of 236 until `docs/schema.generated.sql` is refreshed after the apply
  (its comparison of `assessment` with the live snapshot, which has neither
  the five columns nor the two triggers yet), then 236.
- **scale** (7). With 1,000,000 submissions of other classes in the
  table: the trigger's two deletes go through an index, and
  `delete_assessment` for a teacher who never used photos takes what it took
  with the table empty (1.7 ms and 1.2 ms on the test machine, the middle of 25 calls each). With 300,000 files in the bucket: the
  look-up every function makes goes through one of storage's indexes on
  `(bucket_id, name)`, and through the plain one when the others are taken
  away; handing in 30 pages, a teacher reading one page under the policies,
  and an Unsend with one pass of the worker (3 ms, 0.8 ms and 8 ms on the test machine).

`batch-b-undo.sql` (not a migration) and its proof, `submissions_undo.py`
(60 checks). Three parts. PART 1 turns Send Work off and deletes
nothing. PART 1B drops the four triggers on `assessment` and `enrollment`
and nothing else, for when deleting an assessment or a student misbehaves:
what a delete then leaves behind, the migration files run again putting the
triggers back, and the one statement that clears what was left. PART 2
refuses while the bucket holds a file, a page is listed, or **the removal
queue is not finished** (a file could still arrive through an upload link
that is alive: it says when the last one dies), and at each of its other
checks, with nothing changed; then, with the photos deleted the way its
header says, it leaves **the catalog of before Batch B, line for line**, but
that `course` keeps two and `assessment` five empty slots where the dropped
columns were; no row of any earlier table differs but each class's changed
mark; both files apply again.

`submissions_mutate.py`: 103 single changes to the SQL (a check taken out,
a limit moved, a lock dropped, a policy loosened, a revoke left off, and
nineteen of the twenty the first review made; its twentieth was about a
column that is gone), each applied to a fresh copy with the
fingerprint lists stood aside, and the suite run against it. All 103 are noticed.
Two earlier runs found holes, closed since: a table left without row
security that nothing checked, and the eight changes the first review found
unnoticed (an unfinished send kept after the work it was to replace was
deleted; a thumbnail that is not a JPEG; a teacher finishing or deleting a
student's unfinished send; a withdrawn student's send or paper hand-in; the
trigger's own lock; `file_links` for an unfinished send).

Result on 2026-11-11 (UTC), PostgreSQL 17.11 (production runs 17.6), from a clean clone on empty databases:
`submissions.py` 563 of 563; `submissions_undo.py` 60 of 60; `submissions_mutate.py` 103 of 103
noticed. On PostgreSQL 18.6 the same: 563 and 60, and every fingerprint is the one 17.11 gives.
(The 103 were run at commit `27d3025e`. The one commit after it, `da56ef84`, changed header
comments and how the scale scenario takes its timing, and no function: the suites, the undo and the
one change the scale scenario judges were run again at `da56ef84`, on both versions.)

**What the local tests cannot prove.** The Storage service is not run here.
Everything about it is from its documentation and its source, and is first
tried for real in the owner's test class after the apply:

- that a signed upload link is bound to one path, lasts two hours on the
  hosted service, and uploads under the service's own role;
- that the bucket's size limit and type list are enforced on every upload
  path, and that the type checked is the `Content-Type` header;
- that a signed-in teacher's request reaches the tables as the role
  `authenticated` with the teacher's id set (the service's source sets
  both; the policies rest on it, and if it were otherwise a teacher would
  be refused, not let in);
- that the role applying the migration may create a policy on
  `storage.objects` and a row in `storage.buckets` (gradebook-prod grants
  `postgres` the insert, and policies through Supabase's own extension,
  which plain Postgres cannot imitate; if either is refused, the second
  file stops with nothing applied);
- that the stand-in is what gradebook-prod has on the day of the apply: it
  was written from one read-only look on 2026-11-10, and the pre-check's
  second query says whether storage has moved on since;
- that removing a file through the API removes its bytes, that a bucket
  with versioning DISABLED keeps no copy, and that the bucket is stored in
  ca-central-1 with the project;
- how long the Storage service or anything in front of it goes on serving a
  download link after the file is deleted;
- the timings above on gradebook-prod's own machine;
- the edge routes themselves (`S5-F4`), which are not written yet: every
  requirement in `batch-b-contract.md`, "What the edge function must do";
- anything on `gradebook-prod` itself.

## Batch B review fixes (2026111104, 2026-11-11)

`../2026111104_student_work_review_fixes.sql` applies after Batch B's two
files and fixes the two faults its second review found (section (b), items 5
and 6). It replaces `public.finish_work_upload`, `student_submit.send_finish`
and `student_submit.unsend`, each Batch B's body with lines added, and
nothing else. Tested here only (never `gradebook-prod`).

- **Ruling 88 (30 pages).** The 30 was asked only when a send or an upload
  started. A teacher's Add as More Pages finished while the student's
  Replace was still uploading made the Replace's finish hand in 30 new pages
  plus the teacher's 29. Now the 30 is asked again at both finishes, and the
  one finishing second is told `too_many_pages` with `room`. It is not
  dropped: it can be finished with fewer pages or started again.
- **Ruling 92 (a student's Unsend or Replace removes only their own
  pages).** The teacher's Add as More Pages, uploaded and not yet finished,
  pointed at the student's work, and `_submission_target_gone` dropped it
  when an Unsend or a Replace deleted that row. Now a finished Replace moves
  it to the new work first, and an Unsend that leaves no work makes it a new
  upload of the teacher's first. A teacher's unfinished Replace Them is left
  as Batch B has it.

`submissions_fixes.py` uses the same template as Batch B's scripts:

```bash
PGPORT=54341 PGDATABASE=bb python3 submissions_common.py build      # as for Batch B
PGPORT=54341 PGDATABASE=bb python3 submissions_fixes.py             # every scenario, about a minute
PGPORT=54341 PGDATABASE=bb python3 submissions_fixes.py mutate      # wrong versions of the two fixes, about eight minutes
PGPORT=54341 PGDATABASE=bb python3 submissions_fixes.py fingerprints check
PGPORT=54341 PGDATABASE=bb BATCH_B_WITH_FIXES=1 python3 submissions.py          # Batch B's suite with the fixes applied
PGPORT=54341 PGDATABASE=bb BATCH_B_WITH_FIXES=1 python3 submissions_mutate.py   # and its 103 changes
```

Scenarios: `faults` (the review's probes B and C, then each order a send,
a Replace, an Unsend and an Add can finish in: what the student and the
teacher are told, what is handed in, what is queued, the two hours, the
storage policy, the answer not remembered); `faults-without` (the same
cases on Batch B alone: every check marked as the fault must fail there,
and every other check must still hold); `race` and `race-without` (the same
interleavings on connections of their own, the first holding the class);
`fuzz` and `fuzz-without` (1,000 seeded random steps of sends, Replaces,
Unsends and Adds on one student's piece; after every step no work handed in
has more than 30 pages and no file the teacher uploaded is queued by a
student's Unsend or Replace); `apply` (shape, lists, each guard, a lock it
cannot get, the apply on a database in use, a second run, Batch B's files
run again, file 1 alone, the read-only pre-check and post-check and the
damage each notices); `undo` (`batch-b-fixes-undo.sql`).

`BATCH_B_WITH_FIXES=1` makes `submissions_common.py` apply the fixes after
the two files for every Batch B scenario but `submissions.py apply`, which
is the two files' own apply and second run: with the fixes in, a second run
of the first file stops at its first check by design (shown in
`submissions_fixes.py apply`). In `submissions_mutate.py` each change is then
made to the fixes' copy of a function too, where it holds the same text.

**The order out.** Batch B's undo PART 2 and a second run of its first file
(PART 1B's way back) both refuse while the fixes are applied, because they
check Batch B's own fingerprints. Run `batch-b-fixes-undo.sql` first. PART 1
and PART 1B run either way.

Result on 2026-11-11, PostgreSQL 17.11: `submissions_fixes.py` 188 of 188
(the review's probes B and C both fail on Batch B alone and pass with the
file; without it the random run put more than 30 pages in a submission 20
times and queued a teacher's file by a student's action 369 times, with it 0
and 0); its 14 wrong versions of the two fixes, 14 noticed. With the fixes
applied: `submissions.py` 563 of 563; `submissions_mutate.py` 103 of 103 noticed (17 of them made in the
fixes' copy too; change 65 matches text the fix put lines into, so its
equivalent is given in `IN_FIXES` and it was run again on its own after
that).
`submissions_undo.py` 60 of 60 on Batch B alone and 60 of 60 after the fixes
and their undo; with the fixes still applied 28 of 60, every failure being
PART 2 or the first file's second run refusing on Batch B's fingerprints, as
designed.

## Batch B send rules: rulings 106 and 107 (2026-11-11)

One file, `../2026111130_student_send_rules.sql`. **Apply order:** Batch B's
two files and the fixes file (`2026111104`), all three on live; then Batch C's
C1 (`2026111120`) and C2 (`2026111121`), as of `a682b559` (their review round
3); then this file. Its first check stops it, with nothing changed, unless all
five are in at the tested fingerprints: the Batch B and fixes functions it
relies on, C1's `_grading_started`, `_revision_state`, `revision_start`,
`revision_finish` and `_revision_gone`, and C2's `_markup_on_return` and
`_markup_on_release` (so it stops with C1 in and C2 not). It replaces
`student_submit._send_begin`, `send_finish` and `work`, each from its body
after those files, adds `student_submit.send_paths` (approved by Colin on
Nov 11), and nothing else:

- **Ruling 106.** A send started while the piece was open can be finished
  within its two hours after the piece's last day has ended, and is Late.
  `send_finish` asks the piece's dates as they are now about the day the send
  first started (`created_at`, in the class's time zone): a send started on
  the last day passes; one the teacher closed under it (the last day moved to
  before that day) does not. `_send_begin` still refuses a start after the
  last day, so a row exists only for a send started while open.
- **Ruling 107.** When the work in is the teacher's (Add Work, or what an
  Unsend left) and not on paper, `send_start` starts a send; at the finish the
  student's pages come first and the teacher's follow, by the rule a Replace
  follows. Grading started (a draft, a returned grade, an Overall Comment, or
  a page with the teacher's marks: C1's `_grading_started`, ruling 109), 30
  pages, a revision open and Handed In on Paper are asked as for a Replace.
  `work().sent.can_send` says so.
- **`send_finish` takes version 1 only** (review F2). A revision's unfinished
  send (version 2 or later; only `revision_start` makes one) is answered
  `not_found` before anything else is asked, and nothing changes: it keeps its
  place and pages for `revision_finish`. Before, it was handed in as ordinary
  work when nothing else was in (the request then read "being graded"), or
  dropped when version 1 was in.

**Batch C round 3 (`a682b559`).** Only C1's `_revision_state` changed among
the functions in the lists; the lists were regenerated by script and now also
pin round 3's `_revision_gone` (C1) and `_markup_on_release` (C2). The three
"revision open" tests (`revision_request.state = 'open'` in `_send_begin`,
`send_finish` and `work`) still mean what they did: a request's stored state
goes from open only to done (settled) or cancelled, never back, and round 3
changes only when it is settled. While it is open, Send My Revision is the way.
`revision_gone` (before delete of a sent version 2 or later) fires when
`send_finish`'s join deletes a teacher's version 2; the join is refused while
any request is open, so the trigger settles nothing (checked in `rule107`).
The file's other deletes are of unfinished sends, which it does not fire on.

With Batch C after its two review rounds (`b26cf1c7`: Hide out, C2 only the
marks-on-Return trigger, `in_returned_at`, `request_changed`), none of the
three bodies needed a change: Batch C changed none of them and nothing they
call (every fingerprint in the lists is the same), and a revision goes
through Batch C's own `revision_start` and `revision_finish`, which this file
does not touch (Revise By marks it late and never closes it, so ruling 106
has nothing to change there).

The base is `batch_c_common.py`'s (Batch B and the fixes; this branch has
`main` merged, so `BATCH_B_DIR` may be left unset); `send_rules.py` applies
C1 and C2 to it:

```bash
PGPORT=54611 PGDATABASE=sr python3 batch_c_common.py build        # an empty database: live with Batch B and the fixes
PGPORT=54611 PGDATABASE=sr python3 send_rules.py                  # every scenario, about four minutes
PGPORT=54611 PGDATABASE=sr python3 send_rules.py mutate           # wrong versions of the file, about five minutes
PGPORT=54611 PGDATABASE=sr python3 send_rules.py fingerprints check
```

`send_rules.py`, by scenario:

- **rule106**: the midnight edge, in a zone where it is just past midnight
  (a first start at 23:59:59 on the last day is taken and Late; 00:00:00 and
  00:00:01 are refused); the same row in a class one hour east is refused;
  the calling connection's time zone makes no difference; Until a date, and
  Until before the due date; a Replace across midnight; Send Work off,
  nothing taken, withdrawn, a locked card, grading and missing pages after the
  last day; a replay of the start; 1 h 59 taken, 2 h 0 min 1 s expired.
- **rule107**: after an Unsend that kept the teacher's pages: `can_send`,
  the start and its replay, nobody can open the unfinished pages, the finish
  (pages in order with their files, the work as a student's own send,
  nothing of the teacher's queued), links, the teacher's list, a later Unsend
  and a send again, a Replace; Add Work; 28 + 3 refused, room 2; on paper; a
  draft; a mark and its erasing; a revision open; a revision's pages after the
  request was taken back; the student's own work; a version 2; `replace` and
  `unsend` still `cannot_change`; Send Work off; closed; another student; two
  hours; Late.
- **interleave**: fifteen orders of a student's send or Replace with the
  teacher's Add Work, Add as More Pages, Replace Them, delete, Handed In on
  Paper, a grade and a mark, each followed by: never over 30 pages, and Batch
  B's invariants hold.
- **race**: the same on two connections, the second seen to wait.
- **fuzz**: 1,000 random steps: never over 30, no student step queues a page
  the teacher handed in, never stuck behind the teacher's pages.
- **paths** (section 4, `send_paths`, approved by Colin on Nov 11): this student's
  own unfinished send gives exactly the files its start named, and writes
  nothing; another student's send, the teacher's upload, work handed in, a
  send that does not exist give `not_found`; past two hours `expired`; a
  locked card `card_locked`; the service role only.
- **apply**, **undo**: as the fixes file's suite (shape, every guard, a lock
  it cannot get, the apply on a database in use with no row changed and only
  the three bodies changed, a second run, the files before it run again, what
  the two checks notice; the undo back to the fingerprints, pg_proc column for
  column, and the order out).

`rule106`, `rule107`, `interleave` and `race` also run `-without` (on the
base): every check marked as changed by the file must fail there and every
other must hold.

Results after the review fixes (2026-11-11, PostgreSQL 17.11, from a clean
clone, Batch C at `a682b559`, file md5 `548280d178e7a0d8b29eb3783c070120`):
`send_rules.py` 308 of 308 (288 before; new: 9 checks for F2 and the
round-3 trigger in `rule107` and 2 in `rule107-without`, 11 for F1 in `undo`,
and in `undo` one more guard check and the fixes' undo after the documented
order, less the two that said this undo stops after C2's); `mutate` 40 wrong
versions (36 of the file: 26 of the two rules, 4 of F2, 6 of `send_paths`;
4 of the undo, for F1), 40 noticed; `fingerprints check` every list current.

The earlier suites with this file applied (scratch hooks, not in any branch;
each number beside the same suite on the same base without this file, both
with Batch B, the fixes, C1 and C2 at `a682b559`):

- `batch_c.py` (hook: `BATCH_C2` = C2 then this file): 723 of 723 without;
  720 with. The 3 are structural, where `apply2` looks at what C2 alone
  changes: "no existing function changes" (this file's three), "two
  functions are new" (`send_paths` too), and "C1 run again after C2 applies"
  (C1's guard lists the fixes' `send_finish` and stops on this file's).
- `submissions.py` (hook: `BATCH_B_FIXES_FILE` = the fixes, C1, C2 [this
  file], `BATCH_B_WITH_FIXES=1`): 562 of 563 without (C1's grade-reader
  inventory); 559 with. Two are ruling 107 itself ("the work stays, as the
  teacher's ... the student can no longer change it" and "the teacher added
  the student's work while their pages were going up: ... already*sent").
  The third was `score_rpcs.py` failing once more in its run \_before* any of
  these files is applied (234 against 235); the `suites` scenario run again
  with the file: 14 of 14.
- `submissions_fixes.py` (same hook): 137 of 154 without, 136 with. The hook
  breaks its apply and undo scenarios the same 17 ways on both sides (they
  apply the fixes file alone); the one more is ruling 107: "probe C, 8: ...
  a new send already_sent".
- `student_page_fields.py` (S4-M1; storage stand-in, Batch B, the fixes, C1,
  C2 [this file] loaded into its base after `build`): 255 of 259 without and
  with, the same 4: C1's inventory, and three `batchb` checks that apply
  Batch B to a base that already has it.

**The order out:** `send-rules-undo.sql` first, then Batch C's undo
(`batch-c2-undo.sql`, then `batch-c1-undo.sql`), then the fixes' undo, then
Batch B's. Batch C's undo PART 2 does not check this file's functions and
drops `revision_request`, which `work`, `_send_begin` and `send_finish` read:
with this file in, the student's page then fails (proved, and rolled back, in
the undo scenario). Since the review (F1) this undo checks only its own four
functions (the three as this file leaves them or as before, `send_paths`
absent or this file's), so it also runs after Batch C's undo and puts the
page right: proved in `undo`, which runs C2's and C1's undo with the file in,
sees the page fail, runs this undo, and finds the page and a send working,
every function as on Batch B and the fixes alone (pg_proc column for column
but the oid), no row changed, and the fixes' undo running after it.

Not verified here: anything on gradebook-prod; the edge routes and the Demo
screens; PostgreSQL 17.6 printing these bodies with the same fingerprints (the
last check stops the file with nothing changed if not).

## Batch D: the photo lifecycle (S8-M1, 2026-11-11)

One file, `../2026111140_photo_lifecycle.sql`. **It deletes photos on a
schedule** (project rule 2). **Apply order:** after Batch B, the fixes, C1, C2
and the send rules, all on live. It replaces one function,
`student_submit._grading_started` (C1's, plus one condition: kept marks count
as grading started), changes no existing trigger, policy or grant, and adds
`markup_kept`, `photo_keep_check` and `photo_check_log`, nine functions, the
procedure `photo_lifecycle_nightly()` and two pg_cron jobs
(`fv_photo_lifecycle_daily` at 10:27 UTC, `fv_photo_removal` every ten
minutes). Its guard needs pg_cron, pg_net and Vault;
`photo-lifecycle-stand-in.sql` stands in for the three here (nothing is
scheduled or sent; the tests call what a job would).

- **Keep Photos Until.** `_keep_photos_day` is the screen's `keepPhotosDate`
  (`teacher/cm-student-page.js`, changed in the same PR so that End of Term
  with no term end ahead is June 30), checked against it in Node for every day
  of two school years. Photos are kept through the day and deleted the night
  after: each page of work handed in by midnight after the day, in the class's
  zone. A page whose send started in its two-hour hold before midnight, on work
  handed in or added to after it, stays (ruling 106). The submission row,
  grades, comments and the rest stay; Mark Up is copied to `markup_kept` first.
  Missed nights are caught up only under the choice and terms the job last
  judged with (`photo_keep_check`); otherwise, and on a class's first night,
  only yesterday is judged. A class in the trash is skipped.
- **Strays.** A layout-shaped file with no page row, over 24 hours old, is
  queued (`stray`), in every class with work or a folder in the bucket, by a
  name range on storage's `(bucket_id, name)` index; other names are reported
  only. A page row whose file is missing is reported (`missing_file`) and never
  changed.
- **The timer.** `photo_removal_call()` posts `{route: 'scheduled-sweep',
secret}` through pg_net to the edge function when a file is due, reading the
  address (this project's own, exactly) and secret from Vault
  (`fv_photo_sweep_url`, `fv_photo_sweep_secret`). Files due for 6 hours are
  logged as `error` (once an hour) and fail the nightly run. The route is in
  `supabase/functions/student-submit/send-routes.ts` and is tested in
  `tests/student-submit-scheduled-sweep.test.js`.

```bash
PGPORT=54731 PGDATABASE=pl python3 batch_c_common.py build        # an empty database: live with Batch B and the fixes
PGPORT=54731 PGDATABASE=pl python3 photo_lifecycle.py             # every scenario, and the -without runs
PGPORT=54731 PGDATABASE=pl python3 photo_lifecycle.py mutate      # wrong versions of the file
PGPORT=54731 PGDATABASE=pl python3 photo_lifecycle.py fingerprints check
```

Scenarios: `keepday`, `keep`, `strays`, `expired` (these three also run
`-without`, on the base: every check marked as the file's must fail there),
`paths` (ruling 105: deleting an assessment, a withdrawn student, a student
record, the 30-day class purge, the 30-day teacher purge, a `clear_data()`
stand-in and TRUNCATE each queue every file of what they remove, and kept Mark
Up goes with its work; no change was needed), `timer`, `nightly`, `apply`,
`undo`, and `review`: the independent review's probes (`batch-d-review.md`)
kept as tests: M1 for real across midnight (a student's send and the teacher's
Add Work and Add as More Pages), M2 (a switch and a term edit during missed
nights), M3 (stuck files logged and failing the run), M4 (a stray in a class
with no work), the stray scan with 200,000 other files in the bucket, two
nightly runs at once, kept marks locking Replace and Unsend, End of Term after
the last term, a class in the trash, and the pre-check's per-class list. Run
against the file as it was before the review (`75ee95fd`,
`PHOTO_LIFECYCLE_FILE=...`), 14 of `review`'s 30 checks fail.

Results (2026-11-11, PostgreSQL 17.11, embedded-postgres, file md5
`240245baeab9650ba0edfc5f7c8ad792`): `photo_lifecycle.py` 243 of 243 (after merging main and review 2's pre-check fix), of which 37 ran on the base without
the file and 17 of those are the checks the file must change (each failed
there, as required); `mutate` 41 wrong versions, 41 noticed (a 42nd, taking out `f.created_at < _cutoff` alone, changes nothing, since a page made after the cutoff is on work handed in after it, which the ruling-106 test keeps anyway, and was dropped); `fingerprints check` every list current.
Taking out the stray check's "already waiting" test alone changes nothing (the
insert's `ON CONFLICT ... WHERE done` leaves a waiting row alone), so it is not
a mutant. The PostgreSQL time zone data used keeps British Columbia on one
clock all year (10:27 UTC is 3:27 there in January and July) and Alberta
likewise.

Not verified here: pg_cron, pg_net and Vault themselves (stand-ins only: no job
runs and no request is sent); the deployed edge function; gradebook-prod.

## Batch E (2026111150), the last database change of the student page build

`batch_e.py` exercises `../2026111150_student_page_last_changes.sql` on a database built as live is after Batch D:
E1 (`work` says whether Reflect on Feedback is on), E2 (questionnaires and phone reports from a card: `forms`, `form`,
`answer`, `report`, with a slip used first and the card answering first), E3 (a Note for the Report waits with its
grade), E4 (a piece dated into the future serves nothing), E5 (an Excused group-mate's marks stay theirs), E6 (the
per-card limits), the apply's guards, a second run, grants, the pre-check and post-check, and the undo. Checks marked
differs are run again without the file and must fail there.

```bash
PGPORT=54331 PGDATABASE=fv_be python3 batch_c_common.py build
PGPORT=54331 PGDATABASE=fv_be python3 batch_e.py
PGPORT=54331 PGDATABASE=fv_be python3 batch_e.py fingerprints check
```

`batch_c_route_statements.py` and `batch_c_route_refusals.py` now run on top of Batch D and Batch E too; the three
checks that were the review of PR 1138's KNOWN gaps (S3, S4) check Batch E's fix.

## Handouts and Links (2026111170, 2026-11-11)

One file, `../2026111170_handouts_links.sql`, **not applied**. **Apply order:** after everything through `2026111160_slips_keyed.sql` (all on live). It adds `assessment_resource`, sixteen functions, two triggers on `assessment` and two on its own table, and two storage policies (`fv_handouts_read`, `fv_handouts_upload`). It replaces two functions, each guarded by the md5 read from live on Nov 11: `student_submit.page` (each assessment gains `resources`) and `public._photo_strays` (it now knows a handout page's name). It widens one policy, `fv_student_photos_fence`, to let through what the two new policies allow. It changes no row and no file. The contract is `handouts-links-contract.md`.

- **The table has no foreign key to `assessment`,** for the reason `submission` has none: every write is under the class's lock, taken first, and a foreign-key check would take the assessment's row lock in the other order. Triggers delete the rows when their assessment goes.
- **A handout's pages** are JPEGs in `student-photos` at `<class>/handouts/<resource>/<n>.jpg`. When a row goes, by any path, its trigger writes every page to `submission_file_removal`, the queue the students' photos use; the same worker deletes them.
- **Keep Photos Until never touches a handout** (it deletes `submission_file` rows; a handout has none). The nightly stray check leaves a handout page with its row alone, queues one with no row after 24 hours, and drops an upload not finished in two hours.
- **Known, for the edge function:** `supabase/functions/_shared/storage-rest.ts` accepts only the students' path shape, so the deployed worker skips a queued handout page, and nothing calls `handout_links` yet. Both must change before a screen ships. The `lifecycle` scenario keeps a check that says so.

```bash
PGPORT=54877 PGDATABASE=hl python3 batch_c_common.py build         # an empty database: live with Batch B and the fixes
PGPORT=54877 PGDATABASE=hl python3 handouts_links.py               # every scenario
PGPORT=54877 PGDATABASE=hl python3 handouts_links.py mutate        # wrong versions of the file
PGPORT=54877 PGDATABASE=hl python3 handouts_links.py fingerprints check
```

Scenarios: `teacher` (the five functions: answers, refusals, a request sent twice, another teacher, nobody signed in, the table's own checks, 50 at most, a class in the trash, the two hours), `storage` (which exact names a teacher may upload and when, who reads, nothing changed or deleted, Batch B's rules for students' photos unchanged, and both restricting policies holding with a careless allow-everything policy added), `student` (`page` is the same answer as before but for `resources`; ready only, in order, only on pieces the page shows; `handout_links` and each refusal), `lifecycle` (Keep Photos Until, the stray check, an abandoned upload; the same files on the database without the file are reported as strange names, as required), `deletes` (Remove, `delete_assessment`, the 30-day class purge, the 30-day teacher purge, a `clear_data()` stand-in, TRUNCATE and a plain delete each queue every page, and the worker deletes them; the queue's two looks), `race` (on connections of their own, twelve rounds each: the same start twice, two adds, finish against remove, two finishes, two removes, and start, finish and Add a Link against `delete_assessment`: no deadlock, no row left without its assessment, every page queued), `apply` (eleven guards, each also named by the pre-check; a database in use; no row of any table changes; a second run; grants; the pre-check and post-check), `undo` (PART 1 stops adding; PART 2 refuses while rows are held; the catalog and every row come back exactly).

Results (2026-11-11, PostgreSQL 17.11, embedded-postgres): `handouts_links.py` 285 of 285, of which 7 ran on the database without the file and 1 of those is the check the file must change (it failed there, as required); `mutate` 26 wrong versions, 26 noticed; `fingerprints check` every list current. The 31 functions the file calls or replaces have, on the local build, the md5 read from gradebook-prod (PostgreSQL 17.6) on Nov 11.

Not verified here: the Storage service itself (`submissions_common.py` plays its part, written from its source), that the applying role may alter a policy on `storage.objects` (live's `supautils.policy_grants` lists the table for `postgres`; the pre-check reads it), pg_cron, the edge function, gradebook-prod.

## My Learning sends the rest (2026111201)

`my_learning_rest.py` exercises `../2026111201_my_learning_page_sends_rest.sql` on live as it is after Handouts and Links (`handouts_links.py`'s template with `2026111170` applied):

```bash
PGDATABASE=mlr python3 batch_c_common.py build
PGDATABASE=mlr python3 my_learning_rest.py            # off, on, apply, undo
```

- `off`: with Show My Learning off, page's answer is the same text before and after the file.
- `on`: `learning.course.grade_level` and `learning.rubric_tags` are added (only listed rubrics, only competencies still on the class, never another class's). With the two taken out, the answer is page's before the file.
- `apply`: the guard, a second run, grants and attributes, and the md5 the header records.
- `undo`: `my-learning-rest-undo.sql` restores the md5 the file found.

Result on 2026-11-12, PostgreSQL 17.12, local (port 54329), from empty databases: **32 of 32**: off 5/5, on 12/12, apply 9/9, undo 6/6.

- The md5 of `student_submit.page` on this build before the file is `8d8e3f9aa91e43b0163cb3189430b758`, the same as the header's "Before" and 2026111170's own list. After the file it is `b460f6f2753ad24317ad2d1f2f4149ce`, the same as the header's "After".
- A wrong version of the file, with the removed-section filter taken out of `rubric_tags`, fails 2 checks of `on`.
- Sanity check on the same server: `batch_e_e9.py` 32 of 32.

## Assessment drafts (2026111701, 2026-11-16)

One file, `../2026111701_assessment_drafts.sql`, **not applied**. It adds `assessment.is_draft` (false on every row), the trigger `assessment_draft_guard` (Unassign refused with `draft_has_work`, P0001, while a student has a result or work), `p_is_draft` (last) on `create_assessment`, and replaces 16 functions, each guarded by the md5 read from gradebook-prod on Nov 16. `assessment_drafts.py` runs on a database rebuilt from the repo and proved equal to live (`scripts/db-rebuild.mjs --check`; all 343 function md5s equal live's), not on `harness.sql`:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54461/drafts_live node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54461 PGDATABASE=drafts_live python3 assessment_drafts.py                                  # every scenario
```

Scenarios (the script's docstring says what each checks): `student` (each of 13 routes gives a Draft the byte-for-byte answer it gives the same piece dated in the future, names nothing of it, and gives it back once assigned), `create`, `update` (17 kinds of student result or work each refuse Unassign; 5 things that do not), `copies` (bundle, gradebook, Duplicate, Teams import, restore), `rls`, `race` (four orders and a send holding the class's lock, three rounds each, on connections of their own; twenty sends and Unassigns started at once, no deadlock; the trigger with its class lock taken out lets the first race through, as it must), `apply` (five guards, a second run, only is_draft added to each body, the header's md5s, pre-check, post-check, lock timeout), `undo` (PART 1, the fast stop, drops only the trigger and the file puts it back; PART 2 refuses while a Draft exists; catalog and rows as before but one dropped-column slot on `assessment`; a second run; a database without the file).

Result on 2026-11-16, PostgreSQL 17.11 (embedded-postgres): **166 of 166** after the review of PR 1484 (the trigger no longer takes the piece's row for update; the 40P01 the review reported did not reproduce on this build, with either trigger): student 35, create 7, update 40, copies 8, rls 27, race 17, apply 18, undo 14. The pre-check, run read-only on gradebook-prod (17.6) the same day: every fingerprint ok; 149 assessments, 0 dated in the future, 146 with a result or work, 73 empty score rows and 2 seen-only grade_return rows (neither blocks).

Not verified here: PostgREST's schema cache and the app's calls through it, the edge functions, gradebook-prod itself. `tests/db/run.mjs` rebuilds from `migrations/baseline/`, so it covers this file only after the baseline is refreshed following the apply.

## Reflect from the card (2026111620)

`reflect_from_card.py` exercises `../2026111620_reflect_from_the_card.sql` on live as it is after Slips Keyed (`slips_keyed.py`'s template with `2026111160` applied). The later files (`2026111170` to `2026111310`) touch none of the functions it patches or relies on.

```bash
PGDATABASE=rc python3 batch_c_common.py build
PGDATABASE=rc python3 reflect_from_card.py                    # every scenario
PGDATABASE=rc python3 reflect_from_card.py fingerprints check
```

- `live`: the six functions it patches or relies on have, on this build, the md5 read from gradebook-prod on Nov 16.
- `listed`: before the file (the fault), a questionnaire that is on with no slip is not on a card. After: it is, for every student of the class; off, closed, not open yet and answered; `form` and `answer` with no slip; another class, another student's session, a withdrawn student; a Goal Check-In still rides on its reflection; a printed slip still opens and sends, and a card answer still uses one up.
- `custom`: a teacher saves a reflection with every kind of question (refused before the file); another teacher cannot; a student answers it from the card and each answer is kept as `docs/plans/reflect-plan.md` says; an answered one cannot be deleted.
- `answers`: `_clean_answer` for rating, date, ranking and likert: what each takes, refuses and keeps.
- `same`: every old kind's answers come out of `_clean_answer` exactly as before the file, refusals included.
- `apply`: six guards (a relied-on function changed stops it too); a database in use; only the two functions and two checks change; no row changes; a second run; anon and authenticated cannot run either function; the pre-check and post-check.
- `undo`: the catalog comes back line for line; with a teacher's reflection in place both functions go back, the checks stay wide and nothing is deleted; the fast stop.

Result on 2026-11-16, PostgreSQL 17.11, embedded-postgres, from an empty database: **174 of 174**; `fingerprints check` every list current. The pre-check, run read-only on gradebook-prod the same day, returned no row that would stop the file.

Not verified here: the edge function (not changed: it passes a question's `options` and an answer through as they are), gradebook-prod.

## One student page rule (2026111702, 2026-11-17)

One file, `../2026111702_student_listed_rule.sql`, applied to gradebook-prod on 2026-11-17 (post-check: all 15 rows ok), 16.7 KB. It adds `student_submit._listed(assessment, today)` (not a Draft, and Date Assigned empty or on or before today) and patches the 10 `student_submit` functions that spelled that rule out, in place: each swap of the rule for a call is checked against the md5 before and after. It changes no row and no answer. `student_listed.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has the same 344 function md5s as gradebook-prod:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54471/listed_main node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54471 PGDATABASE=listed_main python3 student_listed.py                                        # every scenario
```

Scenarios (the script's docstring says what each checks): `rule` (16 cases against the spelled-out rule, null included; attributes; only the owner may run it), `same` (14 routes, 8 states, 3 time zones: 336 answers, byte for byte the same before and after; two mutants of `_listed` are caught), `apply` (four guards, the catalog changes only in the 10 functions and `_listed`, no row, attributes and grants kept, only the rule's lines change, the header's md5s, pre-check, post-check, a second run, lock timeout, size), `undo` (catalog, rows and answers exactly as before; a second run; a changed function stops it; 2026111701's undo stops while this file is applied and runs after this undo).

Result on 2026-11-17, PostgreSQL 17.11 (embedded-postgres): **64 of 64**: rule 7, same 22, apply 24, undo 11. The pre-check, run read-only on gradebook-prod (17.6) the same day: all 11 rows ok.

Not verified here: the edge functions and gradebook-prod itself. `tests/db/run.mjs` covers this file only after the baseline is refreshed following the apply.

## Observation follow-ups (2026111703, 2026-11-17)

One file, `../2026111703_observation_follow_ups.sql`, **not applied**, 23 KB. It adds `observation.follow_up_of` (references `observation`, on delete cascade, indexed) and `observation.follow_up_kind` (four kinds or null, only on a follow-up), both null on every row; `fv_private.observation_follow_up_rule()` on `observation` and `observation_student` (same class, one level, the link and the class never change, no students of a follow-up's own); `create_observation_follow_up` (with `p_created_at`, the moment the teacher saved it: refused more than 5 minutes ahead, the observation's own time when earlier than it, now() when null) and `update_observation_follow_up` (idempotent, run as the teacher); and patches `get_class_bundle`, `get_observations` and `import_json_restore` in place, each md5-checked before and after. It changes no existing row. `observation_follow_ups.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has the same function md5s as gradebook-prod:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54491/fu_base node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54491 PGDATABASE=fu_base python3 observation_follow_ups.py                                 # every scenario
DATABASE_URL=postgresql://postgres@127.0.0.1:54491/postgres \
  FV_DB_TEST_APPLY=$PWD/migrations/2026111703_observation_follow_ups.sql npm run test:db         # the rule tests, with the file
```

Scenarios (the script's docstring says what each checks): `rules` (the two functions as A, B, signed out and a visitor; kinds, words, idempotency; the rule at the table and through `update_observation`; the check; the cascade), `readers` (every reader of observations: the bundle's list, total, follow-ups and profiles, `get_observations` with paging and every filter, the Term Questionnaire's picker, a withdrawn student's records, the profile lists, deleting a withdrawn student; no `student_submit` function names the tables), `same` (with no follow-up, 20 answers byte for byte as before but the new empty `follow_ups`), `dates`, `purge` (`fv_retention_cleanup` purging a class and a teacher that hold follow-ups), `restore`, `race` (follow-up and delete in both orders, two follow-ups at once, three rounds, connections of their own), `apply` (three guards, only the header's changes, no row, attributes and grants kept, the header's md5s, pre-check, post-check, a second run, lock timeout, size), `undo` (the table lock before its checks; nothing without the file; stops while a follow-up exists; the fast stop; catalog and rows as before but two dropped-column slots; a second run; the file applies again).

Result on 2026-11-17, PostgreSQL 17.12 (Postgres.app), from an empty database: **162 of 162** after the review of PR 1508 (`p_created_at`, the undo's table lock, the purge): rules 39, readers 18, same 24, dates 6, purge 4, restore 8, race 19, apply 23, undo 15, and 6 setup steps. `npm run test:db` with the file loaded: every rule test passed (348 functions, `create_observation_follow_up` and `update_observation_follow_up` refused B's ids by the ownership check); without it, as before (345).

On the dates: `create_observation` stamps an observation when it reaches the server, so an observation and its follow-up made offline together would have the follow-up dated before its observation. Refusing that would leave the follow-up as a dead letter, so the follow-up takes its observation's time instead.

The pre-check (`observation-follow-ups-live-precheck.sql`, catalog facts only, returns only the rows that differ) was run read-only on gradebook-prod on Nov 17 and returned no rows. The review changes did not alter its list of "before" fingerprints.

Not verified here: PostgREST's schema cache and the app's calls through it, gradebook-prod itself.

## Photos stay with the class (2026111704, 2026-11-17)

One file, `../2026111704_photos_stay_with_class.sql`, applied to gradebook-prod on 2026-11-17 (pre-check: no rows; post-check: all ok), 17 KB. It adds `public.course_opened` (one row per class, `last_opened_at`, on delete cascade with the class, row security on, no grants) with a row for every class that exists, stamped with the apply's time; `note_course_opened(p_course_id, p_idempotency_key)` (idempotent, runs as its owner, `fv_owns_course`; another teacher's class, one in the trash or one that is gone answers false and changes nothing); and replaces `_photo_keep_class` whole, md5-checked before and after, so the nightly job deletes a class's photos only after 365 days without it being opened (Keep Photos Until no longer deletes). It changes no existing row. `photos_stay.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has the same function md5s as gradebook-prod:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54511/ph_base node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54511 PGDATABASE=ph_base python3 photos_stay.py                                            # every scenario
DATABASE_URL=postgresql://postgres@127.0.0.1:54511/postgres npm run test:db                     # the rule tests (the baseline has the file)
```

Scenarios (the script's docstring says what each checks): `stamp`, `year` (eight classes through `photo_lifecycle_nightly` as pg_cron calls it: opened 364 days ago kept, 366 gone; archived 366 gone, archived 10 kept; in the trash skipped; no stamp and made today kept, made 400 days ago gone; a Keep Photos Until day passed yesterday kept; what goes, what is queued and logged, what stays; a second night), `without` (the same classes without the file: the two checks that must differ do), `oldapp` (`set_course_send_work` with `keep_photos_until` accepted and answered as before, and it deletes nothing), `purge` (`fv_retention_cleanup`: the class, its stamp and its pages go), `race` (the nightly step and an open on connections of their own, both orders, three rounds), `apply` (fourteen guards, each named by the pre-check; only the header's changes; no existing row; every class stamped with one time; the header's md5s; pre-check, post-check, a second run, lock timeout, size), `undo` (PART 1 alone puts the old step back and stamps still land; the full undo leaves the catalog and every row as before; a changed function stops it; a second run; the file applies again).

Result on 2026-11-17, PostgreSQL 17.12 (Postgres.app), from an empty database: **122 of 122**. `npm run test:db` with the file loaded: every rule test passed (349 functions, 81 tables with an owner, `course_opened` among them); without it, as before (348 functions).

The pre-check (`photos-stay-live-precheck.sql`, catalog facts only, returns only the rows that differ) was run read-only on gradebook-prod on Nov 17 and returned no rows; after the apply the post-check said ok on every row.

Since the apply, `migrations/baseline/` has the file, so a rebuilt database is the database after it: `photos_stay.py` takes each scenario's copy back to before the file with the full undo (proven by `undo` to leave the catalog exactly as before) and goes on from there.

**The undo's levers (review of PR 1514).** PART 0, added after the review, deletes nothing: it stamps every class as opened now, so the year rule takes nothing for 365 days and Keep Photos Until stays off. It is the first lever. PART 1 puts the old nightly step back, which brings Keep Photos Until's deleting back on the setting each class still holds (End of Year: the night after June 30; End of Term: the night after the term the class is in ends), so it deletes photos. Scenario `levers` proves both: after PART 0 the nightly job deletes nothing, a class unopened for 366 days and one whose End of Term ends today included; after PART 1 the End of Term class, opened today, loses its photos the night after its term ends.

Result after the review (2026-11-17, PostgreSQL 17.12, a database rebuilt from the refreshed baseline): **133 of 133**, `levers` included. `npm run test:db` on the same baseline: every rule test passed, `course_opened` now one of live's own tables.

Not verified here: pg_cron itself, the Storage service and the removal worker (the queue rows are checked, not the files), gradebook-prod itself.

## A warning before the year runs out (2026111705, 2026-11-17)

One file, `../2026111705_photo_expiry_warning.sql`, not applied (needs Colin's OK), 10 KB. It adds `list_course_photo_expiry()` (stable, runs as its owner, fixed search_path; the signed-in teacher's own classes not in the trash, with pages of sent work, unopened for 300 days or more: `course_id`, `last_opened_at` as `_photo_keep_class` judges it, `photos`; a visitor may not run it) and a trigger on `course`, `course_restored_opened`, with its function `_course_restored_opened()`: when `deleted_at` goes from a time to null, the class is stamped in `course_opened` as opened now, never moving a stamp back. There is no restore function: the operator restores with one UPDATE (20261012), and the `course_owner` policy lets a teacher's own update do the same, so a trigger covers both. It changes no existing row. `photo_expiry.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has 2026111704 as live does:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54491/pe_base node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54491 PGDATABASE=pe_base python3 photo_expiry.py                                            # every scenario
DATABASE_URL=postgresql://postgres@127.0.0.1:54491/postgres FV_DB_TEST_APPLY=migrations/2026111705_photo_expiry_warning.sql npm run test:db
```

Scenarios (the script's docstring says what each checks): `list` (eleven classes: who is listed and who is not, the date it answers, the page count, Teacher B, signed out, a visitor; a class opened leaves the list; at 364 days 23 hours the nightly step keeps the photos and the class is listed, past 365 it takes them), `restore` (the operator's UPDATE and a teacher's own update stamp the class; the nightly job then keeps its photos, and without the file the same restore loses them; a stamp in the future, a class with no stamp, a rename, a move to the trash, the purge), `apply` (each guard stops with the catalog unchanged and the pre-check names it; only the header's changes; no existing row; the md5s; a second run; pre-check and post-check; lock timeout; size), `undo` (PART 0 alone, the stop that deletes nothing; the full undo leaves the catalog and every row as before; a changed function stops it; a second run; the file applies again).

Result on 2026-11-17, PostgreSQL 17.12 (Postgres.app), from an empty database: **66 of 66**. `npm run test:db` with the file loaded: every rule test passed (351 functions; a visitor may run none).

The pre-check (`photo-expiry-live-precheck.sql`, catalog facts only, returns only the rows that differ) is to be run read-only on gradebook-prod before the apply. After it, the post-check (`photo-expiry-live-postcheck.sql`) says ok on every row.

Not verified here: gradebook-prod itself; pg_cron itself.

## Handout files (2026111706, 2026-11-17)

One file, `../2026111706_handout_files.sql`, not applied (needs Colin's OK), about 50 KB. Colin's call on Nov 17: "+ Add a PDF" becomes "+ Add a File"; a web page, a text file or an EPUB is kept as uploaded. It adds the kinds `html`, `txt` and `epub` and a column `bytes` to `assessment_resource`, a second private bucket `handout-files` (20 MB a file, `text/html`, `text/plain`, `application/epub+zip`; `student-photos` is not touched), four policies for it on `storage.objects` (read, upload, and two restricting ones, the shape of `student-photos`'), `start_handout_file` and `finish_handout_file` for a signed-in teacher, `student_submit.handout_file` for the edge function, and helpers. It replaces five functions, each guarded by its live md5: `_assessment_resource_json` (a file's row carries `bytes` and `path`), `_assessment_resource_removed` (a file's row going queues its file, bucket `handout-files`), `_handout_drop_expired` (drops an unfinished file upload too), `student_submit.removal_done` (asks the queued row's own bucket whether the file is gone) and `photo_lifecycle_nightly` (also visits a class with a handout still uploading). It changes no row and no file. `handout_files.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has 2026111705 as live does:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54733/hf_base node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54733 PGDATABASE=hf_base python3 handout_files.py fingerprints                              # write the md5 lists
PGPORT=54733 PGDATABASE=hf_base python3 handout_files.py                                           # every scenario
DATABASE_URL=postgresql://postgres@127.0.0.1:54733/postgres FV_DB_TEST_APPLY=migrations/2026111706_handout_files.sql npm run test:db
```

Scenarios (the script's docstring says what each checks): `teacher` (start and finish: what each answers and refuses, a request sent twice, a missing file, a file of another type or over 20 MB, the list, Remove, the 50-a-piece limit, the shape check; a PDF's and a link's rows answer exactly as before), `storage` (the exact name a teacher may write and only while it uploads, no overwrite, change or delete, who reads, a visitor, the PDF pages in `student-photos` as before, a careless policy added later), `student` (`handout_file` for a ready file on a listed piece; not found while uploading, for a PDF or a link, another class, a future date, a Draft; a bad session; `page` lists each file's kind), `lifecycle` (deleting the assessment and the 30-day purge of the class or the teacher queue the file; Keep Photos Until a year unopened leaves it; an upload never finished is dropped by the nightly job in a class with no photos, which without the file it is not: differs, as required; `removal_done` for a file still in `handout-files`, and gone), `apply` (each guard stops with the catalog unchanged and the pre-check names it; only the header's changes; no row but the bucket's own; the md5s; a second run; pre-check and post-check; lock timeout; size), `undo` (PART 0 alone; the full undo refuses while a file is held or not yet gone, then leaves the catalog as before but one dropped-column slot; a changed function stops it; a second run; the file applies again).

Result on 2026-11-17, PostgreSQL 17.11 (embedded-postgres), from an empty database: **142 of 142**. `npm run test:db` with the file loaded: every rule test passed (362 functions; a visitor may run none).

The md5 of `pg_get_functiondef` depends on the search path: `student_submit._listed(public.assessment, date)` prints its argument as `assessment` only while `public` is on it. The file sets `search_path = public, pg_temp`; run the pre-check and post-check with `public` on the search path, as Supabase's SQL tools do.

Not verified here: gradebook-prod itself; the Storage service's own checks (that it refuses a type or size the bucket does not allow, and an upload to a name that holds a file); the project's upload limit (must be 20 MB or more).

## Sticker codes (2026111710, 2026-11-17)

One file, `../2026111710_scan_labels.sql`, 19 KB, applied to gradebook-prod on 2026-11-17 on Colin's word ("Apply it"; pre-check: no rows; post-check: all ok, the table empty). Add Work for the Class, slice B4: a random code on each student's sticker sheet, so a scanned paper names its student. It adds `public.scan_label` (one row per code: `enrollment_id` on delete cascade, `code` unique and checked against the alphabet, `created_at`, `retired_at`; one live code per student; row security on, no policy, no grants), `fv_private.scan_label_new` (draws and stores a code; no role may call it), and three functions a teacher may run: `list_scan_labels`, `issue_scan_labels` and `reissue_scan_label` (the two that write are idempotent). It changes no existing row, table or function, and the table starts empty. `scan_labels.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has the same function md5s as gradebook-prod:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54620/sl_base node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54620 PGDATABASE=sl_base python3 scan_labels.py                                            # every scenario
DATABASE_URL=postgresql://postgres@127.0.0.1:54620/postgres npm run test:db                     # the rule tests, without the file
FV_DB_TEST_APPLY=migrations/2026111710_scan_labels.sql DATABASE_URL=postgresql://postgres@127.0.0.1:54620/postgres npm run test:db   # and with it
```

Scenarios (the script's docstring says what each checks): `issue`, `reissue`, `list`, `others` (Teacher B's class and student, a class in the trash, ids that do not exist and null ids answer empty and change nothing; signed out is PT401; a visitor runs none; no role reads or writes the table or calls the code-drawing function; no function of the student page names the table), `cascade` (a withdrawn student deleted for good and a class purged from the trash take their codes), `taken` (a code already taken is drawn again; five in a row fail and add nothing; the table itself refuses a code outside the alphabet, a second live code for a student and a repeated code; 1,500 of the function's own draws all differ and every one of the twelve places shows all 32 characters), `race` (two issues for one class and two reissues for one student on connections of their own, three rounds each; one key from two windows, both held behind the key's lock first), `missing` (a relied-on function that is missing altogether stops the file), `defaults` (with Supabase's default privileges in place the grants still come out exact), `apply` (nine guards, each named by the pre-check; a held lock gives up after five seconds; only the header's changes; no existing row; the header's md5s; pre-check, post-check, a second run, size), `undo` (PART 1 alone takes the functions from teachers and keeps every code; the full undo leaves the catalog and every row as before; a changed function stops it; a second run; the file applies again).

Result on 2026-11-17, PostgreSQL 17.12 (Postgres.app), from an empty database: **204 of 204**. `npm run test:db` with the file loaded: every rule test passed (355 functions, 82 tables with an owner, `scan_label` among them); without it, as before (351 functions).

The pre-check (`scan-labels-live-precheck.sql`, catalog facts only, returns only the rows that differ) was run read-only on gradebook-prod on Nov 17 and returned no rows. After the apply the post-check said ok on every row.

Since the apply, `docs/schema.generated.sql`, `migrations/baseline/` and `types/database.d.ts` have the file (a rebuild with `--check` matches; 355 functions), so a rebuilt database is the database after it: `scan_labels.py` takes each scenario's copy back to before the file with the full undo and goes on from there. On that baseline: **204 of 204**, and every rule test passed with `scan_label` one of live's own tables.

**Independent review (Nov 17).** One must-fix, fixed: the first guard let a relied-on function that was missing altogether through (it now stops; scenario `missing`). Also fixed: the undo's header and message now say that a full removal which stops leaves PART 1's revoke in place and how to give the functions back, and that the removal needs `public.enrollment` to itself for a moment; the post-check's last row fails when the table is not empty; four harness checks that asserted less than their names (the sync cursor, the spread of draws by place, one key from two windows, another teacher sending this teacher's key). The reviewer agreed with keeping the code readable: no function takes a code as input, so there is nothing to guess against.

Not verified here: gradebook-prod itself; the app that calls the functions (its own tests are in the B4 app PR).

## Per-student options (2026111720, 2026-11-17)

One file, `../2026111720_student_page_per_student.sql`, applied to gradebook-prod on 2026-11-17 on Colin's OK (post-check: all 17 rows ok), 23 KB. The contract is `docs/plans/per-student-options-plan.md`. It adds `enrollment.show_overall_grade` (boolean) and `enrollment.page_paused_at` (timestamptz), both null on every row with no default; `set_student_page_options` and `list_student_page_options` for the class's teacher (idempotent, owner only, granted to `authenticated` alone; an id that is not an active student of the class is skipped and named in `skipped`, and only a call with none left is refused); and patches four `student_submit` functions in place, each md5-checked before and after: `_card_refusal` (a paused student is `closed`), `_session_classes` (a paused student's class is left out), and `page` and `feedback` (Show Overall Grade is `coalesce(enrollment.show_overall_grade, course.show_my_learning)`). It changes no existing row. `per_student.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has the same 366 function md5s as gradebook-prod:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54801/ps_base node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54801 PGDATABASE=ps_base python3 per_student.py                                            # every scenario
```

Scenarios (the script's docstring says what each checks): `same` (with no option set, 25 session routes, the card scan and the sign-in for two students: 54 answers byte for byte as before), `pause` (a paused student's scan, sign-in and all 25 routes on a session opened before the pause answer `closed`; classmates unchanged; opening again gives every answer back), `grade` (hidden: no My Learning and no category ids, byte for byte the page with the class switch off, which still carries each piece's result, weight and category_percent; show overrides a class that is off; class follows; a mutant page is caught), `rpc` (replies, 19 refusals that change nothing, foreign ids skipped with one reply whatever they are, idempotency, only changed rows written, the sync cursor, roles), `leak` (no student answer or student function names the columns; the bundle's profiles carry them to the teacher only; withdraw and re-enrol keep them), `race` (two calls on the same students, three rounds; twenty at once), `defaults` (grants exact under Supabase's default privileges), `apply` (six guards, each named by the pre-check; only the header's changes; no row; md5s; pre-check, post-check, a second run, lock timeout, size), `undo` (PART 1 alone, the fast stop; the full removal refuses while a choice is set; catalog as before but two dropped-column slots; a changed function stops it; a second run; the file applies again; the removal's ACCESS EXCLUSIVE lock lets a transaction that read enrollment and then writes it finish, where the weaker lock it replaced deadlocks, reproduced).

Result on 2026-11-17, PostgreSQL 17.11 (embedded-postgres), from an empty database: **149 of 149** after the independent review (`per-student-review.md`: skipped ids, the undo's lock, wording). The pre-check (`per-student-live-precheck.sql`, catalog facts only, returns only the rows that differ) was run read-only on gradebook-prod (17.6) the same day and returned no rows.

Since the apply, `docs/schema.generated.sql` (its md5 equal to live's snapshot, read read-only), `migrations/baseline/` (the Database baseline workflow's output) and `types/database.d.ts` have the file, and a rebuild with `--check` matches (368 functions). `per_student.py` then takes each scenario's copy back to before the file with the full undo and goes on from there: **149 of 149** on that baseline; `npm run test:db`: every security rule test passed.

Not verified here: PostgREST's schema cache and the app's calls through it, the edge function (not changed: `closed` is already in its whitelist).

## Quizzes, the student page's list (2026111807, 2026-11-18)

One file, `../2026111807_quizzes_student_list.sql`, APPLIED to gradebook-prod on 2026-11-18 from commit `04d50b81` (the text applied: 13,333 bytes, sha256 `d5f7d52e080d929ba00e9b808118fccca1afaaf5f51639d9fcc6fe3a0767127b`; since then only its first comment line says it is applied); post-check 13 of 13 ok; the `student-submit` edge function (v22) deployed from `04d50b81` after it. It needs 2026111806 (MQ2). It adds one read-only function, `student_submit.quiz_list` (`stable`, `security definer`, the path pinned, `service_role` only), for the route `quiz-list`: which pieces of the session's class are quizzes the student may open, by `quiz`'s own rule (`_quiz_window`), and for each `tries_left`, `can_answer`, `closed` and `has_open_try`. It begins with `_session_class`, reads no question, key or answer, writes nothing (no try, no `write_log` row) and takes no row lock. `student_submit.page` and its reply are not changed. It changes no existing row, table, policy, constraint or function. 13,333 bytes, plain ASCII, no backslash. Contract: `quizzes-contract.md`, "quiz_list".

```bash
export PGPORT=54761 FV_ICU_DB=q3a_icu FV_C_DB=q3a_c PYTHONDONTWRITEBYTECODE=1     # the two templates as for 2026111806
PGDATABASE=q3a_icu python3 quizzes_student_list.py
PGDATABASE=q3a_c python3 quizzes_student_list.py
FV_NONSUPER=q3a_postgres PGDATABASE=q3a_icu python3 quizzes_student_list.py
FV_DB_TEST_APPLY=migrations/2026111807_quizzes_student_list.sql DATABASE_URL=postgresql://postgres@127.0.0.1:54761/postgres npm run test:db
```

The script uses `quizzes_student.py`'s world (MQ2 kept as the template has it). Scenarios: `list` (exactly the pieces `quiz` opens, at every stage of a try, and it agrees with `quiz`; Draft, next week, DIBELS, Pairs and Groups left out), `nowrite` (700 calls: no row, no `write_log` row, no lock left on a quiz row, never `too_many`; it answers at once while the teacher holds the quiz for a save), `leak`, `refused`, `others`, `apply`, `lastcheck`, `undo`, `collations`.

Result on 2026-11-18, PostgreSQL 17.11, on databases rebuilt with `--check` from `main` at `c9864884`: under ICU en-US **207 of 207**; under C **207 of 207**; as the non-superuser **214 of 214**. The post-check has 13 rows. `npm run test:db` without the file: every rule test passed (74 student_submit functions; service_role may run 44); with it: every rule test passed (75; 45).

Not verified here: gradebook-prod; the edge function deployed.

## Quizzes, the student's side (2026111806, 2026-11-18)

One file, `../2026111806_quizzes_student.sql`, APPLIED to gradebook-prod on 2026-11-18 as `quizzes_student` from commit `ef96d940` (the text applied: 36,786 bytes, sha256 `f8d288da038890a136a2d6501343c9521969db455fac0d642ce179d9c8753719`; since then only its first comment line says it is applied); post-check 28 of 28 ok; the `student-submit` edge function (v21) deployed from `ef96d940` after it. Slice Q3a of `docs/plans/quizzes-plan.md`; the contract is `quizzes-contract.md`, "The student's side (MQ2)". It needs MQ1 (`2026111804`, `2026111805`) and Bulletins' M2 (`2026111803`) applied first, which a database rebuilt from the repo already has. It adds six `student_submit` functions, each `security definer` with the path pinned: three private helpers no role may call (`_quiz_window`, the piece as a quiz this class may open (never a pair or group piece), open or closed read as `_work_window` reads Student Work's from the quiz's own columns; `_quiz_new_order`; `_quiz_questions`, the active questions in a try's order without key, competency or position) and the three the edge function calls, `quiz`, `quiz_save`, `quiz_send`, each beginning with `_session_class`. None of the six reads `quiz_key`. The three are granted to `service_role` and no other role; the edge function signs in as the database's owner, so the undo's fast stop drops them. It changes one existing thing: `write_log_kind_check` gains `quiz` (dropped and added in one statement, behind a guard that stops if the check is not the one Bulletins' M2 left). No row changes. 36,786 bytes, plain ASCII, no backslash.

```bash
$PSQL postgresql://postgres@127.0.0.1:54761/postgres -c "create database q3a_icu template template0 locale_provider icu icu_locale 'en-US' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8'"
$PSQL postgresql://postgres@127.0.0.1:54761/postgres -c "create database q3a_c template template0 locale_provider libc lc_collate 'C' lc_ctype 'C'"
DATABASE_URL=postgresql://postgres@127.0.0.1:54761/q3a_icu node scripts/db-rebuild.mjs --check     # and the same for q3a_c
export PGPORT=54761 FV_ICU_DB=q3a_icu FV_C_DB=q3a_c PYTHONDONTWRITEBYTECODE=1
PGDATABASE=q3a_icu python3 quizzes_student.py                                 # every scenario, under ICU en-US (as live)
PGDATABASE=q3a_c python3 quizzes_student.py                                   # every scenario, under C
FV_NONSUPER=q3a_postgres PGDATABASE=q3a_icu python3 quizzes_student.py        # every scenario as a role that is not a superuser
FV_DB_TEST_APPLY=migrations/2026111806_quizzes_student.sql DATABASE_URL=postgresql://postgres@127.0.0.1:54761/postgres npm run test:db
```

`FV_NONSUPER` gives the copy's app schemas to a role made like live's `postgres` (not a superuser; `createrole`, `bypassrls`; a member of `anon`, `authenticated`, `service_role`, `pg_read_all_data`, `pg_monitor`; live's default privileges for what it creates), and every statement after the world is made, the file's apply, checks and undo included, is that role's.

Scenarios (the docstring says what each checks): `open`, `save`, `send`, `tries`, `closed` (in the class's time zone: one last day read open at UTC-11 and closed at UTC+14), `reopen`, `refused`, `collab` (a quiz whose piece the teacher switches to Pairs or Groups after, which `save_collab` allows: every route `not_found`, nothing written; switched back, the student carries on), `access` (the rule for unfinished answers; a second device carries on), `leak` (the key's three marker values, the competencies, a teacher's note, points and confirmed marks in no reply at any stage; over 300 new orders the right choice lands in each place), `limit`, `race` (two saves of one answer, two first opens, a save and a send, a save and the teacher removing that question both orders, a first open and an Unassign both orders, an open and a Reopen), `released` (the released app's writes answer the same and leave the same rows with and without the file), `others`, `defaults`, `apply`, `lastcheck`, `undo` (sent whole, PART 1 stays when PART 2 refuses), `undolock`, `collations`.

Result on 2026-11-18, PostgreSQL 17.11 (embedded-postgres), on databases rebuilt with `--check` from `main` at `f1505bf7`: under ICU en-US **630 of 630**; under C **630 of 630**; as the non-superuser **652 of 652**. The post-check has 28 rows, every one ok. `npm run test:db` without the file: every rule test passed (68 student_submit functions; service_role may run 41 entry points); with it: every rule test passed (74; 44). The routes were also run through the real `handler.ts` with postgres.js 3.4.5 (the edge function's driver) against a copy with the file: 20 of 20. That run is why `quiz` sends `new_try` as `$5::text::boolean`: typed as boolean straight away, postgres.js sends the string `'true'` as false.

For the student's screen (Q3b), from how these functions behave: an open that starts a try, and every save and send, spend one of 600 writes an hour per card; `sent` on a save means another device sent the try or a Reopen is waiting (call `quiz` again); a cleared answer is `answer: null`, and an empty string is `bad_answer`.

Not verified here: gradebook-prod; the edge function deployed.

## Bulletins, the student's side (2026111803, 2026-11-17)

One file, `../2026111803_bulletins_student.sql`, APPLIED to gradebook-prod on 2026-11-18 as `bulletins_student` from commit `2ba145b6` (the text applied: 31,004 bytes, sha256 `6cbcf7ed149f0edc0057efefc2838350a18fbbcb2dd92696e52ccab7814e5f0b`; since then only its first comment lines say it is applied); post-check 25 of 25 ok; the `student-submit` edge function deployed from `2ba145b6` after it. Slice B1b of `docs/plans/bulletins-plan.md`; the contract is `bulletins-contract.md`, "For B1b". It needs M1 (`../2026111801_bulletins.sql`) applied first. It adds six `student_submit` functions, each `security definer` with the path pinned: two private helpers no role may call, `_bulletin_visible` (the one rule for whether a student may see a bulletin) and `_bulletin_session_enrollments` (the classes a device may name, mirroring `_session_classes`' tests without its to-do counts), and the four the edge function calls, `bulletins`, `bulletin_seen`, `bulletin_react`, `bulletin_file_links`, each beginning with `_session_class`. The four are granted to `service_role` and no other role; the edge function signs in as the database's owner, which may run them grant or not, so the undo's fast stop drops them. It changes one existing thing: `student_submit.write_log`'s `write_log_kind_check` gains `bulletin` (dropped and added in one statement, behind a guard that stops if the check is not today's). No row changes. It sets its own search path (`public, pg_temp`): an md5 of `pg_get_functiondef` depends on it. Run the pre-check and post-check with public on the path, as Supabase's SQL editor does.

Live is PostgreSQL 17 with the ICU locale `en-US` (`datlocprovider = 'i'`). The main run is on a database made the same way, and a second run on a `C` database:

```bash
$PSQL postgresql://postgres@127.0.0.1:54732/postgres -c "create database b1b_icu template template0 locale_provider icu icu_locale 'en-US' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8'"
$PSQL postgresql://postgres@127.0.0.1:54732/postgres -c "create database b1b_c template template0 locale_provider libc lc_collate 'C' lc_ctype 'C'"
DATABASE_URL=postgresql://postgres@127.0.0.1:54732/b1b_icu node scripts/db-rebuild.mjs --check     # and the same for b1b_c
export FV_M1=<M1's file> PGPORT=54732 FV_ICU_DB=b1b_icu FV_C_DB=b1b_c PYTHONDONTWRITEBYTECODE=1
PGDATABASE=b1b_icu python3 bulletins_student.py                                                    # every scenario, under ICU en-US
PGDATABASE=b1b_c python3 bulletins_student.py apply undo defaults missing undolock                 # and under C
FV_DB_TEST_APPLY=<M1 and M2 in one file> DATABASE_URL=postgresql://postgres@127.0.0.1:54732/postgres npm run test:db
```

macOS's libc `en_US.UTF-8` does not sort as ICU does and is not a stand-in. Every text order the file, its checks and its undo aggregate is `collate "C"`, so their answers do not depend on the database's collation; scenario `collations` proves the fingerprints and both checks' rows are the same under the two.

The SQL file, its pre-check, post-check and undo are plain ASCII (printable characters and newlines only), and the only backslashes in them are the pre-check's two test strings, `'\x41'` and `'a\\b'`: the tool a migration is sent through was measured turning a backslash, `u` and four hex digits into the character itself, and that row names a route that changes text. Making the files ASCII changed comments only: the six functions' md5s, their grants and the whole catalog after the apply are the same as before.

Until M1 is on this branch, `FV_M1` names a copy of it (none is kept here); once the baseline has M1, the template has it and the script skips it. `npm run test:db` with M1 loaded needs M1's own additions to `tests/db/` (on its branch).

Scenarios (the docstring says what each checks): `feed`, `new`, `seen`, `react`, `links`, `refused` (on all four functions: paused mid-session, withdrawn, page off, trash, stopped card, expired card, unknown or expired session, an enrolment not on the session, a null enrolment; nothing written; a locked card still works), `limit` (120 an hour per card across both write routes; every older kind still passes the widened check), `leak` (key sets at every level are the contract's; no other student's id, time, count or name), `others` (exact grants), `race` (two `bulletin_seen` for the same ids at once; a reaction set and taken back at once), `defaults`, `apply` (the guards, each named by the pre-check; the lock timeout; only the header's changes; a second run; size), `missing`, `undo` (as the owner: a revoke would stop nothing; PART 1 drops the four; the full undo puts the check back exactly, deleting only write_log's `bulletin` rate-limit rows; the file applies again), `mirror` (the helper and `_session_classes` name the same enrolments in every state), `collations` (ICU en-US and C give the same fingerprints and check answers), `undolock` (the full undo locks write_log before it deletes, so a student's write arriving between waits; the old order is shown to deadlock).

Result on 2026-11-18, PostgreSQL 17.11 (embedded-postgres), M1 at `129b8646`: under ICU en-US **412 of 412**; under C, the apply, undo, defaults, missing and undolock scenarios **123 of 123**; with `FV_NONSUPER=b1b_postgres` (the app schemas given to a role that is not a superuser, as Supabase's `postgres` is, which then applies, checks and undoes the file), apply, missing and undo **119 of 119**. `npm run test:db` with M1 and M2: every rule test passed (68 student_submit functions; service_role may run 41 entry points). M1 applied, then M2, then M1 again: a clean second run, and M1's post-check says ok on every row with M2 in place. Undo M2 before M1 (M2's functions read M1's tables).

Since the apply, `docs/schema.generated.sql` (the live snapshot CI printed), `migrations/baseline/` (the Database baseline workflow's output) and `types/database.d.ts` have both files, and a rebuild with `--check` matches (392 functions; `bulletin_file_page_count_check` joins the two known nested-AND differences: it was written with `between`). `bulletins_student.py` then takes each scenario's copy back to before M2 with the full undo and goes on from there: on that baseline, under ICU en-US **412 of 412**, under C **123 of 123**, as a non-superuser **119 of 119**; `npm run test:db` with no file named: every security rule test passed (68 student_submit functions).

For the student page (B1d), from how these functions behave:

- **An expired card's class** is still in `new` with its count, as `_session_classes` still lists it on the class list; opening it is refused `card_expired`.
- **An empty or repeated `bulletin-seen`** spends one of the 120 writes an hour. Send only ids whose `seen_at` is null, when they come into view, never on a timer.
- **A write that meets a teacher's delete or a student's removal** (the bulletin or the enrolment gone between the check and the insert) fails with a server error (500); a retry gets an ordinary answer (the id skipped, or `not_found`). Treat a 500 on `bulletin-seen` and `bulletin-react` as "try again", never as signed out.

Not verified here: gradebook-prod; the edge function deployed; Supabase Storage signing a `bulletin-files` link.

## Bulletins (2026111801, 2026-11-17)

One file, `../2026111801_bulletins.sql`, APPLIED to gradebook-prod on 2026-11-18 as `bulletins` from commit `129b8646` (the text applied: 40,743 bytes, sha256 `a57602233f6385994dafcf4f439994abefc7904b8a3b9776e55543576dccf227`; since then only its first comment line says it is applied); post-check 26 of 26 ok. Bulletins slice B1a, the teacher's side of a one-way class feed (`docs/plans/bulletins-plan.md`); the contract, for the builders of B1b, B1c, B1d and B1f, is `bulletins-contract.md`. It adds four empty tables in `public` (`bulletin`, `bulletin_file`, `bulletin_seen`, `bulletin_reaction`: row security on, no policy, no grant to any role, each with a primary key, each going with its class, bulletin and student on delete cascade; a deleted file row queues its pages in `submission_file_removal`), a private bucket `bulletin-files` (JPEG only, 2 MB a page) with four policies on `storage.objects` in the shape of `handout-files'`, seven functions a signed-in teacher may run (`list_bulletins`, `post_bulletin`, `finish_bulletin_file`, `edit_bulletin`, `delete_bulletin`, `list_bulletin_seen`, `show_bulletin_again`) and eleven helpers in `fv_private` that no role runs but the two the storage policies call. It changes no existing row, table, policy or function; the one row it adds is the bucket's. `bulletins.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has the same function md5s as gradebook-prod:

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:54731/b1a_base node scripts/db-rebuild.mjs --check   # an empty database
PGPORT=54731 PGDATABASE=b1a_base python3 bulletins.py fingerprints                                  # write the md5s the file, post-check and undo carry
PGPORT=54731 PGDATABASE=b1a_base python3 bulletins.py                                               # every scenario
DATABASE_URL=postgresql://postgres@127.0.0.1:54731/postgres npm run test:db                         # the rule tests, without the file
FV_DB_TEST_APPLY=migrations/2026111801_bulletins.sql DATABASE_URL=postgresql://postgres@127.0.0.1:54731/postgres npm run test:db   # and with it
```

Scenarios (the script's docstring says what each checks): `post`, `edit`, `delete`, `counts` (Seen by N of M with a paused, a withdrawn, a no-card, a stopped-card, an expired-card and a locked-card student; seen rows inserted directly, the student functions being B1b's), `others` (Teacher B, a class in the trash, ids that do not exist; signed out is PT401; a visitor and the service role run nothing; no role reads or writes the tables or runs a helper; no sync cursor moves), `storage`, `cascade` (a student deleted for good, the 30-day purge, a deleted assessment, an upload never finished), `limits`, `race` (one key twice; one key from two connections at once; two posts at the page cap at once; two files of one bulletin finished at once; three rounds each), `defaults`, `missing`, `apply` (nine guards, each named by the pre-check; a held lock gives up after five seconds; only the header's changes; no existing row changed; a second run; pre-check and post-check; the size), `m2` (with a stand-in for M2's `student_submit.bulletins`: M1 again, its post-check, PART 1 and the seven grants back, the full undo refusing until M2 is undone), `locks` (a delete holding the class's lock first: show again, edit, delete and finish refuse rightly, 5 of 5 each; an expired upload dropped while another file finishes, 20 of 20), `lastcheck` (a stop at the last check leaves nothing, the bucket row included), `spentkey` (after an expired upload the same key answers its first reply; a new key posts), `undo` (PART 1 alone; the full removal of an unused install leaves the catalog and every row as before; with use it refuses while a row, a queued page or a file is kept; a changed function stops it; a second run; the file again).

Result on 2026-11-17, PostgreSQL 17.11 (embedded-postgres), from an empty database rebuilt after `2026111730` (zero_data): **349 of 349**; after the independent review's fixes (Nov 18; scope to M1's own names, the way back from PART 1, dates, whole page numbers, re-reads under the lock, one class per drop, the storage helpers' grant checked, links and whitespace), on a database rebuilt from main at the merge: **419 of 419**. `npm run test:db` without the file: every rule test passed (368 functions, 84 tables); with it: every rule test passed (386 functions, 88 tables, the four new ones among them, seeded by `tests/db/seed.sql` once the file is there).

The md5 of `pg_get_functiondef` depends on the search path (`fv_private.bulletin_patched` takes a `public.bulletin`): the file sets `search_path = public, pg_temp`; run the pre-check and post-check with `public` on the search path, as Supabase's SQL editor does.

**Collation (Nov 18).** The first send to live was stopped by the file's own last check and changed nothing: live sorts text by ICU `en-US`, and the function fingerprint's `order by` used the server's collation, so its md5 differed from the one computed on this Mac's C cluster. Reproduced here on an ICU `en-US` database with the old file (the same message). Every fingerprint now sorts with `collate "C"`; the table grant check reads `aclexplode` instead of `information_schema` (which shows only the running role's grants); the post-check reads only M1's 18 function names. The template now mirrors live:

```bash
psql … -c "create database b1a_icu template template0 encoding 'UTF8' locale_provider icu icu_locale 'en-US' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8'"
DATABASE_URL=postgresql://postgres@127.0.0.1:54731/b1a_icu node scripts/db-rebuild.mjs --check
B1A_C_TEMPLATE=b1a_base PGPORT=54731 PGDATABASE=b1a_icu python3 bulletins.py        # every scenario on ICU en-US, and collations on C too
PGPORT=54731 PGDATABASE=b1a_base python3 bulletins.py post edit … spentkey             # every other scenario on C
```

Result: **441 of 441** on ICU `en-US` (scenario `collations`: apply, fingerprints, second run, post-check, pre-check, undo, re-apply on both, identical fingerprints); on C every scenario but `collations`: **419 of 419**. `tests/db/run.mjs` makes its database with a bare `create database` (the cluster's default), and `db-rebuild.mjs` uses whatever database it is given.

**The apply route (Nov 18).** The second send to live was stopped by the last check too, and changed nothing: the route the file is sent through turns each backslash, small u and four hex digits into the real character, so `bulletin_patched`'s hidden-character class arrived with other text. The class is now built with `chr()`; the four files are plain ASCII with no such escape (`tests/migrations-route-safe.test.js`, which fails on the old file); the pre-check has a row that comes back if the route starts changing backslashes; the last check names each part that failed (scenario `named` trips each of its six parts and two at once). Only `bulletin_patched`'s md5 changed. Result: **488 of 488** on ICU `en-US`, **445 of 445** on C (every scenario but `collations` and `route`, which run both collations themselves).

Not verified here: gradebook-prod itself; the Storage service's own checks (the bucket's type and size limits, refusing a second upload to a name that holds a file); the removal worker (B1b teaches it the bucket); PostgREST's schema cache.

## Quizzes (2026111804 and 2026111805, 2026-11-17, applied Nov 18)

Two files, APPLIED to gradebook-prod on 2026-11-18 from commit `4880726f`, in that order: `../2026111804_quizzes.sql` as `quizzes` (the text applied: 40,633 bytes, sha256 `8585b4d0292f06885fe7c384c5261c04c9944832ab941a471e756d517e0b54e2`; post-check 45 of 45 ok) and `../2026111805_quiz_results.sql` as `quiz_results` (21,879 bytes, sha256 `e9764a221bf6516f1f18b6761cd368589611ea552e9dbc19b0709b5b55c87e0a`; post-check 13 of 13 ok). Since then only their first comment lines say they are applied. (First numbered 2026111802 and 03; renumbered on Nov 18 because Bulletins' `2026111803_bulletins_student.sql` took 03.) Quizzes, slice Q1 (`docs/plans/quizzes-plan.md`); the contract every later slice builds to is `quizzes-contract.md`. The first adds five tables (`quiz`, `quiz_question`, `quiz_key`, `quiz_attempt`, `quiz_answer`: row security on, no policy, no grants; foreign keys cascade with the assessment and with the student), `list_quiz` and `save_quiz` for the class's teacher (`save_quiz` refuses a stale payload, and stores no copy of its reply, so the key is never in `fv_idempotency`), the private helper `fv_private.quiz_json`, the trigger `assessment_quiz_draft_guard` (Unassign refused with `draft_has_work` once any try exists; the existing guard is not changed), the deferred constraint trigger `quiz_tag_gone` on `assessment_tag` (a competency off the piece at commit is off its questions; the form's delete-and-insert of the same ones changes nothing) and `quiz_attempt_same_class`. The two triggers on existing tables go in first, after one `share row exclusive` lock on `enrollment`, `assessment` and `assessment_tag` in that order, so a second run never holds a quiz table while it waits for a teacher's save (the review found a second run could fail that save with `40P01`). The second file adds `list_quiz_tries` (moved from the first for room), `mark_quiz_answer`, `reopen_quiz` and `confirm_quiz` (stores what the teacher's app confirmed; writes no score). Split because the whole was 53 KB and `apply_migration` takes 40 KB at most. Neither changes an existing row, table, policy, constraint or function. `quizzes.py` runs on a database rebuilt from the repo (`scripts/db-rebuild.mjs --check`), which has the same function md5s as gradebook-prod. The student's functions are MQ2's: the script inserts tries and answers directly, taking the locks the contract gives MQ2.

```bash
# Two empty databases: one with live's locale (ICU en-US), one with C.
$PSQL postgresql://postgres@127.0.0.1:54733/postgres -c "create database q1_icu template template0 locale_provider icu icu_locale 'en-US' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8'"
$PSQL postgresql://postgres@127.0.0.1:54733/postgres -c "create database q1_c template template0 locale_provider libc lc_collate 'C' lc_ctype 'C'"
DATABASE_URL=postgresql://postgres@127.0.0.1:54733/q1_icu node scripts/db-rebuild.mjs --check
DATABASE_URL=postgresql://postgres@127.0.0.1:54733/q1_c node scripts/db-rebuild.mjs --check
PGPORT=54733 PGDATABASE=q1_icu python3 quizzes.py      # every scenario, on live's locale (the main run)
PGPORT=54733 PGDATABASE=q1_c python3 quizzes.py        # and on C
DATABASE_URL=postgresql://postgres@127.0.0.1:54733/postgres npm run test:db                  # the rule tests, without the files
cat ../2026111804_quizzes.sql ../2026111805_quiz_results.sql > /tmp/quizzes-both.sql
FV_DB_TEST_APPLY=/tmp/quizzes-both.sql DATABASE_URL=postgresql://postgres@127.0.0.1:54733/postgres npm run test:db   # and with them
```

Scenarios (the script's docstring says what each checks): `save` (every kind, trimming, reorder, settings, a question removed with and without answers, brought back, what may and may not change once answered, 50-odd refusals each changing nothing, DIBELS and pair pieces, a Draft, removing a quiz), `list`, `tries` (sent tries only; an unsent try's answers, order and id are in no reply; a withdrawn student is left out), `mark`, `reopen`, `confirm` (no row of `score`, `tag_score`, `rubric_score` or `grade_return` changes: counts and md5 before and after), `draft` (Unassign before and after a try; both orders of a start and of a reopen racing an Unassign on two connections), `others` (Teacher B through every function; signed out; a visitor and `service_role` run none; no role reads or writes the five tables; no `student_submit` function names `quiz_key`, by `pg_get_functiondef`), `cascade`, `race` (one key twice and from two connections; a student's save holding the quiz while the teacher removes that question; a delete racing a save, both orders), `missing`, `defaults`, `apply` (each file's guards named by the pre-checks, only the headers' changes, no existing row, md5s, post-checks, a second run, lock timeout, sizes), `lastcheck` (each part the last checks read, a function's md5, a grant from `proacl` or `relacl`, a table's row security, policy, relacl or attacl, a key's cascade, a trigger's function, events, columns or condition, tripped alone and two at once on ICU: the message names exactly that part and nothing is left behind; the pre-checks' route row fires when an escape arrives changed), `nonsuper` (as a role that is not a superuser, with live's default privileges set, so new tables are born granted to `authenticated` and new functions to `authenticated` and `service_role`: apply, the grants end exactly as the contract says, post-checks, undo, apply again; without the file's revoke the last check names the table), `collation` (on ICU en-US and on C, from `PG_ICU_TEMPLATE` and `PG_C_TEMPLATE`: apply, post-checks, a second run, undo, apply again; the fingerprints and the stored key are the same under both), `undowhole` (each undo sent whole as one string: PART 1 is its own transaction and commits first; when PART 2 refuses, PART 1's stop stays and nothing else changes), `rerun` (a second run of file one against a teacher mid-save, committing after 0.3 s, 2.5 s and 6 s: no deadlock, the save commits, reads under 0.2 s), `undo` (each PART 1 alone; the full removal refuses while a quiz exists or the results file is there; a changed function stops it; catalog and rows as before; the files apply again).

`tests/db/table-owners.mjs` names the five tables (in `NOT_YET_APPLIED` until the apply), `tests/db/seed.sql` gives each teacher a quiz, a sent try and an answer once the files are loaded, and `tests/db/function-args.mjs` reads `p_attempt_id` and `p_question_id` as a quiz try and question.

Result on 2026-11-18, PostgreSQL 17.11 (embedded-postgres), from empty databases rebuilt with `--check` after merging `main` (both Bulletins migrations applied, baseline refreshed): **626 of 626** on ICU en-US (live's locale: `datlocprovider` `i`, `datlocale` `en-US`, `datcollate` and `datctype` `en_US.UTF-8`), the main run, and **626 of 626** on C. The eight SQL files are plain ASCII with no backslash-u escape (`tests/migrations-route-safe.test.js`), each live pre-check has the route row, and each file's last check names each part not as tested. Every text order that feeds a comparison or a stored value sorts with `collate "C"`. A first apply leaves the same catalog as the reviewed `8549bad4` except the three changed functions (`save_quiz`, `mark_quiz_answer`, `confirm_quiz`) and `quiz_key`'s comment. `npm run test:db` without the files: every rule test passed (392 functions, 88 tables); with both: every rule test passed (402 functions, 93 tables, the six new public functions refused with Teacher B's ids by the ownership check).

**The undo, sent whole.** Each undo's PART 1 is its own transaction. To stop, send PART 1 alone. Sent whole as one text, PART 1 commits first and PART 2 runs in a transaction of its own: when PART 2 refuses (a quiz exists, or the results file is still there), it changes nothing and PART 1's stop stays, so teachers are without the functions until the migration files are run again. (Before Nov 18 PART 1 had no transaction of its own, and sent whole it was folded into PART 2's and rolled back with it.)

### Every delete these files can perform

| What                                                                             | Deletes                                                                                                                      | When                                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `save_quiz` with `p_quiz` null                                                   | the quiz row, every question and its key                                                                                     | only while no student has a try (`has_tries` otherwise)                                |
| `save_quiz` leaving a question out                                               | that question and its key                                                                                                    | only when no answer names it; one with answers is archived and kept                    |
| `save_quiz` with an old payload                                                  | nothing: refused as `stale`                                                                                                  | the quiz was saved since the payload was read                                          |
| every `save_quiz`                                                                | nothing deleted: it OVERWRITES the quiz's settings, each kept question's fields and its key row (an overwrite, not a delete) | on each save that is not refused                                                       |
| `delete_assessment` (and a class purged by `fv_retention_cleanup`, `clear_data`) | the quiz, its questions, keys, every try and answer                                                                          | by the foreign keys, with the assessment                                               |
| `delete_withdrawn_student`, and `relink_student` merging a duplicate             | that enrolment's tries and answers                                                                                           | by the foreign key, with the enrolment (as its scores go)                              |
| a competency taken off a piece, or deleted                                       | nothing: `tag_id` becomes null on its questions at commit                                                                    | the pair is still gone at commit                                                       |
| `confirm_quiz`                                                                   | nothing deleted: another try's `marked` is set to null when a student is confirmed on a new try, or a `marked` given null    | as the teacher's app sends it (Undo)                                                   |
| `mark_quiz_answer` with null points or a blank note                              | nothing deleted: the given points or note are set to null                                                                    | as the teacher sends it                                                                |
| `quizzes-undo.sql` PART 2                                                        | the five tables and their functions                                                                                          | refuses while any quiz exists; `delete from public.quiz` first is a decision for Colin |
| `quiz-results-undo.sql` PART 2                                                   | the four functions, no row                                                                                                   | always                                                                                 |

Since the apply, `docs/schema.generated.sql`, `migrations/baseline/` (the Database baseline workflow's output) and `types/database.d.ts` have the two files, so a rebuilt database is the database after them: `quizzes.py` takes each scenario's copy back to before the files with the two full undos and goes on from there. Not verified here: the app that calls the functions (Q2b, Q4); MQ2 and MQ3, which build to the contract.

## The factored score (2026111808, 2026-11-18)

One file, `../2026111808_factored_score.sql`, **not applied**. It adds `assessment.students_see_factored` (false on every row), `p_students_see_factored` (last) on `create_assessment`, and replaces `update_assessment`, `get_class_bundle`, `get_gradebook`, `duplicate_assessment` and `student_submit.page`, each guarded by its md5 in `migrations/baseline/function-md5.txt` (Nov 18). `get_class_bundle`'s own comments lose their box-drawing characters (plain hyphens), so the file is plain ASCII; nothing else in it changes.

Run on PostgreSQL 17.11 (embedded-postgres), rebuilt from the repo and proved equal to live (`scripts/db-rebuild.mjs --check`):

- Apply, a second run (no change), undo (`factored-score-undo.sql`: all six fingerprints back to live's, the column gone), apply again: all clean.
- `FV_DB_TEST_APPLY=migrations/2026111808_factored_score.sql npm run test:db`: every security rule test passed.
- As a seeded teacher: create with it on (true) and without (false); update off, on, another key (kept), and a non-boolean (refused, 22023); `get_class_bundle`, `get_gradebook` and Duplicate carry it; `student_submit.page` through a device session as `service_role` sends it on all 12 pieces, true on the one switched on.

Not verified here: PostgREST's schema cache, the edge functions, gradebook-prod itself.
