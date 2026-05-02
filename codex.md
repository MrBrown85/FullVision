# FullVision Open Work

This is the only active work list for the repo. All pending work, design
decisions, and deploy steps live here — no sibling docs (XSS, pilot, ops) to
keep in sync. Implementation history still belongs in
`docs/backend-design/HANDOFF.md`; everything else is here.

Last pilot audit: 2026-04-23. Last production deploy: 2026-04-28.

Tag glossary (inline on each ticket title):

- `[agent-ready]` — an agent can scope and ship a PR without further product input.
- `[needs-design]` — blocked on a human product / architecture decision before any code.
- `[user-blocked]` — external (credentials, billing, Supabase provisioning) — only the user can clear.

## User-blocked / operational

### P1.0 · Netlify quota fix ✅ done 2026-04-28

- Billing resolved by user. Production deployment had been stalled at commit `c558b87b` (April 20) — production context was locked + the build script unconditionally referenced `favicon.svg` and `robots.txt` which were deleted in `de9ca23` (cleanup commit), so every queued build failed with exit code 2.
- [scripts/build.sh](scripts/build.sh) updated to `[ -f favicon.svg ] && cp …` / `[ -f robots.txt ] && cp …` — pattern matches the existing `student/` and `parent/` optional-directory copies.
- Triggered fresh build via `netlify api createSiteBuild`, unlocked deploy, restored deploy `69f117bf2f81884e1244ea2f` to production. Live commit advanced from `c558b87b` (April 20) to `b172f5c3` (April 28) — PRs 81–92 are now deployed.

### P1.1 · Rotate leaked publishable Supabase key `[user-blocked]`

- Replace the old leaked publishable key in Netlify and local envs, then disable it in Supabase.

### P1.3 · Production push / production smoke follow-through `[user-blocked]`

- After the quota issue is resolved and the user wants a production update, run a live smoke on the deployed site.
- Trigger condition: more local-only commits accumulate, or the user asks.

### P2.3 · Apply course soft-delete migration live and verify the delete flow `[user-blocked]` (deploy) + `[agent-ready]` (RLS fix)

- Repo-side implementation is done: `delete_course` is modeled as a 30-day soft-delete, reads hide `Course.deleted_at`, retention cleanup purges stale soft-deleted courses, and the current destructive UI now says "Delete class" with 30-day copy.
- Remaining debt:
  - apply the live Supabase migration for `Course.deleted_at`, `delete_course`, read filters, RLS helper predicates, and retention cleanup.
  - verify the real delete flow on a live account: delete class → class disappears immediately → active course falls back cleanly → no immediate hard-delete regression.
  - confirm the scheduled retention job now purges 30-day-stale soft-deleted courses in production, not just teachers + audit rows.
  - tighten `teacher_self` RLS policy to filter `deleted_at IS NULL`: a soft-deleted teacher can currently still read/write their own `teacher` row during the 30-day grace window (flagged by the 2026-04-23 pilot audit).

## Platform / integration

### P2.1 · Realtime rollout verification for v2 invalidation `[user-blocked]`

- `course_sync_cursor` schema/docs, SQL trigger/publication plan, and client invalidation wiring exist in the repo.
- Still needs live Supabase rollout verification before this can be treated as fully closed.

### T-UI-05 / T-BE-01 · Data export `[needs-design]`

- Blocked on the missing backend export surface: `window.v2.exportMyData` / `export_my_data`.
- Product decision owed: shape of export (ZIP of JSON? single CSV? per-course PDFs?) and whether parents/students get access.

### T-OPS-02 · Sentry project + DSN wiring `[user-blocked]` (Sentry account) + `[agent-ready]` (wiring)

- Register for Sentry (or equivalent); capture DSN.
- Client wiring: add Sentry SDK via CDN in `login.html`, `teacher/app.html`, `teacher-mobile/index.html`; initialize in `shared/supabase.js` using `window.__ENV.SENTRY_DSN` (inject via `netlify/edge-functions/inject-env.js`).
- Global `window.onerror` + `window.onunhandledrejection` → `Sentry.captureException`.
- Server-side RPC errors: add an `fv_error_log` table (teacher_id, endpoint, error, created_at, context jsonb) + `log_error(p_endpoint text, p_error text, p_context jsonb)` SECURITY DEFINER RPC. Wire `shared/data.js`'s `_rpcOrNoop` error path to call it when online.
- CSP violation reporter (pairs with P5.7): `netlify/edge-functions/csp-report.js` receives `application/csp-report` POST bodies, rate-limited to first N per day, logs to `fv_error_log`.
- Acceptance: a test page with `throw new Error('sentry-test')` lands in Sentry within 60s; a failing RPC surfaces in `fv_error_log`; CSP violation surfaces in `fv_error_log`.

## Validation / demo follow-through

### P3.5 · Reconcile remaining Playwright failures `[agent-ready]`

- The flaky real-Supabase full-class smoke spec and its CI workflow were removed; the manual `e2e-real/persistence/` suite remains the persistence gate.
- Broader mocked Playwright still needs a clean reconciliation pass.

## Persistence hardening

Audit findings from 2026-05-01. Cross-checked every "must persist" row in [fullvision-user-inputs.xlsx](fullvision-user-inputs.xlsx) against actual write paths in [shared/data.js](shared/data.js). Full technical writeup in [docs/backend-design/persistence-gaps-2026-05-01.md](docs/backend-design/persistence-gaps-2026-05-01.md). The team's 2026-04-29 gradebook audit ([docs/backend-design/gradebook-supabase-persistence-audit.md](docs/backend-design/gradebook-supabase-persistence-audit.md)) covered the gradebook surface; these tickets address everything else and the systemic fail-closed and race-window vectors that affect every entity.

### P6.1 · Recover from initial Supabase load failure `[agent-ready]` — BLOCKER

- Problem: when `bootstrap_teacher` or `list_teacher_courses` throws inside `initAllCourses()`, [shared/data.js:602](shared/data.js) sets `_useSupabase = false` and never flips it back. Every persist function then short-circuits at the `!_useSupabase` gate. A single transient network/JWT failure on page load silently demotes the entire session to LS-only; the teacher keeps editing, none of it lands canonically, sign-out wipes LS, full session of work is gone with no UI signal. Most likely cause of in-the-wild "elements being dropped" reports.
- Fix:
  1. Wrap the bootstrap block at [data.js:559-603](shared/data.js) in a retry-with-backoff (3 attempts at 1s/2s/4s) before flipping `_useSupabase = false`.
  2. After the flip, schedule a recovery probe on a 30-60s timer that re-calls `bootstrap_teacher`. On success, flip `_useSupabase` back to true and drain any persist calls that were queued during the degraded window (wire through the existing offline queue at [shared/offline-queue.js](shared/offline-queue.js)).
  3. Surface the degraded state via a persistent banner driven by `_syncStatus` / the existing `showSyncToast` helper: "Saving locally — cloud sync paused." Click triggers an immediate retry probe.
- Acceptance: simulate `bootstrap_teacher` 500 once on page load; verify the persistent banner appears; teacher edits a score; recovery probe at ~30s succeeds; the score lands in `score` table without manual reload. Add `tests/persistence-degraded-recovery.test.js` mocking the failure + recovery sequence.

### P6.2 · Replay local-cid writes when canonical course UUID arrives `[agent-ready]` — HIGH

- Problem: [shared/data.js:3321 createCourse](shared/data.js) returns a temporary local id (`c{ts}{rand}`) before `create_course` resolves. During the in-flight window, every persist function (`saveStudents`, `saveAssessments`, `saveScores`, `saveModules`, `saveRubrics`, `saveNotes`, `saveGoals`, `saveReflections`, `saveCustomTags`, `saveLearningMap`, etc.) short-circuits at `!_isUuid(cid)`. Only the curriculum wizard waits for the canonical id via [dash-class-manager.js:249 `_awaitCanonicalCourse`](teacher/dash-class-manager.js). Other entry surfaces (inline student add, immediate score entry) write to LS under the local id and never replay against the canonical UUID. On reload the new class hydrates from Supabase with zero rows.
- Fix:
  1. Maintain a `_pendingLocalCids` map populated when `createCourse` runs and cleared on RPC resolution.
  2. In each persist function with `!_isUuid(cid)` early-return, redirect to a `_pendingCidQueue[localId]` instead.
  3. In the `create_course.then` callback at [data.js:3361](shared/data.js), after the `COURSES` rekey: migrate every `gb-{kind}-{localId}` LS key to `gb-{kind}-{canonicalId}` (kinds: students, scores, assessments, modules, rubrics, statuses, notes, goals, reflections, flags, customTags, learningMaps, observations, sectionOverrides, termRatings) and drain `_pendingCidQueue[localId]` against the canonical id.
- Acceptance: throttle network to Slow 3G; create class; immediately add a student and enter a score; reload; both present. Add `e2e-real/persistence/course-creation-race.spec.js` to lock this in.

### P6.3 · Sync custom-tag deletions to Supabase ✅ done 2026-05-01

- [migrations/20260501_add_delete_custom_tag.sql](migrations/20260501_add_delete_custom_tag.sql) adds two RPCs: `delete_custom_tag(p_id uuid)` for the primary by-id path and `delete_custom_tag_by_label(p_course_id, p_label)` for the cross-session fallback (LS only stores labels; tags created in a previous session don't have a cached uuid client-side). Both are SECURITY DEFINER with explicit teacher-id ownership checks; idempotent (already-deleted = success).
- [shared/data.js](shared/data.js) `_persistCustomTagsToCanonical` now diffs prev vs. arr in both directions: adds dispatch `create_custom_tag` and cache the returned uuid in a new per-course `_customTagIds` map (mirrors the `_noteIds` pattern); removes dispatch `delete_custom_tag(p_id)` when a uuid is cached, falling through to `delete_custom_tag_by_label(cid, label)` when the user is removing a tag from a previous session. `window.v2.deleteCustomTag` and `window.v2.deleteCustomTagByLabel` exposed for direct callers; `window.createCustomTag` updated to populate `_customTagIds` from the response.
- Tests: [tests/persistence-custom-tag-delete.test.js](tests/persistence-custom-tag-delete.test.js) — 8 cases covering uuid caching on add, by-id delete with cached uuid, by-label fallback for cross-session deletes, only-removed-labels fire deletes, all three skip gates (demo mode, !\_useSupabase, non-uuid cid), full add-then-remove regression guard. All pass; 841 in the wider suite.
- Browser preview: with demo mode disabled and Supabase mocked, end-to-end add → remove cycle dispatches `create_custom_tag` then `delete_custom_tag` with the cached uuid; cross-session simulation (clear `_customTagIds`, then remove) falls through to `delete_custom_tag_by_label` correctly. No console errors.
- Live deploy still owed: apply the migration to `gradebook-prod` once user is ready (`[user-blocked]` per the established cadence).

### P6.4 · Score-path null-tag/null-value guard ✅ closed-as-theoretical 2026-05-01

- Investigation: every UI call to `upsertScore` was traced — [page-gradebook.js:1683](teacher/page-gradebook.js), [:1753](teacher/page-gradebook.js), [:2239](teacher/page-gradebook.js), [:2473](teacher/page-gradebook.js), [:2509](teacher/page-gradebook.js); [page-assignments.js:1788](teacher/page-assignments.js), [:1828](teacher/page-assignments.js), [:1863](teacher/page-assignments.js); [tab-grade.js:707](teacher-mobile/tab-grade.js), [:757](teacher-mobile/tab-grade.js). Every site passes (a) a truthy `tid` sourced from `data-tid` / `tagIds` / dataset, and (b) a numeric `scoreVal` (0 for clear, 1-4 for proficiency, integer ≥0 for points). No path passes `tid=null` or `scoreVal=null`.
- The guard at [shared/data.js:3156](shared/data.js) (`if (_isUuid(tid) && intVal != null)`) is defensive code, not a silent drop in real use. The cases it skips are correct skips: demo mode is blocked one gate up; non-UUID tid means the canonical tag row doesn't exist server-side so a tag-score upsert would 500; intVal=null is only reachable from non-UI callers (test fixtures) and there's nothing to write. The "upsert_score for overall non-tag cells" concern raised in the audit was based on a misreading — points-mode cells return early at [page-gradebook.js:1666](teacher/page-gradebook.js) and route through `setPointsScore` → `upsertCellScore`, never through `upsertScore` with `tid=null`.
- Code comment at [shared/data.js:3146](shared/data.js) updated to record the assumption + audit-trace conclusion so future readers don't re-re-litigate it.
- No code change shipped beyond the comment. Skipped: the proposed `tid=null → upsert_score` and `intVal=null → clear_score` fall-throughs would only fire in shapes no caller produces.

### P6.5 · Dispatch observation deletes when an assessment is deleted ✅ done 2026-05-01

- New helper `deleteAssessmentObservations(cid, aid)` in [shared/data.js](shared/data.js) (next to `deleteQuickOb`): filters the obs blob, captures matching observation ids, dispatches `delete_observation(p_id)` for each UUID via the existing `_persistObservationDelete` helper, then writes the cleaned blob through `saveQuickObs`. Returns the number of removed observations. Exposed on `window.GB`.
- [teacher/page-assignments.js](teacher/page-assignments.js) `deleteAssess` — replaced the inline `getQuickObs` + bare `saveQuickObs` cleanup with the new helper. Same LS behavior plus the missing canonical dispatch.
- [teacher/page-gradebook.js](teacher/page-gradebook.js) `deleteAssess` (context menu) — bonus fix surfaced during the audit: this branch was previously skipping status cleanup AND observation cleanup entirely (only assessments + scores were touched), leaving status pills + observations orphaned in both LS and the canonical store. Now mirrors the page-assignments.js path: status filter + `saveAssignmentStatuses` + `deleteAssessmentObservations`.
- Tests: [tests/persistence-assessment-delete-observations.test.js](tests/persistence-assessment-delete-observations.test.js) — 8 cases covering selective filtering by aid, RPC dispatch per UUID, no-match no-op, non-UUID id skip, demo-mode + `_useSupabase=false` short-circuits, falsy-input safety, full integration regression guard. All pass; 849 in the wider suite.
- Browser preview: with demo mode disabled and Supabase mocked, seeded 3 observations across 2 students (2 linked to AID, 1 to OTHER_AID); calling `deleteAssessmentObservations(cid, aid)` removed the 2 matching observations, kept the unrelated one, dispatched `delete_observation` exactly twice with the correct ids. No console errors.

### P6.6 · Bulk save{QuickObs,Flags,Goals,Reflections} fallbacks ✅ closed-as-theoretical 2026-05-01

- Investigation: traced [schema.sql:179-388](schema.sql) FK declarations for every per-enrollment table — `note`, `goal`, `reflection`, `section_override`, `attendance`, `term_rating`, `observation_student`, `score`, `tag_score`, `rubric_score` all declare `enrollment_id → enrollment on delete cascade`. `enrollment.student_id → student on delete cascade` so a student hard-delete cascades through enrollment to every dependent table.
- Key finding: `withdraw_enrollment` is a **soft delete** (sets `withdrawn_at`, doesn't `DELETE`). All v2 read paths filter `withdrawn_at IS NULL` (verified in [migrations/20260429_get_gradebook_full_hydration.sql:42](migrations/20260429_get_gradebook_full_hydration.sql), [migrations/20260429_get_gradebook_categories.sql:43](migrations/20260429_get_gradebook_categories.sql), and [migrations/20260429_restore_live_profile_and_sync_read_paths.sql:96](migrations/20260429_restore_live_profile_and_sync_read_paths.sql)). Server-side rows are **intentionally preserved** so re-enrollment can restore the full record.
- That means the bulk LS cleanups identified in the audit (`saveGoals`/`saveReflections`/`saveQuickObs`/`saveFlags` called from [teacher/ui.js:796-811](teacher/ui.js) and [teacher/dash-class-manager.js:558-563](teacher/dash-class-manager.js) during student delete) are visual-only refreshes — the server state they "miss writing to" is exactly the state we want preserved. No server-side orphans accumulate from this code path.
- For full hard-delete (when P6.7 wires `delete_student`), the schema cascade through `enrollment` handles every dependent table automatically. No additional client-side dispatch is needed.
- One minor future consideration tracked here: `delete_student` would leave top-level `observation` rows surviving after their `observation_student` join rows cascade-delete. UI read paths filter implicitly via the join, so it's benign in practice, but a server-side cleanup pass on observations with zero enrollments could be added if it ever surfaces.
- No code change shipped. Single-action UI paths (`toggleFlag`, `createObservation`, per-section goal/reflection saves at [page-student.js:166-194](teacher/page-student.js)) already dispatch the right RPCs and stay correct.

### P6.7 · Wire hard-delete student via window.v2.deleteStudent ✅ done 2026-05-01

- Decision: hard delete only. Single button, single dialog, no soft-delete safety net. Rationale: xlsx row 73's "Delete (full, cascade)" expectation matches; schema cascade through `enrollment` is clean; today's soft-delete + undo flow created a duplicate enrollment row in the canonical store.
- [teacher/ui.js:762 deleteStudent](teacher/ui.js) — switched LS cleanup from per-entity `saveX` calls (which dispatched redundant RPCs) to direct `_saveCourseField` writes, then fires `window.v2.deleteStudent(sid)` once at the end. Schema FK cascade through `enrollment` handles every dependent (`note`, `goal`, `reflection`, `section_override`, `attendance`, `term_rating`, `score`, `tag_score`, `rubric_score`, `observation_student`). Demo mode + `_useSupabase=false` skip the canonical RPC; LS cleanup still runs.
- [teacher/dash-class-manager.js](teacher/dash-class-manager.js) — dialog text updated to "Permanently delete X and all their data? This cannot be undone." Same `'danger'` style.
- Mobile parity: `teacher-mobile/` has no delete-student entry point (verified via grep). Mobile is roster-read-only for deletion.
- Undo semantics: kept the 5-second undo toast. With hard-delete, undo recreates a new student under a fresh UUID via `create_student_and_enroll` and the existing diff-based saves repopulate the related data. From the teacher's perspective the data is back; under the hood it's a new record. This is cleaner than today's broken flow (which created a duplicate enrollment alongside the soft-deleted one).
- Tests: [tests/persistence-student-hard-delete.test.js](tests/persistence-student-hard-delete.test.js) — 8 cases covering RPC dispatch, withdraw_enrollment NOT called, every per-student LS field cleaned, composite-key statuses preserve other students, snapshot completeness for undo, demo-mode + `_useSupabase=false` short-circuits, full integration regression guard. All pass; 857 in the wider suite.
- Browser preview: with demo mode disabled and Supabase mocked, seeded a student with scores, goals, reflections, notes, flags, observations, statuses, term ratings; clicking through `deleteStudent` fired `delete_student(p_id=SID)` with no `withdraw_enrollment` call, every per-student LS field cleared, other students' data preserved (`OTHER_SID:AID` status remained `LATE`). Undo path fired `create_student_and_enroll` for the fresh-UUID recreate. No console errors.
- Live deploy still owed: confirm `delete_student` RPC is deployed on `gradebook-prod` (likely already there; was added 2026-04-20 per the schema.sql:512 inline comment).
- Out of scope (potential follow-ups): "ghost observation" cleanup — when `delete_student` cascades, top-level `observation` rows survive after their `observation_student` join rows cascade-delete. UI read paths filter implicitly so it's invisible, but a server-side cleanup pass (or extending `delete_student` to also delete observations with zero remaining join rows) would tighten data hygiene. Bulk delete via the class manager's bulk-edit mode wasn't audited; if exposed it should route through the same `deleteStudent` per-id loop today.

## District pilot readiness

Pilot-audit findings from 2026-04-23. Ordered: blockers first, then HIGH, then MEDIUM.

### P5.1 · Multi-tenancy: school_id / district_id `[needs-design]` — BLOCKER

- Current state: flat `teacher.id = auth.uid()`, no tenancy hierarchy ([schema.sql:37-57](schema.sql)). A 15-school district today = 15 Supabase projects.
- Decisions owed before any code changes:
  1. One district = one Supabase org, or one district = rows scoped by `district_id` in a single schema?
  2. If scoped: put `district_id` on `teacher` only, or propagate to `course` / `student` for read-path efficiency?
  3. A school-admin can see all teachers in their school — how does RLS express that? Probably a `teacher_membership(teacher_id, school_id, role)` table joining into every ownership predicate.
  4. Migration path for existing single-teacher accounts: freeze as `school_id = null` "standalone teacher" or require self-assignment on next login?
- Blocks P5.2 and P5.3.

### P5.2 · District / school admin role + admin UI + bulk provisioning `[needs-design]` — BLOCKER

- Current portals: teacher / student / parent only. No admin tier.
- Depends on P5.1 (tenancy model).
- Decisions owed: admin UI mounts at `/admin/`? bulk-invite via CSV upload? roster sync with external SIS (PowerSchool, MyEducationBC)?
- Acceptance deferred until P5.1 shape is known.

### P5.3 · RLS cross-tenant integration tests `[needs-design]` (infra) + `[agent-ready]` (implementation) — BLOCKER

- Current state: [tests/security-data.test.js](tests/security-data.test.js) only checks LS key format. `e2e/` specs use `mockAuth` — no test proves teacher A cannot read teacher B's rows against a real DB.
- Infra decision owed (user): spin up a dedicated Supabase "fullvision-ci-rls" project (cheap; ~$25/mo), put service-role key in GitHub Actions secrets.
- Once infra is ready (agent-ready):
  - `tests/rls/` directory, one file per entity group (course, student, enrollment, score, observation, assessment, report, tag, term_rating).
  - Helper `tests/rls/setup.mjs` provisions two teachers via Admin API, exposes `withTeacher(...)` client factory, `resetFixtures()` calls a server-side `fv_ci_reset_rls_fixtures()` RPC that truncates and re-seeds.
  - Matrix per table: teacher-A select, update, delete, insert-with-B's-id, mutation-RPC-with-B's-id, anonymous select, soft-deleted-teacher access.
  - `e2e/rls-cross-tenant.spec.js`: seed teacher B with a student named `SENTINEL_VALUE_XYZ`; sign in as teacher A; navigate every route; assert the string never appears in HTML.
- CI gate: `paths:` filter so the job runs only when `schema.sql` / `shared/data.js` changes.
- Depends on P5.1 (what RLS actually enforces across schools).

### P5.4 · Demo-mode auth bypass ✅ done 2026-04-23

- Landed: companion-token gate. [login-auth.js](login-auth.js) legitimate demo entry paths (`?demo=1` URL + "Try Demo Mode" button) now set a random UUID at `localStorage['gb-demo-mode-token']` alongside `gb-demo-mode=1`. New [window.isDemoMode()](shared/supabase.js) helper requires both flags (token ≥16 chars) and is used by `requireAuth()` and [initAllCourses()](shared/data.js). A lone `gb-demo-mode=1` written in DevTools after sign-out is stripped as an orphan; demo mode does not activate.
- Tests: [tests/demo-mode-gate.test.js](tests/demo-mode-gate.test.js) — 8 cases covering both flags / lone flag / lone token / short token / empty token plus `requireAuth` orphan-strip. Full suite 765/765 passing.
- Browser preview: legitimate "Try Demo Mode" flow verified (27-student seed, full widgets); attack path (lone `gb-demo-mode=1`) confirms `isDemoMode() === false` and orphan stripped. Production-redirect leg to `/login.html` is environment-gated by `_isDevMode` — will take effect automatically on Netlify since `__ENV.SUPABASE_URL` is set there; un-testable locally without stubbing.
- Deploy: bump [sw.js](sw.js) `CACHE_NAME` when shipping. No SQL migration needed.

### P5.5 · Session hardening ✅ done 2026-04-23

- Fix A landed: [shared/supabase.js](shared/supabase.js) `requireAuth()` now always round-trips `sb.auth.getUser()` (server-side JWT validation); the old localStorage `expires_at` fast-path is gone. Result is cached via `_authCheckPromise` so repeated `requireAuth()` calls on one page load share one server round-trip. Demo-mode + dev-mode branches unchanged.
- Fix B landed: `_ECHO_GUARD_MS` in [shared/data.js](shared/data.js) reduced `35000` → `8000`. The old 35s window could swallow a second legitimate write that landed inside it; 8s still covers the p99 RPC round-trip (~3s) with headroom.
- Tests: [tests/session-hardening.test.js](tests/session-hardening.test.js) — 5 cases covering getUser-hit, forged-expires_at rejection, getUser-throws fallback, per-page-load caching, and the 8000ms source-pin. Full suite 804 passed + 1 skipped.

### P5.6 · Idempotency retrofit ✅ done 2026-04-28

- Phase 1 done 2026-04-23: [migrations/20260423_write_path_idempotency.sql](migrations/20260423_write_path_idempotency.sql) retrofits `create_observation`, `create_assessment`, `duplicate_assessment`, `create_custom_tag`, `upsert_note`, `create_student_and_enroll`. Applied to `gradebook-prod` as `fullvision_v2_write_path_idempotency`; cron `fv_idempotency_cleanup` scheduled (`*/15 * * * *`, 24h retention).
- Phase 2 done 2026-04-23: [migrations/20260423_write_path_idempotency_phase2.sql](migrations/20260423_write_path_idempotency_phase2.sql) retrofits the remaining 13 RPCs — `create_course`, `duplicate_course`, `import_roster_csv`, `import_teams_class`, `import_json_restore`, `upsert_observation_template`, and the null-id insert branch of `upsert_category`, `upsert_module`, `upsert_rubric`, `upsert_subject`, `upsert_competency_group`, `upsert_section`, `upsert_tag`. Applied to `gradebook-prod` as three migrations (`fullvision_v2_write_path_idempotency_phase2`, `_imports`, `_import_json_restore`, `_upserts`). All 19 idempotent RPCs verified via `pg_get_function_identity_arguments` to expose the `p_idempotency_key` overload. 0 security advisor lints post-deploy.
- `IDEMPOTENT_ENDPOINTS` allowlist in [shared/offline-queue.js](shared/offline-queue.js) now covers all 19 endpoints. Client-side queue retries pass `entry.id` as the idempotency key so a blip-after-commit replay returns the cached row id instead of duplicating.
- Phase 3 done 2026-04-28: [migrations/20260428_drop_legacy_non_idempotent_overloads.sql](migrations/20260428_drop_legacy_non_idempotent_overloads.sql) drops the 19 legacy (non-idempotent) overloads left behind by phases 1 + 2. Phases 1 + 2 _added_ the new overloads but never _dropped_ the originals, leaving every retrofitted RPC with twin overloads sharing all named params. PostgREST resolves RPCs by named-argument match, so client calls that omitted `p_idempotency_key` were ambiguous and rejected with PGRST203 ("could not choose the best candidate function"). Symptom: every create/upsert from the client failed silently for 5 days (April 23 → April 28) — `console.warn` only, no toast, no UI feedback. User-visible: classes, students, assessments, observations, custom tags, roster imports, learning-map upserts (subjects/sections/tags/categories/modules/competency groups/rubrics), and observation templates appeared to save (localStorage write succeeded) but never persisted server-side. The fix drops the legacy signatures so PostgREST resolves cleanly to the remaining (idempotent) overload; existing client code that omits the key still works because `p_idempotency_key uuid DEFAULT NULL`. Migration includes a `DO $$` verification block asserting exactly 1 overload per RPC name post-drop. Applied to `gradebook-prod`; production restored at 2026-04-28T20:36:16Z.

#### P5.6 follow-up `[agent-ready]` — LOW

- Route the 17 active client call-sites through the offline queue's `_withIdemKey` helper so retries reuse a stable idempotency key. Currently `createCourse`, `createStudentAndEnroll`, `importRosterCsv`, `createAssessment`, `duplicateAssessment`, `createCustomTag`, `upsertObservationTemplate` (direct `sb.rpc`) and `createObservation`, `upsertNote`, `importJsonRestore`, plus all `window.v2.upsert*` helpers (`subject/section/tag/category/module/rubric/competency_group`) bypass the queue and don't pass an idempotency key at all. With the legacy overloads gone the calls succeed (key defaults to NULL → fresh insert), so this is purely a retry-correctness cleanup, not a data-loss bug. Audit in [shared/data.js](shared/data.js) call-sites; the queue's `callOrEnqueue` already mints `entry.id` as the stable key.

### P5.7 · XSS hardening follow-up `[agent-ready]` — HIGH

Day 1 done 2026-04-23: audit script [scripts/audit-innerhtml.mjs](scripts/audit-innerhtml.mjs) shipped; 117 sites catalogued (47 LITERAL + 15 TRUSTED_EXPR + 11 ESC_WRAPPED proven safe, 44 UNKNOWN needing review); `cssColor()` helper in [shared/data.js](shared/data.js) with 7 unit tests; color-format validation migration [migrations/20260423_color_format_validation.sql](migrations/20260423_color_format_validation.sql); gradebook `data-tip` WeakMap refactor; 3 defence-in-depth wraps landed. Audit regenerates via `node scripts/audit-innerhtml.mjs`.

Deploy done 2026-04-23: pre-scan returned 0 malformed rows across course/subject/competency_group/section/module; migration applied to `gradebook-prod` as `fullvision_v2_color_format_validation` (CHECK constraints VALIDATED from day one); [sw.js](sw.js) `CACHE_NAME` bumped `fullvision-v36` → `fullvision-v37`.

Remaining agent work:

- **Regression tests.** Extend [tests/security-sanitize.test.js](tests/security-sanitize.test.js) with: esc() unit tests covering all 5 replacements including the `&` ordering trap; HTML-entity-encoded attack test — input `&lt;img onerror=alert(1)&gt;` → assert no `<img` in `sanitizeHtml()` output (fix [teacher/ui.js:4](teacher/ui.js) to normalize entities before walking if the test fails). New `e2e/xss.spec.js`: sign in, seed entities with `<img src=x onerror=window.__xss=1>` payloads in every user-text field (student firstName/lastName/pronouns, observation body, note body, assessment title, tag label, subject/section/module name, goal text, report narrative); navigate each route; assert `window.__xss` stays undefined.
- **CI gate.** Wire `node scripts/audit-innerhtml.mjs` into [.github/workflows/ci.yml](.github/workflows/ci.yml). Build `xss-allowlist.json` from the ~43 safe sites already classified; script fails CI if any new UNKNOWN site is introduced outside the allowlist. Add `// xss-safe: <reason>` inline comments on allowlisted sites opportunistically.
- **CSP tightening.** Edit [netlify/edge-functions/inject-env.js](netlify/edge-functions/inject-env.js): drop `'unsafe-inline'` from `style-src` (audit/migrate inline `style=` to classes first — biggest subtask), drop `https://cdn.jsdelivr.net` from `script-src` if network trace shows no active use, add `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`. Add `report-to` header → new `netlify/edge-functions/csp-report.js` function logging to `fv_error_log` (depends on T-OPS-02 infra).

### P5.8 · Delete-account → Supabase Auth Admin API `[agent-ready]` — MEDIUM

- Current: `fv_retention_cleanup` hard-deletes the `teacher` row after 30d, cascading all owned data. Does NOT delete the `auth.users` row — orphans the identity. FOIPPA requires full identity removal.
- Fix: either extend `fv_retention_cleanup` to call `auth.admin_delete_user(teacher_id)` (available in Supabase via service-role), OR add a dedicated `fv_delete_auth_user(teacher_id uuid) returns void` SECURITY DEFINER RPC that the cron calls.
- Acceptance: teacher deletes account → 30 days later → `select * from auth.users where id = teacher_id` returns 0 rows; sign-in with that email returns "user not found," not "wrong password."

### P5.13 · Assignment-status enum standardization ✅ done 2026-04-23

- Discovered during a pilot-audit follow-up: NS / EXC / LATE status flags had been silently broken by a three-way string-format inconsistency.
  - Desktop wrote `'notSubmitted'` / `'excused'` / `'late'` to LocalStorage.
  - Mobile wrote `'NS'` / `'EXC'` / `'LATE'`.
  - Server [set_score_status RPC](docs/backend-design/write-paths.sql) accepted only the short form — desktop writes were rejected with `"invalid status"` and silently swallowed.
  - [shared/calc.js](shared/calc.js) only recognized long form — mobile-set flags were visually on but mathematically a no-op.
- Fixed: standardized every client path on `'NS'` / `'EXC'` / `'LATE'` (matching the server CHECK constraint), added a one-time LocalStorage migration, ported desktop's NS-auto-zero behavior to mobile so both surfaces produce identical records.
- Files touched: [shared/calc.js](shared/calc.js) (3 compares), [shared/data.js](shared/data.js) (new `_migrateAssignmentStatusFormat()` called from top of `initAllCourses()`, backs up to `gb-mig-bak-statuses-<cid>`), [teacher/page-assignments.js](teacher/page-assignments.js) (~13 sites + `data-status` attribute values), [teacher/page-student.js](teacher/page-student.js) (3 render compares), [teacher/ui.js](teacher/ui.js) (3 render compares), [teacher-mobile/tab-grade.js](teacher-mobile/tab-grade.js) (NS auto-zero block + score-button UI reset).
- Tests: full suite 792/792 pass. New [tests/data-statuses-migration.test.js](tests/data-statuses-migration.test.js) (8 cases pinning migration idempotency, backup behavior, mixed short+long form, parse failures); extended [tests/mobile-grade.test.js](tests/mobile-grade.test.js) with 3 NS/EXC/LATE behavior tests; extended [tests/calc-integration.test.js](tests/calc-integration.test.js) with `getAssessmentOverallScore` enum contract + legacy-ignored regression guards.
- Browser preview: pre-seeded broken LS `{"st1:sci8a1":"notSubmitted",…}` → on reload, migration rewrote to `{"st1:sci8a1":"NS",…}` with backup intact. Mobile tapping NS on an assessment with active tag scores [PI:3, EM:4, CA:3] zeroed all tags, pill activated, button colors cleared. `getAssessmentOverallScore` returns `0` for NS students, `null` for EXC — calc now behaves as promised.
- Deploy: client-only. [sw.js](sw.js) `CACHE_NAME` bumped `fullvision-v35` → `fullvision-v36`. No SQL migration — server schema is already the source of truth.
- Side effect: desktop statuses now persist to the server for the first time (previously failed silently). Teachers' historical desktop-set flags exist only in LS; next page action that touches a status will sync it up to prod.

### P5.9 · Score-date course-timezone handling ✅ done 2026-04-23

- Landed: new [courseToday(cid)](shared/data.js) helper formats today in the course's timezone via `Intl.DateTimeFormat('en-CA', { timeZone, year, month, day }).formatToParts(new Date())`. Falls back to `America/Vancouver` when the course has no timezone (legacy seed data) and ultimately to UTC if Intl is unavailable.
- Call-site sweep: swapped every `new Date().toISOString().slice(0, 10)` that produces a SCORE date — [shared/data.js](shared/data.js) upsertScore fallback + the bulk-score push path, [teacher/page-gradebook.js](teacher/page-gradebook.js) four score-write call sites, and [shared/calc.js](shared/calc.js) `setSectionOverride` date stamp. Assessment due-date/date-assigned inputs, roster enrollment dates, export filenames, and past-due comparisons were intentionally left alone — they are either user-picked, range filters, or filename-only.
- Tests: [tests/data-create-course-timezone.test.js](tests/data-create-course-timezone.test.js) gained 6 cases covering 11 pm PST → same-day, 11 pm EDT → same-day, UTC pass-through, missing-timezone fallback, unknown-cid fallback, and YYYY-MM-DD zero-padding. Full suite 771/771 passing.
- Browser preview: Demo Mode's `sci8` course has no `timezone` field (legacy seed) — `courseToday('sci8')` correctly returned `"2026-04-23"` at 17:00 PDT while the naive `new Date().toISOString().slice(0, 10)` gave `"2026-04-24"`. Exactly the bug this ticket fixes, now measurable.
- Deploy: client-only change, bump [sw.js](sw.js) `CACHE_NAME` when shipping.

### P5.10 · Deploy + migration + rollback framework `[needs-design]` — MEDIUM

- Current: [schema.sql](schema.sql) is a readable snapshot, not replayable. `migrations/` didn't exist before 2026-04-23. No documented rollback. No runbook for district onboarding or deploy verification. Service-worker cache-busting ([sw.js](sw.js) `CACHE_NAME`) is bumped manually per release.
- Decisions owed:
  1. Adopt a migration tool (Supabase CLI migrations? Flyway? Stay with hand-numbered `migrations/*.sql` + forward-only convention?). Affects every future DB change.
  2. Rollback policy: forward-only with fix-up migrations, or reversible up/down pairs?
  3. Service worker contract: does a schema change auto-bump `CACHE_NAME` in the build step, or is it always manual?
- Once decided (agent-ready follow-ups): deploy runbook in codex.md, district-onboarding runbook in codex.md, SW cache-bust hook in [scripts/build.sh](scripts/build.sh).

### P5.11 · Soft-delete on assessment / score / observation `[needs-design]` — MEDIUM

- Current: only `teacher` and `course` have `deleted_at` ([schema.sql:42, 71](schema.sql)). Assessment / score / observation deletes are permanent. No audit recovery if a teacher accidentally deletes a column of scores.
- Decision owed: which entities warrant soft-delete, and for how long? Trade-off is storage cost + query cost of the `deleted_at IS NULL` filter on very large tables (score especially).
- Once decided (agent-ready): migration adds `deleted_at timestamptz` + read-path filters + retention cron extension.

### P5.12 · Idle-timeout warning for generic routes `[agent-ready]` — LOW

- Current: [shared/supabase.js:322-341](shared/supabase.js) fires signOut after 30 min of no mousemove/keydown/touchstart/scroll. Long-form writing contexts (report builder, questionnaire narrative) are already protected via `isLongFormAuthContextActive` + `markLongFormSessionExpired` which preserves draft state. Ordinary navigation (dashboard, gradebook, assignments) gets silent signOut with no warning.
- Fix: at 28 min, show a non-blocking "You'll be signed out in 2 minutes — click to stay signed in" toast. Click resets the idle timer; ignoring runs the existing signOut at 30 min.
- Acceptance: load /teacher/app.html, leave the tab idle for 28 min (test harness can shorten `IDLE_TIMEOUT`), assert toast appears with a dismiss button; click "Stay signed in" → idle timer resets, no signOut at 30 min.

## Deferred / external work

### D1 · Term-rating narrative auto-generate

- Deferred to the separate external workstream/repo.
- Keep the button hidden in this repo until that workstream is ready.

### D2 · Cross-year historical context on student profiles

- Explicitly deferred to v2+.
- Current product remains course-scoped per active design decisions.

### D3 · Offline read-side caching beyond the current write queue

- The write queue is implemented. Reads also work offline today via LocalStorage fallback: [getScores in shared/data.js:3960](shared/data.js:3960) and the sibling read paths for students, observations, notes, flags all fall back to `localStorage.getItem('gb-<type>-<cid>')` when the cache is cold, and LocalStorage is populated by every write. The offline banner at [teacher/ui.js:27](teacher/ui.js:27) and [teacher-mobile/index.html:176](teacher-mobile/index.html:176) lets the user know they're offline.
- What's deferred is the ARCHITECTURAL upgrade: IndexedDB (more storage headroom than LocalStorage's ~5-10 MB) + structured delta-refresh on reconnect (bandwidth-efficient `?since=<timestamp>` diffs vs. full refetch). Not pilot-blocking.

### D5 · Migrate Demo Mode to `buildDemoSeedPayload`

- Local Demo Mode still depends on `shared/seed-data.js` (legacy camelCase, string IDs).
- `buildDemoSeedPayload` uses v2 snake_case schema; a full client-side hydration layer would be needed to swap. Deferred until the schema gap is smaller or maintenance cost becomes acute.

### D4 · UI surfaces deferred beyond the current repo scope

- Parent portal
- Student portal
- File uploads / attachments
- Calendar / schedule view
- Email / push notifications

### D6 · Redesigned Teams import

- The original Microsoft Teams CSV/XLSX import wizard was removed on 2026-04-23 (commit `f618f9b`) because it never dispatched through the v2 `import_teams_class` RPC and silently lost data on sync.
- The server-side `import_teams_class` RPC is still deployed on `gradebook-prod` and untouched — a future client flow can call it once redesigned.
- Before reintroducing: decide on the parse surface (reuse SheetJS vs. CSV-only), define the payload-normalization layer that aligns with the RPC, and spec the UI wizard.

### D7 · Curriculum bundle — already lazy-loaded ✅

- Both `curriculum_data.js` (971 KB) and `curriculum_by_course.json` (1.3 MB) are fetched on demand by [`loadCurriculumIndex()` in shared/data.js:2724](shared/data.js:2724), NOT at page load. [teacher/app.html:34](teacher/app.html:34) deliberately omits the `<script>` tag for `curriculum_data.js`; it's injected lazily.
- [sw.js](sw.js) lists `/curriculum_data.js` in `PRECACHE_URLS`, but service-worker install runs AFTER the page is interactive — it's a background cache warm-up, not a blocking download.
- Further splitting `curriculum_by_course.json` into per-course files would only help if teachers frequently switch between courses AND have network-constrained devices. Revisit if real teacher feedback flags slow first-load of a specific route; otherwise leave alone.

### D8 · Gradebook DOM virtualization `[agent-ready, deferred]`

- What IS in place: network/DB fetch pagination. [\_selectCourseTable in shared/data.js:632-665](shared/data.js) pages past PostgREST's 1000-row cap when loading scores; [`p_page_size`](shared/data.js) is passed on bulk reads. A course with 5k scores correctly loads every row.
- What is NOT in place: DOM-side virtualization. [page-gradebook.js:830](teacher/page-gradebook.js) does `sortedStudents.forEach(...)` and builds every row into an HTML string assigned via innerHTML. A class with 25-30 students × 50-80 assessments = 1.5-2.4k cells, which modern browsers handle without issue. Degradation shows up around 8-10k cells (year-end 30-student class with 200+ assessment columns) and becomes noticeable on low-end Chromebooks.
- Fix if needed: virtualize the row list (IntersectionObserver + fixed-height row tracks, render only the visible window).
- Deferred because current pilot-class sizes stay comfortably under the degradation threshold. Revisit if teacher feedback reports year-end jitter, or if a class hits ~10k cells.

### D9 · Accessibility audit `[agent-ready, deferred]`

- Current: [e2e/accessibility.spec.js](e2e/accessibility.spec.js) checks skip link + 3 aria-labels. Not a WCAG 2.1 AA audit.
- Fix: wire axe-core into Playwright; add keyboard-nav + color-contrast specs per key route.
- Deferred because no district has requested formal accessibility sign-off. Revisit when asked.
