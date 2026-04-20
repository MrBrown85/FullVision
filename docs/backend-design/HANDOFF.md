# FullVision v2 — Rebuild Handoff

**Purpose:** single source of truth for multi-session, multi-context-window continuation of the v2 rebuild. Each Claude run reads this, does the next task, updates this file, stops. The user just re-runs the same prompt.

**Prompt to repeat in each new session** (cold start — no prior context):

```
You are continuing the FullVision v2 rebuild. This is a long-running multi-session effort coordinated through a handoff doc.

Read docs/backend-design/HANDOFF.md in full. It contains: ground truth, safety gates, what's done, the active work queue, and the conventions you must follow.

Then:
1. Pick the top-most unchecked task in the Active work queue.
2. Execute it within the Safety gates (stop and ask if you hit one).
3. When done, tick the box and append a line to the Activity log.
4. Stop and return control — do not batch into the next task.

Do not invent model/effort choices; I've already set them per the table at the top of the doc.
```

Shorter version if you want to save tokens on a warm context:

```
Read docs/backend-design/HANDOFF.md and continue.
```

**Recommended model + effort per phase** (don't use Opus 1M + Extra high by default — it burns weekly quota fast):

| Phase | Model | Effort |
|---|---|---|
| 1 (write-path RPCs — mechanical) | Sonnet 4.6 | Medium |
| 2 (git hygiene — trivial) | Haiku 4.5 | Low |
| 3 (minimal client port — per file) | Sonnet 4.6 | High |
| 4 (data.js rewrite — domain logic) | Opus 4.7 (standard, NOT 1M) | High |
| Stuck / novel bug | Opus 4.7 + Extra high | one-off |

Set via `/model` and `/effort` before each session. Standard 200k context is enough — HANDOFF is designed to keep each session small.

---

## Prime directive

You are continuing an ongoing rebuild. **Read this whole file before touching anything.** Then:

1. Pick the next unchecked item from **Active work queue** (top-most unchecked line is next).
2. Execute it autonomously, **respecting the Safety gates** (below).
3. When done, check the box (`[x]`), append a one-line entry to the **Activity log** at the bottom, commit any artifact updates alongside the migration/code change.
4. Stop (return to user) if:
   - you hit a Safety gate,
   - the next task is blocked by user input,
   - you discover a new correctness issue that reshapes the plan — record it in **Discovered gaps** and stop.

**Do NOT** batch multiple phases silently. One phase, then stop and let the user re-invoke. This keeps context-window growth bounded.

---

## Ground truth

| Fact | Value |
|---|---|
| Supabase project ref | `novsfeqjhbleyyaztmlh` (name: `gradebook-prod`, ca-central-1, Postgres 17) |
| Org | `MrBrown85's Org` (`zvqlrjxkzxeidhrnqgny`) |
| **Design worktree (this repo, read-only charter)** | `/Users/colinbrown/Documents/fullvision-backend-design` |
| **Main FullVision repo (write target for client port)** | `/Users/colinbrown/Documents/FullVision` |
| Legacy (reference-only) | `/Users/colinbrown/Documents/Projects/FullVision -- Legacy` |
| Main repo branch at last touch | `docs-cleanup-redundant-stale` (NOT `main`; has 17 uncommitted changes) |
| User has **no budget** for new Supabase projects | Reuse `gradebook-prod`. Do NOT create new projects or paid resources. |
| User owns domain | `fullvision.ca` (+ `fullvision.netlify.com` fallback). DNS changes are user-only. |

### Reading order for first-time context load

1. [CLAUDE.md](../../CLAUDE.md) — charter, hard rules.
2. This file.
3. [DECISIONS.md](DECISIONS.md) — every answered question, do not relitigate.
4. [erd.md](erd.md) — live schema (source of truth).
5. [write-paths.md](write-paths.md) — Pass B RPC specs (what to implement next).
6. [read-paths.md](read-paths.md) — Pass D computations.
7. [auth-lifecycle.md](auth-lifecycle.md) — Pass C flows.
8. [schema.sql](schema.sql), [rls-policies.sql](rls-policies.sql), [read-paths.sql](read-paths.sql) — what's deployed.

---

## Working mode (as of 2026-04-19 evening)

**Local-only until the user pushes.** The user is out of Netlify build credits and has asked that no further work be pushed to `origin` — every push triggers a Netlify deploy and burns minutes. Until the user explicitly says "push" again:

- Do **not** run `git push` on any branch in the main FullVision repo.
- Do **not** run `gh pr create` / `gh pr edit` / any command that changes remote state on GitHub.
- Do **not** update PRs #75 or #76 from the CLI — they stay frozen at their last pushed commit.
- Commits on `rebuild-v2` (and the design repo's `design/backend-v2`) are fine and expected — just keep them local.
- Supabase migrations on `gradebook-prod` are unaffected (free tier, no Netlify involvement).

The user plans to push early next week. When they do, the accumulated local commits on `rebuild-v2` will update PR #76 in one batch.

## Safety gates (NEVER proceed without explicit user approval)

Stop and ask if the next step requires any of these:

- **Destructive SQL on `gradebook-prod`**: `DROP`, `TRUNCATE`, `DELETE without WHERE`, wiping schemas. One-time approvals do not extend; each new destruction needs its own "yes."
- **Git actions on the main FullVision repo that rewrite state**: tagging, force-push, reset --hard, discarding uncommitted work, `git add -A` when untracked files might be sensitive, committing to a branch the user didn't specify.
- **Creating paid Supabase resources** (new projects, upgraded tiers) — blocked absolutely.
- **DNS / SMTP / email sends / PR opens / Slack messages** — all user-executed only.
- **Modifying files across many directories of the main repo in one shot** — always do one narrow slice, verify, stop. User memory says "Verify UI in Demo Mode" for any UI change; Claude cannot do manual UI verification autonomously.

If the user said "yes" to one action in a past session, **do not** assume it extends. Re-confirm per action.

---

## What's already done (as of 2026-04-19)

**Design artifacts (complete, in this worktree):**
- ERD (Pass A), Write paths (Pass B), Auth (Pass C), Read paths (Pass D), Decisions, Offline-sync stub, Spec-vs-UI diff.
- `schema.sql` — v2 schema with composite FKs, audit tables, FK covering indexes, category weight-cap trigger, role grants.
- `rls-policies.sql` — 4 helper fns + 39 RLS policies; auth.uid() wrapped in subselect per Supabase linter 0003.
- `read-paths.sql` — 11 computation primitives + 2 read RPCs (`get_gradebook`, `get_student_profile`).

**Live state on `gradebook-prod`:**
- Legacy schema (old `public`, `academics`, `assessment`, `identity`, `integration`, `observation`, `projection`, `reporting`) was **wiped and replaced** with v2 (user authorized). Zero production data was preserved.
- 13 v2 migrations applied in order:
  1. `fullvision_v2_reset_public_schema`
  2. `fullvision_v2_schema`
  3. `fullvision_v2_rls_policies`
  4. `fullvision_v2_read_path_primitives`
  5. `fullvision_v2_fix_audit_changed_by_nullable`
  6. `fullvision_v2_lock_function_search_paths`
  7. `fullvision_v2_drop_legacy_schemas`
  8. `fullvision_v2_perf_rls_initplan_and_fk_indexes`
  9. `fullvision_v2_category_weight_cap_trigger`
  10. `fullvision_v2_fix_section_proficiency_mostrecent_ambiguity`
  11. `fullvision_v2_fix_decaying_avg_ambiguity`
  12. `fullvision_v2_grant_table_privileges`
  13. `fullvision_v2_write_path_auth_bootstrap` ← Phase 1.1
  14. `fullvision_v2_write_path_course_crud` ← Phase 1.2
- 39 tables, all RLS-enabled with ≥1 policy.
- 25 functions, all with `search_path=public` locked.
- Security advisor: **0 lints.** Performance advisor: 0 actionable.

**Verified via smoke tests (today):**
- §1.1 assessment_overall: no-score → `not_yet_graded`; proficiency value → `value`; EXC → `excluded`; NS → `0`; points 40/50 → `3.2`.
- §1.2 rubric tag derivation: multi-criterion-linking average correct.
- Rubric overall weighted-by-criterion: `(1·3 + 2·4)/3 = 3.67`.
- §1.5 calc_methods (proven with [2,3,4] contributions): `average=3.0`, `median=3.0`, `highest=4.0`, `mostRecent=4.0` (by max date), `mode` non-null, `decayingAvg(dw=0.5)=3.25`.
- Cascade deletes: `delete course` collapses enrollment + assessment + score + section + tag.
- Category weight-cap trigger: rejects INSERT and UPDATE that would push sum > 100.
- **RLS cross-tenant isolation: 10 assertions passed.** Teacher A cannot SELECT/INSERT/UPDATE/DELETE B's rows; WITH CHECK rejects cross-teacher inserts.

**Main FullVision repo: UNTOUCHED so far.** No git operations performed there.

---

## Scope reality check (read before Phase 2+)

`shared/data.js` in the main repo is **4,666 lines** and calls ~30 legacy RPCs that do not exist in v2. None of the following exist in `gradebook-prod` anymore:

> `get_teacher_preferences`, `list_teacher_courses`, `save_course_score`, `create_course`, `update_course`, `save_course_policy`, `get_course_policy`, `enroll_student`, `update_enrollment`, `withdraw_enrollment`, `update_student`, `create_assessment`, `update_assessment`, `delete_assessment`, `save_assignment_status`, `list_assignment_statuses`, `create_observation`, `update_observation`, `delete_observation`, `upsert_term_rating`, `list_term_ratings_for_course`, `save_report_config`, `get_report_config`, `get_student_goals`, `list_student_reflections`, `list_section_overrides`, `projection.list_student_flags`, `save_teacher_preferences`, `save_course_score`

Also, direct `.from('scores' | 'students' | 'assessments' | 'observations' | 'teacher_config')` calls hit plural table names that don't exist (v2 is singular: `score`, `student`, `assessment`, `observation`; `teacher_config` was dropped).

**The legacy app is currently broken** (its schema was wiped). No production traffic to protect — zero-risk to reset main-repo client code.

---

## Active work queue

Check the top-most unchecked box; do that task; then update. **One task per session.**

### Phase 1 — Pass B write-path RPCs (server-side, deploy to gradebook-prod)

Author each RPC per [write-paths.md](write-paths.md), deploy as a new migration on `gradebook-prod`, update [write-paths.sql](write-paths.sql) (create this file in this worktree; it's the design-artifact mirror of what got deployed). After each RPC group, run a smoke test and check the box.

RPC inventory is grouped so each box is ~one session of work:

- [x] **1.1 Auth/bootstrap RPCs**: `bootstrap_teacher()` (creates Teacher + TeacherPreference + Welcome-Class seed per Pass C §1.3 + Q45/Q47), `soft_delete_teacher()` (Q29).
- [x] **1.2 Course CRUD RPCs**: `create_course`, `update_course`, `archive_course`, `duplicate_course` (structure-only per Q27), `delete_course`.
- [x] **1.3 Category + Module + Rubric RPCs**: `upsert_category` (per-course weight-cap enforced by trigger already deployed), `delete_category`, `upsert_module`, `delete_module`, `upsert_rubric` (full criteria payload), `delete_rubric`.
- [x] **1.4 Learning map RPCs**: `upsert_subject`, `delete_subject`, `upsert_competency_group`, `delete_competency_group`, `upsert_section`, `delete_section`, `upsert_tag`, `delete_tag`, `reorder_*` family.
- [x] **1.5 Student + Enrollment RPCs**: `create_student_and_enroll`, `update_student`, `update_enrollment`, `withdraw_enrollment`, `reorder_roster`, `bulk_apply_pronouns`, `import_roster_csv`.
- [x] **1.6 Assessment CRUD RPCs**: `create_assessment`, `update_assessment`, `duplicate_assessment`, `delete_assessment`, `save_assessment_tags` (AssessmentTag join).
- [x] **1.7 Scoring RPCs**: `upsert_score` (with ScoreAudit write in same tx per Q28), `upsert_rubric_score`, `upsert_tag_score`, `set_score_status`, `clear_score`, `clear_row_scores`, `clear_column_scores`, `save_score_comment`.
- [x] **1.8 Observation + Template RPCs**: `create_observation`, `update_observation`, `delete_observation`, `upsert_observation_template` (per Q4; seed `is_seed=true` are immutable), `delete_observation_template`.
- [x] **1.9 Student-record RPCs**: `upsert_note`, `delete_note`, `upsert_goal`, `upsert_reflection`, `upsert_section_override`, `clear_section_override`, `bulk_attendance`.
- [x] **1.10 Term rating RPCs**: `upsert_term_rating` (with TermRatingAudit writes per Q28), all join-table updates (strengths, growth, assessment mentions, observation mentions).
- [x] **1.11 ReportConfig + preferences RPCs**: `save_report_config`, `apply_report_preset`, `save_teacher_preferences`.
- [x] **1.12 Cleanup cron (pg_cron Edge Function)**: hard-delete teachers where `deleted_at < now() - interval '30 days'` (Q29), and purge audit rows older than 2 years (Q28).

### Phase 2 — Git hygiene on main repo (needs user OK per Safety gate)

- [x] **2.1** User chose "commit". Committed 27 files on `docs-cleanup-redundant-stale` as `e7f935c` ("Checkpoint: diagrams, inputs inventory, stale-docs cleanup"); added `.playwright-cli/` to .gitignore.
- [x] **2.2** Tagged `legacy-v1` at `main` (commit `c028ec9`, "Merge pull request #73 from MrBrown85/guard-initdata-rpc-calls"). Tag is local only — user pushes to origin when ready.
- [x] **2.3** Created branch `rebuild-v2` from `main` (same commit as `legacy-v1` tag). Local only; not yet pushed.

### Phase 3 — Minimal client port (main repo, one file at a time)

Each task here edits one file in `/Users/colinbrown/Documents/FullVision/`, then stops for the user to verify in Demo Mode. Do NOT batch.

- [x] **3.1** `shared/supabase.js` audited on branch `rebuild-v2`: no references to any dropped schema, no legacy RPC calls, no `.from('plural_name')` table calls. Pure auth + session + idle-timeout code; fully v2-compatible. No edits needed.
- [x] **3.2** Identified boot path as `initAllCourses()` in `shared/data.js` (previously called legacy `get_teacher_preferences` + `list_teacher_courses`). Replaced with v2 `bootstrap_teacher(email, display_name)` + new v2-shaped `list_teacher_courses()` RPC (migration `fullvision_v2_read_path_list_teacher_courses`). `_canonicalCoursesToBlob` remapped to v2 columns; policy fields now arrive with the list (lazy `get_course_policy` retired). Commits `a9cdb2b` + `e9f84ce` on `rebuild-v2`. **Pending user verification in Demo Mode.**
- [x] **3.3** Short-circuited `_doInitData()` behind `window.__V2_GRADEBOOK_READY` — populates empty-but-valid blobs for all 13 course-scoped fields so the app shell renders without calling any of the 12 dropped per-course legacy RPCs. Also gated the `gb-retry-queue` replay behind `window.__V2_WRITE_PATHS_READY` so stale queue entries don't spam errors against dropped tables. Commit `62e8406` on `rebuild-v2` (local only; no push). Demo Mode unaffected. **Pending user verification in Demo Mode + a signed-in v2 account.**
- [x] **3.4** Ported `_doInitData()` to call `get_gradebook(p_course_id)`; added `_v2GradebookToCache(cid, payload)` mapper that populates `_cache.students[cid]` (enrollment-id-keyed, app shape), `_cache.assessments[cid]` (v2 shape), and stashes the raw payload on `_cache.v2Gradebook[cid]` for later cell-rendering passes. Default-on via `window.__V2_GRADEBOOK_READY`. Legacy per-course fan-out in `_doInitData` now unreachable (left in place for reference until Phase 4 ports subsume each section). Smoke-tested against `gradebook-prod`: `get_gradebook` returns expected shape (1 student + 1 assessment + cell score = 3.5). Commit `1c5bfe9` on `rebuild-v2` (local only). **Pending Demo-Mode + signed-in v2 verification.**
- [x] **3.5** Ported `_persistScoreToCanonical` to dispatch over v2 RPCs: `upsert_tag_score` (non-rubric), `upsert_rubric_score` (has_rubric, tid treated as criterion_id), `save_score_comment`. Added `window.upsertCellScore(cid, enrollmentId, assessmentId, value)` → `upsert_score` (overall per-cell) and `window.setCellStatus(enrollmentId, assessmentId, status)` → `set_score_status`. Dispatch reads `has_rubric` from `_cache.v2Gradebook[cid].assessments[aid]` populated in 3.4. Commit `584c832` on `rebuild-v2` (local only). gradebook-prod smoke confirms all 5 RPCs land + rubric-assessment rejection works. **Pending Demo-Mode verification.**

### Phase 4 — Incremental data.js rewrite

Each task = one functional area (students, assessments, observations, term ratings, reports, learning map, preferences). Order by dependency. One per session, user-verify in Demo Mode after each.

- [x] **4.1** Students + enrollment CRUD. Ported `_canonicalEnrollStudent` (`create_student_and_enroll`, passes through existing personId), `_canonicalUpdateStudent` (`update_student` jsonb patch), `_canonicalUpdateEnrollment` (`update_enrollment` jsonb patch w/ designations + roster_position + is_flagged), `_canonicalWithdrawEnrollment` (`withdraw_enrollment`). Added `window.reorderRoster`, `window.bulkApplyPronouns`, `window.importRosterCsv`, `window.setEnrollmentFlag`. Commit `13b3403` on `rebuild-v2` (local only). gradebook-prod smoke: all 8 dispatch paths pass. **Pending Demo-Mode verification.**
- [ ] **4.2** Assessment CRUD
- [ ] **4.3** Score + rubric score + tag score entry
- [ ] **4.4** Observations + templates
- [ ] **4.5** Learning map (subjects/groups/sections/tags/modules/rubrics)
- [ ] **4.6** Student profile view (`get_student_profile` + goals/reflections/overrides)
- [ ] **4.7** Term rating editor
- [ ] **4.8** Report preview
- [ ] **4.9** Import flows (CSV roster, JSON, Teams file)
- [ ] **4.10** Offline write queue per [offline-sync.md](offline-sync.md) (separate workstream; do last).

### Phase 5 — Polish

- [ ] **5.1** Demo-seed JSON per DECISIONS.md Q43 (Grade 8 Humanities, 20–30 students, ~8 assessments). Shared between demo mode and Welcome Class (Q47).
- [ ] **5.2** Custom SMTP via `fullvision.ca` (Q6). **DNS is user-only.**
- [ ] **5.3** pgTAP or smoke-test pack runnable as CI check.

---

## Discovered gaps (append as found)

When Claude finds a real defect mid-session that reshapes the plan, add a bullet here describing it and the remediation. Don't silently fix and continue.

- *(none recorded yet in this file; earlier bugs — mostRecent ambiguity, decaying_avg ambiguity, missing GRANTs — were all fixed on 2026-04-19 and recorded in the Activity log.)*
- **2026-04-19 (Phase 1.11):** report_config.preset CHECK was `in (brief,standard,detailed)` but write-paths §14 requires `'custom'` for manual block toggles. Fixed via migration `fullvision_v2_fix_report_config_add_custom_preset`; schema.sql updated.
- **2026-04-19 (Phase 1.4):** `section_competency_group_fk` used `ON DELETE SET NULL` without a column list, so deleting a `competency_group` tried to null `section.course_id` (NOT NULL). Fixed via migration `fullvision_v2_fix_section_competency_group_fk_set_null` using PG15+ `SET NULL (competency_group_id)`. schema.sql updated to match.

---

## Conventions Claude must follow

- **Never use `mcp__...__apply_migration` with `DROP`, `TRUNCATE`, or anything that removes data** without an explicit per-action user approval.
- **All new DB objects go through `apply_migration`** (not `execute_sql`). Migration names start with `fullvision_v2_`.
- **Every new function must set `search_path = public`** (Supabase linter 0011).
- **Every new table gets RLS enabled + policy** in the same migration (linter guards).
- **Every new FK gets a covering index** unless it's the leading column of the PK (linter 0001).
- **Audit writes go inside the same transaction** as the parent write (Q28).
- **Test each new RPC with a DO-block smoke test** before checking its box. The smoke test must roll back its own seed (via sentinel exception at the end).
- **Update the matching design artifact** (`schema.sql` / `rls-policies.sql` / `read-paths.sql` / new `write-paths.sql`) in this worktree to mirror what's deployed.
- **No AI references in commits / branches / file comments** (user memory: `feedback_no_ai_references.md`). Do not add `Co-Authored-By: Claude` or similar.
- **Match existing UI naming where the UI already expects it** (per folded-in rule in CLAUDE.md — the clean-room "ignore RPC names" rule was retired post-fold).

---

## Activity log (append-only)

Claude appends one line per completed task. Format: `YYYY-MM-DD | session-<n> | task-id | short note`.

- `2026-04-19 | session-1 | v2-bootstrap | 12 migrations deployed, schema + RLS + read-path primitives live on gradebook-prod; 0 security lints`
- `2026-04-19 | session-1 | audit | smoke tests passed for §1.1, rubric path, all 6 calc_methods, cascade deletes, weight-cap trigger, RLS cross-tenant (10 assertions)`
- `2026-04-19 | session-1 | handoff | this document created`

- `2026-04-19 | session-2 | 1.1 | deployed migration fullvision_v2_write_path_auth_bootstrap: bootstrap_teacher, soft_delete_teacher, restore_teacher; 7-assertion smoke test passed; write-paths.sql created`
- `2026-04-19 | session-2 | docs | updated HANDOFF What's-already-done: 13 migrations, 20 functions`
- `2026-04-19 | session-2 | 1.2 | deployed migration fullvision_v2_write_path_course_crud: create_course (plain+wizard), update_course (jsonb patch), archive_course, duplicate_course (full structure remap), delete_course; 14-assertion smoke test passed`
- `2026-04-19 | session-3 | 1.3 | deployed migration fullvision_v2_write_path_category_module_rubric: upsert_category/delete_category (weight-cap trigger verified rejects >100), upsert_module/delete_module (assessment.module_id SET NULL confirmed), upsert_rubric (composite criteria+criterion_tag diff with insert/update/delete) / delete_rubric; 13-assertion smoke test passed`
- `2026-04-19 | session-3 | bugfix | found latent schema bug: section_competency_group_fk SET NULL also nulled section.course_id (NOT NULL); deployed migration fullvision_v2_fix_section_competency_group_fk_set_null using PG15+ SET NULL (column_list) form; schema.sql updated`
- `2026-04-19 | session-3 | 1.12 | enabled pg_cron extension; deployed fv_retention_cleanup() SECURITY DEFINER (hard-deletes teachers w/ deleted_at < now() - 30d, purges score_audit + term_rating_audit > 2yr); scheduled daily at 03:17 UTC as cron job 'fv_retention_cleanup_daily'; smoke verified stale teacher purge + stale-audit purge + fresh-row survival`
- `2026-04-19 | session-3 | 4.1 | shared/data.js: ported _canonicalEnrollStudent/UpdateStudent/UpdateEnrollment/WithdrawEnrollment to v2 RPCs; added window helpers reorderRoster, bulkApplyPronouns, importRosterCsv, setEnrollmentFlag. Commit 13b3403 on rebuild-v2 (local). gradebook-prod smoke: 8/8 dispatch paths.`
- `2026-04-19 | session-3 | 3.5 | shared/data.js: _persistScoreToCanonical now dispatches upsert_tag_score / upsert_rubric_score / save_score_comment based on _cache.v2Gradebook[cid].assessments[aid].has_rubric. Added window.upsertCellScore (upsert_score) and window.setCellStatus (set_score_status). Commit 584c832 on rebuild-v2 (local only). gradebook-prod smoke: all 5 RPCs correct + tag_score rejects rubric assessment.`
- `2026-04-19 | session-3 | 3.4 | shared/data.js: _doInitData now calls get_gradebook(p_course_id); added _v2GradebookToCache mapper (students enrollment-id-keyed, assessments v2-shape, raw payload on _cache.v2Gradebook). __V2_GRADEBOOK_READY default ON; empty-shell fallback retained for flag=false. Commit 1c5bfe9 on rebuild-v2 (local only). gradebook-prod smoke: get_gradebook returns expected shape.`
- `2026-04-19 | session-3 | 3.3 | shared/data.js: gated _doInitData's legacy per-course RPC fan-out behind window.__V2_GRADEBOOK_READY (falsy by default); the short-circuit populates empty-but-valid cache blobs for all 13 course-scoped fields. Also gated retry-queue replay behind window.__V2_WRITE_PATHS_READY. Commit 62e8406 on rebuild-v2 (local only).`
- `2026-04-19 | session-3 | 3.2 | deployed read-path RPC list_teacher_courses() (v2-shaped); rewired initAllCourses() in shared/data.js to bootstrap_teacher + list_teacher_courses; _canonicalCoursesToBlob remapped to v2 columns. Commits a9cdb2b + e9f84ce on rebuild-v2; pushed and opened draft PR #76 (https://github.com/MrBrown85/FullVision/pull/76) as umbrella for Phases 3+4. Awaiting Demo-Mode verification.`
- `2026-04-19 | session-3 | 3.1 | audited shared/supabase.js on rebuild-v2 — clean (auth-only, no legacy refs). Pushed docs-cleanup-redundant-stale + rebuild-v2 + legacy-v1 tag to origin; opened PR #75 (https://github.com/MrBrown85/FullVision/pull/75) for the Phase 2.1 checkpoint commit.`
- `2026-04-19 | session-3 | 2.1-2.3 | main FullVision repo: committed 17 pending changes on docs-cleanup-redundant-stale as e7f935c (gitignored .playwright-cli/); tagged legacy-v1 at main (c028ec9); created rebuild-v2 branch from main. Tag/branch are local — user pushes when ready.`
- `2026-04-19 | session-3 | phase-1-complete | all 12 Phase-1 write-path RPC groups landed; no Phase-1 tasks remain. Next unchecked item is Phase 2 (git hygiene) which requires user input per Safety gate — stopping and returning control.`
- `2026-04-19 | session-3 | 1.11 | deployed migrations fullvision_v2_fix_report_config_add_custom_preset + fullvision_v2_write_path_prefs_report: apply_report_preset (validates brief/standard/detailed), save_report_config (custom default), toggle_report_block (flips preset→custom), save_teacher_preferences (partial jsonb patch); smoke passed`
- `2026-04-19 | session-3 | 1.10 | deployed migrations fullvision_v2_write_path_term_rating + fullvision_v2_fix_save_term_rating_dim_audit: save_term_rating composite jsonb payload (parent fields + dimensions + 4 join tables), per-field audit rows via _term_rating_audit_field (SECURITY DEFINER, bypasses audit RLS); smoke passed (first save + edit + partial-update preserves unchanged fields + invalid-rating/invalid-term rejections)`
- `2026-04-19 | session-3 | 1.9 | deployed migration fullvision_v2_write_path_student_records: upsert_note (immutable) / delete_note, upsert_goal / upsert_reflection (1..5 guard) / upsert_section_override (1..4 guard) + clear, bulk_attendance (same-day overwrite); smoke passed`
- `2026-04-19 | session-3 | 1.8 | deployed migration fullvision_v2_write_path_observation: create_observation (+ enrollment/tag/custom_tag joins), update_observation (null array param leaves set alone; empty array wipes), delete_observation, upsert_observation_template (seed-immutable enforced), delete_observation_template (seed-immutable), create_custom_tag; smoke passed (8 assertions + 2 immutability rejections)`
- `2026-04-19 | session-3 | 1.7 | deployed migrations fullvision_v2_write_path_scoring + fullvision_v2_fix_score_audit_security_definer: upsert_score, set_score_status, save_score_comment, upsert_rubric_score, upsert_tag_score (rejects rubric assessments), fill_rubric, clear_score/clear_row_scores/clear_column_scores; _score_audit_diff helper is SECURITY DEFINER to bypass score_audit's read-only RLS (per design: audit writes only via service_role); audit diff-only semantics verified (no-op doesn't write, changed_by = auth.uid()); smoke passed (9 assertions)`
- `2026-04-19 | session-3 | 1.6 | deployed migration fullvision_v2_write_path_assessment_crud: create_assessment (with tag_ids[]), update_assessment (jsonb patch + optional tag replace), duplicate_assessment (copies tags, not scores/observations), delete_assessment, save_assessment_tags, save_collab (validates mode ∈ {none,pairs,groups}); smoke test passed`
- `2026-04-19 | session-3 | 1.5 | deployed migrations fullvision_v2_write_path_student_enrollment + fullvision_v2_fix_import_roster_csv_reenroll: create_student_and_enroll, update_student, update_enrollment (jsonb patch inc. designations/is_flagged/roster_position/withdrawn_at), withdraw_enrollment, reorder_roster, bulk_apply_pronouns, import_roster_csv (match by SN→email→name; reactivates withdrawn enrollments); smoke test (11 assertions) passed`
- `2026-04-19 | session-3 | 1.4 | deployed migration fullvision_v2_write_path_learning_map: upsert/delete for subject, competency_group, section (auto-denormalizes course_id from subject), tag; reorder_{subjects,competency_groups,sections,tags,modules}; smoke test passed (subject/group/section/tag CRUD, display_order auto-append, reorder, cascades, group-delete preserves section.course_id)`

*(next session, keep appending.)*
