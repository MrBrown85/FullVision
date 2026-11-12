# One Report: build plan

Colin, 2026-11-12: retire the Custom report and the Quick Report / Custom switch; one panel of parts
with switches; the pages show what prints. The design, the decisions and the council's review are in
`docs/plans/quick-report-options-mockup.html` (sections One Report, Council Review, Decisions Owed).

## What is already there

The two engines share one seam. `page-reports.js` asks `_layout()` for a function
`(cid, student, ctx, { form, paper, stage, probe })` that returns `{ html, sheets, sides, over, … }`;
`ReportSheets.layoutStudent` (built reports) and `GradeReport.layoutStudent` (the Quick Report) both
answer it, and the preview, the fit line, Everyone, Print Reports and the printed copies read only
that. One Report is a third answer to the same seam.

`ReportSheets.pack` already does most of the flowing the design asks for: rows fill a side, a table
splits between its rows and carries on under "(continued)", every side after the Front names its
student, a student's sides are padded to whole sheets, and one block can dock at the foot of a side.

## Shape

- `teacher/report-one.js` (`ReportOne`): the model, the Setups, the readers that turn a class's saved
  Quick Report choices or built form into a model, and `layoutWith(model)`. It draws every part with
  the code that draws it today (`ReportBlocks.renderReportBlock`, `GradeReport`'s table, summary and
  Feedback Pages) and lays the cells out with `ReportSheets.pack`. It never computes a grade.
- `teacher/report-one-panel.js` (`ReportOnePanel`): the left panel.
- `teacher/report-one-page.js` (`ReportOnePage`): what the pages do on screen (Hide, remove a row,
  rename, the Add strip, the comment editor, the dialogs). Everything it adds to the page is
  `no-print`; a printed copy is the layout's own HTML.
- `page-reports.js`: a third `progressMode`, `'one'`, beside `'grade'` and `'build'`.

The model is saved in the class's report settings as `reportConfig.one`; nothing is migrated and no
saved form is rewritten. A class with no `one` yet gets one read from what it has (`progressMode`,
`gradeReport`, `form`) each time, until the teacher changes something.

## Order

1. Pinned already: `tests/report-surfaces-output.test.js` (every block, every surface, Demo class),
   the Quick Report fixtures, the saved-forms and issued-copy specs. Add: saved forms and Quick
   Report choices read into a model keep their parts and order; no model change moves a grade.
2. `ReportOne`: model, Setups, readers, layout. `pack` gains `caps` (room kept free at the foot of
   a side, for the back of the response slip); nothing else in the two engines changes behaviour.
3. Blocks gain options, off by default so no built report changes: reworded reflections and
   response, the legend's descriptors, family wording on Proficiency, a blank Core Competency form.
4. The panel and the page, behind a switch (`?onereport=1`, remembered on the device). Demo Mode
   first.
5. Its own PRs after that: Excuse It Instead (it changes a grade: Colin's review), IEP Goals, Use
   in My Other Classes.
6. One Report becomes the Progress Reports screen for everyone; the old editor stays in the code,
   unreachable, for one reporting period.
7. Delete last: `report-studio.js`, the grid editing in `page-reports.js`, the mode switch. Never
   the saved-form readers or reprinting.

Steps 2 to 4 are one PR (nothing reaches a teacher until the switch is on). A release is Colin's
word, as always.

## Parts

A part's key is its block id where a block exists.

| Key                                                      | Prints as                       | Drawn by                                            |
| -------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| `header`                                                 | the letterhead                  | block                                               |
| `proficiency`                                            | Proficiency                     | block, `family: true`                               |
| `legend`                                                 | Proficiency Legend              | block, `descriptors: true`                          |
| `assessments`                                            | Assessments                     | `GradeReport` rows and table                        |
| `category-summary`                                       | Categories                      | `GradeReport` summary                               |
| `course-grade`                                           | Overall Proficiency / Course Grade | `GradeReport` term line                          |
| `grade-table`                                            | Assignment Grades               | block (kept for reports built with it)              |
| `missing-work`, `term-attendance`, `progress`, `next-steps` | as today                     | block                                               |
| `teacher-narrative`                                      | Teacher Comment                 | block                                               |
| `self-assessment`                                        | Core Competency Self-Assessment | block (`blank: true` for a form to fill in)         |
| `learner-dimensions`                                     | Work Habits                     | block                                               |
| `student-reflection-learning`, `student-reflection-habits`, `parent-response` | as today, or the class's wording | block, `wording` |
| `support-home`, `text-block`                             | as today                        | block                                               |
| `fb-rubrics`, `fb-comments`, `fb-observations`           | Feedback Pages                  | `GradeReport` Feedback Pages                        |

Already-retired blocks stay retired (the mockup's "Evidence by Competency" was one).

## Rules carried from the decisions

- Removing a row or leaving an assessment off the list changes what prints, never a grade. Missing
  Work reads the gradebook, not the list.
- A change made with Changes Apply To set to a student is kept for that student only, in
  `one.perStudent[sid]`, and goes into the printed copy's record with the model.
- Reworded questions belong to the class.
- A student's Core Competency self-assessment prints in the student's own words or as a blank form.
  The teacher never rates a Core Competency.
- Unsaved comment changes never print.
