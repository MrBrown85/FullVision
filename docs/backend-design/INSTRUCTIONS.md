# FullVision Backend Rebuild — Implementation Instructions

Authoritative instruction set for the FullVision v2 rebuild. Derived from 49 finalized decisions (see `DECISIONS.md` for the answer-by-answer log). This document is **self-contained** — fresh implementation sessions can act from this file alone without prior conversation context.

If anything in this file contradicts the other design docs (`erd.md`, `write-paths.md`, `auth-lifecycle.md`, `read-paths.md`, `spec-vs-ui-diff.md`, `offline-sync.md`), **this file is the later decision and wins**.

---

## 0. Mental model before you touch code

- **FullVision is a BC-region gradebook app.** Teacher-facing only in v1 (no parent/student portal; those are stubbed).
- **Two orthogonal grading pipelines** always exist side-by-side, driven by `Course.grading_system`:
  1. **Proficiency pipeline** (1–4 / Emerging–Extending) — for grade 8–9 courses and anywhere the teacher wants competency-based reporting.
  2. **Letter/percentage pipeline** (Q → R% → letter) — for grade 10–12 courses. Hardcoded BC-region Q→R and R→letter maps.
  - `grading_system = 'both'` runs both pipelines; UI shows both results.
- **Categories replace the old summative/formative model entirely.** Teacher-named per-course buckets with weights (e.g., "Tests 40% / Essays 50% / Review 10%"). Categories drive the percentage pipeline. They do NOT drive the proficiency pipeline.
- **Competencies = Sections in the ERD.** Assessments/criteria tag Tags → Tags belong to Sections. Proficiency aggregates at the Section level via `calc_method`.
- **Student is teacher-owned** (`Student.teacher_id` FK), but **the student profile view is course-scoped** — no cross-year carry-forward of observations/notes/goals in v1.
- **Aggregates compute on read, never cached.** No denormalized "overall_grade" columns anywhere. The old app's backend fell apart because of unsynchronized denormalized caches; do not repeat that.

---

## 1. Architecture stack (fixed)

- **Database + Auth + API:** Supabase full stack (Postgres, Supabase Auth, RLS, PostgREST/RPC). Do not switch stacks mid-implementation.
- **Project:** Fresh Supabase project named `fullvision-v2`. The legacy project stays read-only.
- **Repo:** Same GitHub repo (`MrBrown85/FullVision`). Old `main` is tagged `legacy-v1`. Rebuild branch is `rebuild-v2`. When the rebuild is complete, it becomes the new `main`.
- **Primary domain:** `fullvision.ca`. Netlify deploy URL (`fullvision.netlify.com`) stays as a fallback.
- **Custom SMTP sender:** `noreply@fullvision.ca` via Supabase Auth (configure SPF + DKIM + DMARC DNS).
- **CI/CD:** Netlify auto-deploys on git push. Preview deploys per PR branch.
- **Env vars:** Separate `.env` files per environment. Legacy and v2 project URLs must never coexist in one deploy artifact.
- **Backups:** Supabase Pro managed daily backups + PITR (7-day retention). Weekly manual JSON export as belt-and-suspenders.

---

## 2. UI changes (new, modified, removed, deferred)

This is the part that differs most from the old app. Implement exactly as listed.

### 2.1 UI to ADD

| # | UI feature | Where | Notes |
|---|---|---|---|
| U1 | **Category management** | Course settings (inline row UX, clones Modules-panel pattern) | Add / rename / weight / reorder / delete `Category` rows. Per-course. **Not added to the class-creation wizard** — teachers set up categories post-create in Course Settings. Weights are percentages; UI displays running sum "85 / 100 %" in `var(--text-2)` when ≤100, `var(--priority)` when >100. Save disabled while sum > 100. No hard-clamp on keystroke. |
| U2 | **`grading_system` toggle** | Course settings | 3-way: `proficiency` / `letter` / `both`. Default seeded by grade level: 8–9 → proficiency, 10–12 → letter. Always visible so teacher can override. **If teacher picks letter/both without any Categories, block with inline prompt: "Create a category first →".** |
| U3 | **Per-criterion weight input** | Rubric editor | New numeric input per criterion row. Default 1.0. Normalized across the rubric at read time. |
| U4 | **Per-level value inputs** | Rubric editor | Four numeric inputs per criterion (`level_1_value` through `level_4_value`). Defaults 1/2/3/4. Teacher-adjustable (matches Teams/Schoology flexibility). |
| U5 | **"N unsynced" badge** | Top-right user avatar | Shows count of pending writes in offline queue. Queue module lives at `shared/offline-queue.js` on `rebuild-v2`. |
| U6 | **Sync status panel** | Accessible from user menu | Shows queue size, last-sync time, dead-letter list. Dead-letter entries the user can dismiss individually. |
| U7 | **Offline banner** | Top of app | Appears when `navigator.onLine === false`. Small strip, non-blocking. |
| U8 | **Session-expired modal with draft preservation** | Only on term-rating narrative editor + observation capture | On 401 after 30min idle, show modal that re-prompts password WITHOUT destroying the form state. Other surfaces use the existing toast + redirect pattern. |
| U9 | **Course `timezone` setting** | Course settings | IANA tz string picker. Defaults to browser TZ on create. All dates in that course render in this TZ. |
| U10 | **Welcome Class** | Auto-seeded on first verified sign-in | Same content as demo seed. Teacher lands in a populated gradebook, not an empty state. They can delete it anytime. |
| U11 | **Delete-account 30-day grace notice** | Delete-account confirmation dialog | Copy: "Your account will be deleted in 30 days. Sign in within 30 days to cancel." |
| U12 | **Restore-account prompt** | Sign-in flow | If a teacher signs in during their 30-day grace window, detect `Teacher.deleted_at IS NOT NULL` and prompt: "Your account is scheduled for deletion. Restore it?" |
| U13 | **Data export** | Settings + delete-account flow | "Download all my data (JSON)" button in settings. Same export offered inside the delete-account dialog before destructive confirmation. |

### 2.2 UI to REMOVE (legacy controls that are now dead)

| # | Remove | Reason |
|---|---|---|
| U14 | **Grading scale inputs** (labels, min boundaries, reset button) | Scale is hardcoded app-wide. BC-region Q→%→letter map is fixed. Controls have nothing to persist to. |
| U15 | **Summative/formative toggle** on assessment form | Replaced by a Category dropdown populated from the course's Categories. |
| U16 | **"Category weights enabled" checkbox + "Summative %" slider** | Replaced by the dedicated Category management panel (U1). |
| U17 | **Term-rating narrative "Auto-generate" button** | Feature is deferred to a separate workstream in another repo. Hide the button in v1. Do NOT wire it to a placeholder or "coming soon" modal — just hide. |

### 2.3 UI to MODIFY

| # | UI | Change |
|---|---|---|
| U18 | **Assignment status pills** | Already exist as `NS / EXC / LATE`. **Keep the labels as-is.** Do NOT rename `NS` to `Missing`. Wire each to the backend: `NS` counts as 0 in calcs; `EXC` excludes from calcs; `LATE` is informational (surfaces in reports as "N late this term"). |
| U19 | **Term-rating dimension editor** | Currently pre-fills with zeros. Change to pre-fill with `round(section_proficiency)` computed from the student's current section-level proficiency at editor load time. Teacher can override. |
| U20 | **Gradebook cell display** | Round to 1 decimal for both proficiency (`2.7`) and percentage (`78.6%`). Don't show whole numbers only for percentage. |
| U21 | **Gradebook Tab key** | Moves focus RIGHT (next assignment, same student). Standard spreadsheet behavior. |
| U22 | **Student profile** | Render data from the active course Enrollment only. Do NOT aggregate observations/notes/goals across prior courses the student was in. |
| U23 | **"At-risk" list on class dashboard** | Apply fixed threshold: student is at-risk if `overall_proficiency < 2.0` OR letter `R < 60%`. No teacher-configurable threshold UI in v1. |
| U24 | **Delete-account dialog** | Require password re-entry. Backend calls Supabase `reauthenticate` before proceeding with soft-delete. |
| U25 | **Session-expiry** (default surfaces) | Existing toast + redirect pattern is fine for most surfaces. Only the two long-form surfaces in U8 get the modal upgrade. |
| U26 | **Email-verification screen** | May already exist (check `login-auth.js` and Supabase Auth flow). If it does, leave it. If not, add a simple "check your email" screen post-sign-up. |

### 2.4 UI to LEAVE ALONE

- Observation capture flow (already works, just rewire to new API)
- Learning map tree view (subjects / groups / sections / tags)
- Notes, goals, reflections forms
- Roster management, bulk ops, import wizards
- Observation feed filters
- Navigation shell, sidebar, tabs, mobile sheets
- Service worker file structure (logic inside will change for Q33 offline)

### 2.5 UI deferred to v2+

- Parent portal (`/parent/` routing stubs exist; do not build)
- Student portal (same)
- File uploads / attachments
- Calendar / schedule view (date columns in lists only)
- Email/push notifications (toasts only)
- Cross-year "historical context" panel on student profile
- Term-rating narrative auto-generate (in another repo)

---

## 3. Schema additions (apply via migrations to `fullvision-v2`)

Beyond the entities in `erd.md`:

```sql
-- Teacher soft-delete support
ALTER TABLE teacher ADD COLUMN deleted_at timestamptz;
-- All reads filter WHERE deleted_at IS NULL

-- ObservationTemplate seed/custom distinction
ALTER TABLE observation_template ADD COLUMN is_seed boolean DEFAULT false;
-- RLS policy: UPDATE/DELETE blocked when is_seed = true
-- Seeds are inserted at migration time, not via teacher actions

-- Course timezone (IANA string)
ALTER TABLE course ADD COLUMN timezone text;
-- Default on INSERT: client-provided browser TZ or fall back to 'America/Vancouver'

-- Audit tables
CREATE TABLE score_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id uuid NOT NULL REFERENCES score(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES teacher(id),
  old_value numeric,
  new_value numeric,
  old_status text,
  new_status text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX score_audit_score_id_idx ON score_audit(score_id, changed_at DESC);

CREATE TABLE term_rating_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_rating_id uuid NOT NULL REFERENCES term_rating(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES teacher(id),
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX term_rating_audit_id_idx ON term_rating_audit(term_rating_id, changed_at DESC);
```

**Category entity** (from ERD amendment) — confirm this exists in your migrations:

```sql
CREATE TABLE category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  name text NOT NULL,
  weight numeric NOT NULL CHECK (weight >= 0 AND weight <= 100),
  display_order int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Criterion additions** (weights + per-level values):

```sql
ALTER TABLE criterion
  ADD COLUMN weight numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN level_1_value numeric NOT NULL DEFAULT 1,
  ADD COLUMN level_2_value numeric NOT NULL DEFAULT 2,
  ADD COLUMN level_3_value numeric NOT NULL DEFAULT 3,
  ADD COLUMN level_4_value numeric NOT NULL DEFAULT 4;
```

**Schema removals** from the old model:

```sql
ALTER TABLE assessment DROP COLUMN type; -- replaced by category_id
ALTER TABLE course
  DROP COLUMN summative_weight_pct,
  DROP COLUMN category_weights_enabled,
  DROP COLUMN grading_scale,  -- hardcoded app-wide now
  DROP COLUMN report_as_percentage; -- replaced by grading_system
```

**Status enum on Score** stays as `'NS' | 'EXC' | 'LATE' | NULL`. Do not rename to `MISSING`.

---

## 4. Computation rules (Pass D primitives)

Implement these exactly. Wrong math silently changes grades.

1. **Blank cell (no Score row) = not graded.** Exclude from all averages.
2. **`status = 'NS'` = zero.** Student explicitly didn't submit. Counts as 0 in all averages that touch that assessment.
3. **`status = 'EXC'` = excused.** Exclude from averages entirely (drop the assessment).
4. **`status = 'LATE'` = informational only.** No calc effect. Surfaces as "N late this term" in reports.
5. **Assessment overall (per student):**
   - Rubric-based: `sum(criterion.weight × level_value_for_score) / sum(criterion.weight)` where criteria with no scored value are skipped.
   - Points-mode: `(score.value / assessment.max_points) × 4` (normalize to 0–4 scale at read time).
   - Proficiency mode: `score.value` directly.
6. **Tag score per assessment:**
   - Rubric-based: straight average of criterion values whose Criterion links to the Tag via CriterionTag. Criterion weights do NOT apply here.
   - Non-rubric: `TagScore.value` directly.
   - Zero criteria linked to tag → NOT_APPLICABLE (contributes nothing).
7. **Per-tag contribution to section proficiency:** 1 averaged contribution per assessment per section (average the assessment's tag-scores in that section first, then feed the single value into `calc_method`). Heavily-tagged assessments do NOT count extra.
8. **Category average:** average of assessment overall scores within the category. Drop NOT_YET_GRADED and EXC; count NS as 0.
9. **Course Q (letter pipeline):** `Q = Σ(category.weight × category_avg) / Σ(category.weight of non-empty categories)`. Empty categories (no graded assessments) are dropped and weights renormalized across remaining.
10. **Q → R% (hardcoded, piecewise linear):**
    - `Q ≤ 0`: 0%
    - `Q ≤ 2`: `55 + (Q − 1) × 13`
    - `Q ≤ 3`: `68 + (Q − 2) × 14`
    - `Q > 3`: `82 + (Q − 3) × 14`
11. **R → letter (hardcoded cutoffs):** A≥86, B≥73, C+≥67, C≥60, C-≥50, else F.
12. **Section proficiency:** apply `Course.calc_method` (average / median / mostRecent / highest / mode / decayingAvg) to the per-assessment tag contributions for that section.
13. **Decaying average formula:** `avg = avg × (1 − dw) + new × dw`. New scores dominate with higher `dw`. Chronological ordering by `Assessment.date_assigned`.
14. **Section override:** if a `SectionOverride` exists for (enrollment, section), it **fully replaces** the computed proficiency for that section.
15. **Group rollup:** straight average of section proficiencies within the group (no weighting).
16. **Overall proficiency:** straight average of all sections' proficiencies (if no groups) OR of group rollups (if groups exist).
17. **Display rounding:** proficiency `2.7`, percentage `78.6%`. Both to 1 decimal. Intermediate math retains full precision.
18. **At-risk threshold (fixed):** student is at-risk if `overall_proficiency < 2.0` OR `R < 60%`.

---

## 5. Write-path rules

1. **Every score write appends to `score_audit`** in the same transaction. Capture old/new value and status, acting teacher_id, timestamp.
2. **Every term-rating write appends to `term_rating_audit`** per changed field, in the same transaction.
3. **Score.status = 'NS'** is a teacher-set value; never inferred. Blank cells stay blank; the teacher explicitly marks NS when they want it to count as zero.
4. **Rubric save** is one transaction: upsert Rubric, diff criteria (insert new, update changed, delete removed → cascades CriterionTag and RubricScore), replace CriterionTag links.
5. **Course duplicate copies structure only:** Subjects, Sections, Tags, CompetencyGroups, Modules, Rubrics, Criteria, Categories, CustomTags, ObservationTemplates (only `is_seed = false` ones — seeds are already in the new course via the migration), ReportConfig. No students. No assessments. No scores. No observations.
6. **Delete course** cascades everything course-scoped (enrollments → scores/notes/goals/etc., assessments, rubrics, observations, etc.). Students themselves are NOT deleted — only their enrollments in the deleted course.
7. **Delete student** cascades all student-scoped rows (enrollments across all courses, scores, notes, goals, reflections, overrides, attendance, term ratings, observation links).
8. **Delete account = soft-delete.** Set `Teacher.deleted_at = now()`. Data stays intact. A scheduled daily Supabase function hard-deletes teachers where `deleted_at < now() - interval '30 days'`.
9. **Demo mode is entirely client-side.** No backend writes in demo mode. Demo data lives in localStorage, loaded from a bundled static seed JSON. "Reset demo data" = client-side wipe + reload of seed; do NOT write a backend `reset_demo` function.
10. **Offline writes enqueue to `shared/offline-queue.js`** (already implemented on `rebuild-v2`). Every v2 RPC call has a matching `v2Queue.callOrEnqueue` path.

---

## 6. Auth rules

1. **Sign-up is two-phase.** Phase 1: Supabase creates the auth record + sends verification email (no Teacher row yet). Phase 2 (first verified sign-in): on `getMe()`, if no Teacher row exists, create it + TeacherPreference + auto-seed the Welcome Class. This eliminates orphan Teacher rows for people who never verify.
2. **Session token TTL: 30 minutes sliding.** Every successful API response issues a refreshed token.
3. **Sign-in when `deleted_at IS NOT NULL`:** prompt "Your account is scheduled for deletion. Restore it?" If teacher confirms restore, `UPDATE teacher SET deleted_at = NULL`.
4. **Multi-device sessions: unlimited.** No device cap.
5. **Password reset invalidates all existing sessions** for that user. Redirect to sign-in page after reset, don't auto-sign-in.
6. **Delete account requires password re-entry** via Supabase `reauthenticate`. Stolen session tokens alone cannot trigger a delete.
7. **Rate limiting:** use Supabase Auth defaults. Do not build custom rate limiting.
8. **Sign-up is open self-serve.** No invite codes, no domain whitelist, no admin approval.

---

## 7. Authorization (RLS)

1. **Every teacher-owned entity is filtered at the database level.** Implement RLS policies that walk up the FK chain to `Teacher`. The API layer also does application-level ownership checks as a backstop, but RLS is the primary enforcement.
2. **Every list read filters `WHERE deleted_at IS NULL`** on the teacher chain. Soft-deleted teachers' data is invisible to anyone (including themselves — they must restore first).
3. **`is_seed = true` ObservationTemplates are read-only** via RLS (UPDATE and DELETE blocked).

---

## 8. Quality features

1. **Audit log:** `ScoreAudit` + `TermRatingAudit`. 2-year retention (implement as a cleanup job later; for v1 just let the tables grow).
2. **Error monitoring:** wire Sentry on both client and API. E2E via Playwright for critical flows.
3. **Testing:** critical-paths only for v1 — auth, Pass B write paths, Pass D computations, persistence layer. Do NOT pursue full coverage.
4. **Backups:** Supabase Pro managed daily + PITR. Set up a weekly cron to download a JSON export to your local machine or external storage.
5. **Analytics:** NONE in v1. Do not add Plausible/PostHog/Mixpanel.
6. **GDPR-style export:** JSON download available in settings and offered in delete-account flow. The export includes all teacher-owned entities.

---

## 9. Product content

### 9.1 Demo seed JSON

Build `/shared/demo-seed.json` matching this spec:

- **1 course:** grade 8 Humanities (proficiency-focused; showcases the competency pipeline).
- **20–30 students** with realistic fake names (mix of cultures, varied pronouns).
- **~8 assessments:** mix of rubric-based and direct-scored. Varied completion states — some fully graded, some partial, some untouched.
- **Dataset personality:** realistic bell curve (most students mid-range, a few strong, a few struggling). Makes the at-risk indicator and class distribution meaningful.
- **Extras:** include several observations (strength / growth / concern sentiments), and ONE student with a fully completed term rating with narrative.

This JSON serves double duty: demo mode loads it, AND first-verified sign-in auto-seeds a Welcome Class from it.

### 9.2 Report blocks (v1 includes all 10)

Order matters. Blocks render in this order:

1. Header (student + course + teacher + term + school year)
2. Academic Summary (overall Q/R/S + proficiency + category breakdown)
3. Section Outcomes (per-competency proficiency with level descriptors)
4. Focus Areas (lowest-N sections with zero-evidence ranked first)
5. Completion (N late this term, NS count, excused count)
6. Learner Dimensions (work habits, participation, social traits from TermRating)
7. Teacher Narrative (`TermRating.narrative_html`)
8. Observations (cited via `TermRatingObservation`)
9. Assessment list (every assessment in the course with score and category)
10. Signature block (teacher line + optional principal line)

NOT in v1 (do not build): Cover page, Strengths block, Attendance block, Goals block.

### 9.3 First-run onboarding

On first verified sign-in, auto-seed a Welcome Class using the demo seed JSON. Teacher lands in a populated gradebook. Surface a small banner on that course: "This is a sample class. Delete it anytime from Course Settings."

---

## 10. What to explicitly NOT do

- Do NOT rename `NS` to `MISSING` anywhere. Backend enum stays `'NS' | 'EXC' | 'LATE'`. UI pills stay labeled `NS` / `EXC` / `LATE`.
- Do NOT treat blank gradebook cells as zero. Blank = not graded = excluded from averages.
- Do NOT add teacher-configurable at-risk thresholds in v1.
- Do NOT allow category weights to sum above 100 in the UI.
- Do NOT allow selecting `grading_system = letter` or `both` when zero Categories exist.
- Do NOT denormalize any computed field into a column on Enrollment, Student, or Course. Aggregates compute on read. Period.
- Do NOT build the parent or student portal routing targets (`/parent/`, `/student/`). Stubs exist in `login-auth.js`; leave them.
- Do NOT wire the term-rating narrative auto-generate button. Hide it.
- Do NOT attempt cross-course observation/note/goal aggregation on the student profile view. Each course is a sandbox.
- Do NOT modify app-seeded ObservationTemplates (`is_seed = true`). RLS blocks this; don't try to override.
- Do NOT add per-section `calc_method` overrides in v1. Course-wide setting only.
- Do NOT add analytics/telemetry beyond Sentry error tracking in v1.
- Do NOT wire any old code path (`saveScores`, `saveRubrics`, `saveLearningMap`, etc.) — these are the LS-only stubs that motivated the rebuild. Every write goes through a new v2 RPC that actually persists.

---

## 11. Implementation order (recommended phases)

Phase order — each phase builds on the previous:

1. **Schema migrations** — apply ERD + amendment + this file's additions to `fullvision-v2`. Add RLS policies. Seed ObservationTemplates.
2. **Auth** — Supabase Auth with custom SMTP; two-phase sign-up; sign-in with soft-delete detection; delete-account with password re-entry + soft-delete.
3. **Pass B write paths in FK order:** Course → Category → Subject → Section → Tag → CompetencyGroup → Module → Rubric → Criterion → CriterionTag → Student → Enrollment → Assessment → AssessmentTag → Score → RubricScore → TagScore → Observation (and join tables) → Note → Goal → Reflection → SectionOverride → Attendance → TermRating → TermRatingDimension → TermRating join tables → ReportConfig → ObservationTemplate (custom only) → CustomTag.
4. **Pass D computation primitives** as pure functions (§4 above). Unit-test these thoroughly — they're the math that silently affects grades.
5. **Pass D read surfaces** — one endpoint per surface (gradebook, student profile, class dashboard, learning map, term rating editor, report preview, observation feed, assessment detail).
6. **UI rewiring** — point every existing UI component at the new API. Remove legacy controls (U14–U17). Add new controls (U1–U13).
7. **Category UI** — inline management row in Course Settings (clone of Modules panel). No new wizard step.
8. **Rubric editor enhancements** — per-criterion weights + per-level values (U3, U4).
9. **Offline queue integration** — already scaffolded at `shared/offline-queue.js`. Wrap v2 RPCs with `v2Queue.callOrEnqueue`. Build U5–U7 UI components (badge, panel, banner).
10. **Audit wiring** — confirm every score/term-rating write appends to audit tables inside its transaction.
11. **Welcome Class auto-seed** — in the first-verified-sign-in bootstrap flow.
12. **Import flows** — CSV roster, Teams file, JSON, class-creation wizard. The existing wizard is untouched — no Category step added to it. Teachers set up Categories in Course Settings after the wizard finishes.
13. **Report renderer** — the 10 blocks in §9.2, rendered from the `/api/report/{enrollment_id}` endpoint.
14. **E2E tests** (Playwright) for: sign-up → verify → first sign-in shows Welcome Class; create course → create category → create assessment → score a student → view dashboard → view report; offline score entry → reconnect → verify sync; soft-delete account → sign-in within 30 days → restore.
15. **Cutover:** tag `main` → `legacy-v1`, rename `rebuild-v2` → `main`, update Netlify to build from new main, move old site to `legacy.fullvision.ca`.

---

## 12. Content strings (bake these in)

Net-new copy for new UI. Use verbatim unless a future decision supersedes.

### 12.1 Seed `ObservationTemplate` rows (`is_seed = true`, immutable)

Ten templates ship in the schema migration:

1. "Showed strong effort on [skill/task]."
2. "Would benefit from additional support with [concept]."
3. "Demonstrated leadership in [context]."
4. "Collaborated effectively with peers on [task]."
5. "Asked thoughtful questions that deepened the discussion."
6. "Extended thinking beyond the task."
7. "Applied the concept in a novel way."
8. "Engagement noticeably dropped during [context]."
9. "Showed persistence through a challenging problem."
10. "Would benefit from re-teaching [specific competency]."

### 12.2 `TermRating.social_traits` — app-wide set

Ten trait checkboxes on the term-rating editor:

`Respectful`, `Responsible`, `Curious`, `Collaborative`, `Persistent`, `Kind`, `Creative`, `Self-directed`, `Thoughtful`, `Inclusive`

### 12.3 Welcome Class banner

> Welcome! This is a sample class. Explore the features, then delete it anytime from Course Settings.

Render with existing `--focus-banner-bg` / `--focus-banner-border` tokens.

### 12.4 Delete-account confirmation dialog

> Deleting your account hides all your data immediately and permanently removes it after 30 days. You can cancel the deletion by signing in again within 30 days.

Requires: password re-entry + typed-confirm (teacher's email).

### 12.5 Restore-account prompt (shown on sign-in during 30-day grace)

> Your account is scheduled for deletion on [date]. Restore it now?

Buttons: **Restore** (primary) / **Continue deletion** (secondary).

### 12.6 Default category names on new-course create

None. Teacher starts with zero categories. If they pick `grading_system = 'letter'` or `'both'`, the letter/both segments disable and show tooltip "Create a category first →".

### 12.7 Category weight input behavior

Live warn + Save disabled at `sum > 100`. Running total displays "85 / 100 %" in `var(--text-2)` when ≤100, `var(--priority)` when >100. No hard-clamp on keystroke — teacher can type freely while rebalancing.

### 12.8 Dual proficiency color scale

Keep both. Global semantic `--score-1..4` (red/orange/green/blue) stays on pills/dashboards/reports. Earthy `.gb-grid --score-1..4` (rust/brown/sage/teal) stays scoped to the gradebook grid. Two scales are intentional — earthy reduces visual noise in a dense grid.

### 12.9 Placement for new elements

- **Category management** — inline in Course Settings, below the `grading_system` toggle. Row pattern cloned from Modules (name + weight input + drag handle + delete).
- **`grading_system` toggle** — existing `.gb-seg-control` pattern, three segments.
- **Rubric per-criterion weight** — small number input inline in the criterion header next to the name.
- **Rubric per-level values** — four small number inputs tucked under a per-criterion "Customize point values" disclosure, hidden by default.
- **Data export (JSON)** — user-menu dropdown entry "Export my data" + secondary button in delete-account dialog.
- **"N unsynced" badge** — existing `.obs-badge` markup on the user avatar, colored `var(--late)` instead of `var(--active)`.
- **Sync status panel** — popover anchored to the badge; click badge to open, click outside to dismiss.
- **Offline banner** — thin strip at top of viewport, `var(--late)` accent.
- **At-risk list** — "Needs attention" card on class dashboard; no inline row-level badges.
- **Session-expired modal** — existing `.modal-box` pattern, only on term-rating narrative + observation capture surfaces; preserves form state.

---

## 13. Source of truth pointers

- **ERD:** `docs/backend-design/erd.md` (Pass D amendment folded in 2026-04-19; former `erd-amendment-pass-d.md` content now canonical within `erd.md` §"Pass D Amendment")
- **Write paths:** `docs/backend-design/write-paths.md`
- **Auth/session:** `docs/backend-design/auth-lifecycle.md`
- **Read paths + math:** `docs/backend-design/read-paths.md`
- **Spec vs. UI reconciliation:** `docs/backend-design/spec-vs-ui-diff.md`
- **Offline architecture:** `docs/backend-design/offline-sync.md`
- **Answer-by-answer log:** `docs/backend-design/DECISIONS.md`
- **This file:** `docs/backend-design/INSTRUCTIONS.md` (actionable summary)

All of the above live on the `design/backend-v2` branch of `MrBrown85/FullVision`. Implementation work lives on `rebuild-v2` (same repo). Browse them rendered on GitHub or at <https://fullvision-decisions.netlify.app>.

---

## 14. Unanswered at design time — decide during implementation

These were not in the 49 questions because they're coding-level decisions:

1. **Offline delta-refresh shape** — does each read endpoint support `?since=<timestamp>` or does client always full-refetch? Recommend `since` for bandwidth.
2. **Dead-letter UX in offline sync** — blocking vs skipping. Recommend skipping so one bad entry doesn't jam 50 others.
3. **Offline queue size cap** — recommend 500 entries or 5 MB localStorage.
4. **Server-side clock-skew policy** — server overwrites `updated_at = now()`; client timestamp only for ordering.
5. **Welcome Class banner copy** — suggest "This is a sample class. Delete it anytime from Course Settings."
6. **Empty-category UX for letter/both mode** — inline tooltip on the disabled segment is the default. No modal, no wizard step.

When in doubt on any of these, prefer the simplest behavior that doesn't silently lose data.
