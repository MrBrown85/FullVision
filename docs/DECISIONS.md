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
- **Students are removed by withdrawal, not deletion** (2026-10-19). The roster's remove button withdraws: the student leaves the roster, gradebook, dashboard, observations, phone app and reports, and their scores, observations and reports stay on the server. Class Management lists them under Withdrawn with Re-enrol. Permanent delete is the second step, only from that list, and only for a withdrawn student (`delete_withdrawn_student`); it has no Undo.
- **Sync failures show only on the sync dot.** No banners or toasts.
- **Plain language in the UI:** no jargon without a legend. Casing: see "Text size and casing" (2026-10-19).

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
9. **A class runs Full year, Semester 1 or Semester 2** (2026-10-19), chosen in Class Management's terms editor or the new-class wizard, as Schoology and Teams link a section to the school's grading periods. A semester class carries only that semester's preset terms and **keeps the school's numbers**: Semester 2 keeps Terms 3 and 4, so its reports are Report 3 and 4 ("Apr report card", "Jun report card") like a full-year class's. The choice is not stored; it is read off which preset terms the class has. Semester 1 is the terms that end before Semester 2 starts (Term 3's start for a school preset, else Feb 1); Semester 2 those that start on or after it. Typed terms are numbered in date order and get no semester choice. Narrowing a class hides terms but deletes nothing: questionnaire answers saved under a hidden report come back with Full year.

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

## Copying a class's grading setup (2026-10-18)

Context: a teacher asked for Teams' "Import settings": set up grading once and use it in every section. `teacher/grading-setup-copy.js`. No database change; categories go through `save_categories`.

1. **One dialog, two directions.** "Copy grading setup…" in Class Management copies this class's setup to other classes (several at once, same course first) or imports it from one. "Copy from another class" beside the categories opens the same dialog with only categories ticked.
2. **What copies:** grading system, categories and weights, calculation method (with decay weight), course % rounding and late work policy, each its own checkbox, all ticked. Reporting terms are listed unticked: dates belong to one school year, as with Duplicate Class.
3. **Categories match by name** (case and spacing ignored). A matched category keeps its id, so its assessments stay in it, and takes the source's name, weight and order. Unmatched source categories are added. A target category the source lacks is removed; if it has assessments the teacher picks where they move first (defaulting to a category sharing its first word). Work with no category is offered a category too, or can be left.
4. **A source with no categories never clears the target's.** The option is greyed out.
5. **A review step lists every change per class** before anything is saved, and what is already the same. Unsaved category or term edits in Class Management block the dialog until saved or undone.
6. **Copies are not linked** and scores are never touched. Grades in the target classes follow the new setup.
7. **Signed in, removed categories with work stay at 0% until the work has moved,** then a second save deletes them (the server refuses to delete a category in use). If the new categories haven't reached the server (offline, refused), the work stays where it is and Class Management offers the move later.
8. **Duplicate Class copies categories and weights too** (2026-10-18), as new rows, with the class settings, learning map and sentence starters. It leaves reporting terms (Reporting periods 6), rubrics and assessments, which each have their own copy.

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

1. **Rubrics stay per class.** `rubric.course_id` is kept; RLS, the class bundle, Demo Mode and the outbox all assume it. Duplicate Class does not copy rubrics; the copy below does.
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

## Observations (2026-10-18)

Context: a review of observation capture and display across desktop, phone, student page, dashboard and reports (`~/fullvision-observations-ux-review.md`). Build plan at `~/fullvision-observations-plan.md`.

1. **Tags are stored as `observation.dims text[]`**, the same string keys the client already uses (`engagement`, `cc:3`, `tag:Lab safety`). Not the join tables: `observation_tag` points at the learning map and `custom_tag` is the teacher's tag library. `migrations/20261018_observation_dims.sql`.
2. **The feed's default is a card list** with a coloured type rail, the date on each card and text pills. The sticky-note grid stays as a view toggle, remembered per device. Changed 2026-10-19: see 10.
3. **Capture is roster-first, with one chip strip on every surface** (Observations page, Assignments comment popover, student page, gradebook cell, phone sheet). Inline shorthand (`@name`, `#tag`, `!type`, `/starter`). Sentence starters are a per-class bank in `observation_template`, editable, and replace the phone's six fixed lines. A starter has text, an optional type and context, and tags (no competency or level). They are edited in Class Management; the phone reads them. Duplicate Class copies them. A class with none is offered the six old phone lines, saved only when the teacher presses "Add these to this class" (2026-10-19). The phone gets a class-sweep screen.
4. **The dashboard has one Observations card** (two thirds of the top row, beside Class Distribution, the same height; they stack below 1100 px; Core Competencies and Upcoming Birthdays move to a second row). Changed 2026-10-18 from the #218 overdue chips and full-width grid. Rules:
   - Two tabs, remembered per device. **By week**: the picked term's weeks, else the last 8; one mark per observation coloured by type (strength, growth, concern, note; an untyped note is an outline), up to 3 marks then "+N" (with more than 3, every type present shows once first); the window's total; the days since the last observation once a student is overdue (no observation in 21+ days, measured from today). Hovering or focusing a week lists its notes; clicking opens the student page at that week's newest observation (`&ob=`). **By competency**: the picked term or all time; one cell per learning-map section with the student's level from `getSectionProficiency`, shown through `formatLevel`, and an evidence count (distinct assessments scored above 0 on the section's tags plus observations linked to one of its tags, in the term). No evidence is a dashed "none" cell; the Gaps column counts them. One column per section even when the class uses competency groups.
   - Flags (only those above 0) highlight students and dim the rest in place: "not observed in 3+ weeks" and "with no strength recorded" on By week; "a competency with no evidence" and "no strength recorded" on By competency. A purple diamond marks no strength recorded: at least one observation in the By week window and none a strength. Overdue names are amber and bold (By week). A class with no observations at all shows no flags and no amber names.
   - Students in roster order, 1 column up to 15, 2 to 30, 3 from 31, fewer when they don't fit; the grid scrolls inside the card and never sideways on the page. "+" on a row opens the capture strip in a dialog with the student fixed.
   - **Hide names** (remembered per device, cleared at sign-out) blurs student names, pronouns, student numbers and designation badges across the dashboard for a projected screen; grades stay visible, popovers stay closed, clicks still work. The student cards' untyped dot is an outline to match.
5. **An observation can link to a learning-map competency** (`observation_tag`) **with an optional level** ("looks Proficient"). The level is evidence only and never enters a grade. The competency card gets an evidence drawer listing scores and observations on one dated list.
6. **The student page gets one Evidence panel** (tabs All / By competency / Assessments / Concerns) with the shared capture strip and a timeline strip above it. It replaces "Assignment Feedback" and "Notes & Observations".
7. **Text pills replace emoji** for type, context and tags on desktop and phone. **Enter sends, Shift+Enter adds a line. Delete shows an Undo toast** instead of a two-click confirm. **Cards show "Quoted in Report N"** when a term rating quotes them, with a "not yet quoted" filter. **A concern observation offers to flag the student.**
8. **No dictation and no photo attachments this round.**
9. **Not decided:** whether a multi-student capture becomes one server row. The client keeps fanning out to one row per student until it is; the feed shows "with …" on each.
10. **Observation cards use FullVision's own vocabulary** (2026-10-19, mockup D2 at `~/fullvision-observation-cards-mockup.html`), replacing the stripe-and-pill card on desktop, the phone and the student page:
    - The type is a solid word block (Strength, Growth, Concern in `--score-3`, `--score-4`, `--score-2`, white bold text, 4 px corners) in a fixed 74 px column, so every name starts at the same x. An untyped note is an empty outline. No left stripe, no tinted pills, no chip tags.
    - The card shows the time only; the day header carries the date and the day's count ("3 observations"). Lists without day headers (the student page) show date and time. Phone day groups read Today, Yesterday, then "Fri, Oct 16".
    - The meta line goes from lightest to most important: the setting in `--text-3`, a linked assessment in link blue, tags with their dots in `--text-2`, and "Quoted in Report N" as a small outlined stamp at the right.
    - Desktop delete shows on hover or keyboard focus only. The phone card has no buttons: a faint › says it opens, the whole card opens the edit sheet (which has Delete Observation), the name still filters the feed, and a left swipe deletes with Undo.
    - **The sticky-note view is gone.** One card style is easier to keep right than two, and the review table leaned toward dropping it.
11. **The edit window is the same white card** (2026-10-19, mockup D3), replacing the cream lined notebook page:
    - A folder band (`--bg`, bottom border) holds the three types as tabs, the chosen one filled; clicking it again clears it. The date sits at the band's right. The name follows, then, for a quoted note, "Quoted in Report N. Changes here show in that report."
    - A plain bordered note box, then one row: Tags (chips with ×, "+ Add Tag" opening the tag popover), then Context as a small menu ("Independent ▾", or a dashed "+ Context") listing the five contexts with None last. Tags come first because they reach the report; context is a note to yourself, and a segmented control made it look required.
    - **Nothing is written until Save.** Enter saves, Shift+Enter adds a line, Esc and Cancel leave the note as it was; a click outside closes only when nothing changed. The × close is gone (one way out). Delete sits at the left in quiet red and offers Undo.
    - The phone edit sheet: Cancel / name / Save in the top bar, the type band, the note box, a settings-style "Context · Independent ›" row that opens a picker (None last), tags as chips with "+ Add Tag" opening a tag picker, and a full-width Delete Observation last; every target is 44 px.
    - The Assignments comment popover keeps its own editor.
12. **The capture strip** (2026-10-19, mockup D4), on every host (Observations page, Assignments comment popover, student page, competency drawer, gradebook cell and dashboard dialogs):
    - The type chips sit beside the student, none chosen until picked: dashed when off, tinted in their colour when on. The strip has no folder band and, on the Observations page, the comment popover and the dialogs, no border of its own (Colin, 2026-10-19: the band and its grey border were rolled back; the edit window keeps its band). A Student line above the box, like an email's To line: chips with an initial avatar, name and ×, then "+ Student" and the hint "or type @name". Then the note box and one row: + Starter, Tags (chips and "+ Add Tag"), the same Context menu as the editor (None last), "+ Link ▾" holding + Assessment and + Competency (with its Level), and at the right Keep Tags, "Enter adds" and the blue Add (disabled until there is text and a student). Nine equal chips said nothing was important; an assessment is linked about once a week.
    - Every host keeps its pre-fill and lock (a fixed student shows without ×, a fixed assessment drops out of + Link), and all shorthand stays (@name, #tag, !type, /starter).
    - Starter menus (+ Starter and /) show each starter's type block and, under its text, what it will set (context · tags), with "Edit starters…" and the line "A starter fills the type, context and tags you haven't set."
    - All chips are square-cornered (4 px); none are pills.
    - **The phone has one form.** Tapping a student avatar opens a sheet titled with their name: one-tap starter rows with the type block in the feed's 74 px column, then "Write Your Own…", which opens the observation sheet from item 11 for that student. The + button opens the same sheet with a Student row (a searchable picker). For a new note the sheet also has Assessment, Competency and Level rows (the old phone strip's links, pre-filled with the assessment scored today), applies @name, #tag and !type on Add, keeps unsent text, and offers to flag the students after a concern. It no longer offers starters or /starter; the quick menu has them.
13. **A fourth type, Note** (Colin, 2026-10-19: "Add one more tab that's yellow and called Note"), everywhere the other three are: card blocks, the editor's band, the strip's chips, the phone sheet, the class sweep, starters, the Type filter and phone filter pills, `!note` shorthand, the report writer's counts, the dashboard's marks and key, and the student page's timeline. Order: Strength, Growth, Concern, Note.
    - **Note is neutral.** It never counts as a strength: the "no strength recorded" flag and diamond ignore it, and the report writer treats it like an untyped note. An observation with no type is still allowed and still an outline.
    - **Yellow, `--obs-note`** (`#f2c200` light, `#ffd60a` dark), apart from Concern's amber. Solid blocks and tabs take dark text (`--obs-note-on`), since white on yellow fails contrast; yellow text on the surface uses `--obs-note-text` (`#7a5900` light); small marks carry a 1 px `--obs-note-edge` so they hold their shape on white.
    - On the dashboard a busy week shows Concern, Growth, Strength, then Note, then no type, while there is room.
    - The live database limits `observation.sentiment` and `observation_template.default_sentiment` to the three old values with check constraints `schema.sql` never recorded; `migrations/20261020_observation_note_type.sql` widens both to include `note`. No server function reads the values.

## Buttons and breadcrumbs (2026-10-19)

Context: a UI/UX sweep found solid blue spent on navigation ("Class Management", "← Dashboard", "Edit Student") beside the real action. Plan at `~/fullvision-design-fixes-plan.md`, PR B.

1. **One primary action per screen; navigation and settings are secondary.** Solid blue marks the screen's main action only: + New Assessment (Assignments, Gradebook), Add in the capture strip (Observations), Issue Reports… (Progress Reports on the Report Card; it saves a fixed copy, then prints), Print Reports (other presets, Class Summary), Save & Next (Term Questionnaire), Term Questionnaire (student page), and Save in forms and dialogs. Links to other screens and settings (Class Management, Edit Student, Student Dashboard, Generate) use an outline button. A screen with no single main action, such as the dashboard, has no solid button.
2. **Screens under the dashboard keep "Dashboard" lit in the top nav** and show a breadcrumb at the left of their toolbar: "Dashboard › Mei Wong" on a student page, "Dashboard › Class Management". "Dashboard" links back; there is no separate back button. `renderBreadcrumb` in `teacher/ui.js`.
3. **No page titles on the five top-level pages.** The nav pill already names them.

## Text size and casing (2026-10-19)

Context: a UI/UX sweep found text too small and too much uppercase monospace (253 of ~650 dashboard text elements at 10–11 px).

1. **12 px minimum on screen, 14 px body text.** Printed sheets (progress reports, rubric handouts) keep their own print sizes; the progress report preview matches the printout.
2. **Title Case for labels, headings, buttons, tabs and menu options** ("Class Details", "Upcoming Birthdays", "Save and Next Criterion"), with short words (a, and, for, of, the, to…) lower case. Hints, messages and full sentences stay sentences. This supersedes "sentence case" in Product shape (2026-10-17).
3. **No uppercase or monospace labels.** Monospace is only for numbers that line up (scores, percentages, counts, student numbers) and codes (QAP, CRT, SCI8).

## Report forms (2026-10-20)

Context: a review of the report printer (`~/fullvision-report-printer-review/`, three passes) measured the Standard preset at three Letter pages per student with page three mostly blank, no Legal paper, colour as the only encoding of a level, no letterhead, and no saved copy of anything printed. Plan at `docs/report-forms-plan.md`.

1. **A class has one report form.** The layout is shared by every student in the class and prints identically for each: same blocks, same places, same type size. Students differ in content, never in typography. There are no per-student layout exceptions.
2. **Blocks are fixed or flowing.** A fixed block's height is known from the class (letterhead, overall and competencies, the competency table, dispositions, the student reflection, attendance, the return strip). A flowing block's height depends on the student (teacher comment, next steps, observations, assignment grades). Only fixed blocks may sit side by side.
3. **A flowing block has reserved room and a rule.** When a student needs more than the room, the block grows and pushes the blocks below it down the sheet and onto the next side, or continues its own text on the next side. Nothing is shrunk, clipped or hidden. When it is empty, the form's rule applies to everyone: print the box with lines, or leave it out.
4. **A form is a sheet.** Letter by default, Legal as an option, front and back. A student whose content overruns gets a Continued sheet, whole blocks only, its back left blank. Duplex is safe by construction.
5. **The Parent / Guardian Response and the student reflection keep their wording.** Colin wrote those blocks for the school; no redesign changes a word of them. Layout work may move the response block to the bottom of the back, below a cut line, so the family keeps the report and returns only the response; the text on it stays as it is.
6. **Levels print as dots and a word** (●●●○ Proficient), in black. Colour is never the only encoding of a level. Dimensions with no rating in the term are left off; a competency row with no evidence says so in words.
7. **The letterhead names the school, class and block, the report by its school name ("Nov Report Card"), the term dates, the teacher and the student number.** Every page carries a running footer with the course, report, teacher, student and page.
8. **Page Studio is the Progress Reports screen.** A palette of blocks on the left, the previewed student's pages at paper size in the middle, an inspector for the selected block on the right (the review's Mockup A). A block is placed on a page, beside another block for a two-column row, and sized full, two-thirds, half or third; the form decides nothing a teacher did not. The toolbar carries the report, Paper, Pages per student, Ink, the class count and Print Reports; the student list is hidden on this screen because the picker is in the toolbar. Labels, not sentences: the screen carries one hint line and no explanatory text. Brief and Detailed are gone; a class that was on Brief opens on the Interim Update template. The Class Summary tab is gone. Replaces the list editor and the setup list of 2026-10-20, which Colin rejected as nothing like the mockup he approved.
9. **Printing saves a copy.** Print Reports saves a fixed copy of every report (`report_issue`) and then prints; a reprint uses the copy, not later scores. The copy picker lists them as "Printed Oct 20, 2:09 p.m.". There is no separate "Issue" step or word anywhere on the screen. Sending a report by email, later, is a second output of the same copy.
10. **Sending a report emails a link, not the report.** The copy stays in Canadian storage; the family opens it with the student's birth date for 30 days; the email names the teacher and school and carries no grades. Print stays the default; sending is opt-in per family with a guardian address on file. Built only after the district's position on teacher-to-family email is checked.
11. **Plain labels:** "1 sheet / 2 sheets", "No comment", "Black / Colour", "Fit Content / Fixed", "Page 1 of 2", "Print Reports". Not "pp", "proof", "fit all" or "issue".
12. **Reports carry no attendance.** FullVision has no real attendance entry: the one place to record it (Class Management's Bulk Edit) writes only to the computer it was typed on, and attendance lives in MyEd. The Attendance block is gone from the palette and from every saved layout (a layout that had it keeps the competency table alone). Replaces "Attendance is off by default". Colin's call, 2026-10-20.

## Printed class grade sheet (2026-10-20)

Context: Colin asked for a class grading spreadsheet that prints like MasterGrade did: student names down the left, assignment titles and dates across the top, a class header, narrow margins, and options when Print Grades opens. The layout follows what MasterGrade, Easy Grade Pro, Gradekeeper, MyEd's Blank Grading Sheet and paper class record books share. `teacher/grades-print.js`.

1. **Print Grades on the Gradebook toolbar** (an outline button, beside Export) opens a dialog: Term (All Time, each reporting term, Custom Dates), Assessments (All, Shown in the Gradebook when filter chips are on, Pick), Scores (As Entered, Levels Only, Points and Levels, Blank Scores), Show (Late Marks, Class Average Row, Category Averages, Overall Grade, Student Numbers), Sort By, Paper and Text Size. A status line gives students, columns and pages before printing.
2. **Landscape only, Letter or Legal, 0.4 in margins.** Paper is remembered per class on this device under the same key as the Reports page, so one choice serves both. The other choices are remembered on this device; term and assessments follow the gradebook when the dialog opens.
3. **The sheet:** a header with the school (when the class uses a school's terms), class and block, teacher, counts and scores setting at the left, the term and its dates, the date printed and the students and columns on the page at the right. Columns are numbered and grouped under a band per category in category order (no category last), by date within it; each has its number, title on up to three lines, month and day, and "/n" for points work. A title that does not fit prints in full in the page's key with its date. At the right: one average per category, then Overall. A Class Average row at the foot. A heavier rule after every fifth student. Footer: class, term, teacher, Page N of M.
4. **Cells print what the Scores view shows.** Both read `assessmentCellValue` in `shared/calc.js`. NS and EXC replace the score, Late adds an L, ✓ and ✗ are Complete and Incomplete, — is no score. Category grades come from `categoryGradeText` (level, %, or both, by the class's grading style), the overall from `studentGradeSummary`.
5. **Averages follow reporting terms.** The sheet reads grades with the class scoped to the chosen term and puts the gradebook's own term back after. Custom Dates chooses the columns only; Category Averages and Overall Grade are off for it.
6. **Pages are counted, not measured.** Students are cut into even blocks that fit a page's height, columns into even blocks that fit its width with the summary beside the last; pages run every column page of one student block before the next. The dialog's count is the printed count (Demo Mode: 3 Letter pages, 2 Legal, 2 Letter at Compact).
7. **Black and white, labels and numbers only.** No shading and no explanatory text on the sheet; the key carries the marks it uses and the titles it cut.
8. **Portrait, filled, laid out like MyEd's class list** (Colin, 2026-10-20, after seeing the landscape sheet: "it should be portrait, and fill the page", with MyEd's "BC Class List with Grid" as the model). Supersedes the landscape layout in 2, 3 and 6. Letter or Legal, portrait, 0.3 in margins. The header is MyEd's: a rule, the school at the right, "Class Grade Sheet" centred, Page N of M at the left and the date and time printed at the right, a rule, then Class, Teacher, Block, Term, Students and Scores in fixed places (a field with no value keeps its label). Pupil # and Name run down the left. Each assessment's title turns to read up its column, on up to two lines, with its month and day and "/n" under it, under the category band. Rows stretch to the foot of the page and columns to its right edge; a small class gets blank rows and blank columns to fill the rest, for writing in. Each column page of a group of students has the same row height, so pages line up side by side. Pupil # is on by default. Column numbers and the cut-title key are gone; the key lists the marks only.
9. **Assignments only** (Colin, 2026-10-20: "Teachers only need the assignments, not the proficiencies on the far right"). Supersedes the category averages and Overall in 1, 3, 4 and 5: the sheet prints no category or overall grades, and no count of the class by overall grade. The Class Average row under each assignment stays.
