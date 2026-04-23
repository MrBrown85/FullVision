# FullVision v2 — Rebuild Handoff

**Purpose:** single source of truth for multi-session, multi-context-window continuation of the v2 rebuild. Each Claude run reads this, does the next task, updates this file, stops. The user just re-runs the same prompt.

**Prompt to repeat in each new session** (cold start — no prior context):

```
You are continuing the FullVision v2 rebuild. This is a long-running multi-session effort coordinated through a handoff doc.

Read docs/backend-design/HANDOFF.md in full. It contains: ground truth, safety gates, what's done, and links to the active work list and conventions you must follow.

Then:
1. Pick the top-most item from the active work list listed under Remaining work.
2. Execute it within the Safety gates (stop and ask if you hit one).
3. When done, update `codex.md` if the task state changed and append a line to the Activity log.
4. Stop and return control — do not batch into the next task.

Do not invent process or priority. Follow the active work list linked under Remaining work and use the live repo state rather than historical rebuild sequencing.
```

Shorter version if you want to save tokens on a warm context:

```
Read docs/backend-design/HANDOFF.md and continue.
```

The old phase-specific model table is gone. Standard context is enough for the live startup path in this file.

---

## Prime directive

You are continuing an ongoing rebuild. **Read this whole file before touching anything.** Then:

1. Pick the next item from the active work list listed under **Remaining work**.
2. Execute it autonomously, **respecting the Safety gates** (below).
3. When done, update `codex.md` if the task state changed, append a one-line entry to the **Activity log** at the bottom, commit any artifact updates alongside the migration/code change.
4. Stop (return to user) if:
   - you hit a Safety gate,
   - the next task is blocked by user input,
   - you discover a new correctness issue that reshapes the plan — record it in **Discovered gaps** and stop.

**Do NOT** batch multiple phases silently. One phase, then stop and let the user re-invoke. This keeps context-window growth bounded.

---

## Ground truth

| Fact                                                    | Value                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Supabase project ref                                    | `novsfeqjhbleyyaztmlh` (name: `gradebook-prod`, ca-central-1, Postgres 17)        |
| Org                                                     | `MrBrown85's Org` (`zvqlrjxkzxeidhrnqgny`)                                        |
| **Design worktree (this repo, read-only charter)**      | `/Users/colinbrown/Documents/fullvision-backend-design`                           |
| **Main FullVision repo (write target for client port)** | `/Users/colinbrown/Documents/FullVision`                                          |
| Legacy (reference-only)                                 | `/Users/colinbrown/Documents/Projects/FullVision -- Legacy`                       |
| Main repo active branch                                 | `main` (rebuild-v2 merged and pushed; this is the only active app branch now)     |
| User has **no budget** for new Supabase projects        | Reuse `gradebook-prod`. Do NOT create new projects or paid resources.             |
| User owns domain                                        | `fullvision.ca` (+ `fullvision.netlify.com` fallback). DNS changes are user-only. |

### Reading order for first-time context load

1. [CLAUDE.md](../../CLAUDE.md) — charter, hard rules.
2. This file.
3. [erd.md](erd.md) — entity-relationship design reference (shipped).
4. [write-paths.md](write-paths.md) — Pass B RPC specs (shipped).
5. [read-paths.md](read-paths.md) — Pass D computations (shipped).
6. [auth-lifecycle.md](auth-lifecycle.md) — Pass C flows (shipped).
7. [rls-policies.sql](rls-policies.sql), [read-paths.sql](read-paths.sql), [write-paths.sql](write-paths.sql) — live SQL mirrors.
8. [../../schema.sql](../../schema.sql) — live schema (root, authoritative).

---

## Working mode (updated 2026-04-21)

`main` is the source of truth and has been pushed to `origin`. The old `rebuild-v2` / PR-75 / PR-76 / PR-79 branch choreography is historical only.

- Default to local commits first; **push only when the user explicitly asks**.
- Avoid reviving or targeting historical branches/PRs that were superseded by `main`.
- Netlify still auto-deploys on push, and production is currently quota-blocked (`usage_exceeded`), so do not push speculatively just to "keep things synced."
- Supabase migrations on `gradebook-prod` are still allowed when a task requires them and the Safety gates permit it.

## Safety gates (NEVER proceed without explicit user approval)

Stop and ask if the next step requires any of these:

- **Destructive SQL on `gradebook-prod`**: `DROP`, `TRUNCATE`, `DELETE without WHERE`, wiping schemas. One-time approvals do not extend; each new destruction needs its own "yes."
- **Git actions on the main FullVision repo that rewrite state**: tagging, force-push, reset --hard, discarding uncommitted work, `git add -A` when untracked files might be sensitive, committing to a branch the user didn't specify.
- **Creating paid Supabase resources** (new projects, upgraded tiers) — blocked absolutely.
- **DNS / SMTP / email sends / PR opens / Slack messages** — all user-executed only.
- **Modifying files across many directories of the main repo in one shot** — always do one narrow slice, verify, stop. User memory says "Verify UI in Demo Mode" for any UI change; Claude cannot do manual UI verification autonomously.

If the user said "yes" to one action in a past session, **do not** assume it extends. Re-confirm per action.

---

## Current state (updated 2026-04-22)

The rebuild/reconciliation work is complete and lives on `main`.

### gradebook-prod (Supabase)

- **Schema + RLS + function surface:** all deployed. 39 tables, every one RLS-enabled with ≥1 policy; live functions use `search_path = public`.
- **Write-path RPCs:** every Pass B §1–§16 path is live. Write-paths.sql mirrors what's deployed.
- **Read-path RPCs:** live surface includes `list_teacher_courses`, `get_gradebook`, `get_student_profile`, `get_learning_map`, `get_class_dashboard`, `get_term_rating`, `get_observations`, `get_assessment_detail`, and `get_report` (+ computation helpers described in `read-paths.md` / `read-paths.sql`).
- **Retention cron:** `fv_retention_cleanup_daily` (pg_cron, 03:17 UTC) — purges 30-day-stale soft-deleted teachers + >2yr audit rows.
- **Advisors:** 0 security lints, 0 actionable performance lints.

### Main FullVision repo (branch `main`, pushed)

- **`shared/supabase.js`** — audited clean (auth-only).
- **`shared/data.js`** — boot path (`initAllCourses` / `_doInitData`) calls the v2 RPCs. `_canonicalCoursesToBlob`, `_v2GradebookToCache`, `_persistScoreToCanonical`, `_canonical{Enroll,UpdateStudent,UpdateEnrollment,Withdraw}`, `_canonicalCreate/Update/DeleteAssessment`, `_persistObservationCreate/Update/Delete` all routed to v2 RPCs. `_v2GradebookToCache` now hydrates category rows into `_cache.categories[cid]`, and assessment payloads round-trip `category_id`. Fresh first sign-in now detects an empty Welcome Class, applies the existing `shared/demo-seed.js` payload once, and queues a one-shot gradebook landing. Legacy per-course RPC fan-out is unreachable (retained for reference).
- **`shared/supabase.js` + `login-auth.js`** — account lifecycle is further along: `reauthenticateWithPassword(...)` now re-checks credentials for sensitive actions, sign-in runs the restore-account check before redirect, deleted teachers see the restore prompt with `Restore` / `Continue deletion`, and long-form surfaces now use the draft-safe session-expired path instead of losing work on the 30-minute idle timeout.
- **`window.v2.*` namespace** — 40+ thin RPC wrappers covering everything the backend exposes: course / category / module / rubric / subject / competency-group / section / tag CRUD + reorder; student + enrollment + roster + bulk pronouns + CSV import; assessment CRUD + collab; scoring (cell/tag/rubric/status/comment/fill/clear); observations + templates + custom tags; student-record writes + `getStudentProfile`; `saveTermRating`; ReportConfig + preferences + teacher-lifecycle; imports (CSV, Teams, JSON restore).
- **`shared/offline-queue.js`** — `window.v2Queue` FIFO + dead-letter + 3-attempt backoff + auto-flush, wired into `teacher/app.html` and `teacher-mobile/index.html`. It now also exposes `subscribe(...)` so desktop/mobile UI can react to queue/network changes without polling.
- **`scripts/dev-local.mjs` / `npm run dev:local`** — local signed-in dev flow now lives on `main`; no Netlify preview/build credits are needed for local verification.
- **`shared/calc.js`** — category-aware helpers now exist for the letter pipeline: `courseShowsLetterGrades`, `getAssessmentOverallScore`, `getCategoryAverage`, `qToPercentage`, `percentageToLetter`, and `getCourseLetterData`. Desktop/report surfaces can now derive letter + percentage from weighted categories instead of the old summative/formative split.
- **`teacher/dash-class-manager.js`** — Tier-A course-settings UI is live on `main`: 3-way `grading_system` segmented control, inline category management, saved-category gating for Letter/Both, Mean + Median calc methods, grading/calc descriptions, and late-work-policy editing.
- **`teacher/page-assignments.js`** — assessment create/edit/export flows are now category-aware: the legacy type toggle is replaced by a Category dropdown, filters are `All / Categorized / No Category`, and exported JSON/CSV include categories. The rubric editor also supports per-criterion weights and per-level value overrides, and `saveRubrics(...)` now dispatches canonical rubric writes through `window.v2.upsertRubric`, rehydrates canonical rubric/criterion ids from Supabase, and patches linked assessment `rubricId` values back onto the server-safe ids.
- **`teacher/page-gradebook.js` + desktop report/header surfaces** — gradebook filters, badges, and add-assessment popover now use categories; row/summary/report letter displays read `getCourseLetterData` so Letter/Both mode follows the category-weighted pipeline on desktop. Gradebook also carries the dismissible Welcome Class sample banner when the seeded course is active.
- **`teacher/ui.js` + `teacher/styles.css` + `teacher/router.js`** — desktop offline UX now ships: unsynced badge on the account avatar, sync-status popover (queue counts, last-sync time, dead-letter dismiss/retry), and the offline banner strip that pushes the dock down while offline. The old sync toast retry action now calls the real queue flush path.
- **`teacher/page-reports.js` + `teacher/page-observations.js` + `teacher/ui.js`** — the two long-form surfaces now register draft-preservation auth context. On term-rating narrative saves or observation capture writes, the v2 dispatch layer tries `refreshSession()` first; if refresh fails, a password modal keeps the draft visible, retries the failed write on success, and offers a copy-draft escape hatch on dismiss.
- **`teacher/ui.js`** — desktop account menu now uses a real Delete Account flow instead of the local-only “Clear This Device” affordance: exact 30-day grace copy, typed-email confirm, password re-entry, `window.v2.softDeleteTeacher()`, then sign-out.
- **Quality baseline** — `npm test` currently passes `834` tests with `1` skipped (run on 2026-04-22).
- **Playwright baseline** — `e2e/regression-smoke.spec.js` now covers the local auth/write/sign-out/sign-in/read round-trip with a durable fake backend harness in `e2e/helpers.js`; targeted verification is green for that smoke plus `e2e/auth.spec.js`, `e2e/gradebook.spec.js`, and `e2e/score-entry.spec.js` (`27` passing on 2026-04-22).
- **Feature flags** on `window`: `__V2_GRADEBOOK_READY` (default true), `__V2_WRITE_PATHS_READY` (false — legacy `gb-retry-queue` replay gated off until the bulk `_syncToSupabase` machinery is retired).
- **GitHub state:** no open app PRs are required for the rebuild; stale gap-fill PR #79 was closed as superseded by `main`.

### Remaining work

- The active next-work list is now [`codex.md`](../../codex.md).
- Highest-signal unresolved items today: Netlify quota / `fullvision.ca` 503 (`P1.0`), leaked publishable key cleanup (`P1.1`), the Teams import adapter gap (`T-BE-02`), and the missing export backend surface (`T-UI-05` + `T-BE-01 export_my_data`).
- The dormant legacy fan-out in `_doInitData` and the bulk `_syncToSupabase` block are now cleanup/backlog work, not blockers.

---

## Discovered gaps (append as found)

When Claude finds a real defect mid-session that reshapes the plan, add a bullet here describing it and the remediation. Don't silently fix and continue.

Earlier bugs fixed inline (mostRecent ambiguity, decaying_avg ambiguity, missing GRANTs) are in the Activity log, not here.

- **2026-04-19 (Phase 1.4):** `section_competency_group_fk` used `ON DELETE SET NULL` without a column list, so deleting a `competency_group` tried to null `section.course_id` (NOT NULL). Fixed via migration `fullvision_v2_fix_section_competency_group_fk_set_null` using PG15+ `SET NULL (competency_group_id)`. schema.sql updated to match.
- **2026-04-19 (Phase 1.11):** `report_config.preset` CHECK was `in (brief,standard,detailed)` but write-paths §14 requires `'custom'` for manual block toggles. Fixed via migration `fullvision_v2_fix_report_config_add_custom_preset`; schema.sql updated.
- **2026-04-20 (plan reconciliation):** The `main`-branch client called `sb.rpc('save_course_score', …)` at [`shared/data.js:2731`](../../shared/data.js:2731), but no such RPC existed on `gradebook-prod`. Every score save since PR #63 (2026-04-18) had `console.warn`-logged an error and lost the remote write; localStorage kept the UI looking correct. Root cause: `ACTION_PLAN.md` was authored against a canonical-schema RPC naming scheme that the v2 rebuild replaced; the plan was never reconciled after the rename. The claim "canonical-RPC migration ~70% complete" was therefore false. **Resolved 2026-04-20:** rebuild-v2 merged to main via --no-ff — v2 dispatch is now the active path.
- **2026-04-20 (Phase 2.2 diff):** Design SQL (`write-paths.sql` + `read-paths.sql`) is missing 17 functions that landed on `gradebook-prod` from 2026-04-19/20 but never got mirrored back per convention #6. Affected RPCs: read-path (`get_assessment_detail`, `get_class_dashboard`, `get_learning_map`, `get_observations`, `get_report`, `get_term_rating`), imports (`import_json_restore`, `import_teams_class`), term rating (`save_term_rating`), student (`delete_student`, `relink_student`), plus internal helpers (`fv_check_category_weight_sum` trigger, `fv_owns_*` RLS predicates, `clear_data`). Remediation: regenerate `write-paths.sql` and `read-paths.sql` from live DB as part of Phase 5.1 of the reconciliation plan. No functional impact — live RPCs work correctly; only the design-artifact mirrors are behind.
- **2026-04-20 (Phase 3.0 test baseline):** `tests/data-init-invokes-canonical-reads.test.js` and `tests/data-pagination.test.js` were guarding against the April 3 regression using the cancelled canonical-schema RPC names (`list_course_roster`, `list_course_assessments`, etc.). Both files were updated to guard against `get_gradebook` being stubbed (the actual v2 boot read); all 36 test files now green. Commit `570529c` on `rebuild-v2`.
- **2026-04-20 (Phase 3.1-l, pre-existing):** `tests/mobile-components.test.js` (`MComponents.dateGroupLabel`) and `tests/mobile-observe.test.js` use fixed fixture dates (April 2026) combined with `new Date()` to label as "Today"/"Yesterday"/"This Week"/"Earlier". 5 tests flake on UTC-midnight rollover. Not touched this session (last edit 4eb04a2). Fix: either freeze `Date.now` in the suite (vitest `vi.useFakeTimers`) or express fixtures relative to the current day. Out of scope for the reconciliation plan.
- **2026-04-20 (Phase 5.3 pre-check):** `docs/ARCHITECTURE.md` §"Data-layer overview" table (~lines 190–210) still lists the pre-rebuild canonical-schema RPC names (`save_course_score`, `save_section_override`, `save_student_goals`, `save_student_reflection`, `save_learning_map`, `projection.add_student_flag`, `projection.remove_student_flag`, `bulk_save_course_scores`, `delete_course_score`, etc.) as the current write surface. None of these exist on `gradebook-prod`. Remediation: regenerate the table against live RPCs as part of Phase 5.2 of the reconciliation plan.

---

- **2026-04-22 (T-WIRE-01 audit):** Grep of `teacher/` + `teacher-mobile/` for legacy save\* / sb.rpc call sites found two categories of unmigrated UI actions:

  **A — Score writes that never reach Supabase** (`saveScores` instead of `upsertScore`):
  - `teacher/page-gradebook.js:1420` — inline cell-edit `commit()`. Score-mode (cycle-click) uses `upsertScore` (✓ dispatches v2); inline text edit uses `saveScores` (✗ local only). Fix: replace bulk `saveScores(cid, allScores)` with per-entry `upsertScore(cid, sid, aid, tid, val)` calls inside `commit()`.
  - `teacher/page-gradebook.js:1275` — "Clear cell" context menu calls `saveScores` without calling `window.clearScore(enrollmentId, assessmentId)`. Fix: add `window.clearScore` call.
  - `teacher/page-assignments.js:setScore (line 1035)` — called by `selectTagLevel` (tag-level click in sidebar). Uses `saveScores` only. Fix: use `upsertScore` instead.
  - `teacher/page-assignments.js:selectScore (line 1062)` — level-button click. Uses `saveScores` only. Fix: use `upsertScore` instead.
  - `teacher/page-assignments.js:1005` — "notSubmitted" status writes zero scores via `saveScores`. Fix: pair with `upsertScore` (value=0) calls.
  - `teacher/page-gradebook.js:setPointsScore` calls `saveScores` in points-mode "isPtsCol" entry. Fix: add `window.upsertCellScore(cid, enrollmentId, assessmentId, raw)` call alongside.
  - `teacher-mobile/tab-grade.js:257, 305` — mobile score entry. Fix: use `upsertScore`.
  - Undo callbacks (`page-gradebook.js:1510`, `page-assignments.js:1101/1146`) restore local state; borderline acceptable for v1 since undo is ephemeral.

  **B — Learning-map CRUD that never reaches Supabase** (`saveLearningMap` only, no `window.v2.*`):
  - `teacher/dash-class-manager.js` (~25 call sites: lines 153, 232, 261, 1208, 1599, 1623, 1782, 1795, 1803, 1810, 1843, 1856, 1861, 1879, 1887, 1894, 1904, 1920, 1950, 1967, 1977, 1987, 1996, 2005, 2012, 2038, 2055). Every subject / section / competency-group / tag / reorder mutation writes only to `saveLearningMap` (local). `window.v2.upsertSubject`, `deleteSubject`, `upsertSection`, etc. exist but are never called from the UI. Fix: add paired `window.v2.*` dispatch alongside each mutation in dash-class-manager. This is a larger task and should be a dedicated session (new task: **T-WIRE-02 — learning-map v2 dispatch**).

  **C — Import paths that bypass v2 RPCs** (local-only):
  - `teacher/teams-import.js:705` — Teams CSV import writes scores via `saveScores`; `window.v2.importTeamsClass` exists but is not called here. Fix: call `window.v2.importTeamsClass` instead of writing locally.
  - `teacher/page-assignments.js:1631–1638` — Legacy local JSON `importData()`. Calls save\* locally; should use `window.v2.importJsonRestore` for remote persistence. Lower priority (this is a "restore from file" escape hatch, not a primary path).

  **D — Acceptable local-only (no fix needed)**:
  - `teacher/page-assignments.js:853` — removes score rows from local cache after `delete_assessment`; DB cascade already cleaned remote. OK.
  - `teacher/ui.js:781` — cleans up local scores blob after `window.v2.deleteStudent`. OK.

  **Historical follow-up outcome**:
  - **T-WIRE-01a** — completed on 2026-04-22.
  - **T-WIRE-01b** — score-clear wiring completed on 2026-04-22; the separate Teams import adapter gap remains open and is tracked in `codex.md` as **T-BE-02**.
  - **T-WIRE-02** — completed on 2026-04-22.

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

## Recent activity log (append-only)

Claude appends one line per completed task. Format: `YYYY-MM-DD | session-<n> | task-id | short note`.

Keep only the recent tail here for startup context.

- `2026-04-21 | session-10 | welcome-auth-lifecycle | Welcome Class now auto-seeds on fresh bootstrap, lands once in gradebook, and shows a dismissible sample-class banner; term-rating auto-generate is hidden; sign-in now prompts restore when deleted_at is set; desktop Delete Account now uses exact 30-day grace copy + typed email + password reauth + soft-delete. Added 10 focused tests across welcome-class, report-questionnaire, login restore, and delete-account paths. Full suite 825 passed + 1 skipped.`
- `2026-04-21 | session-11 | offline-desktop-ux | desktop offline UX shipped: shared/offline-queue.js now exposes subscribe(...); teacher/ui.js + teacher/styles.css + teacher/router.js render an amber offline banner, unsynced avatar badge, and sync-status popover with queue counts, relative last-sync time, retry, and dead-letter dismiss. Added tests/offline-queue.test.js subscription coverage + tests/ui-sync-status.test.js. Full suite 829 passed + 1 skipped.`
- `2026-04-21 | session-12 | session-expired-longform | long-form session-expiry UX shipped: shared/data.js now guards v2 RPCs with silent refresh + modal fallback, teacher/page-reports.js and teacher/page-observations.js register draft-preservation context, shared/supabase.js marks long-form idle expiry instead of hard sign-out, and teacher/ui.js renders the password re-auth modal + copy-draft escape hatch. Added tests/data-session-expired-guard.test.js. Full suite 832 passed + 1 skipped.`
- `2026-04-22 | session-13 | backlog-P2.5 | rubric canonical persistence shipped: shared/data.js now syncs saveRubrics/deleteRubric through window.v2.upsertRubric/deleteRubric, rehydrates canonical rubric + criterion ids from rubric/criterion/criterion_tag, and patches linked assessment rubricIds; teacher/page-assignments.js now follows the canonical id when auto-selecting a newly saved rubric. Added tests/data-rubrics-v2-sync.test.js. Full suite 834 passed + 1 skipped. Demo-Mode verification still pending user.`
- `2026-04-22 | session-14 | backlog-P1.2 | Playwright auth round-trip smoke shipped at e2e/regression-smoke.spec.js using a durable fake-auth harness in e2e/helpers.js (local sign-up -> sign-in -> Welcome Class gradebook -> score write -> sign-out -> sign-in -> same score visible). Targeted Playwright verification: regression smoke + auth + gradebook + score-entry = 27 passing. Unit suite remains 834 passed + 1 skipped.`
- `2026-04-22 | session-15 | T-WIRE-01 | audit complete — see Discovered gaps below for the full inventory. No code changes in this session; follow-up patches queued.`
- `2026-04-22 | session-16 | T-WIRE-01a | score-entry paths wired to upsertScore: selectScore + setScore in page-assignments.js, notSubmitted zero-writes, commit() in page-gradebook.js, setPointsScore in data.js (+ unit test), and setScore in tab-grade.js. Mobile test mocks updated to shared-store pattern. 837 passed + 1 skipped.`
- `2026-04-22 | session-16 | T-WIRE-01b | clearCell handler now calls window.clearScore(sid, aid) after saveScores. Teams-import audit: tiParsedFile shape mismatches import_teams_class expected payload — gap documented inline + T-BE-02 added to Future tasks. 837 passed + 1 skipped.`
- `2026-04-22 | session-16 | T-WIRE-02 | learning-map CRUD wired to v2 RPCs: _isCanonicalId + _patchMapId helpers added; subjects (add/rename/delete), groups (add/rename/color/delete + _cmMergeToNewGroup), sections (add with subject-first chain + upsertSection + upsertTag, rename, reassign subject, assign group, delete, drag-drop), tags (label, text, code-rename with delete+reinsert). Color fields local-only (no RPC field). Bulk ops deferred with comments. 837 passed + 1 skipped.`
- `2026-04-22 | session-16 | T-UI-03 | reduced-scope: no picker UI; createCourse now defaults timezone to America/Vancouver on the local course object and passes p_timezone to create_course RPC. 839 passed + 1 skipped.`
- `2026-04-22 | session-17 | docs-cleanup-pass-2 | consolidated the live reading path onto ACTIVE_BACKLOG.md + TASKS.md and moved historical planning and audit material out of the active docs path.`
- `2026-04-22 | session-21 | docs-prune | deleted archive-only and cleanup-plan docs so the repo now points only at the live operating path.`
- `2026-04-22 | session-18 | docs-cleanup-pass-3 | trimmed HANDOFF.md to the live startup path and shortened the activity log to the recent tail.`
- `2026-04-22 | session-19 | docs-cleanup-pass-4 | rewrote ARCHITECTURE.md as a current-state architecture doc centered on the live boot flow, explicit v2 RPC dispatch model, offline queue, grading model, and deployment/runtime boundaries.`
- `2026-04-22 | session-20 | docs-cleanup-pass-5 | relabeled docs/diagrams/README.md as a reference-only index, folded the Lucidchart source pointers into it, and archived docs/lucidchart-user-flowcharts.md so the diagram layer stops reading like a live operational doc set.`

_(next session, keep appending.)_
