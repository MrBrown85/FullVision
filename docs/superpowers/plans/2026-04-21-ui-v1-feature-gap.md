# FullVision UI v1 — Feature-Gap Plan

> **Status:** opened 2026-04-21 at the close of the database-wiring reconciliation. The backend is fully deployed on `gradebook-prod` and dispatch helpers (`window.v2.*`) are wired through `shared/data.js`, but the **teacher-facing UI for several v1-scope features was never built**. This plan tracks that work.
>
> **Scope:** ship the UI affordances teachers need to use the backend capabilities that already exist. No new backend work. No new RPCs.
>
> **For agentic workers:** pick the topmost unchecked top-level task, read the linked files, execute the prompt from `TASKS.md`, tick the checkbox, append to `docs/backend-design/HANDOFF.md`'s activity log, commit. One task per session. Verify every UI change in Demo Mode before ticking per `feedback_verify_ui_in_demo_mode.md`.

---

## Ground truth (snapshot 2026-04-21)

| Fact | Value |
|---|---|
| Branch | `main` (reconciliation plan shipped — 31+ commits past pre-session origin) |
| Backend | all v2 RPCs live on `gradebook-prod`; 805/805 unit tests green; 123/141 e2e green (18 content-mismatch failures → P3.5) |
| Source of truth for UI requirements | [`docs/backend-design/INSTRUCTIONS.md`](../../backend-design/INSTRUCTIONS.md) §2.1 U1–U17 + §12 exact-copy strings |
| Source of truth for UI tokens/patterns | [`docs/backend-design/DESIGN-SYSTEM.md`](../../backend-design/DESIGN-SYSTEM.md) |
| Source of truth for per-task prompts | [`docs/backend-design/TASKS.md`](../../backend-design/TASKS.md) |
| Push embargo | Lifted. `main` pushed to origin. Netlify currently 503ing on "usage_exceeded" (P1.0 in post-reconciliation-backlog); UI work can still land + merge even while production is dark. |

**Before first UI session:** read the three docs above in order. They are now authoritative and must not drift.

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

- [ ] **File:** `teacher/dash-class-manager.js` course-policy section (~line 720–770); reuse `.gb-seg-control` from `teacher/gradebook.css:41–54`.
- 3 segments: Proficiency / Letter / Both.
- Default by grade level: 8–9 → proficiency, 10–12 → letter.
- Disable Letter + Both when `course.categories.length === 0`; tooltip "Create a category first →" links to the category row landed by A.2.
- Click persists via `window.v2.updateCourse({ grading_system: value })` or the existing `updateCourse` wrapper in data.js.
- **Delete** the legacy "Report as percentage" toggle (U16/Q26) and the grading-scale editing controls (U14) in the same commit.
- **Ship criterion:** Demo-Mode toggle between modes → gradebook display flips; categories-empty shows disabled state with tooltip.

### A.2 · T-UI-12 — Category management inline row · ~3 hours

- [ ] **File:** `teacher/dash-class-manager.js` — clone the Modules panel pattern; replace the binary summative/formative block at line 761.
- Per-row controls: name input + weight % input + drag handle + delete ×.
- "+ Add category" button below the list.
- Running sum at bottom: `Sum: 85 / 100 %` — `var(--text-2)` when ≤100, `var(--priority)` when >100.
- **Live warn** at >100; **no** hard-clamp on keystroke (§12.7).
- Save button disabled while sum > 100.
- Drag reorder updates `display_order` via `v2.reorderCategories`.
- Assessments' category dropdown populates from the new category list.
- **Ship criterion:** create 3 categories (Tests 40, Essays 50, Participation 10) → reload → categories persist → T-UI-02's Letter/Both segments enable → an assessment's category dropdown shows all three.

### A.3 · T-UI-09 — Rubric per-criterion weight input · ~1 hour (ship together with A.4)

- [ ] **File:** `teacher/page-assignments.js` (rubric editor lives inline here, not in a separate file).
- Small number input next to each criterion's name, ~60px wide, labeled "Weight".
- Any positive number accepted; values normalize at read time per Pass D §1.1.
- Save path through `window.v2.upsertRubric` already accepts `weight` on each criterion — no dispatcher change needed.
- **Ship criterion:** set weights 1/1/2 on three criteria → save → reopen → weights persist.

### A.4 · T-UI-10 — Rubric per-level value inputs (disclosure) · ~1 hour

- [ ] **File:** same as A.3.
- Per-criterion `<details><summary>Customize point values</summary>` disclosure, defaults **closed**.
- When open: 4 small inputs (~40–50px wide) labeled `L4 L3 L2 L1`, pre-filled with defaults 4/3/2/1.
- Writes `level_1_value`..`level_4_value` via existing `v2.upsertRubric` dispatch.
- **Ship criterion:** open disclosure → set custom 5/3/2/1 → save → reopen → overrides persist; closed disclosure remains the default shape for teachers who don't need custom values.

---

## Tier B — Remaining T-UI backlog (from `TASKS.md`, in recommended order)

Each item is a full session with a ready-to-paste prompt in `TASKS.md`. These can land in any order after Tier A — `TASKS.md` notes their specific dependencies.

- [ ] T-UI-03 — Course `timezone` picker (30 min)
- [ ] T-UI-04 — Restore-account prompt on sign-in (1 h)
- [ ] T-UI-05 — Data export menu entry (1 h; spawns backend `export_my_data` if missing)
- [ ] T-UI-06 — "N unsynced" badge on user avatar (45 min; uses `window.v2Queue.stats()`)
- [ ] T-UI-07 — Offline banner strip (30 min)
- [ ] T-UI-08 — Sync status popover (1.5 h; depends on T-UI-06)
- [ ] T-UI-11 — Session-expired modal with draft preservation (2 h)
- [ ] T-COPY-01 — Delete-account 30-day grace copy (15 min)
- [ ] T-COPY-02 — Welcome Class banner + auto-seed (45 min)
- [ ] T-UI-01 — Hide term-rating auto-generate button (15 min)

---

## Tier C — Operational (blocks T-OPS-04 cutover)

These can run in parallel with Tier A/B and do not require code.

- [ ] T-OPS-01 — Custom SMTP for `noreply@fullvision.ca` (45 min + DNS wait) — already shipped per HANDOFF 5.2; verify with a live password reset.
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

- [ ] Run the full unit suite: `npm test` — expect 805/805 passing + 1 skipped.
- [ ] Run the e2e suite: `npx playwright test` — expect ≥123 passing; any NEW failures from Tier A UI are real regressions (P3.5 existing failures are pre-existing).
- [ ] Demo-Mode smoke of the four features end-to-end: create 3 categories → flip grading_system to Both → build a rubric with weighted criteria and one custom-value criterion → enter a score → reload → everything persists.
- [ ] Append close-out line to `HANDOFF.md`: "Tier A UI v1 complete; backend + frontend linked for categories, grading modes, and rubric flexibility."
- [ ] Move this plan to `docs/superpowers/shipped/` once Tier A + at least one Tier B + at least P1.0/P1.1 close out.

---

> **Conventions** carried forward from the reconciliation plan: commits stay local if push embargo is in effect (currently lifted), no AI co-author, Demo-Mode verification required on UI changes, one task per session, every tick appends to `HANDOFF.md`.
