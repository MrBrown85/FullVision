# Spec-vs-UI Diff

After the user clarified that the goal is **"make the backend match the UI I have right now,"** I surveyed the frontend code to verify each significant decision in the four design docs (ERD, write-paths, auth-lifecycle, read-paths) against what the UI actually does. This document is the delta.

Three buckets:
- **Bucket 1 — Already aligned.** Spec matches UI. No action.
- **Bucket 2 — Backend needs to bend toward UI.** My spec over-reached or used different naming than the UI. Amend the spec.
- **Bucket 3 — UI needs to grow into spec.** My spec adds capability the UI doesn't yet have. These are genuinely new features you've confirmed you want.
- **Bucket 4 — Decisions needed.** Ambiguity the UI doesn't settle.

---

## Bucket 1 — Already aligned

| Feature | UI state | Spec says | Action |
|---|---|---|---|
| Email verification flow | Supabase handles verification; UI shows "check your email" post-signup at `login-auth.js:137`. No custom landing. | Pass C §1 (two-phase sign-up with verification gate). | None. Supabase handles what I specified. |
| Term rating dim pre-fill (existence) | `upsertTermRating()` pre-creates dims object on first access at `shared/data.js:4410-4446` | Pass D §2.5 says pre-fill dimensions. | Existence matches. See Bucket 2 for the **value** mismatch. |
| Missing/Late/Excused pills (rendering) | Fully rendered at `teacher-mobile/tab-grade.js:219-221` and `teacher/page-assignments.js` (7 locations) | Pass A Score.status + Pass B §9.3 | Match — the pills exist and are wired. |
| Assignment status RPC | `save_assignment_status` is called from `setAssignmentStatus()` at `shared/data.js:3414-3433` | Pass B §9.3 Assignment status write path | Logic matches; API layer names differ but that's an implementation detail. |
| Grading scale hardcoded | Letter grade display logic lives in code, no teacher-editable scale | Pass D §1.4 (hardcoded Q→R% and R→letter cutoffs) | Match. |

---

## Bucket 2 — Backend should bend toward UI

### 2.1 Score.status value: `NS` not `MISSING`

**UI:** The existing pill is labeled **`NS`** (stands for "not submitted") per the pill rendering at `teacher-mobile/tab-grade.js:219-221` and multiple locations in `teacher/page-assignments.js`. The RPC payload uses `NS`.

**My spec:** ERD amendment renames `NS → MISSING`.

**Delta:** My rename was based on "NS is ambiguous." But the UI already has NS in production-ready form, and `NS` is conceptually tighter than `MISSING` — it means specifically "the student did not submit this work," not the broader "this is missing."

**Recommendation:** **Revert the rename.** Keep `NS` in the DB. Update Pass A's Score entity and Pass D's §1.1/§1.8 to use `NS` everywhere. Meaning stays: `NS = counts as 0 in calculations`.

Score status enum, final:
```
status: 'NS' | 'EXC' | 'LATE' | null
```

### 2.2 Term rating dim pre-fill value

**UI:** `upsertTermRating()` at `shared/data.js:4410-4446` creates the dims object with **all dimensions defaulted to 0** (`:4419`), not with computed proficiency values.

**My spec:** Pass D §2.5 says "when term rating is new, pre-fill with `round(section_proficiency)`."

**Delta:** The UI currently defaults to 0. My spec is an upgrade, not a match.

**Recommendation:** This is a genuine UX improvement worth keeping — zero-filled dims are a lousy starting point for a teacher writing a narrative. Classify this as Bucket 3 (new feature) and plan to update the UI's `upsertTermRating` default-creation logic alongside the new backend. The read-path endpoint for the term rating editor (Pass D §2.5) will surface the computed defaults; the UI can adopt them when it's updated.

### 2.3 `display_mode` field name

**UI:** Course has `gradingSystem` field with value `'letter'` checked at multiple points (e.g., `:169-174` student header). Used to switch between letter and proficiency display.

**My spec:** ERD amendment introduces `Course.display_mode` with values `proficiency | letter | both`.

**Delta:** Name mismatch. The UI uses `gradingSystem`; I introduced `display_mode`. The two-value UI behavior matches my `proficiency` / `letter` values. `both` is net-new.

**Recommendation:** **Rename `display_mode → grading_system`** in the ERD amendment. Values: `'proficiency' | 'letter' | 'both'`. Keep three-value enum since `both` is intentional. The UI's current `gradingSystem` field becomes the target of the new three-way toggle; no data migration needed since existing courses will have `'letter'` and that's a valid value in the new enum.

### 2.4 Session expiry: toast, not modal

**UI:** `shared/supabase.js:240-256` shows a **toast** that says "Session expired" with a "Sign In" button, triggered by Supabase's `TOKEN_REFRESHED` event. No modal. No draft preservation. Redirects to `/login.html`.

**My spec:** Pass C §8.1 describes a modal with draft preservation.

**Delta:** My spec is a significant UX upgrade. The current UI is stubbed.

**Recommendation:** Two paths:
- **Path A — match UI as-is.** Keep the toast + redirect. Pass C §8.1 becomes: "On 401, show toast with Sign In link, redirect to login, drafts are lost." Minimal work, matches reality.
- **Path B — implement the spec's upgrade.** Build the modal with draft preservation. This is a user-protection feature (teacher writing a long term-rating narrative won't lose it).

**My take:** Path B is worth it specifically for the term-rating narrative editor and the observation capture. Both are long-form text inputs where session-expiry data loss is painful. The rest of the app can use the toast. This lets you ship Path A first and add Path B later for the two vulnerable surfaces. Flag in spec as "toast by default; modal+draft-preservation for long-form text surfaces."

---

## Bucket 3 — UI needs to grow into the spec (genuinely new features)

These are things my spec describes that the UI does not currently implement. You've already confirmed each one.

| Feature | UI effort estimate | Spec location |
|---|---|---|
| **Assessment categories** — full feature: new entity, per-course setup, weights, assignment → category FK, gradebook category-filter strip, dashboard category breakdown | Large: new wizard step, new settings panel, new gradebook strip, dashboard section, migration-safe default (courses without categories fall back to equal-weight average) | ERD amendment §Add, Pass D §1.3, §1.4, §2.1, §2.2, §2.3 |
| **`grading_system = 'both'` mode** + UI toggle | Medium: toggle control in course settings; dashboard + gradebook + report must render both pipelines side-by-side or toggle | ERD amendment + Pass D §3 |
| **Rubric per-criterion weight** | Medium: new input per criterion row in rubric editor; rubric save payload changes; `assessment_overall` formula uses weights | ERD amendment §Add, Pass D §1.1 |
| **Rubric per-level point values** | Medium: new inputs on each criterion (four level values, default 4/3/2/1); rubric save payload changes; `assessment_overall` + `tag_score_for_assessment` use `level_N_value` not the level index | ERD amendment §Add, Pass D §1.1, §1.2 |
| **Term rating dim auto-suggest** | Small: backend returns computed section proficiency; UI defaults new dim values from that (replaces the current 0-fill) | Pass D §2.5 |
| **Modal + draft preservation for long-form surfaces** (optional — see 2.4) | Small-medium: only for term rating narrative and observation capture | Pass C §8.1 Path B |

---

## Bucket 4 — Decisions (resolved)

### 4.1 Parent and student portals — **plan for later**

`login-auth.js:22-23` routes `case 'parent'` to `/parent/` and `case 'student'` to `/student/`, but neither directory exists.

**Decision:** Keep the routing stubs. Not a v1 feature. When built, they'll need read-only endpoints and role-based authorization (parent can see only their children's grades; student can see only their own). Captured as a deferred feature in the ERD amendment.

### 4.2 File uploads — **later**

**Decision:** Not a v1 feature. When built: new `Attachment` entity with storage-provider reference, mime-type, size, FK to Assessment and/or Enrollment; write paths for upload/delete; storage bucket setup. Captured as a deferred feature in the ERD amendment.

### 4.3 Calendar / schedule view — **list-columns only**

**Decision:** No calendar view. `Assessment.date_assigned` and `due_date` remain as list-column metadata. No schema change needed. If a calendar view is added later, it's purely a new read endpoint over the same columns.

### 4.4 Notifications — **toasts-only**

**Decision:** Current toast-based approach stays. No email, no push, no in-app notification center. No `Notification` entity in the ERD. If this changes later, it's additive (a new entity + delivery path).

---

## Amendments applied

All amendments identified above have been applied to the design docs:

| Change | Status | Files touched |
|---|---|---|
| Rename `display_mode` → `grading_system` | ✅ Done | `erd-amendment-pass-d.md`, `read-paths.md` |
| Revert `NS → MISSING` rename (keep `NS`) | ✅ Done | `erd-amendment-pass-d.md`, `read-paths.md` (§1.1, §1.2, §1.8) |
| Session expiry: Path A default + Path B for long-form | ✅ Done | `auth-lifecycle.md` §8.1 |
| Term rating dim defaults: note current zero-fill + target proficiency-fill | ✅ Done | `read-paths.md` §2.5 |
| Deferred features (parent/student, files, calendar, notifications) | ✅ Documented | `erd-amendment-pass-d.md`, this doc §4 |

## What's left before implementation

The design is **complete for v1**. Remaining actions are not design work:

- **Tier 1 implementation blockers from my earlier "what info do you need" list:** tech stack (Supabase + Postgres + RLS + RPC?), code location (main repo vs fresh?), ObservationTemplate creation story (seed-only vs teacher-editable?)
- **Tier 2 material decisions** that I flagged in Pass D §5 (per-tag contribution counting, decaying-avg convention direction, demo seed content, report-blocks-config shape)
- **Bucket 3 UI work** — category wizard step, display_mode toggle, rubric editor per-criterion inputs, term rating auto-suggest wiring, long-form draft preservation. These are the user-facing additions that pay for the rebuild.

**Accepted by the rebuild:** categories, rubric flexibility, `grading_system='both'` mode, term rating auto-suggest, long-form draft preservation. Everything else keeps the existing UI shape.
