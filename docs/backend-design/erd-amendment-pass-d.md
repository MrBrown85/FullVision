# ERD Amendment — Prerequisites for Pass D

This document amends Pass A's `erd.md` based on three concrete teaching use cases (Phil 12, Humanities 8, IT hybrid) and the Philosophy 12 grade-spreadsheet inspection. Apply these changes to `erd.md` before reading `read-paths.md`.

## Why the amendment exists

Pass A's ERD assumed a binary summative/formative assessment type plus a single weight slider. Real use cases show:

- Teacher A (Phil 12, senior) needs **teacher-named assessment categories** with custom weights, **plus** curricular competencies (Sections) for dashboard display. Categories and competencies are separate concerns.
- Teacher B (Humanities 8, junior) uses competencies only, no categories. Scores reported as proficiency (1–4 / Emerging–Extending).
- Teacher C (IT hybrid) needs both modes, toggled per view.
- Rubric criteria need teacher-adjustable **weights** (per-criterion) and **level point values** (per-cell), matching Teams/Schoology flexibility.

## Changes at a glance

### Add

#### Category entity
```
Category {
    uuid id PK
    uuid course_id FK "FK → Course"
    text name
    numeric weight "0-100; teacher-set percentage"
    int display_order "within course"
    timestamp created_at
    timestamp updated_at
}
```

- Per-course. Many per Course. Optional — a course may have zero categories.
- Weights are teacher-managed. **UI hard-caps at 100**: a teacher cannot save a configuration whose weights sum > 100. If they type a value that would push the sum over, the input is rejected or auto-clamped down (per final decision on Q18). Sums below 100 are tolerated and renormalized at read time (Pass D §1.4).
- When present and `Course.grading_system = 'letter'` or `'both'`, categories drive the percentage pipeline.
- When absent, **letter/both mode is blocked** — UI prompts teacher to create at least one category before selecting those modes (per final decision on Q11).

#### New columns

- `Assessment.category_id uuid FK → Category, nullable`
- `Course.grading_system text` — enum: `'proficiency' | 'letter' | 'both'`. Replaces `report_as_percentage`. The UI already has a `course.gradingSystem` field with values `proficiency` and `letter` — this amendment adds `both` and standardizes the three-value enum.
- `Course.timezone text` — IANA tz string (e.g., `'America/Vancouver'`). Defaults to the teacher's browser timezone on course creation (per Q22). All date/datetime fields inside the course render in this TZ.
- `Criterion.weight numeric` — default 1.0. Normalized across criteria at read time: `criterion_weight / SUM(all criteria weights in rubric)`. Teacher-adjustable.
- `Criterion.level_1_value numeric` — default 1. Teacher-adjustable.
- `Criterion.level_2_value numeric` — default 2. Teacher-adjustable.
- `Criterion.level_3_value numeric` — default 3. Teacher-adjustable.
- `Criterion.level_4_value numeric` — default 4. Teacher-adjustable.

### Drop

- `Assessment.type` — replaced by `category_id`.
- `Course.summative_weight_pct` — no longer applicable under the category model.
- `Course.category_weights_enabled` — same.
- `Course.grading_scale jsonb` — Q→R% piecewise map and R→letter cutoffs are hardcoded app-wide (per decision).
- `Course.report_as_percentage` — replaced by `grading_system`.

### Clarify (no rename — matching existing UI)

- `Score.status` value set: `'NS' | 'EXC' | 'LATE' | null`. Unchanged from Pass A; this amendment supersedes an earlier misguided rename to `MISSING`. The UI at `teacher-mobile/tab-grade.js:219-221` and multiple spots in `teacher/page-assignments.js` already renders `NS` pills wired to the `save_assignment_status` RPC, so the value stays.
  - `NS` — "not submitted." Counts as 0 in calculations. Teacher must mark this explicitly.
  - `EXC` — excused. Excluded from calculations entirely.
  - `LATE` — **informational only**. Does not affect any calculation. Surfaces in reports and the teacher dashboard as "student has N late assignments this term."
  - `null` — for Score rows that carry a value and/or a comment but no status.
- Rows that don't exist for a given (enrollment, assessment) pair mean "not yet graded" and are excluded from calculations. This is the default state.

### Expand

- `Course.calc_method` enum. Previous: `'mostRecent' | 'highest' | 'mode' | 'decayingAvg'`. New: `'average' | 'median' | 'mostRecent' | 'highest' | 'mode' | 'decayingAvg'`.
  - Applies to the **competency/section proficiency** pipeline only (Pipeline 2 in Pass D). The letter/percentage pipeline always uses straight average within a category.
  - Set per-course in the class creation wizard.

## Not being added (deliberately)

These were considered and rejected because no use case needs them:

- `Section.weight` — none of A, B, or C weights competencies against each other at rollup time. Group average = straight average of sections in group; overall = straight average of sections (or of groups).
- Criterion → Section direct link (bypassing Tag). Teachers still link criteria to Tags; UI may expose "link to competency" as sugar for "link to the tags under this section," but the relational model is CriterionTag only.

## Updated entity boxes

Showing only entities whose columns changed. Unchanged attributes omitted for brevity.

```
Course {
    uuid id PK
    uuid teacher_id FK
    text name
    text grade_level
    text description
    text color
    boolean is_archived
    int display_order
    text calc_method  "average | median | mostRecent | highest | mode | decayingAvg"
    numeric decay_weight
    text grading_system  "proficiency | letter | both"
    text late_work_policy
    timestamp created_at
    timestamp updated_at
}
```

```
Assessment {
    uuid id PK
    uuid course_id FK
    uuid category_id  "FK → Category, nullable"
    text title
    text description
    date date_assigned
    date due_date
    text score_mode  "proficiency | points"
    numeric max_points
    numeric weight
    text evidence_type
    uuid rubric_id   "FK → Rubric, nullable"
    uuid module_id   "FK → Module, nullable"
    text collab_mode
    jsonb collab_config
    int display_order
    timestamp created_at
    timestamp updated_at
}
```

```
Criterion {
    uuid id PK
    uuid rubric_id FK
    text name
    text level_4_descriptor
    text level_3_descriptor
    text level_2_descriptor
    text level_1_descriptor
    numeric level_4_value  "default 4; teacher-adjustable"
    numeric level_3_value  "default 3; teacher-adjustable"
    numeric level_2_value  "default 2; teacher-adjustable"
    numeric level_1_value  "default 1; teacher-adjustable"
    numeric weight         "default 1.0; normalized across rubric at read time"
    int display_order
    timestamp created_at
    timestamp updated_at
}
```

```
Score {
    uuid id PK
    uuid enrollment_id FK
    uuid assessment_id FK
    numeric value  "nullable; 1-4 proficiency or points"
    text status    "nullable; NS | EXC | LATE"
    text comment
    timestamp scored_at
    timestamp updated_at
}
```

## Impact on prior-pass documents

- **Pass B (write paths):** mostly unaffected. The Assessment create/edit path (§8.1, §8.2) now takes a `category_id` instead of a `type`. The Save Rubric path (§7.1) now includes criterion weights and level values in the payload. No new sequence diagrams needed — payload contents change only.
- **Pass C (auth lifecycle):** no changes.

## Carried-forward open questions

1. **Weights sum validation.** If a teacher's categories sum to 98% or 103%, does the app warn/block/auto-normalize? Recommend: warn in the UI, normalize at read time when computing overall percentage so categories that don't sum to 100 still yield a sensible result.
2. **`grading_system = 'both'` UX.** Not prescribed here. Data side runs both pipelines; UI side is TBD.
3. **Course.calc_method scope.** Applied uniformly to every section, or per-section? Current design: per-course (one setting, all sections follow it). Matches use cases — none specify per-section calc methods.

## Deferred features (out of scope for v1, per user decision)

These are acknowledged forward capabilities that are **not** added to the ERD in this amendment. They will require additional entities and write paths when introduced.

- **Parent / student portal views.** `login-auth.js:22-23` has routing stubs for `/parent/` and `/student/` — keep the stubs, add read-only endpoints + new role-based authorization when these portals are built. No schema additions needed now.
- **File uploads** (assignment attachments, student work artifacts). When added: new `Attachment` entity with storage-provider reference, size, mime-type, foreign keys to Assessment and/or Enrollment; write paths for upload/delete; storage bucket setup.
- **Calendar / schedule view.** Covered by existing `Assessment.date_assigned` / `due_date` columns — no schema change needed when a calendar view is added later. Just a new read endpoint.
- **Notifications beyond toasts.** Current UI uses in-page toasts only. When email / push notifications are added: new `Notification` entity, delivery-state tracking, user notification preferences on TeacherPreference.
