# FullVision v2 — Claude Code Task Queue

Every active task is packaged as a self-contained Claude Code session. Completed items stay in place as historical checkpoints once marked `[DONE]`.

**Branch:** `main`. Historical references to `rebuild-v2` / PR `#76` below are pre-merge notes and should not drive current work.

**Canonical references every session should read first:**

- `docs/backend-design/INSTRUCTIONS.md` — full scope + content strings baked in
- `docs/backend-design/DESIGN-SYSTEM.md` — existing CSS tokens and component patterns
- `docs/backend-design/HANDOFF.md` — implementation log; append per-session entry
- Project `CLAUDE.md` — Demo Mode verification rule, no-AI-refs in git, project title is "FullVision"

**Core rule:** UI stays as literal existing files. Never rewrite visual language. Every new control uses existing CSS classes and tokens. Every UI change is visually verified in Demo Mode before claiming done.

**Already shipped on `main` (2026-04-21):** `T-UI-02` (`cd8922f`), `T-UI-12` (`fd95043`, follow-up `3665af5`), `T-UI-09` + `T-UI-10` (`8ea914b`), `T-UI-06` / `T-UI-07` / `T-UI-08` (desktop offline UX slice, see `HANDOFF.md` session-11), and `T-OPS-01` (live-only completion recorded in `HANDOFF.md` as `5.2-live`).

**2026-04-21 local follow-up:** the desktop category-driven grading slice is now present in the working tree (`shared/data.js`, `shared/calc.js`, `teacher/page-assignments.js`, `teacher/page-gradebook.js`, `teacher/page-reports.js`, `teacher/ui.js`, `teacher/report-blocks.js`). Residual non-desktop / history-style `assessment.type` presentation is tracked as backlog item `P2.6`, not as a new task block here.

---

## How tasks are structured

Each task block has:

- **ID** — stable; do not renumber when tasks complete
- **Goal** — one-line outcome
- **Prompt** — paste verbatim into a fresh Claude Code session
- **Likely files** — starting point; actual touched files may differ
- **Depends on** — list of task IDs that must land first
- **Acceptance** — observable completion criteria
- **Budget** — rough session size

Mark tasks done by editing the ID to **[DONE]** and adding a commit hash where one exists. Do not delete task blocks.

---

## Tier 1 — Backend-to-UI wiring audit (do first)

These unblock the UI tasks and prevent "why isn't my change visible?" confusion.

### [DONE] T-WIRE-01 · Audit legacy save\* calls

**Status:** Completed 2026-04-22. Full audit in `HANDOFF.md` Discovered gaps (2026-04-22 T-WIRE-01). Found two categories of unmigrated writes: (A) score writes in `selectScore`/`setScore`/inline-cell-edit/points-mode/mobile that call `saveScores` instead of `upsertScore`, and (B) all learning-map CRUD in `dash-class-manager.js` that only calls `saveLearningMap` (local) without dispatching `window.v2.*` RPCs. Follow-up tasks T-WIRE-01a, T-WIRE-01b, T-WIRE-02 added below.

**Goal:** Confirm every UI write action calls a `window.v2.*` helper, not a legacy `save*` / `_canonical*` stub.

**Depends on:** nothing

**Acceptance:** Audit report committed to `HANDOFF.md`; any unmigrated UI actions identified with a plan. ✓

---

### [DONE] T-WIRE-01a · Fix score writes in assignments + gradebook + mobile

**Goal:** Replace `saveScores`-only calls in primary score-entry paths with `upsertScore` so scores reach Supabase.

**Prompt:**

```
Read docs/backend-design/HANDOFF.md (T-WIRE-01 discovered gap, 2026-04-22).
The following score-entry paths call saveScores (local only) instead of
upsertScore (which also dispatches _persistScoreToCanonical → v2 RPC):

1. teacher/page-assignments.js — setScore() at line 1035: replace
   saveScores(cid, sc) with upsertScore(cid, sid, aid, tagId, value, ...).
2. teacher/page-assignments.js — selectScore() at line 1062: same fix.
3. teacher/page-assignments.js line 1005: "notSubmitted" writes zeros —
   add upsertScore call per tag after the saveScores call.
4. teacher/page-gradebook.js — startCellEdit commit() at line 1420:
   the commit function builds allScores and calls saveScores(cid, allScores).
   Replace with per-entry upsertScore calls for each (sid, aid, tid) that changed.
5. teacher/page-gradebook.js — setPointsScore at line 3691 in data.js:
   add window.upsertCellScore(cid, sid, aid, raw) call after saveScores.
6. teacher-mobile/tab-grade.js lines 257, 305: same pattern — replace
   saveScores with upsertScore per entry.

upsertScore signature: upsertScore(cid, sid, aid, tid, scoreVal, date, type, note).
It handles both the local cache update (was saveScores) and the v2 RPC dispatch.
_useSupabase and demo-mode guards are already inside upsertScore — no extra checks needed.

Do not change saveRubrics, saveLearningMap, or any non-score save* calls.
Run npm test after changes. Verify score entry in Demo Mode (scores should
persist locally as before; in signed-in mode they should now also reach gradebook-prod).
Commit as "T-WIRE-01a: route score-entry paths through upsertScore for v2 dispatch".
Append to HANDOFF.md activity log.
```

**Likely files:** `teacher/page-assignments.js`, `teacher/page-gradebook.js`, `teacher-mobile/tab-grade.js`, `shared/data.js` (setPointsScore)

**Depends on:** T-WIRE-01

**Acceptance:** `selectScore`, `setScore`, `commit()`, `setPointsScore`, and mobile entry all call `upsertScore`. `npm test` green. Demo-Mode verified.

**Budget:** ~1 hour

---

### [DONE] T-WIRE-01b · Fix "Clear cell" and Teams import dispatch

**Goal:** Wire "Clear cell" to `window.clearScore` and Teams CSV import to `window.v2.importTeamsClass`.

**Prompt:**

```
Read docs/backend-design/HANDOFF.md (T-WIRE-01 discovered gap, 2026-04-22).

Two targeted fixes:

1. teacher/page-gradebook.js line 1275 — "Clear cell" context menu calls
   saveScores(cid, scores) after removing entries. Add a call to
   window.clearScore(enrollmentId, assessmentId) for the remote write.
   window.clearScore wraps clear_score RPC (see shared/data.js).
   The enrollmentId is `sid` and assessmentId is `aid` from the closure.

2. teacher/teams-import.js line 705 — Teams CSV import writes scores with
   saveScores(cid, scores) locally. window.v2.importTeamsClass exists (Phase 4.9).
   However: importTeamsClass takes the full parsed payload (course + students +
   assessments + scores) — not a scores blob. Check how tiParsedFile is structured
   and whether the existing importTeamsClass RPC accepts the Teams-import format.
   If it does, call window.v2.importTeamsClass(tiParsedFile) before saveScores.
   If the format doesn't match, add a comment noting the gap and create a T-BE-02
   task for the adapter.

Run npm test. Commit as "T-WIRE-01b: clear-cell v2 dispatch + Teams import audit".
Append to HANDOFF.md activity log.
```

**Likely files:** `teacher/page-gradebook.js`, `teacher/teams-import.js`

**Depends on:** T-WIRE-01

**Acceptance:** Clear-cell calls `window.clearScore`. Teams import dispatches v2 or gap is documented.

**Budget:** ~30 min

---

### [DONE] T-WIRE-02 · Learning-map CRUD v2 dispatch in dash-class-manager.js

**Goal:** Every subject / section / group / tag mutation in the class manager also calls the matching `window.v2.*` RPC so learning maps persist to Supabase.

**Prompt:**

```
Read docs/backend-design/HANDOFF.md (T-WIRE-01 discovered gap, 2026-04-22) and
shared/data.js to find the window.v2.* learning-map helpers (Phase 4.5):
  window.v2.upsertSubject / deleteSubject / reorderSubjects
  window.v2.upsertCompetencyGroup / deleteCompetencyGroup / reorderCompetencyGroups
  window.v2.upsertSection / deleteSection / reorderSections
  window.v2.upsertTag / deleteTag / reorderTags

teacher/dash-class-manager.js calls saveLearningMap(cid, map) for every mutation
but never calls these RPCs. The full list of call sites is in the HANDOFF discovered-gap entry.

For each mutation function in dash-class-manager.js, add a paired window.v2.* call:
  - cmAddSubject / cmUpdateSubjectName / cmUpdateSubjectColor / cmDeleteSubject
    → v2.upsertSubject (add/update) or v2.deleteSubject (delete)
  - cmAddCompGroup / cmUpdateCompGroupName / cmUpdateCompGroupColor / cmDeleteCompGroup
    → v2.upsertCompetencyGroup / deleteCompetencyGroup
  - cmUpdateStdGroup (assigns section to group) → v2.upsertSection (patch groupId)
  - Tag add / rename / color / delete → v2.upsertTag / deleteTag
  - Drag-reorder for subjects/groups/sections/tags → matching v2.reorder* RPC

Pattern: call saveLearningMap first (keep local in sync), then fire the v2 RPC.
The v2 helpers accept camelCase and handle snake_case mapping internally (see data.js).

Read write-paths.md §4 for the exact RPC payload shapes. The RPCs require
canonical UUIDs; local ids like "custom_abc123" will fail — for local-only objects
(not yet synced), call upsertSubject/Section/Tag which will create and return a
canonical id. Patch the local map with the returned canonical id after the RPC.
This id-patching pattern mirrors what P2.5 did for saveRubrics.

This is a larger task. Work through one function group at a time (subjects, then
groups, then sections/tags). Run npm test after each group. Demo-Mode verification
required. Commit as "T-WIRE-02: learning-map mutations dispatch to v2 RPCs".
Append to HANDOFF.md activity log.
```

**Likely files:** `teacher/dash-class-manager.js`, `shared/data.js`

**Depends on:** T-WIRE-01

**Acceptance:** Creating/editing/deleting subjects, groups, sections, tags in the class manager persists to `gradebook-prod`. Canonical ids are patched back into the local map. `npm test` green. Demo-Mode verified.

**Budget:** 2–3 sessions

---

## Tier 2 — Trivial UI edits (single-file, minutes each)

Can run in any order, in parallel. Each lands as its own commit.

### [DONE] T-UI-01 · Hide term-rating auto-generate button

**Status:** Shipped on `main` 2026-04-21 in `teacher/report-questionnaire.js`. The toolbar no longer renders the deferred `Generate` button; generator code remains behind the hidden UI entry point.

**Goal:** The existing "auto-generate narrative" button in the term-rating editor is hidden in v1. Do NOT wire to a "coming soon" modal — just hide.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U17 and §12.5, hide the term-rating
auto-generate button in v1. The feature is deferred to a separate repo.
Find the button in the term-rating editor (likely under
teacher/reports* or teacher/page-reports.js), add a visibility check
or simply remove it from the rendered output. Do not wire it to a
"coming soon" modal. Do not delete backend code — just hide the UI
entry point. Verify in Demo Mode: open a term rating, confirm no
auto-generate button is visible. Commit as "Hide term-rating
auto-generate button (deferred to external workstream)".
```

**Likely files:** `teacher/reports.css` or `teacher/page-reports.js`; possibly `teacher-mobile/`

**Depends on:** nothing

**Acceptance:** Auto-generate button no longer visible in term-rating editor. Demo Mode verified.

**Budget:** 10–15 min

---

### [DONE] T-COPY-01 · Delete-account dialog 30-day grace copy

**Status:** Shipped on `main` 2026-04-21. Desktop account menu now says `Delete Account`, the dialog copy matches INSTRUCTIONS.md §12.4 exactly, and the live flow is stricter than the original task budget assumed: typed-email confirmation + password re-entry + `v2.softDeleteTeacher()` + sign-out.

**Goal:** Update the existing delete-account confirmation dialog with the exact soft-delete copy from INSTRUCTIONS.md §12.4.

**Prompt:**

```
Per INSTRUCTIONS.md §12.4, the delete-account confirmation dialog
must show this exact copy:

  "Deleting your account hides all your data immediately and
  permanently removes it after 30 days. You can cancel the deletion
  by signing in again within 30 days."

Find the existing delete-account confirmation dialog (likely in
teacher/ somewhere — search for "Delete account" / "deleteAccount").
Replace the current copy with the above. The dialog continues to
require password re-entry (already wired) and the existing backend
already soft-deletes via v2.softDeleteTeacher (HANDOFF Phase 4.8).
Do not change the backend call. Do not add new buttons. Just update
the text. Verify in Demo Mode by opening the delete-account dialog
and reading the copy. Commit.
```

**Likely files:** `teacher/page-settings.*` or wherever the dialog lives; `teacher-mobile/` equivalent if separate

**Depends on:** nothing

**Acceptance:** Copy matches §12.4 exactly. Both desktop and mobile variants updated if they differ.

**Budget:** 15 min

---

### [DONE] T-COPY-02 · Welcome Class banner + auto-seed on first sign-in

**Status:** Shipped on `main` 2026-04-21. `shared/data.js` now seeds an empty Welcome Class once on fresh bootstrap using the existing `shared/demo-seed.js` helper, `teacher/router.js` consumes a one-shot gradebook route hint, and `teacher/page-gradebook.js` renders the dismissible `--focus-banner-*` banner when the seeded sample class is active.

**Goal:** A first-time teacher lands in a populated Welcome Class and sees the in-product banner from INSTRUCTIONS.md §12.3.

**Prompt:**

```
Per INSTRUCTIONS.md §12.3, the Welcome Class banner must render with:

  "Welcome! This is a sample class. Explore the features, then delete
  it anytime from Course Settings."

Two pieces of work:

1. Verify whether first-verified-sign-in actually auto-seeds the
   Welcome Class via shared/demo-seed.js. Current code review says the
   bootstrap path still creates only the bare Welcome Class row, so do
   not assume sample students/assessments are already wired. If the
   sign-in path is still empty, connect the existing demo-seed helper to
   the first-sign-in bootstrap so it fires ONCE when Teacher and
   TeacherPreference rows are fresh-created (see auth-lifecycle.md
   §1.3). Reuse the existing generator; do not build a second seed path.

2. Render a banner inside the gradebook view when the active course is
   the auto-seeded Welcome Class. Use existing --focus-banner-bg and
   --focus-banner-border tokens (see DESIGN-SYSTEM.md §1.7). Include a
   dismiss (×) button; persist the dismissed state in TeacherPreference
   or localStorage. The banner should only show if the Welcome Class is
   currently active AND the teacher hasn't dismissed it.

Verify in Demo Mode: create a new teacher account, verify email, sign
in, land on the gradebook, see the banner. Dismiss; reload; banner
stays dismissed.
```

**Likely files:** auth bootstrap (likely `login-auth.js` or `shared/supabase.js`), gradebook view

**Depends on:** T-WIRE-01 (if audit reveals bootstrap path changes)

**Acceptance:** New teacher → signs in for first time → lands in a populated Welcome Class with the `--focus-banner-bg` banner. Dismiss persists.

**Budget:** 45 min

---

## Tier 3 — Small controls (30 min–1 hour each)

Each lands as its own commit. Can run in parallel after T-WIRE-01.

### [DONE] T-UI-02 · `grading_system` segmented control in Course Settings (`cd8922f`)

**Status:** Shipped on `main`. Follow-ups: `3665af5` tightened the saved-category gate, and `df7d131` added adjacent grading-panel polish. Keep this block as the historical acceptance/spec reference.

**Goal:** Add the 3-way segmented control (proficiency / letter / both) in the course-policy panel. Disabled state when no Categories.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U2, §12.9, and spec-vs-ui-diff.md Bucket 3:
add a segmented control in Course Settings for grading_system. Three
segments: Proficiency, Letter, Both. Reuse the existing
.gb-seg-control pattern (see teacher/gradebook.css:41–54 and
DESIGN-SYSTEM.md §4.6).

Behavior:
- Default by grade level: 8–9 → proficiency, 10–12 → letter.
- If the course has zero Categories, the Letter and Both segments
  render disabled (existing .gb-seg-btn disabled state) with an inline
  tooltip "Create a category first →" linking to the (yet-to-exist)
  Category management row. For now, the tooltip can link to the
  categories area of course settings even if the UI isn't wired yet
  (T-UI-12 will land that).
- Click updates course.gradingSystem via the existing update_course
  RPC (HANDOFF 1.2 or similar).
- Reload gradebook/dashboard after change so the display flips.

Visual: use --active / --text colors per DESIGN-SYSTEM.md §1.1–1.2.

Remove the legacy "Report as percentage" toggle if it still exists in
the policy UI (per INSTRUCTIONS.md §2.2 U16 direction and Q26).
Remove the grading-scale editing controls (U14).

Verify in Demo Mode: open Course Settings, toggle between modes, see
the gradebook switch between proficiency and letter displays.
```

**Likely files:** `teacher/page-settings.*` (course policy section), CSS, `shared/data.js` (if a new v2 helper is needed)

**Depends on:** T-WIRE-01

**Acceptance:** Segmented control renders; switching modes persists; letter/both disabled when no categories; legacy toggles removed.

**Budget:** 45–60 min

---

### [DONE] T-UI-03 · Course `timezone` picker in Course Settings

**Status:** Shipped 2026-04-22 with reduced scope per product decision: no picker UI, all new courses default to `America/Vancouver` (Pacific time). `shared/data.js:createCourse` now sets `timezone: 'America/Vancouver'` on the local object and passes `p_timezone` to `create_course` RPC. Picker can be added later if per-course timezones are needed.

**Goal:** Add an IANA timezone picker in Course Settings.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U9 and erd.md (Pass D amendment folded in):
Course.timezone is a new text column holding an IANA tz string
(e.g., 'America/Vancouver'). Default on course create = the
teacher's browser timezone (Intl.DateTimeFormat().resolvedOptions().timeZone).

Add a dropdown to Course Settings. Options = the common Canadian tz
list plus "Other..." (which accepts any IANA string). Use a standard
<select> styled like other form inputs (see DESIGN-SYSTEM.md §4.2).

All date rendering in the course (due dates, score timestamps,
attendance) should respect this tz going forward. For v1, just
persist it — per-page rendering changes can land incrementally.

Saves via update_course RPC (existing jsonb patch path).

Verify in Demo Mode: open Course Settings, change tz, confirm it
persists after reload.
```

**Likely files:** `teacher/page-settings.*`, `shared/data.js`

**Depends on:** T-WIRE-01

**Acceptance:** Timezone dropdown renders, persists, reloads correctly.

**Budget:** 30 min

---

### [DONE] T-UI-04 · Restore-account prompt on sign-in

**Status:** Shipped on `main` 2026-04-21. `login-auth.js` now runs `bootstrap_teacher` before redirect; when `deleted_at` is set it shows the restore prompt with `Restore` / `Continue deletion`, calls `restore_teacher` on confirm, and signs the user back out if they continue deletion.

**Goal:** When a teacher with `deleted_at IS NOT NULL` signs in during the 30-day grace window, show a prompt to restore the account.

**Prompt:**

```
Per INSTRUCTIONS.md §12.5 and auth-lifecycle.md §5: during the
30-day soft-delete grace window, if a teacher signs in while their
Teacher row has deleted_at IS NOT NULL, show this modal:

  "Your account is scheduled for deletion on [date]. Restore it now?"

Buttons:
- Restore (primary) — calls v2.restoreTeacher (HANDOFF 4.8 confirms
  it exists) which flips deleted_at back to NULL.
- Continue deletion (secondary) — signs the user out without
  restoring.

[date] = deleted_at + 30 days, formatted per the course's tz (or
just en-CA if outside any course context).

Detection point: after auth succeeds and before redirecting to the
gradebook, fetch the teacher row; if deleted_at is set, show the
modal instead of redirecting. Use the existing .modal-box pattern
(DESIGN-SYSTEM.md §4.4).

Verify in Demo Mode: soft-delete the demo teacher, sign in again,
see the modal. Click Restore, sign in again, no modal.
```

**Likely files:** `login-auth.js`, `shared/data.js`, `shared/supabase.js`

**Depends on:** T-WIRE-01

**Acceptance:** Soft-deleted account → sign-in shows modal with correct date and buttons. Restore works.

**Budget:** 1 hour

---

### T-UI-05 · Data export menu entry

**Status:** Audit completed 2026-04-21. `window.v2.exportMyData` and backend RPC `export_my_data` are still missing in this repo, so this task remains blocked on `T-BE-01` before the UI can ship as a real download action.

**Goal:** Add "Export my data" to the user-menu dropdown + secondary button in delete-account dialog.

**Prompt:**

```
Per INSTRUCTIONS.md §12.9: add a "Export my data" entry to the
user-menu dropdown (top-right of the app dock). Clicking it calls
a new v2.exportMyData RPC (or triggers a client-side download if
backend export isn't yet available — check HANDOFF.md first).

Output: single JSON file covering every teacher-owned entity
(Teacher, TeacherPreference, Courses, Categories, Subjects,
Sections, Tags, Modules, Rubrics, Criteria, Students, Enrollments,
Assessments, Scores, RubricScores, TagScores, Observations + join
tables, CustomTags, ObservationTemplates teacher-added only, Notes,
Goals, Reflections, SectionOverrides, Attendance, TermRatings + join
tables, ReportConfig).

Also add the same Export button inside the delete-account
confirmation dialog (from T-COPY-01). Place above the password
re-entry input with a note: "Download a copy of your data before
deleting."

If the v2.exportMyData RPC doesn't exist yet, create a new task
(T-BE-01) for the backend side and wire the button to a disabled
state with a tooltip in the meantime.

Verify in Demo Mode: click Export → downloads a JSON. Inspect to
confirm it contains expected data.
```

**Likely files:** `teacher/page-settings.*`, existing user-menu dropdown component, `shared/data.js`

**Depends on:** T-WIRE-01. Spawns T-BE-01 if backend RPC missing.

**Acceptance:** Menu entry downloads JSON. Same button in delete dialog works.

**Budget:** 1 hour (more if backend RPC needs building)

---

### [DONE] T-UI-06 · "N unsynced" badge on user avatar

**Status:** Shipped on `main` 2026-04-21. `teacher/ui.js` now renders the avatar badge in the dock, `shared/offline-queue.js` exposes `subscribe(...)` for live queue updates, and `teacher/styles.css` reuses the `.obs-badge` pattern with the late-work amber override. The shipped implementation counts queued + dead-lettered items so failed syncs remain visible/actionable.

**Goal:** A badge on the user avatar showing the count of writes in the offline queue.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U5 and §12.9: render an "N unsynced" badge
on the user-avatar element in the top dock. Count comes from
window.v2Queue.stats() (see offline-sync.md and
shared/offline-queue.js already shipped per HANDOFF 4.10).

Visual: reuse the existing .obs-badge pattern (teacher/observations.css:76–82)
but colored with --late (#FF9500) instead of --active. Position
absolute, top-right corner of the avatar element.

Badge is hidden when count is 0. Updates when the queue changes —
shared/offline-queue.js exposes event hooks (check its API).

This badge is the click target for the sync status popover (T-UI-08).
Ensure its click handler is reserved for that task (no-op for now
except possibly console.log, or gate behind a flag).

Verify in Demo Mode: disconnect network (DevTools offline mode),
enter a score, see the badge appear with "1". Reconnect, see it
disappear once the queue drains.
```

**Likely files:** `teacher/styles.css` or new shared/offline-badge.js, dock HTML

**Depends on:** T-WIRE-01, `shared/offline-queue.js` (already shipped)

**Acceptance:** Badge appears when queue has entries, disappears when empty. Correct color.

**Budget:** 45 min

---

### [DONE] T-UI-07 · Offline banner strip

**Status:** Shipped on `main` 2026-04-21. `teacher/ui.js` renders the banner shell, `teacher/styles.css` adds the new `.offline-banner` rule plus the body/dock offset, and `teacher/router.js` refreshes the state after each dock render. The banner is driven by `navigator.onLine` / queue stats and pushes content down instead of overlaying it.

**Goal:** A thin amber banner at the top when `navigator.onLine === false`.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U7 and §12.9: render a thin strip at the
top of the viewport when navigator.onLine === false. Listen to
'online' and 'offline' window events.

Copy: "You're offline. Changes will sync when connection returns."

Visual: full-width strip, height ~28px, background var(--late) at
low opacity (rgba(255,149,0,0.12)), text var(--late) darkened or
--text-2, 12px font. Pushes content down (not an overlay). Appears
above the app dock.

Reuses no existing class exactly — add a new .offline-banner rule in
teacher/styles.css. Dark mode variant too.

Verify in Demo Mode: DevTools offline toggle → banner appears.
Re-enable → banner disappears.
```

**Likely files:** `teacher/styles.css`, top-level HTML (likely `teacher/app.html`), possibly `teacher-mobile/`

**Depends on:** T-WIRE-01

**Acceptance:** Banner correctly appears/disappears with connection state. Doesn't overlap other content.

**Budget:** 30 min

---

## Tier 4 — Medium controls (1–2 hours each)

### [DONE] T-UI-08 · Sync status popover (anchored to badge)

**Status:** Shipped on `main` 2026-04-21. The desktop dock badge now opens a popover showing queue counts, relative last-sync time, retry, and dead-letter dismiss actions. `retry-sync` now routes to the real `window.v2Queue.flush()` path, and focused coverage lives in `tests/ui-sync-status.test.js` plus the new queue-subscription assertions in `tests/offline-queue.test.js`.

**Goal:** Clicking the unsynced-count badge opens a popover showing queue detail.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U6 and §12.9: clicking the offline badge
(T-UI-06) opens a small popover anchored to the badge. Popover shows:

- Queue size (N pending)
- Last sync timestamp (formatted relative: "2 minutes ago")
- Dead-letter list: one row per failed entry, each with a "Dismiss"
  button and a short description of what failed ("Score for Kate on
  Essay 1 — Assessment not found")

Actions:
- Dismiss per-entry calls window.v2Queue.dismissDeadLetter(id).
- Clicking outside the popover closes it.
- Retry button at top runs window.v2Queue.flush() and updates the
  list.

Visual: reuses the existing popover styling. Width ~320px, padding
var(--space-4), background var(--surface), border var(--border),
radius var(--radius), shadow var(--shadow-md). Positioned
bottom-right of the badge.

Verify in Demo Mode: with offline queue populated (force some
failures by editing payloads), open popover, dismiss entries,
retry flush.
```

**Likely files:** new module `shared/sync-status-popover.js`, CSS additions

**Depends on:** T-UI-06

**Acceptance:** Popover opens/closes, shows queue state, dismiss and retry work.

**Budget:** 1.5 hours

---

### [DONE] T-UI-09 · Rubric per-criterion weight input (`8ea914b`)

**Status:** Shipped together with `T-UI-10` in the rubric editor. Follow-up completed 2026-04-22: `saveRubrics(...)` now routes through the canonical rubric RPC path and rehydrates server ids after save.

**Goal:** A numeric input per criterion in the rubric editor, storing `criterion.weight`.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U3, §12.9, and erd.md (Pass D amendment folded in):
Criterion now has a `weight numeric` column (default 1.0). The rubric
editor must let teachers set it per criterion.

Placement: inline in the criterion row header, next to the criterion
name. Small number input labeled "Weight". Allow any positive
number — values are normalized across the rubric at read time per
Pass D §1.1.

The existing rubric save path (check HANDOFF for the v2 RPC, likely
window.v2.saveRubric or save_rubric) should already accept the
criterion.weight field in the criteria array. If not, check
write-paths.sql and fix the RPC.

Visual: small input, ~60px wide, style matches existing rubric form
inputs. Use --text-sm for the label.

Verify in Demo Mode: open a rubric, set weights 1/1/2 on three
criteria, save, reopen — confirm values persist.
```

**Likely files:** `teacher/page-rubrics.*` or equivalent, `shared/data.js`

**Depends on:** T-WIRE-01; ERD migration adding `Criterion.weight` (confirm applied)

**Acceptance:** Weight input renders per criterion, persists, roundtrips correctly.

**Budget:** 1 hour

---

### [DONE] T-UI-10 · Rubric per-level value inputs (disclosure) (`8ea914b`)

**Status:** Shipped together with `T-UI-09` in the rubric editor. Follow-up completed 2026-04-22: `saveRubrics(...)` now routes through the canonical rubric RPC path and rehydrates server ids after save.

**Goal:** Four numeric inputs per criterion for `level_N_value`, hidden under a disclosure that defaults closed.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U4 and erd.md (Pass D amendment folded in):
Criterion now has level_1_value through level_4_value numeric columns
(defaults 1/2/3/4). Teachers can override per criterion (Teams/Schoology-style
flexibility).

In the rubric editor, add a per-criterion disclosure toggle labeled
"Customize point values" that defaults CLOSED. When opened, reveals
four small inputs under each level descriptor, pre-filled with the
defaults.

Do NOT show these by default — 95% of teachers never need them.

Saves via the existing rubric save path along with the other criterion
fields.

Visual: use <details><summary> or a custom disclosure using existing
styles. Small inputs (40–50px wide) with labels like "L4", "L3", etc.

Verify in Demo Mode: open a rubric, open the disclosure on a
criterion, set custom values (e.g., 5/3/2/1), save, reopen, confirm
values persist and defaults are only used where not overridden.
```

**Likely files:** same as T-UI-09

**Depends on:** T-WIRE-01, T-UI-09 (easier to land together); migration adding level_N_value columns

**Acceptance:** Disclosure closed by default. Opens to reveal 4 inputs. Values persist.

**Budget:** 1 hour

---

### [DONE] T-UI-11 · Session-expired modal with draft preservation

**Status:** Shipped on `main` 2026-04-21. Long-form surfaces now register draft-preservation context (`teacher/page-reports.js` term questionnaire and `teacher/page-observations.js` capture surface), `shared/data.js` tries `refreshSession()` first on auth-shaped RPC failures, and `teacher/ui.js` shows the password re-auth modal only for those contexts. The 30-minute idle timeout in `shared/supabase.js` now marks long-form sessions expired instead of hard redirecting, so the next save path can reopen the session without losing the draft.

**Goal:** On 401 in the term-rating narrative or observation capture, show a modal that preserves the form state.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U8, auth-lifecycle.md §8.1, and
DESIGN-SYSTEM.md §4.4: when an API call returns 401 on the
term-rating narrative editor or the observation capture surface,
show a modal that:

1. Does NOT unmount or clear the form.
2. Uses the existing .modal-box pattern with a semi-transparent
   overlay (the form stays visible beneath).
3. Pre-fills the teacher's email from the expired token claim.
4. Accepts a password re-entry.
5. On successful re-auth, retries the failed write and closes.
6. On dismiss, leaves the draft visible and shows a "Copy your draft
   before it's lost" button (copies form contents to clipboard).

Other surfaces (gradebook, settings, etc.) keep the existing
toast+redirect pattern — do NOT apply this modal to them.

Detection: add a guard in the v2 RPC dispatch layer that checks the
response status. If 401 AND we're on one of the two long-form
surfaces (check via a window flag like window.__longFormActive set
when those editors are mounted), trigger the modal.

Verify in Demo Mode: force a 401 (temporarily expire a token via
Supabase dashboard or just override fetch), with the term-rating
narrative open and half-written, trigger the expiry, see modal,
re-auth, confirm draft still there and save succeeds.
```

**Likely files:** `shared/data.js` (401 detection), new `shared/session-expired-modal.js`, CSS additions; surfaces that flip the flag

**Depends on:** T-WIRE-01

**Acceptance:** Modal appears only on the two long-form surfaces. Draft survives. Re-auth retries the failed write.

**Budget:** 2 hours

---

## Tier 5 — Largest single UI task

### [DONE] T-UI-12 · Category management inline row in Course Settings (`fd95043`, follow-up `3665af5`)

**Status:** Shipped on `main`. A later 2026-04-21 local follow-up finished the downstream desktop wiring this task was meant to unlock: assignments + gradebook now use category selectors/filters/badges and desktop letter displays read the category-weighted pipeline. Residual non-desktop/history cleanup is backlog item `P2.6`. Keep this block as the historical acceptance/spec reference.

**Goal:** The Category CRUD inline row in Course Settings. Clones the existing Modules-panel pattern.

**Prompt:**

```
Per INSTRUCTIONS.md §2.1 U1, §12.7, §12.9, and spec-vs-ui-diff.md
Bucket 3: add Category management as an inline row in Course Settings.
Clone the existing Modules panel pattern — same structural shape
(add-row + name input + drag handle + delete).

Fields per row:
- Name (text input)
- Weight % (number input)
- Drag handle (for reorder)
- Delete (X button)

Running sum display at the bottom of the Category list:
"Sum: 85 / 100 %"
Colored var(--text-2) when ≤100, var(--priority) when >100.

Save button disabled while sum > 100. Per §12.7: live warn, NO
hard-clamp on keystroke.

"+ Add category" button below the list. Drag reorder updates
display_order.

Backend: wire to v2.createCategory / v2.updateCategory / v2.deleteCategory /
v2.reorderCategories (check HANDOFF for exact names; add to
shared/data.js if not there yet — spawns T-BE-02 if backend
RPCs missing).

Placement in Course Settings: below the grading_system toggle
(T-UI-02), above any other category-related controls. When category
count > 0, the grading_system letter/both segments enable.

Connects to T-UI-02: once a category exists, the letter/both
segmented-control tooltip disappears.

Verify in Demo Mode: open Course Settings, add 3 categories (Tests
40, Essays 50, Participation 10), reorder, delete, confirm weights
sum warning appears when > 100. Confirm assessments' category
dropdown now shows the new categories.
```

**Likely files:** `teacher/page-settings.*`, `shared/data.js`, migration SQL if RPCs missing

**Depends on:** T-WIRE-01, T-UI-02 (the segmented control needs to know about category count), ERD migration for Category table (confirm applied)

**Acceptance:** Add/edit/reorder/delete categories works. Sum warning shows. Save disabled at > 100. Letter/both segments enable when categories exist. Assessments' category dropdown populated.

**Budget:** 3 hours

---

## Tier 6 — Operational (infrastructure, pre-cutover)

### [DONE] T-OPS-01 · Custom SMTP for `noreply@fullvision.ca` (live completion; see `HANDOFF.md` `5.2-live`)

**Status:** Completed live on 2026-04-20. No repo commit exists because the final work was DNS + Supabase configuration.

**Goal:** Emails from Supabase Auth (verification, password reset) come from the custom domain.

**Prompt:**

```
Per INSTRUCTIONS.md §1 and DECISIONS.md Q6=B: configure Supabase Auth
to send email via custom domain noreply@fullvision.ca.

Steps:
1. In the fullvision-v2 Supabase project dashboard, navigate to
   Authentication → Email Templates → SMTP Settings.
2. Configure SMTP credentials (Resend / Postmark / SendGrid or
   Supabase's built-in custom SMTP — confirm which the user has
   chosen, DECISIONS Q6 was B without a specific provider).
3. Add DNS records to fullvision.ca via the DNS provider:
   - SPF record (TXT)
   - DKIM record (TXT, provider-specific)
   - DMARC record (TXT, policy=quarantine or reject)
4. Test by triggering a password reset on a test account. Verify
   the email arrives from noreply@fullvision.ca with no spam flag.

Document the DNS records added in HANDOFF.md. Do NOT commit SMTP
credentials to the repo.
```

**Likely files:** Supabase dashboard, DNS provider, `HANDOFF.md` (document results)

**Depends on:** the user has `fullvision.ca` DNS access (per DECISIONS Q7 note)

**Acceptance:** Verification and password-reset emails arrive from `noreply@fullvision.ca`. Not in spam.

**Budget:** 45 min (+ DNS propagation wait)

---

### T-OPS-02 · Sentry project + DSN wiring

**Goal:** Runtime errors captured in Sentry.

**Prompt:**

```
Per INSTRUCTIONS.md §8.2 and DECISIONS.md Q34=A: wire Sentry for
runtime error capture.

1. Create a Sentry project (JavaScript platform).
2. Add the DSN to Netlify production env vars (not committed).
3. Add a minimal Sentry init in the client entry points
   (shared/*.js or teacher/app.html and teacher-mobile/index.html).
   Use the browser SDK, no React integration needed. Enable
   automatic error + unhandled-promise-rejection capture.
4. Test by throwing an error in one component; verify Sentry
   captures it.
5. Configure Sentry to scrub obviously PII fields
   (student names, scores — check the default scrubbing + add
   custom rules).

Do not commit the DSN. Document the env var name in INSTRUCTIONS.md
§1 "Env vars."
```

**Likely files:** `shared/sentry.js` (new), `teacher/app.html`, `teacher-mobile/index.html`, Netlify env config

**Depends on:** nothing

**Acceptance:** Errors in production show up in Sentry dashboard.

**Budget:** 45 min

---

### T-OPS-03 · Optional legacy-site parking at `legacy.fullvision.ca`

**Goal:** If desired, expose the old app on a legacy subdomain without changing the current `main`-based production flow.

**Prompt:**

```
Per INSTRUCTIONS.md §1 operational decisions: if the team wants the
old app reachable for comparison or rollback drills, park it at a
legacy subdomain.

Steps:
1. In Netlify, create a new site or take the current deploy and
   change its primary domain to legacy.fullvision.ca.
2. Add the DNS CNAME for `legacy.fullvision.ca` → the Netlify
   site's URL.
3. Do **not** disturb the current `fullvision.ca` production routing.
4. Verify legacy.fullvision.ca loads the old site; the legacy-v1
   git tag remains accessible.

No code changes in the repo. This is a Netlify + DNS task.
```

**Depends on:** `fullvision.ca` DNS access

**Acceptance:** `legacy.fullvision.ca` serves the old app without changing the current `fullvision.ca` routing.

**Budget:** 30 min

---

### T-OPS-04 · Historical cutover (completed 2026-04-20)

**Goal:** Historical record of the old cutover plan. Do not execute these steps now.

**Prompt:**

```
This cutover already happened. `rebuild-v2` was merged into `main`, the stale PR path was closed, and current work should target `main` directly.

Use the current backlog instead:
1. Resolve production blockers like Netlify quota, SMTP verification, and Sentry.
2. Finish remaining UI and persistence gaps on `main`.
3. Treat any future deploy/cutover work as a fresh task, not a continuation of PR `#76`.
```

**Depends on:** every Tier 2–5 task above plus OPS-01/02/03

**Acceptance:** Historical note only; no action required.

**Budget:** 1 hour + rollback buffer

---

## Parallel vs. serial execution

**Can run in parallel (no dependencies between them):**

- T-UI-03 · T-UI-05 — both after T-WIRE-01
- T-OPS-02 · T-OPS-03 — infrastructure, can run any time
- Already shipped on `main`: T-UI-02, T-UI-12, T-UI-09, T-UI-10, T-UI-06, T-UI-07, T-UI-08, T-UI-11, T-OPS-01, T-UI-01, T-COPY-01, T-COPY-02, T-UI-04

**Must be serial:**

- Historical note: T-UI-09 and T-UI-10 shipped together in `8ea914b`
- Historical note: T-UI-12 shipped after T-UI-02 and its saved-category follow-up landed in `3665af5`
- Historical note: the old T-OPS-04 cutover used to wait on everything else; current work no longer depends on that task.

**Recommended session ordering for one-Claude-Code-session-at-a-time:**

1. T-WIRE-01 (audit)
2. T-UI-03, T-UI-05 (timezone, export)
3. T-OPS-02, T-OPS-03 (infra — any order)
4. T-OPS-04 is historical only; use the active backlog plans for current production follow-up work

---

## Per-session procedure (for every task)

1. Open the task block. Read the prompt.
2. Read the three canonical docs listed at the top of this file.
3. If dependencies aren't done, skip to another task or surface the block.
4. Implement. Commit with clear message. No AI refs in commit messages (per user's memory).
5. Verify in Demo Mode (load the app, exercise the new UI path).
6. Append a line to HANDOFF.md's session log: date · session-id · task-id · commit hash · one-line summary · Demo Mode status.
7. Mark the task block **[DONE]** here with the commit hash.
8. If the task uncovered a new backend RPC need, add a T-BE-NN task block for it.

---

## Future tasks (spawn as needed)

- **T-BE-01** · Backend `export_my_data` RPC (if T-UI-05 audit finds it missing)
- **T-BE-02** · Teams-import adapter RPC: `import_teams_class` currently expects a fully-normalized payload; `tiParsedFile` (raw Teams-CSV shape `{ students, assignments }`) needs a server-side adapter before `window.v2.importTeamsClass` can be called from `teacher/teams-import.js`. Gap documented inline at line 678.
- **T-TEST-01** · Expand the shipped `e2e/regression-smoke.spec.js` auth smoke into a fuller Playwright flow: live email verification/test-project path (if available), Welcome Class → score entry → report generation
- **T-TEST-02** · E2E: soft-delete account → sign-in within 30d → restore
- **T-TEST-03** · E2E: offline queue fills → reconnect → queue drains
- **T-OPS-05** · Weekly JSON export cron
- **T-OPS-06** · Demo Mode / production smoke on `fullvision.ca` once the Netlify quota issue is resolved
