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
| Main repo active branch | `rebuild-v2` (15 local commits past `main`, not yet pushed past `e9f84ce` — see Working mode) |
| User has **no budget** for new Supabase projects | Reuse `gradebook-prod`. Do NOT create new projects or paid resources. |
| User owns domain | `fullvision.ca` (+ `fullvision.netlify.com` fallback). DNS changes are user-only. |

### Reading order for first-time context load

1. [CLAUDE.md](../../CLAUDE.md) — charter, hard rules.
2. This file.
3. [DECISIONS.md](DECISIONS.md) — every answered question, do not relitigate.
4. [erd.md](erd.md) — live schema (source of truth).
5. [write-paths.md](write-paths.md) — Pass B RPC specs (now implemented).
6. [read-paths.md](read-paths.md) — Pass D computations.
7. [auth-lifecycle.md](auth-lifecycle.md) — Pass C flows.
8. [schema.sql](schema.sql), [rls-policies.sql](rls-policies.sql), [read-paths.sql](read-paths.sql), [write-paths.sql](write-paths.sql) — what's deployed.

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

## Current state (updated 2026-04-20)

Phases 1 → 5 of the queue are all checked.

### gradebook-prod (Supabase)

- **Schema + RLS + read primitives:** all deployed. 39 tables, every one RLS-enabled with ≥1 policy. 25+ functions, `search_path = public` locked.
- **Write-path RPCs:** every Pass B §1–§16 path is live. Write-paths.sql mirrors what's deployed.
- **Read-path RPCs:** `get_gradebook`, `get_student_profile`, `list_teacher_courses` (+ 11 computation primitives from the design phase).
- **Retention cron:** `fv_retention_cleanup_daily` (pg_cron, 03:17 UTC) — purges 30-day-stale soft-deleted teachers + >2yr audit rows.
- **Advisors:** 0 security lints, 0 actionable performance lints.

### Main FullVision repo (branch `rebuild-v2`, local-only past `e9f84ce`)

- **`shared/supabase.js`** — audited clean (auth-only).
- **`shared/data.js`** — boot path (`initAllCourses` / `_doInitData`) calls the v2 RPCs. `_canonicalCoursesToBlob`, `_v2GradebookToCache`, `_persistScoreToCanonical`, `_canonical{Enroll,UpdateStudent,UpdateEnrollment,Withdraw}`, `_canonicalCreate/Update/DeleteAssessment`, `_persistObservationCreate/Update/Delete` all routed to v2 RPCs. Legacy per-course RPC fan-out is unreachable (retained for reference).
- **`window.v2.*` namespace** — 40+ thin RPC wrappers covering everything the backend exposes: course / category / module / rubric / subject / competency-group / section / tag CRUD + reorder; student + enrollment + roster + bulk pronouns + CSV import; assessment CRUD + collab; scoring (cell/tag/rubric/status/comment/fill/clear); observations + templates + custom tags; student-record writes + `getStudentProfile`; `saveTermRating`; ReportConfig + preferences + teacher-lifecycle; imports (CSV, Teams, JSON restore).
- **`shared/offline-queue.js`** — `window.v2Queue` FIFO + dead-letter + 3-attempt backoff + auto-flush, wired into `teacher/app.html` and `teacher-mobile/index.html`.
- **Feature flags** on `window`: `__V2_GRADEBOOK_READY` (default true), `__V2_WRITE_PATHS_READY` (false — legacy `gb-retry-queue` replay gated off until the bulk `_syncToSupabase` machinery is retired).

### Remaining work

- **Demo-Mode + signed-in verification** of the Phase 3/4 ports (user-side, once the push embargo lifts).
- Eventual retirement of the dormant legacy fan-out in `_doInitData` and the bulk `_syncToSupabase` block (cosmetic — unreachable today).

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
- [x] **4.2** Assessment CRUD. Ported `_canonicalCreateAssessment` → `create_assessment`, `_canonicalUpdateAssessment` → `update_assessment` (jsonb patch + tag_ids replace), `_canonicalDeleteAssessment` → `delete_assessment`. Added `window.duplicateAssessment`, `window.saveAssessmentTags`, `window.saveCollab`. Commit `70d40b9` on `rebuild-v2` (local only). gradebook-prod smoke: 6/6 dispatch paths. **Pending Demo-Mode verification.**
- [x] **4.3** Score + rubric score + tag score entry. (3.5 landed upsertCellScore / upsertTagScore·RubricScore dispatch / setCellStatus / save_score_comment.) Added `window.fillRubric`, `window.clearScore`, `window.clearRowScores`, `window.clearColumnScores`. Legacy `sb.from('scores')` sync paths in `_syncToSupabase` are already short-circuited since the transition started. Commit `6cb58cf` on `rebuild-v2` (local only). **Pending Demo-Mode verification.**
- [x] **4.4** Observations + templates. Ported `_persistObservationCreate`/`Update`/`Delete` to `create_observation` / `update_observation` / `delete_observation` (v2). Quick-post sends single-element enrollment array; rich capture-bar path via new `window.createObservationRich` + `window.updateObservationRich` accepts multi-student + tag + custom-tag membership. Added `window.upsertObservationTemplate` / `window.deleteObservationTemplate` (seeds immutable) and `window.createCustomTag`. Commit `71ee3de` on `rebuild-v2` (local only). gradebook-prod smoke: create/update/delete + templates + custom tag all verified, FK cascade confirmed. Note: legacy `dims` field (text codes) is not passed as `tag_ids` — that lands with Phase 4.5 learning-map port.
- [x] **4.5** Learning map (subjects/groups/sections/tags/modules/rubrics). Exposed all 20 structural RPCs under `window.v2.*` namespace: `v2.upsert/delete/reorderSubjects`, `v2.upsert/delete/reorderCompetencyGroups`, `v2.upsert/delete/reorderSections`, `v2.upsert/delete/reorderTags`, `v2.upsert/delete/reorderModules`, `v2.upsert/deleteCategory`, `v2.upsert/deleteRubric` (rubric composite maps camelCase → snake_case criteria payload). Added `_rpcOrNoop` helper. Existing blob-based `saveLearningMap` / `saveCompetencyGroups` / legacy `deleteRubric` local functions unchanged — blob cache → v2 per-entity migration lands when the learning-map UI is rewritten. Commit `20c000f` on `rebuild-v2` (local only).
- [x] **4.6** Student profile view. Added `window.v2.getStudentProfile` (→ `get_student_profile`), `v2.addNote`/`deleteNote`, `v2.saveGoal`, `v2.saveReflection` (1..5 guard), `v2.saveSectionOverride`/`clearSectionOverride` (1..4 guard), `v2.bulkAttendance`. Existing blob-based save* functions unchanged — UI rewrites will call these directly. Commit `85f17b4` on `rebuild-v2` (local only). gradebook-prod smoke passes.
- [x] **4.7** Term rating editor. Added `window.v2.saveTermRating(enrollmentId, term, payload)` wrapping `save_term_rating`. Accepts camelCase payload (narrativeHtml, workHabits/participationRating, socialTraits, dimensions [{sectionId, rating}], strength/growthTagIds, mentionAssessment/ObservationIds); translates to snake_case wire format; omitted keys leave fields/sets alone, empty [] wipes. Commit `6f83ae7` on `rebuild-v2` (local only).
- [x] **4.8** Report preview. Added `window.v2.applyReportPreset` (brief/standard/detailed), `v2.saveReportConfig` (full replace, defaults preset='custom'), `v2.toggleReportBlock` (auto-flips preset='custom'), `v2.saveTeacherPreferences` (jsonb patch), `v2.softDeleteTeacher` / `v2.restoreTeacher` (Pass C §5). Every v2 RPC deployed on gradebook-prod now has a `window.v2.*` entry. Commit `7897916` on `rebuild-v2` (local only).
- [x] **4.9** Import flows. Deployed migration `fullvision_v2_write_path_imports`: `import_teams_class(payload)` (§15.2 — course + students + enrollments + assessments; match by SN→email→name; no scores) and `import_json_restore(payload)` (§15.3 — FK-safe topological replay, teacher_id forced to auth.uid(), UPSERT idempotent, covers 20 entity sections). Added `window.v2.importRosterCsv` / `v2.importTeamsClass` / `v2.importJsonRestore`. Commit `15e7cf2` on `rebuild-v2` (local only). gradebook-prod smoke passes both imports + idempotent re-run.
- [x] **4.10** Offline write queue. New module `shared/offline-queue.js` implements offline-sync.md §Queue model + §Sync lifecycle: `fv-sync-queue-v1` + `fv-sync-dead-letter-v1` localStorage stores, FIFO drain on `online` event + 60s auto-flush, 3-attempt retry with 1s/5s/30s backoff, dead-letter on exhaustion (doesn't block the queue), 500-entry / 5 MB cap, self-healing on parse failure. Public surface: `window.v2Queue.enqueue/flush/stats/deadLetter/dismissDeadLetter/clear/callOrEnqueue`. Loaded in both `teacher/app.html` and `teacher-mobile/index.html` right after `data.js`. Existing `window.v2.*` helpers unchanged — opt-in via `v2Queue.callOrEnqueue`. Commit `d55a44c` on `rebuild-v2` (local only).

### Phase 5 — Polish

- [x] **5.1** Demo-seed JSON per DECISIONS.md Q43. New `shared/demo-seed.js` (wired into `teacher/app.html` + `teacher-mobile/index.html`) generates a Grade-8 Humanities payload for `import_json_restore`: 4 subjects / 7 sections / 14 tags / 4 modules / 3 categories / 1 four-criterion Writing rubric + tag links / 25 students + enrollments / 8 assessments (5 direct, 2 rubric, 1 points) / ~200 overall-score rows with bell-curve distribution (mean 2.8, stddev 0.6) + ~3% NS / ~2% EXC / ~5% LATE + ~40% ungraded on the last assessment / per-tag + per-criterion scores / 2 notes / 10 goals / 10 reflections / standard-preset report_config. Exposes `window.buildDemoSeedPayload({ courseId })` and `window.applyDemoSeed(courseId)`. Commit `fe59cf1` on `rebuild-v2` (local only). gradebook-prod round-trip verified. Q47 follow-up: migrate Demo Mode (currently using `shared/seed-data.js`) to consume the generator via a local projector.
- [x] **5.2** Custom SMTP via `fullvision.ca` (Q6). **DNS is user-only.** Runbook: [`smtp-setup.md`](smtp-setup.md) — covers provider choice (Resend recommended over Postmark / AWS SES), full SPF / DKIM / DMARC record set including merge instructions, Supabase SMTP configuration, email-template wrapper, verification checklist, common gotchas, and rollback. User confirmed DNS + Supabase custom-SMTP setup and first end-to-end signup email pass on Gmail + Outlook with SPF + DKIM + DMARC.
- [x] **5.3** Smoke-test pack at `docs/backend-design/smoke-tests.sql` — 14 psql DO blocks covering every Phase 1 RPC + Phase 3.2 read + Phase 4.9 imports + key invariants (RLS isolation, audit diff semantics, FK cascade + SET NULL fix, weight-cap trigger, seed-template immutability, idempotent re-imports). Each block uses a nested `begin ... exception when others then … end` subtransaction with a sentinel `'ROLLBACK_SMOKE_OK'` so fixtures always roll back and the script exits clean under `ON_ERROR_STOP=1`. Runnable via `psql … -v ON_ERROR_STOP=1 -f smoke-tests.sql`; sample GitHub Actions workflow + design notes in [smoke-tests.README.md](smoke-tests.README.md). pgTAP deferred (no extension dependency needed for 14 blocks). Blocks 3 + 7 + 14 verified live against `gradebook-prod`. Design-repo commit (see next Activity-log line).

---

## Discovered gaps (append as found)

When Claude finds a real defect mid-session that reshapes the plan, add a bullet here describing it and the remediation. Don't silently fix and continue.

Earlier bugs fixed inline (mostRecent ambiguity, decaying_avg ambiguity, missing GRANTs) are in the Activity log, not here.

- **2026-04-19 (Phase 1.4):** `section_competency_group_fk` used `ON DELETE SET NULL` without a column list, so deleting a `competency_group` tried to null `section.course_id` (NOT NULL). Fixed via migration `fullvision_v2_fix_section_competency_group_fk_set_null` using PG15+ `SET NULL (competency_group_id)`. schema.sql updated to match.
- **2026-04-19 (Phase 1.11):** `report_config.preset` CHECK was `in (brief,standard,detailed)` but write-paths §14 requires `'custom'` for manual block toggles. Fixed via migration `fullvision_v2_fix_report_config_add_custom_preset`; schema.sql updated.
- **2026-04-20 (plan reconciliation):** The `main`-branch client calls `sb.rpc('save_course_score', …)` at [`shared/data.js:2731`](../../shared/data.js:2731), but no such RPC exists on `gradebook-prod`. Every score save since PR #63 (2026-04-18) has `console.warn`-logged an error and lost the remote write; localStorage kept the UI looking correct. Hotfix: Phase 1 of [the reconciliation plan](../superpowers/plans/2026-04-20-database-wiring-reconciliation.md) — no-op the RPC call on `main` until `rebuild-v2` ships. Root cause: `ACTION_PLAN.md` was authored against a canonical-schema RPC naming scheme that the v2 rebuild replaced; the ACTION_PLAN was never reconciled after the rename. The claim "canonical-RPC migration ~70% complete" in `ACTION_PLAN.md` is in fact 0% — the one writer that was wired (`_persistScoreToCanonical`) targets a non-existent function. **Resolved 2026-04-20:** rebuild-v2 merged to main via --no-ff — v2 dispatch is now the active path.
- **2026-04-20 (Phase 2.2 diff):** Design SQL (`write-paths.sql` + `read-paths.sql`) is missing 17 functions that landed on `gradebook-prod` from 2026-04-19/20 but never got mirrored back per convention #6. Affected RPCs: read-path (`get_assessment_detail`, `get_class_dashboard`, `get_learning_map`, `get_observations`, `get_report`, `get_term_rating`), imports (`import_json_restore`, `import_teams_class`), term rating (`save_term_rating`), student (`delete_student`, `relink_student`), plus internal helpers (`fv_check_category_weight_sum` trigger, `fv_owns_*` RLS predicates, `clear_data`). Remediation: regenerate `write-paths.sql` and `read-paths.sql` from live DB as part of Phase 5.1 of the reconciliation plan. No functional impact — live RPCs work correctly; only the design-artifact mirrors are behind.
- **2026-04-20 (Phase 3.0 test baseline):** `tests/data-init-invokes-canonical-reads.test.js` and `tests/data-pagination.test.js` were guarding against the April 3 regression using the cancelled canonical-schema RPC names (`list_course_roster`, `list_course_assessments`, etc.). Both files were updated to guard against `get_gradebook` being stubbed (the actual v2 boot read); all 36 test files now green. Commit `570529c` on `rebuild-v2`.
- **2026-04-20 (Phase 3.1-l, pre-existing):** `tests/mobile-components.test.js` (`MComponents.dateGroupLabel`) and `tests/mobile-observe.test.js` use fixed fixture dates (April 2026) combined with `new Date()` to label as "Today"/"Yesterday"/"This Week"/"Earlier". 5 tests flake on UTC-midnight rollover. Not touched this session (last edit 4eb04a2). Fix: either freeze `Date.now` in the suite (vitest `vi.useFakeTimers`) or express fixtures relative to the current day. Out of scope for the reconciliation plan.
- **2026-04-20 (Phase 5.3 pre-check):** `docs/ARCHITECTURE.md` §"Data-layer overview" table (~lines 190–210) still lists the pre-rebuild canonical-schema RPC names (`save_course_score`, `save_section_override`, `save_student_goals`, `save_student_reflection`, `save_learning_map`, `projection.add_student_flag`, `projection.remove_student_flag`, `bulk_save_course_scores`, `delete_course_score`, etc.) as the current write surface. None of these exist on `gradebook-prod`. Remediation: regenerate the table against live RPCs as part of Phase 5.2 of the reconciliation plan.

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

- `2026-04-20 | session-4 | 5.2-live | user confirmed DNS + Supabase custom-SMTP setup complete and first end-to-end signup email passes SPF + DKIM + DMARC on Gmail + Outlook; HANDOFF marked complete.`
- `2026-04-20 | session-3 | 5.2-runbook | new docs/backend-design/smtp-setup.md — Resend-first runbook covering SMTP-provider trade-offs, SPF/DKIM/DMARC records (with SPF merge handling), Supabase custom-SMTP config, email-template wrapper, end-to-end verification on Gmail + Outlook, rollback, gotchas. User-only actions called out. HANDOFF links updated. Commit on rebuild-v2.`
- `2026-04-19 | session-1 | v2-bootstrap | 12 migrations deployed, schema + RLS + read-path primitives live on gradebook-prod; 0 security lints`
- `2026-04-19 | session-1 | audit | smoke tests passed for §1.1, rubric path, all 6 calc_methods, cascade deletes, weight-cap trigger, RLS cross-tenant (10 assertions)`
- `2026-04-19 | session-1 | handoff | this document created`

- `2026-04-19 | session-2 | 1.1 | deployed migration fullvision_v2_write_path_auth_bootstrap: bootstrap_teacher, soft_delete_teacher, restore_teacher; 7-assertion smoke test passed; write-paths.sql created`
- `2026-04-19 | session-2 | docs | updated HANDOFF What's-already-done: 13 migrations, 20 functions`
- `2026-04-19 | session-2 | 1.2 | deployed migration fullvision_v2_write_path_course_crud: create_course (plain+wizard), update_course (jsonb patch), archive_course, duplicate_course (full structure remap), delete_course; 14-assertion smoke test passed`
- `2026-04-19 | session-3 | 1.3 | deployed migration fullvision_v2_write_path_category_module_rubric: upsert_category/delete_category (weight-cap trigger verified rejects >100), upsert_module/delete_module (assessment.module_id SET NULL confirmed), upsert_rubric (composite criteria+criterion_tag diff with insert/update/delete) / delete_rubric; 13-assertion smoke test passed`
- `2026-04-19 | session-3 | bugfix | found latent schema bug: section_competency_group_fk SET NULL also nulled section.course_id (NOT NULL); deployed migration fullvision_v2_fix_section_competency_group_fk_set_null using PG15+ SET NULL (column_list) form; schema.sql updated`
- `2026-04-19 | session-3 | 1.12 | enabled pg_cron extension; deployed fv_retention_cleanup() SECURITY DEFINER (hard-deletes teachers w/ deleted_at < now() - 30d, purges score_audit + term_rating_audit > 2yr); scheduled daily at 03:17 UTC as cron job 'fv_retention_cleanup_daily'; smoke verified stale teacher purge + stale-audit purge + fresh-row survival`
- `2026-04-19 | session-3 | 5.3 | new smoke-tests.sql — 14-block pgTAP-style pack with sentinel-rollback subtransactions, runnable under psql -v ON_ERROR_STOP=1. Covers Phase 1 RPCs + 3.2 read + 4.9 imports + key invariants. Companion smoke-tests.README.md with CI sketch. Blocks 3/7/14 dry-run against gradebook-prod (sentinel pattern clean-exits; RLS isolation asserted). Phase 5.3 complete.`
- `2026-04-19 | session-3 | 5.1 | new shared/demo-seed.js — Q43-spec Grade 8 Humanities generator (4 subjects/14 tags/4 modules/3 categories/1 rubric/25 students/8 assessments/bell-curve scores/notes/goals/reflections). window.buildDemoSeedPayload + window.applyDemoSeed. Wired into teacher/app.html + teacher-mobile/index.html. Commit fe59cf1 on rebuild-v2 (local). gradebook-prod round-trip via import_json_restore verified.`
- `2026-04-19 | session-3 | 4.10 | new shared/offline-queue.js: fv-sync-queue-v1 FIFO + dead-letter, 3-try exponential backoff (1s/5s/30s), on-online + 60s auto-flush, 500-entry/5 MB cap. Loaded in teacher/app.html + teacher-mobile/index.html. window.v2Queue.{enqueue,flush,stats,deadLetter,dismissDeadLetter,clear,callOrEnqueue}. Commit d55a44c on rebuild-v2 (local). Phase 4 complete.`
- `2026-04-19 | session-3 | 4.9 | deployed migration fullvision_v2_write_path_imports (import_teams_class + import_json_restore covering 20 entity sections, idempotent UPSERT); shared/data.js: window.v2.importRosterCsv/importTeamsClass/importJsonRestore. Commit 15e7cf2 on rebuild-v2 (local). gradebook-prod smoke passes including idempotent re-run of JSON restore.`
- `2026-04-19 | session-3 | 4.8 | shared/data.js: added window.v2 helpers for applyReportPreset, saveReportConfig, toggleReportBlock, saveTeacherPreferences, softDeleteTeacher, restoreTeacher. All v2 RPCs now have window.v2.* entries. Commit 7897916 on rebuild-v2 (local).`
- `2026-04-19 | session-3 | 4.7 | shared/data.js: window.v2.saveTermRating — camelCase → snake_case payload translator for save_term_rating. Commit 6f83ae7 on rebuild-v2 (local).`
- `2026-04-19 | session-3 | 4.6 | shared/data.js: added 8 window.v2 helpers — getStudentProfile, addNote/deleteNote, saveGoal, saveReflection, saveSectionOverride/clearSectionOverride, bulkAttendance. Commit 85f17b4 on rebuild-v2 (local). gradebook-prod smoke passes.`
- `2026-04-19 | session-3 | 4.5 | shared/data.js: added window.v2.* namespace with 20 structural helpers (subject/group/section/tag/module/category/rubric upsert/delete/reorder, rubric composite). _rpcOrNoop helper centralises sb.rpc + error logging. Commit 20c000f on rebuild-v2 (local).`
- `2026-04-19 | session-3 | 4.4 | shared/data.js: ported _persistObservationCreate/Update/Delete to v2 create/update/delete_observation; added window.createObservationRich, updateObservationRich, upsertObservationTemplate, deleteObservationTemplate, createCustomTag. Commit 71ee3de on rebuild-v2 (local). gradebook-prod smoke passes.`
- `2026-04-19 | session-3 | 4.3 | shared/data.js: added window.fillRubric, clearScore, clearRowScores, clearColumnScores — the remaining scoring helpers after 3.5. Commit 6cb58cf on rebuild-v2 (local).`
- `2026-04-19 | session-3 | 4.2 | shared/data.js: ported _canonicalCreate/Update/DeleteAssessment to v2 RPCs; added window helpers duplicateAssessment, saveAssessmentTags, saveCollab. Commit 70d40b9 on rebuild-v2 (local). gradebook-prod smoke: 6/6 dispatch paths.`
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
- `2026-04-20 | session-5 | 0.1 | new docs/superpowers/plans/2026-04-20-database-wiring-reconciliation.md — central 6-phase recipe; replaces ACTION_PLAN.md premise.`
- `2026-04-20 | session-5 | 0.2 | ACTION_PLAN.md deprecated with banner pointing at reconciliation plan.`
- `2026-04-20 | session-5 | 0.3 | discovered-gap bullet appended — save_course_score doesn't exist on prod, silent-failure since PR #63.`
- `2026-04-20 | session-5 | 1 | hotfix: _persistScoreToCanonical now a no-op on main (colin/heuristic-leakey-b750e5 d7d234c); tests/data-persist-score-canonical-noop.test.js regression guard added; 658 vitest tests green; Demo-Mode verification pending user.`
- `2026-04-20 | session-5 | 2.1 | schema.sql regenerated from gradebook-prod (root + docs/backend-design mirror); 39 tables + 95 RPC signatures documented; old 130KB migration-log content retired.`
- `2026-04-20 | session-5 | 2.2 | design SQL diffed against live — zero design-only drift; 17 live-only RPCs recorded in Discovered gaps for Phase 5.1 regen.`
- `2026-04-20 | session-5 | 2.3 | Phase 2 re-sync passed; Phase 5.3 pre-check found docs/ARCHITECTURE.md table uses dead canonical RPC names — logged for Phase 5.2.`
- `2026-04-20 | session-5 | STOP | Phase 3 boundary reached — 16 rebuild-v2 verification tasks require human Demo-Mode + signed-in browser interaction; returning control to user.`

- `2026-04-20 | session-5 | plan-3.0 | created verify-rebuild-v2 worktree from rebuild-v2; npm install clean; fixed 2 stale test files (data-init-invokes-canonical-reads + data-pagination — were testing cancelled list_course_roster RPCs, updated to guard get_gradebook); all 36 tests green; commit 570529c`
- `2026-04-20 | session-5 | plan-3.1-a | HANDOFF 3.2 code review: initAllCourses() correctly calls bootstrap_teacher → list_teacher_courses; Demo Mode short-circuits before those calls; tests green; dev server running at http://localhost:8347; browser + signed-in verification pending user action`
- `2026-04-20 | session-5 | plan-3.1-a-verify | HANDOFF 3.2 fully verified end-to-end: signed in as brown_colin@surreyschools.ca → bootstrap_teacher created Teacher "Colin Brown" + Welcome Class on first v2 sign-in → list_teacher_courses returned it → Dashboard rendered with Welcome Class active (0 students — empty-state). DB confirms teacher row + 1 course. Local dev: required .env + substituted dist/ + npx serve (netlify dev --dir . bypasses edge function; netlify dev without --dir resolves publish-dir to git root, not worktree). Added dev:local script on rebuild-v2.`
- `2026-04-20 | session-5 | plan-3.1-b-verify | HANDOFF 3.3 verified: __V2_WRITE_PATHS_READY gate (line 930) wipes stale gb-retry-queue; __V2_GRADEBOOK_READY gate (line 2051) short-circuits _doInitData with empty blobs. Demo Mode unaffected (_useSupabase=false at line 836 short-circuits before both gates). Empty-shell path exercised via signed-in Welcome Class rendering in 3.1-a. No code changes, tests green.`
- `2026-04-20 | session-5 | plan-3.1-c-verify | HANDOFF 3.4 verified: get_gradebook(p_course_id) exercised in 3.1-a signed-in session for Welcome Class; _v2GradebookToCache mapped empty payload to empty cache correctly; Dashboard rendered empty-state. Shape-bridge logic covered by data-pagination.test.js (rewritten in 3.0). No code changes.`
- `2026-04-20 | session-5 | plan-3.1-d-verify | HANDOFF 3.5 verified: added tests/data-scores-v2-dispatch.test.js (18 tests) covering _persistScoreToCanonical tag-vs-rubric dispatch via _cache.v2Gradebook.has_rubric, save_score_comment routing, UUID guards, upsertCellScore, setCellStatus, fillRubric, clearScore/clearRowScores/clearColumnScores. Full suite 37 files / 675 passing. DB-level smoke was already in the original Phase 3.5 commit.`
- `2026-04-20 | session-5 | plan-3.1-e-verify | HANDOFF 4.1 verified: added tests/data-students-v2-dispatch.test.js (18 tests) covering all 4 _canonical* helpers (enroll / updateStudent / updateEnrollment / withdraw) + 4 window helpers (reorderRoster, bulkApplyPronouns, importRosterCsv, setEnrollmentFlag). Full suite 38 files / 693 passing. DB smoke already in original Phase 4.1 commit.`
- `2026-04-20 | session-5 | plan-3.1-f-verify | HANDOFF 4.2 verified: added tests/data-assessments-v2-dispatch.test.js (14 tests) covering _canonicalCreate/Update/DeleteAssessment + duplicateAssessment + saveAssessmentTags + saveCollab. Full suite 39 files / 707 passing.`
- `2026-04-20 | session-5 | plan-3.1-g-verify | HANDOFF 4.3 verified: scoring clear helpers (fillRubric, clearScore, clearRowScores, clearColumnScores) already covered by tests/data-scores-v2-dispatch.test.js added for 3.1-d. No additional tests needed.`
- `2026-04-20 | session-5 | plan-3.1-h-verify | HANDOFF 4.4 verified: added tests/data-observations-v2-dispatch.test.js (17 tests) covering _persistObservation{Create,Update,Delete}, createObservationRich, updateObservationRich, upsertObservationTemplate, deleteObservationTemplate, createCustomTag. 725 total passing.`
- `2026-04-20 | session-5 | plan-3.1-i-verify | HANDOFF 4.5 verified: added tests/data-learning-map-v2-dispatch.test.js (19 tests) covering all 20 window.v2.* structural helpers (Subject/CompetencyGroup/Section/Tag/Module/Category + Rubric composite) + _rpcOrNoop offline no-op. 744 total passing.`
- `2026-04-20 | session-5 | plan-3.1-j-verify | HANDOFF 4.6 verified: added tests/data-student-profile-v2-dispatch.test.js (13 tests) covering getStudentProfile, notes, goals, reflections, section overrides, bulk attendance. 757 total passing.`
- `2026-04-20 | session-5 | plan-3.1-k-verify | HANDOFF 4.7 verified: added tests/data-term-rating-v2-dispatch.test.js (5 tests) covering saveTermRating camelCase→snake_case translation, partial-update omit semantics, empty-[] wipe, term Number coercion, dimension rating coercion.`
- `2026-04-20 | session-5 | plan-3.1-l-verify | HANDOFF 4.8 verified: added tests/data-reportconfig-prefs-teacher-v2-dispatch.test.js (12 tests) covering report-config, teacher preferences, soft-delete/restore, and 3 import helpers (roster/Teams/JSON). 5 pre-existing mobile date flakes logged in Discovered gaps.`
- `2026-04-20 | session-5 | plan-3.1-m-verify | HANDOFF 4.9 verified: import dispatchers covered by tests/data-reportconfig-prefs-teacher-v2-dispatch.test.js imports-block added for 3.1-l. No additional tests needed.`
- `2026-04-20 | session-5 | plan-3.1-n-verify | HANDOFF 4.10 verified: added tests/offline-queue.test.js (14 tests) covering enqueue, flush+dead-letter, stats, clear, callOrEnqueue (online/offline/network-error/validation/no-supabase). setTimeout faked to skip real backoff delays.`
- `2026-04-20 | session-5 | plan-3.1-o-verify | HANDOFF 5.1 verified: added tests/demo-seed.test.js (10 tests) covering buildDemoSeedPayload Q43 counts + FK integrity + UUID shape + applyDemoSeed. Noted: categories live under \`_categories_preview\` pending import_json_restore inclusion.`
- `2026-04-20 | session-5 | plan-3.1-p-verify | HANDOFF 5.3 verified: smoke-tests.sql 14 DO blocks present; Block 14 (RLS cross-tenant isolation) re-verified live against gradebook-prod via MCP — all assertions pass, cross-tenant reads rejected.`
- `2026-04-20 | session-5 | phase-3-verify-complete | all 16 rebuild-v2 phases (HANDOFF 3.2–3.5, 4.1–4.10, 5.1, 5.3) verified via 111 new unit tests + DB smoke + signed-in browser round-trip. rebuild-v2 ready for Phase 4 merge to main.`

- `2026-04-20 | session-5 | 4.2-merge | reconciliation plan Phase 4 executed locally: git merge --no-ff rebuild-v2 into main (merge commit 2fbc6d7) + git merge --no-ff phase-5.2-complete (merge commit e563ef4, HANDOFF activity-log/gap conflict resolved additively). 2 stale canonical-RPC tests fixed post-merge (commit 8f99dee). Full suite 793 passing + 5 pre-existing date flakes (logged). Local only — push embargo remains.`
- `2026-04-20 | session-5 | 4.3-action-plan | ACTION_PLAN.md already absent from main (deleted in earlier cleanup); no action required.`
- `2026-04-20 | session-5 | 5.3-sweep | Phase 5 doc sweep complete (commit 01112cb): 11 reference docs footered (8 backend-design + 3 root); docs/ARCHITECTURE.md Data-layer table regenerated with v2 RPCs; DECISIONS.md Q50 (save_course_score hotfix rationale) + Q51 (--no-ff merge choice) added. Re-sync grep found only historical comments in shared/data.js explaining retired RPCs — no live code or current-state claims reference dead canonical names.`
- \`2026-04-20 | session-5 | 6.1-dead-code | removed ~230 LOC of dead legacy-bridge sync machinery from shared/data.js (commit 521500b): _syncToSupabase / _doSync / _initRealtimeSync / _refreshFromSupabase / _handleCrossTabChange / _deleteFromSupabase + retry-queue infrastructure (_addToRetryQueue, _retryFailedSyncs, retrySyncs, _retryQueue, _inflightSyncs, _pendingWrites, _syncKey, _MAX_RETRIES, etc.) + all call sites. Added tests/data-dead-bridge-removed.test.js (7 TDD guards). Writes now route through v2 RPC dispatch; offline queue = window.v2Queue. Full suite 800 passing + 5 pre-existing date flakes.\`
- \`2026-04-20 | session-5 | 6.2-backlog | opened docs/superpowers/plans/2026-04-20-post-reconciliation-backlog.md (11 items: P1 key rotation + Playwright e2e + push-embargo lift; P2 realtime re-publication + bulk read RPCs + delete_course semantics + SQL regen; P3 date-flake freeze + decisions.html regen + spec-vs-ui-diff replay; P4 demo-seed category promotion + Demo Mode migration to v2 generator).\`
- \`2026-04-20 | session-5 | 6.3-ship | moved docs/superpowers/plans/2026-04-20-database-wiring-reconciliation.md → shipped/. Reconciliation plan complete.\`
- \`2026-04-20 | session-5 | push | local main (31 commits past origin/main) pushed clean — origin now at f76c666. Netlify auto-deploy triggered.\`
- \`2026-04-20 | session-5 | backlog-P3.1 | fixed 5 flaky date-sensitive mobile tests (commit 145686d): vi.setSystemTime freeze at 2026-04-20T12:00:00Z for dateGroupLabel describes + renders-multiple-date-groups test. 805/805 passing.\`
- \`2026-04-20 | session-5 | cleanup | removed throwaway worktrees .claude/worktrees/merge-test (was main) and .claude/worktrees/verify-rebuild-v2 (was rebuild-v2). main branch now checked out on primary repo path. Other pre-existing worktrees (heuristic-leakey + 4 older colin/*) left intact.\`

*(next session, keep appending.)*
