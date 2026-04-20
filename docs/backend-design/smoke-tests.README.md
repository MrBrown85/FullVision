# FullVision v2 smoke-test pack

`docs/backend-design/smoke-tests.sql` — a single psql-runnable file that
exercises every Phase 1 RPC + Phase 3.2 read + Phase 4.9 imports + key
invariants (RLS isolation, audit semantics, FK cascade + SET NULL,
category weight-cap trigger, seed-template immutability, idempotent
re-imports). Roughly 14 blocks; each block seeds its own teacher + data,
asserts, and rolls back via a sentinel-exception subtransaction so the
script exits cleanly under `ON_ERROR_STOP=1`.

## Local invocation

Against `gradebook-prod` directly (safe — every block rolls back):

```bash
SUPABASE_URL=postgresql://postgres.novsfeqjhbleyyaztmlh:YOUR_DB_PASSWORD@aws-0-ca-central-1.pooler.supabase.com:6543/postgres
psql "$SUPABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f docs/backend-design/smoke-tests.sql
```

Against a Supabase branch (recommended before cutting a release):

```bash
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/backend-design/smoke-tests.sql
```

Against a locally-shadowed copy (`supabase db start` + `supabase db reset`):

```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f docs/backend-design/smoke-tests.sql
```

Expected output — one `[n/14]` line per block, then
`=== all 14 smoke blocks passed ===`. Exit code 0.

## CI wiring (sketch)

Drop this file into `.github/workflows/smoke.yml` once the push embargo
lifts and budget allows. It runs against a throwaway Supabase branch so
`gradebook-prod` is never modified beyond rolled-back smokes.

```yaml
name: smoke
on: [pull_request, workflow_dispatch]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install psql
        run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - name: Run smoke pack
        env:
          DB_URL: ${{ secrets.FV_GRADEBOOK_PROD_DB_URL }}
        run: |
          psql "$DB_URL" -v ON_ERROR_STOP=1 \
            -f docs/backend-design/smoke-tests.sql
```

`FV_GRADEBOOK_PROD_DB_URL` should be the session-mode pooler URL with the
`service_role` password so RLS helpers can impersonate arbitrary teachers
via `set_config('request.jwt.claim.sub', …)`.

## Design

Every block follows the same pattern:

```sql
do $$
declare
    _uid uuid := gen_random_uuid();
    …fixtures…
    _ok boolean;   -- declared here so negative-path catches can set it
begin
  begin
    …seed teacher + fixtures…
    …call RPC under test…
    assert … ;
    raise exception 'ROLLBACK_SMOKE_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
  end;
end $$;
```

The inner `begin/exception` is a PL/pgSQL subtransaction: on exit it rolls
back everything the block did. The sentinel `ROLLBACK_SMOKE_OK` is swallowed
by the handler so `psql` never sees an error and the exit code stays 0.
Anything that isn't the sentinel re-raises and fails the build, which is
what we want.

## Coverage

| Block | Area                                        | Key invariants                                      |
|-------|---------------------------------------------|-----------------------------------------------------|
| 1     | Auth / bootstrap (1.1)                      | first-sign-in seeds Welcome Class; soft-delete/restore round-trip |
| 2     | Course CRUD (1.2)                           | create (plain + wizard), update via jsonb patch, archive, duplicate, delete |
| 3     | Category / Module / Rubric (1.3)            | weight-cap trigger rejects >100; rubric composite diff (insert/update/delete criteria + tag links) |
| 4     | Learning map (1.4)                          | reorder_*; **competency_group SET NULL preserves section.course_id** (the FK column-list fix) |
| 5     | Student + Enrollment + CSV import (1.5)     | update via jsonb patches; import_roster_csv matches by SN→email→name and reactivates withdrawn enrollments |
| 6     | Assessment CRUD (1.6)                       | duplicate copies tags; save_collab rejects invalid modes |
| 7     | Scoring + score_audit (1.7)                 | diff-only audit (no-op doesn't write); changed_by = auth.uid(); upsert_tag_score rejects rubric assessments |
| 8     | Observation + Template (1.8)                | seed templates immutable (update + delete both rejected); observation delete cascades joins |
| 9     | Student records (1.9)                       | reflection 1..5 guard; section_override 1..4 guard; attendance same-day overwrite |
| 10    | Term rating (1.10)                          | composite save emits ≥6 audit rows; partial edit preserves unchanged fields; term + rating-range guards |
| 11    | ReportConfig + preferences (1.11)           | `preset='custom'` accepted by CHECK; `apply_report_preset` rejects `custom`; toggle_report_block flips preset |
| 12    | Retention cleanup (1.12)                    | stale soft-deleted teacher purged (cascade); >2yr audit purged; fresh rows survive |
| 13    | Imports (4.9)                               | Teams creates course/students/assessments; JSON restore 20 sections; idempotent re-run |
| 14    | Read paths + RLS cross-tenant               | get_gradebook, get_student_profile, list_teacher_courses; Teacher B sees zero of A's data and RPCs raise |

## Adding a new smoke

1. Copy the template from any block in the file.
2. Declare `_ok boolean` in the outer `declare` list if you use the negative-path catch.
3. Use random UUIDs for every fixture id (`gen_random_uuid()`) to avoid cross-block collisions in case a future change removes the sentinel rollback.
4. End with `raise exception 'ROLLBACK_SMOKE_OK';` inside the inner `begin`.
5. Bump the block counter and `\echo` header.

## Why not pgTAP?

pgTAP would give nicer output (test counts, tap-compatible result streams)
but requires the `pgtap` extension on the target database. Supabase allows
it but not by default, and installing it on a prod-equivalent branch means
one more migration to manage. The sentinel-exception pattern works on every
vanilla Postgres 15+ without any extension and exits with a clean code,
which is all a CI pipeline needs.

If we grow past ~30 blocks and need the tap output, pgTAP becomes the
better trade-off. For now, 14 blocks is fine.
