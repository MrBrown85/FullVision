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
