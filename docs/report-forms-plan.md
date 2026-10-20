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

## Phase 3 · Edit Layout (weeks 4–5)

- Mode banner, Fixed / Flows tags, options panel, Preview With longest / typical / shortest, pairing of fixed blocks, whole-form settings (the reflection and response blocks keep their text), "+ Add a Block", pointer and keyboard drag with live announcements, Save to Library (`report_template`, teacher-level).
- Phone: Review as a stepper, one page at a time; no editing; a read-only Reports tab in the PWA.

## Phase 4 · Send (weeks 6–9, after the policy check)

- `guardian` table with consent; roster import column; Class Management editing.
- Family view-by-link page with the birth-date check; SES in `ca-central-1`; queue, delivery log, bounce handling.
- Send as the second output of Issue; the Send view (recipients table, composer, preview).
- Assessment emails from the graded rubric; PDF attachments last.

## Open

- District position on teacher-to-family email (gates Phase 4).
- Whether attendance belongs on the Report Card form by default or as an option.
- Safari print parity: measured in Phase 1, not assumed.
