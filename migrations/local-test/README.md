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
