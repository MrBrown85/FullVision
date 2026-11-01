# FullVision: a rubric library across classes

Plan, 2026-10-18. Suggestion 3 from the rubrics comparison (`~/fullvision-rubrics-report`).

## The problem

A rubric belongs to one class (`rubric.course_id`). A teacher with English 9 A and B, or who teaches the same course next year, builds the same rubric twice. Today the only route across classes is the assessment-copy flow (#207), which clones a rubric by name when an assessment is copied, and Duplicate Class (`duplicate_course` copies rubrics, criteria and criterion tags). There is no way to say "use this rubric in that class" on its own, and no way to keep two copies in step.

Competitors: Schoology keeps rubrics in Resources and copies them into courses; Teams keeps one list per teacher; Google Classroom reuses from any class as a copy; Canvas has course and account lists and locks a rubric once it is on more than one assignment. Nobody syncs copies. The pattern that fits FullVision is the one #207 already set for assessments: copy on demand, link the copies, offer to update the others on edit.

## What stays the same

- `rubric.course_id` stays `not null`. RLS through `fv_owns_course`, the class bundle, Demo Mode and the offline outbox all assume a rubric lives in a class. A teacher-level template table would be a second rubric shape through every one of those paths for little gain, because Duplicate Class already carries rubrics into next year.
- Competency links stay per class. Tags are per class, so a copied criterion gets its competencies by name (`AssessmentCopy.mapTags`: short label first, then full text, same section preferred). Unmatched competencies are listed, never silently dropped.
- Scores stay put. `rubric_score` is keyed by criterion id; a copy has its own criterion ids, so copying and later edits never touch another class's scores.

## Phase 1: copy on demand (no schema change)

Two entry points, one dialog.

**Rubric Bank panel.** Each rubric row gets a "Copy to…" button beside edit and delete. The dialog lists the teacher's other live classes with `AssessmentCopy.copyTargets` (same course first, "More classes" behind a toggle), each as a checkbox, and under each ticked class a one-line match summary:

- "3 of 3 criteria, 6 of 6 competencies matched"
- "Identify Patterns and Evaluate Methods have no match in History 12 and will be left off" (the criterion keeps its descriptors and counts toward the overall grade only)
- "Science 8 B already has a rubric called Lab Investigation Rubric; the copy will be named Lab Investigation Rubric (2)"
- When more than half the competencies have no match: "This class teaches a different course; most competencies will be left off." (the warning from the #208 follow-up list)

Button: "Copy to 2 classes". Copies land through `saveRubrics(dstCid, …)` → `upsert_rubric`, so they queue offline like any rubric save.

**Assessment form.** The Rubric drop-down gets a last option "From another class…" beside "+ New Rubric". It opens the same dialog in reverse: pick a rubric from another class (grouped by class, with the criterion and competency match summary), "Use in this class" copies it into the current class and selects it in the form. This is the moment teachers actually reach for a rubric they made elsewhere.

**Code.**

- Move `_cloneRubric`, `_byName` and the rubric part of `planCopy` from `teacher/assessment-copy.js` into a new `teacher/rubric-library.js` (`window.RubricLibrary`: `targets`, `planCopy(srcCid, rubric, dstCid)`, `copyTo(srcCid, rubric, dstCids)`, `uniqueName`, `renderCopyDialog`, `renderPickDialog`). `AssessmentCopy` calls it; nothing in #207 changes behaviour.
- `planCopy` returns `{ dstCid, name, criteria: [{ name, matched: [...labels], dropped: [...labels] }], collision, mostlyDropped }` so the dialog and the tests read the same object.
- Dialog markup reuses `.copy-dialog*` and `.copy-review-*` styles from `assignments.css`; new strings in sentence case.
- Register the file in `teacher/app.html`, `sw.js`, `tests/setup.js` (after `rubric-guard.js`).
- Tests (`tests/rubric-library.test.js`): same-course match, cross-course partial match with dropped labels, name collision suffix, the "mostly dropped" flag, copies never share ids, `AssessmentCopy` still clones through the library.

**Size:** about a day. One PR. No migration, so CI's drift check is unaffected.

## Phase 2: linked copies (one migration)

Mirror `assessment.copy_group`:

- `migrations/<date>_rubric_copy_group.sql`: `alter table rubric add column copy_group uuid; create index … where copy_group is not null;` `upsert_rubric` gains `p_copy_group uuid default null` (drop the 5-arg signature, recreate with 6; anon stays revoked); `get_class_bundle` returns `copy_group` on each rubric. `list_rubric_copies(p_copy_group)` returns `{ id, course_id, course_name, name }` for the teacher's live classes, like `list_assessment_copies`. `bundle_schema` stays 3 (an added field, as in #207).
- Phase 1's copy sets `copy_group` on source and copies (the source gets one the first time it is copied).
- **Editing a rubric with copies** (after `saveRubricEdit`): "Update the other classes too?" listing, per class, what would change: criteria matched by name, then by position when names differ on both sides; descriptor, value and weight changes; added criteria with their competency matches; removed criteria. A removed criterion that has scores in that class is shown with its student count and unticked by default, which is the #209 guard applied across classes. Reuse `AssessmentCopy._dialog` and the change-list rendering from `offerLinkedEdit`.
- Rubric Bank rows show "Also in Science 8 B" chips; the Copy to… dialog hides classes that already hold a copy.
- A rubric deleted in one class leaves its copies; the delete message says so (as `deleteNote` does for assessments).

**Size:** one to two days plus the migration (applied on Colin's OK). Second PR.

## Phase 3: teacher templates (only if asked)

If teachers want rubrics that belong to no class (shared with a department, or kept after a class is purged), add `rubric.teacher_id` with `course_id` nullable and a `teacher_id = auth.uid()` policy for template rows, loaded by a separate `list_rubric_templates()` call rather than the class bundle, with criteria storing competency labels instead of tag ids. "Save as template" in the editor and "Start from template" in the Rubric Bank. Not needed for the two-sections case or for year rollover, so it waits for a real request.

## Order and dependencies

1. Merge #209 (edit guard) and the handout PR (both touch `page-assignments.js`), then start Phase 1 on a fresh branch.
2. Phase 2 after Phase 1 is live and used once.
3. `docs/DECISIONS.md` gets a "Rubrics across classes" entry with the rules above; `docs/ROADMAP.md` item 4 (year rollover) notes that Duplicate Class already copies rubrics.

## Open questions

- Should the copy dialog offer "Replace the existing rubric's criteria" when a same-named rubric exists in the target? Not in Phase 1: replacing criteria deletes scored ones. Phase 2's linked edit is the right place for that.
- Should a copy into a different-course class be allowed at all? Yes, with the "mostly dropped" warning; a descriptor-only rubric (Collaboration, Presentation skills) is useful in any course.
