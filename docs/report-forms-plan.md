# Report forms: build plan

Written 2026-10-20 from the report printer review (`~/fullvision-report-printer-review/`). Decisions in `DECISIONS.md`, "Report forms". This file is the working plan: phases, the PRs inside each, what each PR must prove, and how a change gets to teachers.

## Process

Every change follows the same path.

1. **Decide first.** Anything that changes what a family sees, or how a grade is shown, is written into `DECISIONS.md` before code.
2. **One PR per change,** on a `claude/<slug>` branch from `main`. A PR carries its own tests. A print change carries a page-count test.
3. **CI green before merge:** vitest, prettier on changed files, and the Playwright build. The e2e job is not a required check, but a PR that touches printing waits for it.
4. **Squash merge to `main`.** Netlify deploys `main`; open tabs reload at a quiet moment (`shared/auto-update.js`).
5. **Check the live site** after a print change: Demo Mode on fullvision.ca, print to PDF on Letter, count the pages.
6. **Every feature works in Demo Mode.** No change here needs a migration until Phase 4.

## Measurements to hold

Demo Mode, Science 8, 27 students, Chromium's print engine, Letter.

| Run             | Before (2026-10-20) | Target        |
| --------------- | ------------------- | ------------- |
| Brief preset    | 27 pages            | 27 (1 each)   |
| Standard preset | 81 pages            | 54 (2 each)   |
| Detailed preset | 324 pages           | unchanged     |
| Legal, Standard | 81, Letter box      | 54, 14 in box |
| Class Summary   | 2 pages             | unchanged     |

`e2e/report-print.spec.js` asserts the Standard and Brief counts on every PR and the Legal page box once Legal exists.

## Phase 0 · The current engine, made to fit (days)

Small changes to `reports.css` and `report-blocks.js`. No new model.

| PR  | Change                                                                                                                                                                                                                                                                               | Proves                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 0.1 | Page-count test. Equal 0.5 in margins. Unrated dimensions left off. Disposition examples dropped and descriptions left off paper, three per row in print. Chart lists three assessments per competency. Next Steps lists two I-can statements per focus and may break between items. | Standard prints 54 pages, Brief 27, every student 2 / 1, on Linux CI as well as a Mac |
| 0.2 | Letterhead: school, class and block, report name from the term picker, term dates, teacher, student number. The running footer waits for Phase 1: a repeating table footer cost five pages across the demo class.                                                                    | Header text present                                                                   |
| 0.3 | Levels as dots and word everywhere a level prints; no colour on levels in print; `print-color-adjust` only where a fill carries meaning.                                                                                                                                             | Greyscale PDF distinguishes all four levels                                           |
| 0.4 | Legal as a paper option on the Progress Reports toolbar, injected as an `@page` rule the way `rubric-print.js` does; remembered per class on the device.                                                                                                                             | Legal run has a 612 × 1008 pt page box                                                |

Built 2026-10-20 as PRs #250 (0.1), #254 (0.2, replacing #251), #252 (0.3) and #253 (0.4), stacked in that order.

Lessons from Phase 0: the fit has to hold with the wider fonts of Linux and Windows, not only a Mac (CI's first run printed 57 pages); a `<tfoot>` that repeats per page is not a free running footer; `break-after: right` is not implemented in Chromium, so an even page count has to be built, not requested; deleting a stacked PR's base branch closes the PR above it, so retarget before deleting.

## Phase 1 · The form engine, one form (weeks 1–2)

- Renderers take `{cid, student, term, termLabel, options}` and return HTML with no DOM reads. Each declares `fixed` or `flow`.
- Fixed blocks are measured once per class, flowing blocks per student, after fonts load, with a 4% margin on each flow region.
- Explicit page boxes (`.sheet`) on screen and in print; the preview is the printout.
- The Report Card form only, replacing the Standard preset: front = letterhead, overall, comment (room 8 lines, grow and push), competency table paired with attendance, next steps; back = dispositions, then the existing student reflection and Parent / Guardian Response blocks with their wording unchanged, the response pinned to the bottom below a cut line. Continued sheets for overrun.
- Layout `blocks_config` v3 (`form`, `sides`, `attachments`) with migration from v1 and a shape check in `save_report_config`.
- One level helper (dots + word, colour only on screen in Colour mode); inline `PROF_COLORS` removed from the report renderers.
- Tests: page counts on Chromium and WebKit; a unit test per renderer that it is pure.

Built 2026-10-20 as PRs #256 (pure renderers) and #257 (`teacher/report-sheets.js`, the Report Card form). As built: the Standard preset is the Report Card; front = letterhead, overall, comment (8 lines of room, ruled box when empty), competency table paired with attendance, next steps; back = dispositions, Parent / Guardian Response pinned to the bottom. The student reflection keeps its wording and is 795 px tall at print size, taller than a Letter back with the response below it, so it is not on the default form; it stays in Detailed and becomes an attachment sheet with Edit Layout. Screen / Photocopy control. Measuring runs per student (fixed blocks are not yet cached per class); layout v3 is not persisted (one form, nothing to save); a comment longer than a whole side spills rather than splits. `e2e/report-sheets.spec.js` runs in Chromium and WebKit.

## Phase 2 · Review mode and Issue (week 3)

- Rail: sheet count per student with the one-line reason; Fit Map.
- The questionnaire's comment box reads the form's room and reports the consequence; "See the Page".
- Issue dialog: saves `report_issue` (local in Demo Mode, server row when signed in: migration), "changed since the last issue", before-you-issue list, Print.
- Layout chooser with Interim Update, Report Card and Conference Pack, recommending only after computing the class's fit.

Built 2026-10-20 as PRs #259 (rail sheet counts with the reason, Fit Map), #260 (the comment box reads the form's room; See the Page) and #261 (Issue Reports…: a fixed copy per student in IndexedDB with a hashed index in localStorage, "changed since the last issue", before-you-issue list, Print; the toolbar's copy picker shows and prints a copy). Not built: the layout chooser (there is one form until Edit Layout) and the server row for issues (`report_issue` needs a migration and an RPC; the copy is local to the browser that issued it until then).

## Phase 3 · Edit Layout (weeks 4–5)

- Mode banner, Fixed / Flows tags, options panel, Preview With longest / typical / shortest, pairing of fixed blocks, whole-form settings (the reflection and response blocks keep their text), "+ Add a Block", pointer and keyboard drag with live announcements, Save to Library (`report_template`, teacher-level).
- Phone: Review as a stepper, one page at a time; no editing; a read-only Reports tab in the PWA.

Built 2026-10-20 as PRs #263 (the form as class data, layout v3 in `reportConfig.form`, Edit Layout mode with move, side, remove, add, room, empty rule, pin and Standard / Compact type), #264 (Preview With longest / typical / shortest, pairs, grip drag and arrow keys with a live region, starters Report Card / Interim Update / Conference Pack, a library on the device) and #265 (below 900 px: Builder button, student stepper, wrapping toolbar). Not built: the server-side library (`report_template` needs a migration and an RPC) and a read-only Reports tab in the phone app.

Revised 2026-10-20, evening. Colin opened Edit Layout on his own class and found it far too complicated for teachers: move arrows, Back, ×, Unpair, a Pinned checkbox, "When empty" rules, a room count, Add a Block, Preview With, starters and a library, all on one rail. Decision 8 is rewritten: one Review screen, no editor. The rail becomes a setup list of four choices (Form, Type Size, Comment Room, Include), which is the Phase 2 layout chooser finally built, with the optional blocks as checkboxes that each have one fixed place on the form. The form model and its helpers stay (every saved form still loads); the editor's controls, Preview With, Save to Library and the Edit Layout mode leave the screen. The library rows wait for a teacher to ask. Lesson for the process: a phase ships only after Colin has seen it on his class, not after its tests pass.

## Phase 4 · Send (weeks 6–9, after the policy check)

Applied 2026-10-20 to gradebook-prod: `migrations/20261020_report_template.sql`, `20261020_report_issue.sql`, `20261020_guardian.sql`. Each was first run on a local Postgres 17 stand-in (`migrations/local-test/`, 46 checks, as Supabase branching needs the Pro plan); that run caught a form check that passed when `front` was missing. Client wrappers: `v2.saveReportTemplate` / `listReportTemplates` / `deleteReportTemplate`, `v2.createReportIssue` / `listReportIssues` / `getReportIssue` / `deleteReportIssue`, `v2.upsertGuardian` / `deleteGuardian` / `listCourseGuardians`. The library and Issue Reports now use these rows: `ReportSheets.syncTemplates` / `saveTemplate` / `removeTemplate` and `ReportIssues.sync` / `issue` / `load` / `remove` write through to the server and keep the device copies (localStorage `gb-report-templates`; IndexedDB `fv-report-issues` plus the `gb-report-issues-<cid>` index, each entry carrying `serverId`) as the Demo Mode and offline cache. The Reports page refreshes both from the server when it opens and when the class changes; a copy the device does not hold is fetched on demand. Nothing reads `guardian` until the district policy check.

- `guardian` table with consent; roster import column; Class Management editing.
- Family view-by-link page with the birth-date check; SES in `ca-central-1`; queue, delivery log, bounce handling.
- Send as the second output of Issue; the Send view (recipients table, composer, preview).
- Assessment emails from the graded rubric; PDF attachments last.

## Phase 5 · Finish what the plan left (2026-10-20, evening)

Colin's direction after seeing Phases 0–3 on his class: everything the plan listed and did not build gets finished properly, and nothing reaches main until he has seen it on his class. Each item below is one PR, each ends with a screenshot of his class in the PR, and he says merge.

| Item | What done looks like                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.1  | The setup list in place of Edit Layout (decision 8): Form, Type Size, Comment Room, Include. Each form shows how many sheets most of the class needs on it, computed from the class's fit, so the choice is informed before it is made (the Phase 2 chooser). No drag, no per-block controls, no library on the screen.                                                                                                                                                                                                                                                                    | Merged as #269 (2026-10-20) after Colin saw it on his class                                                                                                        |
| 5.2  | Attendance on the Report Card by default or off: Colin decides; the default form follows. One line in DECISIONS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Decided 2026-10-20: off by default (DECISIONS 12)                                                                                                                  |
| 5.3  | Safari print parity measured: the Report Card form in WebKit, every student, Letter and Legal, zero overflowing sheets and the sheet boxes at paper size; the result recorded here with the build it was measured on. WebKit cannot print to PDF, so the measure is the laid-out sheets under print media, not a page count.                                                                                                                                                                                                                                                               | Measured 2026-10-20 on main @ 4fd5e7b, below                                                                                                                       |
| 5.4  | The phone app's Reports tab: read-only. The class's issued copies by term, each opening the fixed copy sheet by sheet, and the live Report Card for one student at a time with the sheet count. No setup controls on the phone; Issue stays on the desktop.                                                                                                                                                                                                                                                                                                                                | To do                                                                                                                                                              |
| 5.6  | A flowing block taller than a side splits across sides instead of spilling. Found by 5.3: the Conference Pack's Assignment Grades table is about 2,860 px for every demo student against a 935 px side, so the back of sheet 1 overflows for all 27 in both engines. `pack()` places a block taller than the cap alone on a side and marks it over; nothing splits it. The grade table (and any table block) must break at row boundaries into continued parts, each measured; the Fit Map and the rail's reason text say "continues". Until then the Conference Pack is not fit to issue. | Built 2026-10-20: pack() cuts a table block where the side ends; Conference Pack 0 overflow in both engines, 3 sheets per student on Letter; awaiting Colin's look |
| 5.5  | Phase 4 (Send) stays gated on the district's position on teacher-to-family email. What can be done now: the exact questions to put to the district, written down here so Colin can ask them, and the guardian roster column and Class Management editing drafted but not merged until the answer is known. No email leaves FullVision before that.                                                                                                                                                                                                                                         | Questions to write; nothing else until the district answers                                                                                                        |

Safari print parity, measured 2026-10-20 on main @ 4fd5e7b, Demo Mode Science 8 (27 students), print media, Chromium and WebKit side by side, all three forms, Standard and Compact, Letter and Legal (12 combinations). Every combination is identical in the two engines: the same number of sides, the same overflow count, the same sheet box (816 × 1056 px on Letter, 816 × 1344 px on Legal, that is 8.5 × 11 in and 8.5 × 14 in at 96 px/in), the same sheets per student. Report Card and Interim Update: 2 sides per student, 0 overflowing. Conference Pack: 4 sides per student and 27 overflowing sides in both engines, which is item 5.6, not a Safari difference. Re-measured after 5.6 (branch claude/report-split-tall-blocks): still 0 overflowing sides everywhere in both engines; on the Conference Pack at Legal the two engines cut the grade table one row apart for 5 of 27 students (Chromium 3 sheets, WebKit 2), a few px of row height at a side boundary, not a fit difference. The measuring script is a headless Playwright run that applies each setup choice through the rail and reads each sheet's scrollHeight against its clientHeight; the e2e `webkit` project keeps the Report Card part of this under CI.

Process for Phase 5: decisions first (DECISIONS.md), one PR per item with its own tests, CI green, a screenshot of Colin's class in the PR, merge on his word, live check after. No item starts on the strength of the last one's tests alone.

## Phase 6 · Page Studio (2026-10-20, night)

Colin: "The attached image is what I thought I was getting." The image is Mockup A, Page Studio. Phases 3 and 5.1 built a list editor and then a setup list instead; both are replaced. The full plan is in the session plan `~/.claude/plans/splendid-questing-reddy.md`; the short form:

| Stage | What                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1     | Layout model v4 (pages of rows of cells with spans; v3 and the old presets migrate on read); the three panes and the toolbar as drawn; palette with size badges; pages at paper size with fill bars and page numbers; One Student / Everyone; inspector with name, place, Remove and the class stats; Print Reports wording; Brief, Detailed, the setup list, the old builder and the Class Summary tab removed. A block is placed by clicking it in the palette. | Built; awaiting Colin's look at his class |
| 2     | Drag and drop: palette to page with drop zones that say whether it fits, beside a block for a row, move on the page, the corner handle, inspector Width and Height, the keyboard pattern with announcements.                                                                                                                                                                                                                                                      | To do                                     |
| 3     | Options: Show checkboxes per block, the no-evidence rule, Applies To for one student, Pages per student cap with markers, Text Block.                                                                                                                                                                                                                                                                                                                             | To do                                     |
| 4     | Templates tab on the server rows, Save as Template, starters as templates; dead code removed.                                                                                                                                                                                                                                                                                                                                                                     | To do                                     |

Phase 5's remaining items (5.4 phone tab, parked; 5.5 district questions) stand.

## Open

- District position on teacher-to-family email (gates Phase 4).
- Whether attendance belongs on the Report Card form by default or as an option.
- Safari print parity: measured in Phase 1, not assumed.
