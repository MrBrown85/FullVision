# Gradebook Sweep Fixes — Plan

Nov 1 2026. Fixes for the 20 findings of the gradebook UX sweep (Scores and
Competencies views, desktop). One PR per change, built from `origin/main`,
checked in local Demo Mode, drift-checked against this plan before it goes up,
merged once `test-and-format` is green, then main's post-merge e2e checked.

## Design rules every PR keeps

- FullVision's Apple look: white rounded cards on #f5f5f7, filled controls,
  few lines, black #1d1d1f text, chosen level solid `--score-N` with white text,
  no coloured outlines, no hairline grids (dim-screen rule).
- One solid blue button per screen (+ New Assessment). Everything else outline
  or tinted.
- Title Case for labels, headings, buttons, menu items, tabs; plain sentences
  for hints and messages. "Proficiency", never "level", in copy.
- No banners or toasts for sync. No new controls beyond what a PR names.
- Spacing standard: 12px between boxes and from edges; toolbar controls 12px in;
  `--control-h` 32px.
- Nothing is removed. Where a gesture changes, the old path stays reachable.

## The object is an "Assessment"

The nav tab is Assignments (the page). Every item on it is an Assessment
(`+ New Assessment`, Create/Delete Assessment, DECISIONS rule "One primary
action"). The gradebook uses Assessment for the thing and Competencies for the
learning-map columns.

## PRs (in build order)

### 1. Competency cells open the grader (finding 1)

- A click on any Competencies-view cell opens the shared grader, as the Scores
  view and rubric cells already do. No click changes a score any more.
- Keyboard entry stays: 1–4, +/−, 0/Delete, C/I on a selected cell (PR 11 makes
  selecting reachable).
- Points cells: click opens the grader too (typed entry stays on the keyboard).
- DECISIONS entry: "A click never changes a score" (supersedes the click-cycle).

### 2. Late shows in the gradebook (finding 2, part of 17)

- A Late cell keeps its score and adds a small "L" after it, the printed sheet's
  mark (`.gp-late`), in both views; the cell's label reads "…, Late".
- The cell menu gets Mark Late / Undo Late (Late is always allowed, D9).

### 3. Menus close cleanly (finding 3)

- The click that closes a cell or column menu does nothing else.
- Escape closes the menu and returns focus to the cell or title.
- Menus are `role="menu"` with arrow keys, Return, and Shift+F10 / the Menu key
  to open one on the selected cell.

### 4. Empty states say what to do (finding 4)

One centred white card, plain sentence, one outline button (the toolbar's

- New Assessment stays the only blue):

* No students: "No students in this class yet." → Add Students (Class Management).
* No assessments: "No assessments in this class yet." (the toolbar button does it).
* Filters hide every column: "No assessments match these filters." → Clear Filters.
* Search finds no one: "No students match “…”." → Clear Search.
* Term has none: "No assessments in this term." → Show All Time.

### 5. Plain labels and a key (findings 5, 6)

- Scores view corner reads Student | Overall, as the Competencies view does.
- Points column meta reads "Oct 21 · Out of 10" (no "/ 10" beside a date).
- A points cell's label reads "8 out of 10"; levels read their proficiency word.
- A one-line key at the foot of the grid, quiet text, both views:
  coloured swatches Emerging · Developing · Proficient · Extending, then
  M Missing · EXC Excused · L Late · — No Score.
- Competency codes: hover or focus shows the app's own tip at once with the
  code, its full wording and its group (no 1-second browser tooltip). Codes use
  the app font, not monospace.

### 6. One word for one thing (finding 7)

- Column menu: Grade This Assessment, Edit Assessment Details, Delete Assessment.
- Name card: "From 35 assessments handed in". Delete dialog and toast say
  assessment.
- Filters strip label: Competencies (was Outcomes).

### 7. Rubrics by Criterion is the default (finding 8)

- A class with no saved choice opens on Rubrics by Criterion (one column per
  criterion, no repeated scores). A saved choice is kept.

### 8. The points grader's two text boxes (finding 9)

- Note for the Report sits in the same card width and 12px gap as Overall
  Comment.
- Its hint: "Optional. Used only in the report comment, when this is the
  student's best piece." The example line under the field stays.

### 9. Title Case (finding 10)

- Edit Score, Clear Score, Mark Missing / Undo Missing, Excuse / Undo Excuse,
  Add Observation (menu and dialog title), Newest First, Clear All, All Time.

### 10. Grader matches its mockup (finding 11)

- Print / Print Rubric becomes the mockup's tinted button (10% blue fill, blue
  text), so Done is the dialog's only solid blue.
- The chosen level reads "Proficient"; the − or + shows only on its own button.

### 11. Keyboard in both views (findings 12, 13)

- Each grid is one Tab stop (roving tabindex, `role="grid"`); the selected cell
  has the app's focus ring.
- Arrows move, Return or Space opens the grader, Shift+F10 opens the cell menu,
  Escape clears the selection. Scores view gets the same.
- A click selects the cell as well as opening the grader, so the keyboard
  carries on from there when the grader closes.
- A digit typed on a rubric cell shows the cell's tip: "Scored on the rubric.
  Press Return to open it." (DECISIONS: typed scores do nothing there.)

### 12. Return moves down in a points cell (finding 14)

- Return saves and moves to the next student, as levels and C/I do. Tab moves
  right; Escape cancels.

### 13. One order, one date style (finding 15)

- Both views follow one Newest First switch (corner button in both), default
  on, remembered on this device.
- Both views print dates with `formatShortDate` (year only outside this school
  year).

### 14. A steady toolbar (findings 16, 19)

- Export shows in both views.
- Fixed order: Class, Scores | Competencies, Term, Filters, Search, then (in
  Competencies only) Rubric Columns; the right group stays at the right, so
  nothing to the left of it moves when the view changes.
- The term picker sizes to its chosen term; Search shrinks to 140px; one row at
  1024px.

### 15. Scores view averages and column titles (finding 17)

- A Class Average row at the foot of the Scores view, the same row and rule
  (`classColumnAverage`) as the Competencies view.
- A click on a column title opens its menu (right-click and double-click keep
  working).

### 16. Shorter header (finding 18)

- The slanted header's default height fits the longest title up to 150px;
  longer titles end in an ellipsis and show in full on hover.
- The resize edge shows a grab bar on hover. A height the teacher dragged is
  kept.

### 17. Name card (finding 20)

- The card opens after a 400ms hover (at once on keyboard focus) and sits below
  the student's row (above it near the bottom), so the hovered row and its
  scores stay visible.

## Drift check after each PR

List every visible element, label and behaviour the PR adds, changes or
removes; compare with its section above and with the grader mockup (canvas
11CHpXNWvP82169PkLEWNz) where it touches the grader. Anything extra is cut;
anything missing is named. Hover each changed row/cell and measure for layout
shift. The result goes in the PR body.

## Shipped (Nov 1 2026)

All merged to main: #643 (1), #644 (2), #645 (3), #646 (4), #647 (5), #649 (6), #651 (7), #652 (8), #653 (9), #654 (10), #655 (11), #656 (12), #657 (13), #658 (14), #659 (15), #660 (16), #661 (17). Extra: #650 (M/L/EXC marks pass contrast; #647's key exposed them), #662 (names and scores stay in line when a name takes focus).

Departures from this plan, each named in its PR: PR 8 kept the mockup's hint wording; PR 3's Shift+F10 moved to PR 11; PR 11 added → / ← between a name and its first score; PR 13 needed no date change; PR 14 moved Rubric Columns into the Competencies corner and added narrow-width icons; PR 16 caps at 170px, not 150.
