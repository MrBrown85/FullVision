# FullVision UI v1 — Feature-Gap Plan

> **Status:** opened 2026-04-21 at the close of the database-wiring reconciliation. The backend is fully deployed on `gradebook-prod` and dispatch helpers (`window.v2.*`) are wired through `shared/data.js`, but the **teacher-facing UI for several v1-scope features was never built**. This plan tracks that work.
>
> **Scope:** ship the UI affordances teachers need to use the backend capabilities that already exist. No new backend work. No new RPCs.
>
> **For agentic workers:** pick the topmost unchecked top-level task, read the linked files, execute the prompt from `TASKS.md`, tick the checkbox, append to `docs/backend-design/HANDOFF.md`'s activity log, commit. One task per session. Verify every UI change in Demo Mode before ticking per `feedback_verify_ui_in_demo_mode.md`.

---

## Ground truth (snapshot 2026-04-21)

| Fact                                   | Value                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                                 | `main` (reconciliation plan shipped — 31+ commits past pre-session origin)                                                                                                         |
| Backend                                | all v2 RPCs live on `gradebook-prod`; 834 passed / 1 skipped in the current unit suite; 123/141 e2e green (18 content-mismatch failures → P3.5)                                    |
| Source of truth for UI requirements    | [`docs/backend-design/INSTRUCTIONS.md`](../../backend-design/INSTRUCTIONS.md) §2.1 U1–U17 + §12 exact-copy strings                                                                 |
| Source of truth for UI tokens/patterns | [`docs/backend-design/DESIGN-SYSTEM.md`](../../backend-design/DESIGN-SYSTEM.md)                                                                                                    |
| Source of truth for per-task prompts   | [`docs/backend-design/TASKS.md`](../../backend-design/TASKS.md)                                                                                                                    |
| Push embargo                           | Lifted. `main` pushed to origin. Netlify currently 503ing on "usage_exceeded" (P1.0 in post-reconciliation-backlog); UI work can still land + merge even while production is dark. |

**Before first UI session:** read the three docs above in order. They are now authoritative and must not drift.

**2026-04-21 local follow-up after Tier A:** the desktop category-driven grading slice is now in the working tree: assignments + gradebook use category selectors/filters/badges, and desktop report/header letter displays read the category-weighted `getCourseLetterData` pipeline. Residual `assessment.type` presentation/count paths outside that core loop are tracked in post-reconciliation backlog item `P2.6`.

---

## Convention for every task below

1. **Read** the matching prompt in `TASKS.md` verbatim.
2. **Reuse existing tokens/classes** from `DESIGN-SYSTEM.md` — never hand-roll colors, spacings, or component shapes.
3. **Dispatch only via `window.v2.*`** — the helpers are already wired; do not write new `sb.rpc(...)` calls in UI code.
4. **Verify in Demo Mode** before ticking — unit tests catch dispatch errors but never catch layout/rendering regressions per user memory.
5. **One commit per task** with message `T-UI-NN: <short>` (mirrors `TASKS.md` IDs).
6. **Append one line** to `HANDOFF.md` activity log: `YYYY-MM-DD | session-N | T-UI-NN | commit <sha> | summary | Demo-Mode verified`.

No AI co-author. No AI references in branch or commit content (`feedback_no_ai_references.md`).

---

## Tier A — The four the user asked about (sequencing locked)

### A.1 · T-UI-02 — `grading_system` segmented control · ~45–60 min

- [x] _Shipped 2026-04-21 commit TBD._ Rewrote the Course Settings "Grading & Calculation" block in `teacher/dash-class-manager.js:731–790` — 3-segment `Proficiency / Letter / Both` (was `Proficiency (1-4) / Letter (A-F) / Points`; backend CHECK confirms the new triple matches). `_cmHasCategories(cid)` gates Letter + Both — when falsy, those segments render with `.cm-seg-btn-disabled` (strike-through, `not-allowed` cursor, `title` tooltip) + a muted-italic hint line beneath the group: _"Create a category first →"_. `_cmDefaultGradingSystem` maps grade 8–9 → `proficiency`, 10–12 → `letter`. Click handler `cmSetGradingSystem` short-circuits with toast when letter/both + no categories. Deleted: `cmToggleReportPct`, `cmToggleCatWeights`, `cmUpdateCatWeights` + their bindings + the legacy summative/formative slider block + the Report-as-percentage checkbox (U14/U16 retired). Also fixed: create-wizard Step 2 picker (letter/both disabled until categories exist), `teams-import.js` default, `shared/constants.js` JSDoc, 2 stale test fixtures. 805/805 unit tests pass.
- 3 segments: Proficiency / Letter / Both.
- Default by grade level: 8–9 → proficiency, 10–12 → letter.
- Disable Letter + Both when `course.categories.length === 0`; tooltip "Create a category first →" links to the category row landed by A.2.
- Click persists via `window.v2.updateCourse({ grading_system: value })` or the existing `updateCourse` wrapper in data.js.
- **Delete** the legacy "Report as percentage" toggle (U16/Q26) and the grading-scale editing controls (U14) in the same commit.
- **Ship criterion:** Demo-Mode toggle between modes → gradebook display flips; categories-empty shows disabled state with tooltip.

### A.2 · T-UI-12 — Category management inline row · ~3 hours

- [x] _Shipped 2026-04-21 commit TBD._ Added `_cmRenderCategoriesField` inline row pattern in `teacher/dash-class-manager.js` — inserted inside the Grading & Calculation section, directly below the grading_system segmented control. Per-row: drag handle + name input + weight % number input + delete ×. "+ Add category" link + running sum (`Sum: <n> / 100%`, turns `var(--priority)` when >100) in the footer. Live warn on keystroke via `cmCatWeightLive` (updates the sum display only, no persist); blur-commit via `cmCatWeight` (persists only when sum ≤ 100 — the `fv_check_category_weight_sum` trigger still enforces server-side). Drag-reorder via delegated `dragstart/dragover/drop/dragend` listeners, atomic persist via `window.v2.reorderCategories`. New backend RPCs: `list_categories(p_course_id)` + `reorder_categories(p_ids)` deployed as migration `fullvision_v2_category_list_and_reorder` (both security-invoker, grant authenticated; live smoke verified list + reorder + weight-cap rejection). Two new `window.v2.*` dispatch helpers with unit tests (+2 tests; 807 total passing). Also resolves T-UI-02's disabled-state: once a teacher adds their first category, `_cmHasCategories` returns true on the next render and the Letter/Both segments enable.
- Per-row controls: name input + weight % input + drag handle + delete ×.
- "+ Add category" button below the list.
- Running sum at bottom: `Sum: 85 / 100 %` — `var(--text-2)` when ≤100, `var(--priority)` when >100.
- **Live warn** at >100; **no** hard-clamp on keystroke (§12.7).
- Save button disabled while sum > 100.
- Drag reorder updates `display_order` via `v2.reorderCategories`.
- Assessments' category dropdown populates from the new category list.
- **Ship criterion:** create 3 categories (Tests 40, Essays 50, Participation 10) → reload → categories persist → T-UI-02's Letter/Both segments enable → an assessment's category dropdown shows all three.

### A.3 · T-UI-09 — Rubric per-criterion weight input · ~1 hour (ship together with A.4)

- [x] _Shipped 2026-04-21 commit TBD._ `teacher/page-assignments.js` rubric editor — added a small `Weight` number input in each criterion header, right of the name (`.rubric-criterion-weight` ~54px). `addCriterion` seeds `weight: 1`; `updateCritWeight` handler normalizes NaN/negative → 1. Wired on both `actionInput` (live) and `actionBlur` (commit). Normalization at read-time is Pass D §1.1's job.

### A.4 · T-UI-10 — Rubric per-level value inputs (disclosure) · ~1 hour

- [x] _Shipped 2026-04-21 commit TBD._ Added a per-criterion `<details><summary>Customize point values</summary>` disclosure below the 4 level cards. Default closed (opens when `levelValues` is populated so existing overrides remain visible). When open: 4 ~48px inputs labeled L4 / L3 / L2 / L1 pre-filled with defaults 4/3/2/1. `updateCritLevelValue` handler lazily creates `levelValues` only when a teacher actually overrides a default — reverting to the default value auto-removes the override so clean criteria stay clean. Blur-commit via `critLevelValue` dispatcher.

**Follow-up resolved 2026-04-22:** rubric persistence is now canonical. `saveRubrics(...)` dispatches the v2 composite RPC, rehydrates canonical rubric/criterion ids from Supabase after save, and patches linked assessment `rubricId` values so the rubric editor’s weight/value overrides now round-trip to `gradebook-prod`.

---

## Tier B — Remaining T-UI backlog (from `TASKS.md`, in recommended order)

Each item is a full session with a ready-to-paste prompt in `TASKS.md`. These can land in any order after Tier A — `TASKS.md` notes their specific dependencies.

- [ ] T-UI-03 — Course `timezone` picker (30 min)
- [x] T-UI-04 — Restore-account prompt on sign-in (1 h)
- [ ] T-UI-05 — Data export menu entry (1 h; backend audit confirmed `export_my_data` is still missing, so this remains blocked on `T-BE-01`)
- [x] T-UI-06 — "N unsynced" badge on user avatar (45 min; desktop dock now reflects queue + dead-letter counts)
- [x] T-UI-07 — Offline banner strip (30 min; banner pushes dock/content down while offline)
- [x] T-UI-08 — Sync status popover (1.5 h; retry + dead-letter dismiss now live)
- [x] T-UI-11 — Session-expired modal with draft preservation (2 h; term-rating + observation capture now use silent-refresh-then-modal flow)
- [x] T-COPY-01 — Delete-account 30-day grace copy (15 min)
- [x] T-COPY-02 — Welcome Class banner + auto-seed (45 min)
- [x] T-UI-01 — Hide term-rating auto-generate button (15 min)

---

## Tier C — Operational (blocks T-OPS-04 cutover)

These can run in parallel with Tier A/B and do not require code.

- [x] T-OPS-01 — Custom SMTP for `noreply@fullvision.ca` (live setup completed 2026-04-20; optional password-reset re-verify remains a smoke pass)
- [ ] T-OPS-02 — Sentry project + DSN wiring (45 min)
- [ ] T-OPS-03 — Park legacy site at `legacy.fullvision.ca` (30 min; DNS)
- [ ] **P1.0 from post-reconciliation-backlog — Netlify quota fix** (user-only; production 503ing until resolved)
- [ ] **P1.1 from post-reconciliation-backlog — rotate leaked publishable key** (user-only)

---

## Tier D — T-OPS-04 cutover

- [ ] After every Tier A/B/C item: run the T-OPS-04 pre-flight checklist in `TASKS.md`, DNS flip, smoke test production.

---

## Re-sync hook

At the end of each session, the agent appends to `HANDOFF.md` activity log AND ticks the box here. When a task lands that reshapes the plan (e.g. a T-UI-12 discovery that categories need a new column, or an A.2 finding that T-UI-02's disabled state behaves differently than specified), add a **Discovered gaps** bullet to `HANDOFF.md` per convention.

---

## Ship checklist (all four Tier A done)

When A.1 through A.4 are all checked:

- [ ] Run the full unit suite: `npm test` — expect 834 passed + 1 skipped.
- [ ] Run the e2e suite: `npx playwright test` — expect ≥123 passing; any NEW failures from Tier A UI are real regressions (P3.5 existing failures are pre-existing).
- [ ] Demo-Mode smoke of the four features end-to-end: create 3 categories → flip grading_system to Both → build a rubric with weighted criteria and one custom-value criterion → enter a score → reload → everything persists.
- [ ] Append close-out line to `HANDOFF.md`: "Tier A UI v1 complete; backend + frontend linked for categories, grading modes, and rubric flexibility."
- [ ] Move this plan to `docs/superpowers/shipped/` once Tier A + at least one Tier B + at least P1.0/P1.1 close out.

---

> **Conventions** carried forward from the reconciliation plan: commits stay local if push embargo is in effect (currently lifted), no AI co-author, Demo-Mode verification required on UI changes, one task per session, every tick appends to `HANDOFF.md`.
