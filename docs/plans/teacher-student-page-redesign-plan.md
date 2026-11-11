# Teacher student-page redesign (2026-11-10)

**Resumed Nov 11** (Colin's ruling 137: "yes! i didn't intend to pause this"). R1 merged as PR 1015. The teacher tabs keep all grades, drafts included ("Keep all grades"); the student's own page and anything sent home stay returned-only. No grade math changes: R2 reuses S13's helpers in `shared/calc.js`, and any new `calc.js` function needs Colin's review. R5 still asks him first.

R3 (Observations) also keeps a private note's words (Concern, Note, a reflection) off the screen until the teacher presses Show, since the student may be looking, as the approved mockup does.

The teacher's student page, tab by tab, so a student at the desk can read it and a teacher can act on it. The Overview tab shipped in PR 1013. The other tabs were designed as mockups on Colin's canvas (Overview, Grades, Competencies, Observations, Learner Profile) and reviewed against a panel of grading, privacy, data and design experts.

This track runs beside the student-page build (`docs/plans/student-page-build-plan.md`). The build's orchestrator keeps the hot-file list and the order; this track builds its own slices and merges each on green: every check including the browser shards and e2e-report, then main's run after the merge.

## Design rules

Every slice follows these.

1. **Chips are square** (4px corners). No pills.
2. **One control per job.** A segmented control picks a view (Group By, Sort, Term). Chips narrow a list (filters).
3. **One meaning per colour.**
   - Blue is for actions, links and selection.
   - Orange is for what needs attention: missing work, gaps, not seen yet.
   - Level colours appear only on levels.
   - Observation-type colours (`OBS_SENTIMENTS`) appear only on observations.
4. **Levels are written one way.** Always through `formatLevel`: a % in Letter classes, the figure plus the word in Proficiency classes.
5. **One 1–4 scale piece.** 12px cells, 4px gaps, partial fill, a start ring, and an outline variant for a student's own rating.
6. **One teacher-only signal.** A dashed line and a lock reading "Only You". Controls show on hover in lists and stay visible in an open row.
7. **One open-in-place row.** Feedback on the left, a facts list on the right, the teacher line below.
8. **One section header.** Title, one plain sentence (only when it says something), the control on the right.
9. **One hero page.** The 76px figures belong to the Overview only; elsewhere 28px at most.
10. **Same words for the same thing.** "To Get Better", "Your Goals", "Next Step". Tab values read as a number and noun, then a status.
11. **App tokens only**, so dark mode works. 44pt touch targets on `pointer: coarse`. Wide tables stack below 900px.

## Slices

| Slice | What                                                                                                                                                                                                               | Files                                                                               | Waits for                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1    | Shared pieces, and the Overview brought under the rules. This plan.                                                                                                                                                | `teacher/page-student.js`, `teacher/student.css`                                    | Nothing                                                                                                                                                                                    |
| R3    | Observations: today's four tabs become type filters (Strength, Growth, Concern, Note); a term timeline with gaps; Seen in Class as a competency filter. The capture strip (`teacher/obs-capture.js`) is untouched. | `teacher/student-evidence.js`, `teacher/student.css`                                | R1                                                                                                                                                                                         |
| R2    | Competencies: one scale per competency with a start ring, the trend since the start, Now and Next Step, a facts list, Sort. Lands the trend and Next Step helper in `shared/calc.js` that S13 reuses.              | `teacher/page-student.js`, `teacher/student.css`, `shared/calc.js`                  | R1. Any new formula is grade math: an independent review, then Colin's. `tests/golden-grades` and the report fixtures stay identical; the helper is listed in `tests/report-calc-callers`. |
| R6    | Learner Profile: "Jordan Says" beside "Your Level", the Core Competency term status, goals with their source, the Overview's plan writing Goals.                                                                   | `teacher/learner-profile.js`, `teacher/student-voice.js`, `teacher/page-student.js` | Before S10 is handed out                                                                                                                                                                   |
| R4    | Grades: Assessments and Grade Breakdown in one tab. A course-grade bar by category weight, Group By (Category, Unit, Type, Rubric, Date), rows that open, class average off by default. Behind the build switch.   | `teacher/page-student.js`, `teacher/student.css`                                    | PR 1004 (`ReportScores.ready`, the "Loading this class…" state, `e2e/returned-not-loaded.spec.js`), and Colin's answer on returned grades                                                  |
| R5    | Remove the Assessments and Grade Breakdown tabs once Grades is on, with the browser tests updated.                                                                                                                 | `teacher/page-student.js`, `e2e/`                                                   | R4, and Colin's yes                                                                                                                                                                        |
| R7    | An iPad and touch pass across the tabs.                                                                                                                                                                            | `teacher/student.css`                                                               | The rest                                                                                                                                                                                   |

## Hot files

- **This track's, until each slice says done:** `teacher/page-student.js`, `teacher/student.css`, `teacher/student-evidence.js`, `teacher/learner-profile.js`, `teacher/student-voice.js`, and the student-page part of `teacher/ui.js` (`renderStudentHeader`).
- **Shared and risky:** `shared/calc.js`, `teacher/styles.css`, `teacher/app.html`, `sw.js`, `tests/setup.js`. Keep edits to a few lines, and tell the orchestrator first.
- **The build's:** everything else on its list. Stay out.

## Decisions that are Colin's

- Whether these teacher tabs count only returned grades.
- Removing the Assessments and Grade Breakdown tabs (R5).
- Whether competency levels move off "average of all scores" (grade math).
- All new wording, one question at a time, with a picture.

## Working rules

- Branch from `origin/main` in a worktree of your own. Never switch the main checkout's branch.
- Grades display only through `calc.js` helpers (`tests/grade-format-guard`). Text goes into HTML only through `esc` (`npm run audit:html`).
- A late answer from anything asynchronous checks that the screen that asked is still showing before it draws.
- Anything unfinished stays behind the per-class build switch.
- Builders run on Opus. Fable at high effort is only for independent reviews of grade math.
