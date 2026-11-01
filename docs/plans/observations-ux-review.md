# FullVision observations: structure, UX review and competitor comparison

Written 2026-10-18. Read-only study; nothing in the repo was changed. Sources: the code in `~/FullVision` (desktop `teacher/page-observations.js`, `observations.css`, `student-notes.js`, `page-student.js`, `page-assignments.js`, `report-questionnaire.js`, mobile `teacher-mobile/tab-observe.js`, `shared/data.js`, `schema.sql`), Demo Mode in the browser, and the competitor pages listed at the end.

## 1. What exists today

### Surfaces that create an observation

| Surface                                                        | What you can set                                                                                                                                                                                | Notes                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observations page capture bar (desktop)                        | students (multi), Type (strength / growth / concern), Context (whole class, small group, independent, presentation, discussion), 9 disposition tags, 10 Core Competency tags, custom tags, text | `+ Add` or Cmd+Enter. Clicking a name in the roster rail selects that student as the capture target and filters the feed.                                               |
| Assignments page "Comment" button (per student per assessment) | text only                                                                                                                                                                                       | Saved as an observation with `assignmentContext`. No type, context or tags. Rubric criterion comments are a different store (`rubric_score_comment`), not observations. |
| Student page "Notes & Observations" add box                    | text only                                                                                                                                                                                       | Calls `addQuickOb(cid, sid, text, [])`. The note has no type, context or tag.                                                                                           |
| Mobile Observe tab, `+` sheet                                  | students (multi), text, Type, Context, 9 disposition tags                                                                                                                                       | No Core Competency or custom tags on mobile.                                                                                                                            |
| Mobile avatar quick bar                                        | one of six hard-coded template lines                                                                                                                                                            | `QUICK_TEMPLATES` in `tab-observe.js`, not editable.                                                                                                                    |

### Surfaces that show observations

| Surface                      | What it shows                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observations page feed       | Sticky-note grid, two columns, grouped by day, pastel fill by type, slight rotation per card. Card: type icon, name, time, context, text, tag pills, delete (two clicks, no undo). Click opens the focus card: edit text, type, context, tags; cannot change student, date or assessment link. Filters: student, tag, type; text search on body and name. |
| Student page                 | Hero counter; Growth Profile line ("5 observations · 5 strengths"); "Assignment Feedback" card (assignment-linked notes, 5 newest); "Notes & Observations" panel with search, coloured left bar, date, assignment badge, tag pills, delete. The two lists overlap: assignment notes appear in both.                                                       |
| Dashboard                    | Student card: latest observation cut to 45 characters. Overview widget: count this week, flagged students, student count.                                                                                                                                                                                                                                 |
| Reports (term questionnaire) | Panel with counts by type, top context, newest 8, filter All / General / Assignment, "select to mention". The narrative generator quotes selected observations verbatim and summarises counts. Report builder block "Observations & Evidence" exists but is off by default.                                                                               |
| Mobile                       | Feed (as desktop, one column); Students tab card widgets "Latest Observation" and "Observation Insights"; student detail shows the 3 newest.                                                                                                                                                                                                              |

### Data model

Server (`schema.sql`): `observation(body, sentiment, context_type, assessment_id)`, `observation_student` (one observation can belong to many students), `observation_tag` (links to the learning-map `tag`, i.e. curriculum competencies), `observation_custom_tag`, `observation_template` (per course, with default type and context; has upsert and delete RPCs), `term_rating_observation` (an observation quoted in a term rating).

Client (`shared/data.js`): one localStorage blob per course keyed by student id; a multi-student capture is fanned out into N separate rows, so editing one does not edit the others.

## 2. Findings that shape any redesign (not changed)

1. **Tags never reach the server.** `_persistObservationCreate` sends `p_tag_ids: []` and `p_custom_tag_ids: []`; `_persistObservationUpdate` sends `null`; `_observationsPayloadToBlob` sets `dims: []` on every row loaded. The comment in the code says tag linkage "lands in Phase 4.5". So every disposition, Core Competency and custom tag lives only in this device's localStorage and is wiped the next time the class loads from the server. Tag filters, the Growth Profile tag chips and the mobile "Observation Insights" widget are all working on data that does not survive a reload on another device. The dispositions have no server home at all: `tag` is the learning map, `custom_tag` is wired on the server but not from the client.
2. **Assignment-linked comments lose their title after a reload.** The server returns only `assessment_id`; the student page and questionnaire read `assignmentContext.assessmentTitle`, so the badge comes back empty.
3. **Three capture shapes.** The Assignments comment and the student-page note box drop type, context and tags, so the evidence they create cannot be filtered or counted with the rest.
4. **Filters miss Context, date range and "linked to an assessment".** Search does not match tag labels.
5. **No undo on delete; no way to move an observation to another student or link it to an assessment after the fact.**
6. **`observation_template` has no UI.** Mobile uses six hard-coded lines; desktop has none.
7. **No link to a competency.** The schema's `observation_tag` → learning-map `tag` is exactly the "evidence trail" the roadmap wants (item 4), but the tag menu never offers curriculum tags, only dispositions and Core Competencies.
8. **Visual language is out of step with the rest of the app.** Emoji for type, context and every tag (screen readers announce "check mark button"), rotated pastel cards, all-caps labels ("117 OBSERVATIONS"). The rest of the product has moved to plain, sentence-case, greyscale-first design.
9. **Dashboard numbers are not the useful ones.** "Flagged" counts flagged students, not observations; "This week" is a total, not who has none.

## 3. Competitors

| Product                                 | Market                        | What its observation / note flow does well                                                                                                                                                                                                                                                   | What it lacks that FullVision has                                                        |
| --------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Seesaw                                  | K–8 portfolios                | Private teacher notes live in the student's journal beside the work. "Note" is one tool on the item-creation screen. Standards tags; gradebook filtered by standard.                                                                                                                         | No type / context / disposition in one tap; no narrative generation.                     |
| SpacesEDU (Canadian, BC-aligned)        | K–12 portfolios and reporting | Every post can carry curriculum tags and a proficiency level set at tagging time. Levels can be teacher-only. Proficiency Report lists tags and levels per student. Reporting Space holds per-student comments.                                                                              | Evidence is student posts, not quick teacher notes. No sentiment, no narrative drafting. |
| Sesame Snap (Canadian, Ontario)         | K–12                          | Tap student, capture photo / video / audio / text, attach expectations, per-student portfolio. Teachers used it to "attach curriculum expectations directly to photos".                                                                                                                      | No disposition lens, no report writer.                                                   |
| Storypark                               | Early years                   | Individual vs group stories; "story types" are templates / prompts; tag reporting ("does every child have a story this month?"); collaboration and handover between educators.                                                                                                               | Long-form; not one-line capture.                                                         |
| Tapestry (UK)                           | Early years                   | One observation covers many children. Flags (areas, celebrations, custom) filterable per child or whole setting. "Areas of Concern" screen auto-collects flagged observations. Observations link to other observations and activities. Framework statements assessed inside the observation. | Not secondary-ready; no BC scale.                                                        |
| brightwheel / Lillio                    | Childcare                     | Logging "takes a few seconds on a phone"; tag to milestones; record travels with the child.                                                                                                                                                                                                  | Nothing report-grade for secondary.                                                      |
| Apple "Anecdotal Notes Sidekick" (2025) | Any                           | Speak once about several students; on-device AI splits into per-student notes.                                                                                                                                                                                                               | Not a system of record.                                                                  |
| Google Classroom private comments       | LMS                           | Attached to the assignment; a snippet shows beside each student's name in Student Work.                                                                                                                                                                                                      | Student-to-teacher channel, not teacher notes.                                           |
| TeacherKit / Additio                    | Gradebook apps                | Behaviour notes on the student card; sortable; included in PDF / Excel reports. Additio: notes from an Actions menu, interventions shared with families.                                                                                                                                     | No tags, no context, no narrative.                                                       |
| ClassDojo                               | Behaviour                     | Records more data than paper (2016 study), but points are public by default and privacy researchers object.                                                                                                                                                                                  | Explicitly not the model.                                                                |

What FullVision already has that none of these combine: type + context + dispositions in one capture, multi-student capture, a teacher-only log by design, offline-first, "select to mention" in the questionnaire, and a narrative generator that quotes the observation.

## 4. Brainstorm: entering comments faster

1. **Roster-first capture.** Make the rail the picker: click a name, the capture box pins to that student with the name as a chip, type, Enter. Shift-click or drag to add a group. Half of this exists (rail click already filters and selects); make it the primary path and drop the separate "Select students…" button to a secondary position. This is what Tapestry and brightwheel do.
2. **One capture component everywhere.** The same chip strip (student, type, context, tags, assessment) on the Observations page, in the Assignments comment popover, in the student-page note box, in the gradebook cell menu and on the mobile sheet. Each surface pre-fills what it knows: the Assignments popover pre-fills the assessment, the student page pre-fills the student. Today's three shapes become one.
3. **Inline shorthand.** Typing `@Mei`, `#collab`, `!concern`, `/lab-skills` renders chips as you type. Keyboard teachers never leave the text box. A `/` menu lists templates.
4. **Templates and sentence starters from `observation_template`.** A per-course bank the teacher edits, each with a default type, context and tags. Desktop gets a "Starters" chip; mobile's quick menu reads from it instead of the six hard-coded lines. Storypark's story types are the model. Shared banks become the school-tier feature the roadmap already names.
5. **Class sweep mode.** A grid of today's class; tap a name, tap one of three type buttons and up to three most-used tags, tap a starter, done. Ten students in a minute during a work block. The STUDENT-VOICE-PLAN interview mode (three prompts, one observation per answer) fits this screen.
6. **Pre-fill "today".** A chip for the assessment currently open in the gradebook, or the most recently scored one, and a chip for the competency being taught. Both are one tap to accept.
7. **Voice.** Native dictation into the box on mobile is free and needs no AI. A non-AI "speak once about many": split the dictated text on roster first names and offer N cards for review. (Colin ruled out AI-written rubric descriptors; AI splitting of observations is a separate question to ask, not assume.)
8. **Draft safety and undo.** Unsent text survives navigation (the auth re-prompt hook already keeps it); delete shows an Undo toast instead of a two-click confirm.
9. **Keyboard.** Enter sends, Shift+Enter adds a line. After sending, keep the student selected by default and offer "keep tags" as a sticky toggle, for runs of notes about the same student or the same lesson.
10. **Photo of work.** Attach one image (roadmap item 4; Supabase storage in ca-central-1). Sesame, Seesaw, Tapestry and brightwheel all treat the photo as the evidence and the note as the caption.

## 5. Brainstorm: display and graphics

1. **Calmer default view.** A plain card list with a colour rail by type, dates visible on each card, three-line truncation with "more", a focus ring, and sort / group options (day, student, tag, assessment). Keep the sticky-note grid as a toggle for teachers who like it. Rotated orange cards are the hardest to scan, which is the wrong way round for concerns.
2. **Replace emoji with text pills or tinted SVG.** Consistent with the greyscale, plain-language direction elsewhere, and readable by screen readers.
3. **Per-student timeline strip.** On the student page, a horizontal dot timeline across the term, dots coloured by type, hover shows the text, click filters the list. Gaps read as "no evidence since Sept 25". Storypark's "journey" and Tapestry's tracking screens are the reference.
4. **Coverage grid.** Students × weeks, cell shade by count, tint by type mix. One glance shows who has not been observed. Replace the dashboard widget's three numbers with "N students have no observation in 3+ weeks" plus their names. This is Storypark's "every child has a story this month" report.
5. **Tag matrix.** Dispositions (and later competencies) × type, counts per student or per class, click-through to the cards. Feeds the questionnaire directly.
6. **Filter chips in one row** (student, tag, type, context, date, assessment, "used in a report"), plus saved views such as "Concerns this term" and "Unreported evidence".
7. **"Quoted in a report" mark.** `term_rating_observation` already records it. A small mark on cards already used in a Learning Update stops a teacher re-quoting the same moment, and "unreported" becomes a filter.
8. **Assessment-linked cards show the assessment and the score chip** and open the gradebook cell on click (the data is there; only the title is missing after reload, see finding 2).

## 6. Brainstorm: connecting observations

1. **Competency tag from the learning map**, with an optional level ("this looked Proficient") as SpacesEDU does. The student page competency card then reads "3 scores · 2 observations", and a "Why is this a 3?" drawer lists both. This is the roadmap's evidence trail and the schema already has the join table.
2. **One server row for a multi-student observation.** The server supports it; the client fans out. Keep one row, show "with Mei, Sofia" on the card, and an edit changes it for all of them.
3. **Concern raises the flag.** A concern observation offers "Flag this student" inline; today the flag and the log are unrelated.
4. **Suggested mentions in the questionnaire.** Pre-tick the newest strength and newest concern per competency, not just the eight newest overall.
5. **Goals and reflections on the same timeline**, as the student-voice plan already decides.

## 7. The student page specifically (teacher-facing)

Today the page shows a counter in the hero, a stat line in Growth Profile, and two overlapping lists ("Assignment Feedback" and "Notes & Observations") whose add box drops type and tags.

Suggested shape: one "Evidence" panel with tabs All / By competency / Assignments / Concerns; the shared capture component pre-filled with the student and the term's current assessment; the timeline strip above the list; counts by type as small text pills. The dashboard card's 45-character snippet becomes three type dots plus "last observed 12 days ago", which is the thing a teacher actually scans for.

## 8. Order I would do it in

1. Fix tag persistence and the assignment title (finding 1 and 2). Everything in sections 5 and 6 is built on tags, and today they do not survive a reload.
2. One shared capture component with competency and assessment chips.
3. Roster-first capture, Enter to send, undo on delete.
4. Coverage grid on the dashboard; timeline strip on the student page.
5. Templates from `observation_template`, read by mobile too.
6. Photo attach; native dictation on mobile.

## Competitor sources

- Seesaw Help Centre, Learning Journal section (Private folder and Private Notes): https://help.seesaw.me/hc/en-us/sections/48554514858893-Getting-started-with-the-Learning-Journal
- SpacesEDU Help Centre, Assessment category (Curriculum Tags, Proficiency Scales, Proficiency Report, GrowthBook): https://help.spacesedu.com/en-ca/category/assessment-z5ozxe/
- SpacesEDU pilot, Peace River North: https://lt.prn.bc.ca/wp-content/uploads/sites/30/2023/07/Spaces-2023-24-pilot-2.pdf
- Sesame Snap launch (BetaKit): https://betakit.com/next-36-alum-sesame-io-launches-sesame-snap-app-for-parents-teacher-and-students/
- Sesame in Ontario kindergarten (OTF/FEO case study): https://www.otffeo.on.ca/en/?p=63291
- Storypark documentation features: https://ca.storypark.com/feature/documentation
- Tapestry features: https://tapestry.info/features.html
- brightwheel progress reports and observations: https://mybrightwheel.com/childcare-centers/preschool-progress-report.md
- Apple Education, Anecdotal Notes Sidekick: https://education.apple.com/resource/250014925
- Google Classroom private comments (Shake Up Learning): https://shakeuplearning.com/blog/google-classroom-comments-all-you-need-to-know/
- TeacherKit help: https://intercom.help/teacherkit/en/articles/45112-what-is-teacherkit
- Additio quick guide: https://help.additioapp.com/article/1153-quick-guide
- ClassDojo vs paper charts study (UNLV): https://oasis.library.unlv.edu/tl_fac_articles/184

## Decisions (2026-10-18, after Colin read the review)

1. Tags are stored as `observation.dims text[]` (PR #217, open).
2. Feed default is a card list with a type rail; the sticky-note grid stays as a toggle.
3. Capture: roster-first, one shared chip strip on every surface, inline shorthand, editable starters from `observation_template`, phone class sweep.
4. Dashboard: "N students have no observation in 3+ weeks" plus the students-by-week coverage grid replace the three numbers.
5. Competency link via `observation_tag` with an optional level, evidence only; evidence drawer on the competency card.
6. Student page: one Evidence panel with tabs and the timeline strip, replacing the two lists.
7. Text pills, no emoji; Enter sends, Shift+Enter newline; Undo toast on delete; "Quoted in Report N" mark and unreported filter; concern offers to flag.
8. No dictation or photos this round.
9. Undecided: one server row per multi-student capture.

Build plan with per-PR briefs: `~/fullvision-observations-plan.md`.
