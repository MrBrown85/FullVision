# Persistence Gaps Audit — 2026-05-01

Cross-checked every "must persist" row in [fullvision-user-inputs.xlsx](../../fullvision-user-inputs.xlsx) (313 rows, 22 sections) against the actual write paths in [shared/data.js](../../shared/data.js). The team's own audit ([gradebook-supabase-persistence-audit.md](gradebook-supabase-persistence-audit.md)) covers the gradebook surface end-to-end, but several systemic and entity-specific gaps remain. Listed in priority order; the top three are the most likely cause of the user-reported "elements being dropped."

## P0 — Silent fail-closed: `_useSupabase = false` is a one-way flip

**File:** [shared/data.js:600-602](../../shared/data.js#L600), assignments at lines 111, 527, 540, 602.

```js
} catch (e) {
  console.warn('v2 course load failed, falling back to localStorage:', e);
  _useSupabase = false;
}
```

If `bootstrap_teacher` or `list_teacher_courses` throws **once** during `initAllCourses()` — transient 500, JWT refresh hiccup, network blip — the flag flips to `false` for the rest of the session. The only path that flips it back to `true` is the `if (session && session.user)` branch on init (line 540), which is not re-checked after the failure.

Every persist function then short-circuits at the same gate:

```js
if (localStorage.getItem('gb-demo-mode') === '1' || !_useSupabase || !_isUuid(cid)) return;
```

Symptom: user keeps editing for an entire session; on reload (next page load reads from canonical Supabase), every edit since the failure is gone.

**Fix:** retry `bootstrap_teacher` on a backoff, or schedule a recovery check that re-flips `_useSupabase` once Supabase is reachable again. Show a persistent UI banner while degraded so the teacher knows their writes are LS-only.

## P1 — `cid`-UUID race during course creation

**File:** [shared/data.js:3321-3378](../../shared/data.js#L3321) (createCourse), [teacher/dash-class-manager.js:249-266](../../teacher/dash-class-manager.js#L249) (`_awaitCanonicalCourse`).

`createCourse` mints a local id (`c{ts}{rand}`) synchronously, fires `create_course` async, and re-keys `COURSES[localId]` → `COURSES[canonicalId]` when the RPC returns. Only the curriculum wizard has a poll-then-dispatch helper (`_awaitCanonicalCourse`) that waits for the canonical id before persisting subjects/sections/tags.

Other code paths (students, assessments, scores, modules, rubrics, notes, goals, reflections, custom tags, term ratings, attendance, observations) hit the `!_isUuid(cid)` short-circuit on every persist call during the in-flight window. Their LS writes land under `gb-students-{localId}`, `gb-scores-{localId}`, etc., and are **never replayed** under the canonical UUID once it arrives.

Reproduction:

1. Throttle network to "Slow 3G" in DevTools.
2. Click "Add class", give it a name. Course appears immediately under local id.
3. Immediately add a student and enter a score before the network round-trip resolves.
4. Reload. Student and score are gone — they were saved under `local-xxx` keys but the canonical UUID has no rows.

**Fix:** generalize `_awaitCanonicalCourse` to a "pending-cid queue" applied at every entry to a persist function: when `cid` is non-UUID and `__pendingLocalId` resolution is in flight, queue the operation; on resolution, replay the queue against the canonical id and migrate the LS keys.

## P2 — `removeCustomTag` is LS-only (custom tag deletion never syncs)

**File:** [shared/data.js:6388-6416](../../shared/data.js#L6388) (`_persistCustomTagsToCanonical`), [shared/data.js:6426-6431](../../shared/data.js#L6426) (`removeCustomTag`).

`_persistCustomTagsToCanonical` only iterates the _new_ array for inserts (`if (!label || prevSet[label]) return;`). It never iterates `prev` to find labels missing in the new array. There is no `delete_custom_tag` RPC call anywhere.

Reproduction:

1. Add a custom tag "Foo".
2. Confirm it lands in Supabase `custom_tag` table.
3. Remove "Foo" via UI.
4. Reload. "Foo" reappears (canonical row was never deleted).

**Fix:** add a delete branch to `_persistCustomTagsToCanonical` that diffs the prev set and calls a `delete_custom_tag(p_id)` RPC (will need to be added if it doesn't exist server-side).

## P3 — Overall (non-tag) score writes through `upsertScore` skip the RPC

**File:** [shared/data.js:2807](../../shared/data.js#L2807) (the guard inside `_persistScoreToCanonical`).

```js
if (_isUuid(tid) && intVal != null) {
  /* upsert */
}
```

Both conditions must hold for any of `upsert_score`, `upsert_tag_score`, or `upsert_rubric_score` to fire from this function. Cases that fall through:

- `tid === null` (overall cell, no tag) and `intVal != null` — no RPC.
- `tid` UUID and `intVal === null` (clear via inline edit, not via the explicit clear-context-menu) — no RPC.

Mitigation in place: `setPointsScore` (line 5472) calls `window.upsertCellScore` (line 2913) directly when sid/aid are both UUIDs. So the points-mode entry surface is covered. But any UI path that calls `upsertScore(cid, sid, aid, null, val)` for an overall non-tag score relies on the LS-only path.

Reproduction: I did not confirm a UI path that calls `upsertScore` with `tid=null`; this needs UI-level tracing of inline edits in [teacher/page-gradebook.js:1683](../../teacher/page-gradebook.js#L1683) and [teacher/page-gradebook.js:2473](../../teacher/page-gradebook.js#L2473).

**Fix:** in `_persistScoreToCanonical`, when `tid` is null and `intVal != null`, fall through to `upsert_score` (the overall-cell RPC) instead of skipping. When `intVal === null`, fall through to `clear_score`.

## P4 — `delete_student` RPC exists but is never called from UI

**File:** [shared/data.js:6277-6279](../../shared/data.js#L6277), [teacher/ui.js:762](../../teacher/ui.js#L762).

UI's `deleteStudent` does LS cleanup then triggers `saveStudents` → `withdraw_enrollment` (per-id diff). The `student` row itself stays in Supabase. Whether this is intentional depends on multi-course semantics (a `student` may have other enrollments). The xlsx row 73 says "Delete (full, cascade)" with note "SB (partial)", suggesting the intent is full deletion.

**Resolve:** confirm intent with product. If full delete is desired, wire `window.v2.deleteStudent(sid)` from the UI delete handler when this is the student's last/only enrollment.

## P5 — Dangling observations after assessment delete

**File:** [teacher/page-assignments.js:1538-1547](../../teacher/page-assignments.js#L1538).

When deleting an assessment, the UI cleans up LS observations whose `assignmentContext.assessmentId === aid` via `saveQuickObs(cid, obs)`. But `saveQuickObs` ([data.js:5572](../../shared/data.js#L5572)) is pure LS-write; it does NOT dispatch any `delete_observation` calls. Observations are independent rows on the server; FK cascade from `assessment` does not reach them (they reference an assessment via JSON config, not a real FK).

Reproduction: create an observation linked to assessment X; delete assessment X; reload. The observation reappears with a stale `assignmentContext` pointing to a non-existent assessment.

**Fix:** in the assignment-delete handler, dispatch `delete_observation` for each affected observation before LS cleanup, OR update `saveQuickObs` to diff and dispatch deletes through `_rpcOrNoop('delete_observation', …)`.

## P6 — Bulk `saveQuickObs`, `saveFlags` paths skip Supabase

**Files:** [shared/data.js:5572](../../shared/data.js#L5572) (`saveQuickObs`), [shared/data.js:5507](../../shared/data.js#L5507) (`saveFlags`).

```js
function saveQuickObs(cid, obj) {
  _saveCourseField('observations', cid, obj);
}
function saveFlags(cid, obj) {
  _saveCourseField('flags', cid, obj);
}
```

These are bare LS-only writes. The single-action paths (`createObservation`, `toggleFlag`) call the right RPCs explicitly, so direct user actions are covered. But anywhere the UI calls `saveQuickObs` / `saveFlags` in bulk (e.g. cleanup routines, imports, undo), the changes are lost on the canonical store.

Audited callers:

- `saveQuickObs`: ui.js:811 (delete-student cleanup), page-assignments.js:1547 (delete-assessment cleanup) — both could leave server-side rows orphaned.
- `saveFlags`: only used inside `toggleFlag` itself, which separately fires `setEnrollmentFlag`. This one is OK in current code, but the standalone `saveFlags` is a footgun for any future caller.

**Fix:** apply the same "Wire …saves through Supabase fallbacks" pattern that already exists for `saveScores`, `saveAssignmentStatuses`, `saveCategories`, `saveLearningMap`, and `saveAssessments`. Add a `_persistObservationsToCanonical` and `_persistFlagsToCanonical` that diff prev vs. next and dispatch the right deletes/upserts.

## P7 — `saveGoals` / `saveReflections` are LS-only (covered by per-section save path, not by bulk)

**Files:** [shared/data.js:5545-5547](../../shared/data.js#L5545), [shared/data.js:5558-5560](../../shared/data.js#L5558).

Identical pattern to P6. The student-page UI handlers ([page-student.js:166-169](../../teacher/page-student.js#L166), [:190-194](../../teacher/page-student.js#L190)) explicitly call `window.v2.saveGoal` / `window.v2.saveReflection` after the LS write, so the per-section edit path is covered. But:

- [dash-class-manager.js:558](../../teacher/dash-class-manager.js#L558): bulk `saveGoals(cid, g)` during student deletion — does not fire the `delete_goal` RPC. Whether this matters depends on whether `withdraw_enrollment` cascades to `goal` rows server-side (need to check schema).
- [ui.js:796-798](../../teacher/ui.js#L796): same as above, in desktop ui.

**Fix:** verify `withdraw_enrollment` cascades to `goal` and `reflection`. If not, wire bulk-delete dispatch into the student-delete cleanup paths.

## P8 — P5.6 idempotency-key bypass on 17 RPC call sites (low-priority but related)

**Source:** [codex.md P5.6 follow-up](../../codex.md), tagged `[agent-ready]` LOW.

`createCourse`, `createStudentAndEnroll`, `importRosterCsv`, `createAssessment`, `duplicateAssessment`, `createCustomTag`, `upsertObservationTemplate`, `createObservation`, `upsertNote`, `importJsonRestore`, plus all `window.v2.upsert*` helpers don't pass an idempotency key. Under network retry, this can produce duplicate inserts. Doesn't drop data per se, but if reconciliation logic prunes one of the duplicates later, it can present as a drop.

## Items confirmed wired (no action)

These were spot-checked during the audit and are persisting correctly:

- Auth (rows 1-17), Course CRUD + policy (18-45), Active course pref (46), Students CRUD + bulk pronouns + roster reorder + CSV import (56-75, 83), Assessments CRUD + collab + tags (86-116), Scores via `setPointsScore` → `upsertCellScore` (119-120), Per-tag/per-criterion scores via `upsertScore` → `_persistScoreToCanonical` when tid is UUID (117-118, 121-126), Score clears (127-129), Status pills (141-144), Single-action observations (145-159), Per-student notes via `saveNotes` → `_persistNotesToCanonical` (168, 170), Per-section goals/reflections via the explicit RPC tail (173-179), Section overrides (182-185), Learning map via `_persistLearningMapToCanonical` (187-204), Modules via `_persistModulesToCanonical` (205-208), Rubrics via `_persistRubricsToCanonical` (211-226, fixed in `b023b2c`), Custom tag **add only** (229), Term ratings (230-241), Report config (245-246), Roster CSV import (256-272).

## Items intentionally LS-only (no action)

- All EPH rows in the xlsx (~94 rows) — search boxes, filter toggles, modal/sheet open-close, drag UI reorders that aren't roster, tab switches, sidebar toggles, undo toasts. Per [CLAUDE.md](../../CLAUDE.md) hard rules.
- `Report period` (xlsx row 47) — confirm with product whether the selected report term should survive reload, or whether resetting to "most recent term" on each load is the intended UX.
- Mobile UI prefs (rows 48-54) — already in `LS pref` and that's correct.
- Teams import (xlsx rows 259-269) — UI was removed 2026-04-23 ([codex.md D6](../../codex.md)). xlsx is stale here.

## Recommended next steps

1. Ship P0 first — it's the most likely cause of the user-reported drops because it can affect a healthy account on a flaky network at any moment.
2. Ship P1 next — newly-created classes are the second-most-likely vector.
3. Ship P2 (custom tag delete) — small fix, eliminates a confirmed reproducible drop.
4. Run a real-account smoke (not Demo Mode) end-to-end against the xlsx checklist after P0/P1/P2 land. P3-P7 may resolve naturally once P0/P1 are fixed and the audit is rerun against verified writes.
