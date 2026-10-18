# Decisions

Settled product decisions. Add a dated entry when one is made; don't reopen one without a new entry that supersedes it.

## Grade calculation (2026-10-16)

Context: `grading-compliance-plan.md`. All implemented; see its status table.

- **D1 Category weights must total exactly 100** to save. Not relative weights.
- **D2 Per-assessment weight** (0.5×–3×) applies to proficiency work only; hidden on points and Complete/Incomplete work, labelled "Proficiency weight".
- **D3 A proficiency level counts as level ÷ 4** toward a percentage (3 = 75%). Not the middle of a letter band.
- **D4 Extra credit:** points work can score up to 2× its maximum; the course % can exceed 100.
- **D5 No drop-lowest.** Skipped; low demand.
- **D6 Rounding:** a class setting, whole number or one decimal; default whole for grades 10–12. The letter always comes from the % as shown.
- **D7 Missing counts as 0.** No switch to turn it off.

## Product shape (2026-10-17)

- **Teacher-only.** No student or parent logins. Printed reports are the family surface. A no-login student form for self-reflection is planned (see `STUDENT-VOICE-PLAN.md`), not a portal.
- **Flat learning map:** one section per competency, grouped by subject and competency group. Not a duplication to be cleaned up.
- **Demo Mode is the only sample data.** No Welcome Class.
- **Manual archive; delete only after archive; soft delete with a 30-day purge.**
- **Letter cutoffs are the BC scale,** fixed, not editable schemes.
- **Overrides are per competency with a required reason.** No course-level final-grade override.
- **No LMS features:** no assignment submission, content pages, discussions or quizzes. FullVision sits beside the district LMS.
- **Students are removed by withdrawal, not deletion** (planned; hard delete stays behind a second step).
- **Sync failures show only on the sync dot.** No banners or toasts.
- **Plain language in the UI:** sentence case, no jargon without a legend.

## Student voice (2026-10-17)

Context: `STUDENT-VOICE-PLAN.md`.

1. **Two forms:** a core competency reflection from the grade-by-period templates (three prompts plus the nine-dimension rating) and an optional curricular self-assessment from the course's I-can statements. Neither over ten minutes.
2. **Codes:** one single-use code per student per questionnaire, expiring at the close date, stored hashed.
3. **Previous answers** are shown only for the three repeated questions.
4. **Repeated questions:** "What am I good at as a learner?" · "What is hard for me right now?" · "What do I want to get better at, and how?" (September, January, June).
5. **English first;** translations stored as data on each question.
6. **Interview answers are observations** (`context_type = 'interview'`), on the one timeline.
7. **The teacher's term questionnaire stays as is** until phase 5.
8. **Backend:** no anon-callable database functions. One Supabase Edge Function in `ca-central-1` fronts the student form, calling `student_submit` schema functions granted to the service role only; short-lived tokens, rate limiting, append-only responses.
9. **UI:** the student page reuses the teacher mobile app's stylesheets and components; reuse is one-way.

## Reporting periods (2026-10-17)

Context: `ROADMAP.md` 1.2; `migrations/20261017_course_reporting_terms.sql`; `fullvision-myed-integration.md` §4.2 (MyEd terms will use the same ordinals).

1. **A class has up to six reporting terms** with a label, a start date and an end date, stored as `course.reporting_terms` (jsonb), edited in Class Management, numbered 1..n by start date. Term N is what the Reports page calls Report N.
2. **A term counts the assessments whose assigned date falls inside it.** An undated assessment is in no term; the gradebook says how many it left out.
3. **All time is the default view.** The term picker on the gradebook, dashboard and student pages remembers the choice per class on this device, and every grade on those pages follows it. The Reports page follows the report's own period instead.
4. **A competency override applies in every term that has evidence**, as it does all time. With no evidence in the term the level is "no evidence", override or not.
5. **No overlap, no gaps required.** Terms may leave gaps; they may not overlap. The server enforces the shape and date order; overlap is a client rule.
6. **Duplicate Class does not copy terms.** Dates belong to one school year.
7. **Mobile grades stay all-time.** The grade list's date filter offers each reporting term by name and keeps the assessments dated inside it (undated ones drop out), but it is a list filter only: nothing on mobile sets the active term, so every grade there is all-time.
8. **Surrey secondary schools' reporting periods are built in** (`shared/reporting-term-presets.js`, 2026-10-17). Each listed school's four terms come from its published 2026-27 calendar: Term 1 ends the day its first report is published, Term 2 ends with Semester 1, Term 3 ends on the Semester 2 mid-term report, Term 4 on the final. Where a school hasn't published its semester turnaround, Feb 1 is used and the editor says so. **Grandview Heights Secondary is the default:** a class created in the wizard starts with its terms for the current school year, and Class Management can swap in any listed school's dates. Schools with no published dates are not listed. The file is per school year and needs refreshing each August.

## One assessment in several classes (2026-10-18)

Context: a teacher with two sections of a course (English 9 in blocks A and B) wants to make an assessment once. Researched against Teams, Google Classroom, Schoology, MyEd's Aspen gradebook, JumpRope, PowerTeacher Pro and Canvas. `migrations/20261018_assessment_copy_group.sql`; `teacher/assessment-copy.js`.

1. **Each section stays its own class.** No blocks or sections inside a class, and no linked-section syncing (Schoology's linking replaces child data; Canvas's model needs a sections layer MyEd doesn't use).
2. **"Also add to" on the assessment form** copies the assessment into other classes when it is saved, as Teams' "Assign to" does. Classes for the same course are listed first (shared curriculum tags, or the same name once "Block A", "(B)", "Period 3" and a trailing letter are dropped).
3. **"Set dates per class"** gives each class its own assigned and due date.
4. **Matched by name in the other class:** category, competencies (short label, then full text), rubric, module. A missing category is chosen by the teacher; a missing rubric is copied with its competencies matched; missing competencies are left off and listed. Nothing is dropped without the teacher seeing it first. Pairs and groups are not copied: they are per class.
5. **"Add from another class"** copies chosen assessments from another class later, like Teams' Duplicate and JumpRope's bank.
6. **Copies are linked, not synced.** They share `assessment.copy_group`. Editing one offers "Update the other classes too?" and changes only the fields the other copy still shared; a field that class had changed on its own (its own due date) stays. Scores are never copied or moved.
7. **A duplicate inside the same class is not a linked copy.**
8. **The form's Classes row** (2026-10-18 follow-up) sits under the title as chips: this class fixed, the other sections of the course as toggles, other classes behind "More classes". A new assessment starts with the classes ticked last time in that class (remembered per class on this device); an edit starts with none. Dates are "Same for every class" unless "Set per class" is chosen.
9. **Linked copies are visible where the teacher works:** an "Also in …" chip on the assessment card opens that copy in its class; a section toggle beside the course picker switches between sections of the same course; the delete confirmation says a copy stays elsewhere; the "Update the other classes too?" dialog lists exactly what will change in each class.

## Editing a rubric that already has scores (2026-10-18)

Context: rubric scores are stored per criterion and projected onto the criterion's competencies at read time, so a rubric edit can change past grades. Canvas locks a rubric once it is on more than one assignment; Google Classroom locks once grading starts; Aspen warns. `teacher/rubric-guard.js`.

1. **Nothing is locked.** A teacher can always fix a rubric.
2. **Removing a criterion that has scores asks first**, naming the criterion and how many students have a score on it, with "Remove and drop scores" as the only way through.
3. **Changing a scored criterion's top value shows a note** in the editor: past scores keep their level, overall grades on assessments using the rubric will change.
4. **The rubric list closes when the editor opens from it**, so the editor is never covered.

## Graded rubric handouts (2026-10-18)

Context: every gradebook compared in the rubrics review returns the rubric to the student; FullVision's scoring grid shows only the four level buttons. `migrations/20261018_rubric_score_comment.sql`; `teacher/rubric-print.js`.

1. **Descriptors stay off the scoring grid.** Teachers grade for speed and know their rubrics; the descriptor belongs on the thing the student gets. Hover still shows it.
2. **The handout is the feedback.** "Print rubrics" on a rubric assessment prints one student-facing rubric per student: the descriptors, the chosen level in grey with a heavy border and its ± mark (black and white only: the sheets are photocopied), a short comment per criterion, the assessment comments and the overall level. The teacher scores once, prints, staples it to the work; the score still feeds the student profile.
3. **Three layouts:** full page, half sheet (two per landscape page) and quarter sheet (four per page), cut lines between. Text shrinks by layout, and shrinks further by steps to fit; a sheet that still does not fit is clipped and the dialog says so before printing.
4. **One comment per criterion**, stored on `rubric_score.comment`, entered from an icon on the criterion row. It cannot exist without a level on the server, so a comment typed first waits on the device and goes up with the level.
5. **Unscored students print a blank rubric.** Not submitted and Excused print as such in place of the overall level.

## One rubric in several classes (2026-10-18)

Context: a rubric belongs to one class, so a teacher with two sections, or the same course next year, built it twice. Schoology copies rubrics from Resources into courses, Teams keeps one list per teacher, Classroom reuses from any class as a copy; none of them sync copies. Plan at `~/fullvision-rubric-library-plan.md`; `teacher/rubric-library.js`.

1. **Rubrics stay per class.** `rubric.course_id` is kept; RLS, the class bundle, Demo Mode and the outbox all assume it. Duplicate Class already carries rubrics into next year.
2. **Copy on demand.** "Copy to another class" on the Rubric Bank and "From another class" on the assessment form copy a rubric, criteria and descriptors included, into another live class.
3. **Competencies are matched by name** in the target (short label, then full text, same section preferred, as assessment copies do). A competency with no match is listed before the copy is made and the criterion keeps its descriptors. When more than half have no match the dialog says the class teaches a different course.
4. **A same-named rubric in the target is never replaced**; the copy is named "Name (2)". Replacing criteria would delete scored ones.
5. **Copies are independent.** Each has its own criteria ids, so scores never move. Linking copies and offering "Update the other classes too?" is phase 2 of the plan.

## Linked rubric copies (2026-10-18)

Context: phase 2 of the rubric library plan. `migrations/20261018_rubric_copy_group.sql`; `teacher/rubric-library.js`.

1. **Copies share `rubric.copy_group`**, set on the source the first time it is copied. It links the rows only; each class keeps its own criteria and scores.
2. **Saving a rubric that has copies offers "Update the other classes too?"**, listing per class what would change: renamed, re-described, re-valued or re-weighted criteria, added criteria with their competency matches, removed criteria. Only what the copy still shared with the saved rubric changes; a field the other class changed on its own stays and is named.
3. **A scored criterion is never removed from a copy by that offer** unless its own box, unticked by default, is ticked; the box says how many students have a score on it.
4. **The Rubric Bank shows "Also in …" on a linked rubric**, the copy dialog marks classes that already hold a copy, and the delete confirmation says the copy stays.

## A criterion from a competency (2026-10-18)

Context: building a rubric meant typing every descriptor by hand. Canvas creates a criterion from an outcome with the outcome's own scale; JumpRope keeps I-can descriptors on the standard; Teams drafts a whole rubric with AI. Plan at `~/fullvision-criterion-from-competency-plan.md`; `shared/rubric-draft.js`.

1. **"+ From competency" in the rubric editor** turns each picked competency into a criterion: named after it, linked to it, descriptors drafted. A competency already on a criterion of the rubric can't be picked. A new rubric's untouched first criterion is replaced, not left beside the new ones.
2. **The draft is deterministic and needs no backend.** Proficient is the competency's I-can statements (at most three, so half and quarter-sheet handouts still fit); Extending, Developing and Emerging put the first statement into the BC scale's words ("Independently and in new situations…", "In familiar situations and with some help…", "With support, I am beginning to…"). Written in the student's voice because it prints on the handout. A competency with no I-can text gets the scale wording alone.
3. **"Draft from …" beside Level descriptors** drafts a criterion that has exactly one competency. Typed descriptors are only replaced after the teacher confirms.
4. **The criterion comment is a speech-bubble cell after −/+**, always visible, filled when there is a comment, with C as the shortcut on the focused row. It is its own cell because the −/+ group is redrawn on every score change.
5. **A teacher's own wording carries to the next draft** (`migrations/20261018_competency_descriptor.sql`). Saving a rubric keeps, for each criterion with one competency, any level the teacher wrote themselves (not the plain draft), per teacher and competency. The next "From competency" or "Draft from …" for that competency, in any class, starts from it level by level. The key is the competency's short label plus a hash of its I-can text, never a tag id, so another section or next year's class finds it and a same-named competency in another grade doesn't. The last save wins. Stored on the device for Demo Mode and offline; sent through the outbox when signed in; a load never overwrites a save still in the outbox.
6. **No AI rewrite of descriptors.** Ruled out on 2026-10-18. Descriptors come only from the I-can draft and the teacher's own saved wording.
