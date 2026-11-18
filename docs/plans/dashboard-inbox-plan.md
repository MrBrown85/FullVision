# The Dashboard's middle row: Inbox and Competencies (2026-11-17)

**Status (Nov 17, late night).** A plan. Nothing is built. Every design choice is now settled: Colin's own are quoted below, and the rest were chosen by the orchestrating session under Colin's delegation, Nov 17 ("make whatever choices you think is best"). No builder starts until the orchestrating session has reviewed this plan. Nothing here needs SQL or changes a grade, so nothing in this build waits on Colin; a release still needs his word.

**What it is for.** Teachers told Colin the Dashboard is "overwhelming". The top bar and the student cards stay as they are. The calm comes from the row between them: on the left two thirds, an Inbox of the work that has come in with the Bulletins tile under it; on the right third, one Competencies tile as tall as both. The row fills the rest of the first view, so the Students heading and the cards start below it.

**Board.** "Dashboard Inbox Artboard" (https://claude.ai/artifact/8rcZpmvi8tbjcid8KrPCGf), version 10, final after an independent review, a fix pass and the redraw for the stacked row: Board A and A2 (the page in a Proficiency and a Letter class), Heights, Top Bar (changes a and b), Board C (the view menu and the four Inbox views at 669 × 299), Board D (the Competencies tile), Board E (All Caught Up, a busy day, Send Work off), Board F (an iPad held upright), Board G (what each click does). **Every builder's brief is written from the board as it stands that day, not from this plan's summary of it.**

What version 9 changed from the version this plan was first written from, taken into the slices below: the assessment's name is the link to the Work Wall (no separate Work Wall button); the row's button reads "Grade Submissions", the label Assignments already uses (`teacher/page-assignments.js:13716`); counts read "6 in · 4 to grade · 20 not in"; the view pill is a real menu; every view has one "Assignments →" link; Roll Call ticks returned work and draws a student with nothing in as a dashed outline; files held over a full Inbox get one opaque overlay with one message. Three gaps the reviewer left for the real build: every Competencies row is one height (the board's "Lowest" tag and "Proficient or Above" wrap); "Gradebook →" does not fit beside the title at 335 px; Send Work off and Roll Call leave 26 to 33 px empty at the tallest size.

## Rules every slice follows

1. **The top bar and the student cards do not change**, apart from changes a and b in slice D1 and where a click on To Grade goes (D4). Colin, Nov 17: "the student cards can be "below the fold"- so size the top bars appropriately . I still want to keep my top bar exactly as is I don't want the cards to change appearance at all." The left roster keeps its look too. A reviewer compares both against `main` in a browser before a slice merges.
2. **No grade math.** Every count of work comes from `GraderWork` (`shared/grader.js`) and every level from `shared/calc.js`. No slice works out a grade, a level or a "to grade" of its own. `tests/grade.test.js` (the grade-format guard) and `tests/level-readings-outside-calc.test.js` stay green and are not loosened. If a slice needs a new helper inside `calc.js`, that part goes to Colin for review and says so in its PR (CLAUDE.md rule 2).
3. **No database change.** Verified below. A slice that finds it needs one stops and says so.
4. **Dark until whole.** D2 to D8 draw only when the build flag `dashRow` is on (`shared/build-flags.js`, made in D1). The flag is off in every released build, Demo Mode included, until D9 turns it on. `main` can be released at any point in the build and the Dashboard teachers see is today's.
5. **Demo Mode works** for every slice, with the sample class's own work and pages.
6. **Hidden means hidden.** Anything meant to be out of sight at rest (a menu, a pop-up, a drop overlay, an Undo bar) is checked in a browser to be out of sight at rest. A CSS `display` rule beats the `hidden` attribute; two artboards had that fault on Nov 17, so it is a line in every brief and every review.
7. **No name an ad blocker hides.** New classes and ids start with `dash-inbox-` or `dash-comp-`; `tests/adblock-names.test.js` stays green, and the reviewer's browser check runs with the ad-block rules switched on (as `e2e/add-from-class.spec.js` does it).
8. Text reaches HTML only through `esc` (`npm run audit:html`). Labels in Title Case, hints in plain sentences, "assess" not "mark".
9. Motion 150 to 250 ms. A page or a row glides from where it was; nothing fades in; nothing moves under Reduce Motion.
10. **The Dashboard redraws as one string.** `PageDashboard.render` builds the whole page and sets it at once (`teacher/page-dashboard.js:186-339`). Each Inbox view keeps its state (which assessment, which page is centred, which pile is open) in its module and draws from it, so a redraw loses nothing. Pictures come back from the `WorkThumbs` holder, which keeps what it has fetched.
11. A late answer (a picture, a refresh of the class's work) checks that the page still shows the same class before it draws.

## What exists already

Traced on `main` at `68cf3dd8` on Nov 17. File and line as they stand there.

- **How the page is built.** `PageDashboard.render` (`teacher/page-dashboard.js:186`) joins, in order: the photo-expiry line (`:270`), `DashOverview.renderOverviewPanel` (`:271`), Questions From Students (`:298`), the students (`:301`), Observations (`:307`), the level-mix pop-up (`:312`). `renderOverviewPanel` (`teacher/dash-overview.js:1248-1263`) draws the top bar (`glanceHtml`, `:88`), then one row holding `competenciesCardHtml` (`:784`) and `coreCardHtml` (`:1170`).
- **The row today.** Two equal columns, each card at least 300 px, stacked under 900 px: `teacher/dashboard.css:49-57` and `:64`. No script sets a height. `e2e/dashboard-layout.spec.js:46-77` holds the two cards to one height of 300 px or more at 1440, 1280 and 1024, and `:132` holds every box 12 px from the next.
- **Top bar, Class Average.** `dash-overview.js:103-123`. The change line is `opts.classChange.text + ' Since ' + opts.classChange.since`; `classGradeChange` (`shared/calc.js:3397`) gives the text "No Change" when the change rounds to nothing.
- **Top bar, To Grade.** `toGradeGlanceHtml` (`dash-overview.js:220-268`). Drawn only when `GraderWork.workOnInClass(cid)` (`:221`): the class's student page and Send Work both on (`shared/grader.js:406-409`). It is a link to `/assignments?course=…&show=tograde` (`:243-245`), followed by `shared/link-nav.js`.
- **Top bar, Missing and Late.** `missingGlanceHtml` (`teacher/dash-insights.js:338-366`). The second line is built at `:358-364` and always prints both parts ("12 Missing · 0 Late").
- **Per-class choices kept on the device.** `fv-dash-core-view:<class>` and `fv-dash-comp-view:<class>` through `_readPref` and `_writePref` (`page-dashboard.js:52-88`). The view menu is `DashOverview.viewMenuHtml` (`dash-overview.js:991`), run by `_openViewMenu` and `_pickView` (`page-dashboard.js:1268`, `:1299`).
- **The class's work is already in memory.** `getCourseSubmissions(cid)` (`shared/data-student-work.js:164`) reads no network. Each piece of work has `sent_by` ("teacher" or "student"), `on_paper`, `is_late`, `note`, `sent_at`, `created_at` and its `files` (the page count is `files.length`). A signed-in class's work is read with `list_course_submissions_since` when the class loads and again at most every 30 seconds (`:921`, `:1256-1260`, `:1317`). **The Dashboard does not ask for a fresh read today**; Assignments does (`teacher/page-assignments.js:2515`). The Inbox adds that one call, `refreshStudentWork(cid)`, which is already throttled.
- **Counts.** `GraderWork.workCounts(cid, aid, ids)` (`grader.js:500`) gives to grade, to return, returned and not in, with the students in each. `classWorkCounts` (`:586`) gives the class's totals and the pieces with any. `workStateOf` (`:462`) is the one place that decides a student's state. `workShown(cid, a)` (`:424`) is true for a piece that takes work or has work in.
- **"The order the work came in" does not exist yet.** `workCounts().ids.tograde` is in class-list order, and `_openGraderOnWork` (`page-assignments.js:14190`) opens the first by last name. The Inbox sorts those ids by `sent_at`, a sort of a list `GraderWork` already made.
- **Pictures.** `WorkThumbs.holder()` (`shared/work-thumbs.js:159`): `fill(root, cid, lookup)` fills each `<img data-work-pic>`. For a signed-in class every picture asked for in one turn is signed in one call (`createSignedUrls`, `data-student-work.js:1478-1534`), links last 300 seconds (`:920`), and the page gets a `blob:` copy. Demo Mode reads `assets/sample-work/`.
- **Where clicks go.** `WorkWall.open(cid, aid, opts)` (`shared/work-wall.js:711`). `PageAssignments.openGrader(cid, aid, sid, { studentIds, show, onClose })` (`page-assignments.js:12611`), which the Dashboard already calls (`page-dashboard.js:1017`). Return N Graded has no public call: it lives inside Assignments (`_returnDrafts`, `page-assignments.js:14630`) behind its own question.
- **Add Work for the Class.** `AddWorkClass.open(cid, aid, opts)` (`teacher/add-work-class.js:1276`) reads one option, `onClose` (`:1317`). **It takes no files.** Files enter by a drop on the page (`_drop`, `:1188-1210`) or a chooser, and go to the tray: `take(files)` (`teacher/add-work-tray.js:346`) and `takeDrop(dataTransfer)` (`:373`). `takeDrop` must run inside the drop itself: a browser gives up a dropped folder's contents only while the drop is being handled (`:371`). `AddWorkClass.offered(cid, a)` (`:115`) is true in every class for a piece that is not a draft and not DIBELS.
- **Compare does not exist.** The board's Side by Side shows "0 picked · Compare 2". No Compare view is in the app (the Add Work plan recorded the same: "the Work Wall has no Compare"). It is not in this plan (see "Not in this plan").
- **Tests that hold the Dashboard today.** `e2e/dashboard-layout.spec.js`, `dashboard-comp-views.spec.js`, `dashboard-core-card.spec.js`, `dashboard-class-shapes.spec.js`, `to-grade-everywhere.spec.js`, `ipad-portrait.spec.js` (the Dashboard at 744, 820 and 1024 wide), `e2e-visual/pages.spec.js`; `tests/dash-view-menu.test.js`, `dash-core-card.test.js`, `dashboard.test.js`, `to-grade-everywhere.test.js`.

**Live numbers** (gradebook-prod, read only, counts only, Nov 17): 1,584 pieces of work, 1,583 added by a teacher and 1 sent by a student; 3,352 pages, 13 the most in one piece; 2 handed in on paper; none late; 7 classes, 4 with the student page and Send Work on. They match the board's own counts. They are why work the teacher added must not show as "new".

**No database change: verified.** Every figure on the board comes from data the app holds: who sent a piece (`sent_by`), paper (`on_paper`), late (`is_late`), pages (`files`), the states (`GraderWork`), the level mix (`competencyDistribution`, `calc.js:3570`), self-assessments (the Core card's own data). "New since you last looked" is a time kept on the device. Following the teacher between computers would need a column and a migration; it is not in this plan.

## Slices

One PR per slice. D2 to D8 are behind the flag, so each can merge when it is right and nothing shows until D9.

| Slice | What                                                              | Waits for             | Builder | Review |
| ----- | ----------------------------------------------------------------- | --------------------- | ------- | ------ |
| D1    | Top bar changes a and b; the build flags file                     | The orchestrator's go | Sonnet  | Opus   |
| D2    | The row: two thirds and one third, sized to the window; one tile  | D1                    | Sonnet  | Opus   |
| D3    | The Competencies tile's two pages as drawn                        | D2                    | Sonnet  | Opus   |
| D4    | The Inbox: By Assessment, and To Grade jumping to it              | D2                    | Sonnet  | Opus   |
| D5    | All Caught Up and a file drop on the tile                         | D4                    | Opus    | Fable  |
| D6    | Side by Side                                                      | D4                    | Sonnet  | Opus   |
| D7    | Flip Through                                                      | D4                    | Sonnet  | Opus   |
| D8    | Roll Call                                                         | D4                    | Sonnet  | Opus   |
| D9    | Turn it on: the flag, the iPad, the old row's code and tests gone | D3, D4, D5            | Sonnet  | Fable  |

D5 is on Opus with a Fable review because a file that lands under the wrong student, once returned, shows one student's work to another. Every fault the Add Work reviews caught was of that kind.

### D1. The top bar's two changes

**Goal.** The two changes Colin took on Nov 17 ("update it base on the council's suggestions"), live at once. They are not behind the flag.

**Build.**

- **a. Missing and Late never repeats its own number.** When one part is zero the second line reads "All Missing" or "All Late". With both, "3 Missing · 2 Late" stays. With none, "Nothing is missing or late." stays. `teacher/dash-insights.js:357-364`.
- **b. "No Change Since Report N" is hidden when nothing changed, and keeps its space**, so the cell does not jump. The line stays in the page with `visibility: hidden` and is hidden from screen readers. Any real change shows as today. "2.9 Proficient" is untouched. `teacher/dash-overview.js:115-122`, one rule in `teacher/dashboard.css`.
- `shared/build-flags.js`: `BuildFlags.on(name)`. A flag is on when its default is on, or when the device has `fv-build-<name>` set to `1` (how tests and reviewers see unfinished work). It ships with `dashRow` and `bulletins`, both off. Added to `teacher/app.html`, `teacher-mobile/index.html`, `s/index.html` and `sw.js`.

**Tests.** Unit: the second line for 12 and 0, 0 and 12, 3 and 2, 0 and 0; the change line present and not visible for "No Change", visible for a rise and a fall; the flags. Browser: the Class Average cell is the same height with and without a change.

**Done when.** At the sample class's numbers the bar looks exactly as on `main`; with everything Missing the line says "All Missing".

### D2. The row, and one Competencies tile

**Goal.** Behind the flag, the middle row has its new shape: a left slot at two thirds, one Competencies tile at one third, both as tall as the window allows, with the Students heading on the bottom edge of the first view.

**Build.**

- `renderOverviewPanel` draws the new row when the flag is on and today's row when it is off. Today's code is left alone until D9.
- **Height.** Colin, Nov 17, on the stacked board: "the 'students' row at the bottom can also be below the fold, to increase the size fo the above the fold boxes." The rule (the board's Heights): **the row is the window's height less where the row starts (278 px on a desktop) and less one 12 px gap, and never under 510 px.** The tiles end at the bottom of the window and the Students heading starts just below it. In the left column the Inbox has 60% and Bulletins 40%, with a 12 px gap; Competencies is the row's full height.

  | Window                | Row | Inbox | Bulletins | Competencies |
  | --------------------- | --- | ----- | --------- | ------------ |
  | 1280 × 800            | 510 | 299   | 199       | 510          |
  | 1440 × 900            | 610 | 359   | 239       | 610          |
  | 1280 × 720            | 510 | 299   | 199       | 510          |
  | iPad upright, stacked |     | 450   | 300       | 520          |

  At 1280 × 720 the rule gives 430, under the floor, so the row stays 510 and the window cuts the tiles 80 px short. Where the row starts is measured from the row's own place on each draw and on resize, so the photo-expiry line above it is counted. Set as CSS variables; the listener goes when the page is left. With no script the row is 510 px. Under 900 px the tiles stack at the iPad's sizes.

- **The left column** holds the Inbox and, under it, the Bulletins tile (`docs/plans/bulletins-plan.md`, slice B1e). **Until Bulletins is turned on, the Inbox has the whole column**: no empty placeholder is shown to teachers. When the `bulletins` flag is on, the column splits 60 and 40. Every Inbox view is built and tested at both heights (299 px beside Bulletins at 1280 × 800, and the full column without it), and no page picture is ever under 80 px tall.
- **The left slot** is Recent Assessments in this slice: the six latest assessments with their date and how many are assessed, from the gradebook the app holds, and a link to Assignments. It is what the slot shows with Send Work off, and it holds the slot until D4.
- **The Competencies tile**: a segmented control, Curricular | Core, with the arrow keys moving between the two and the page sliding sideways (220 ms). Each page keeps today's views and view menu exactly (Curricular: Class Average, Level Mix, Needs Support, Change; Core: Self-Assessment, Evidence). Only the housing changes in this slice. Which page is open is kept per class on the device (`fv-dash-comp-page:<class>`).
- The tile's code moves to `teacher/dash-competencies.js` so D3 and D4 never write the same file.
- A mount point for the Inbox: `DashInbox.html(cid)` when that module exists and the class has Send Work on, else Recent Assessments.

**Files.** `teacher/dash-overview.js`, `teacher/page-dashboard.js`, `teacher/dashboard.css`, `teacher/dash-competencies.js` (new), `teacher/dash-recent.js` (new), `teacher/app.html`, `sw.js`.

**Tests.** Unit: the height rule at each window size in the table, and at 200% zoom; the left column with and without Bulletins. Browser (`e2e/dashboard-row.spec.js`, flag on): at 1280 × 800 the row is 510 px, its tiles end 12 px above the window's bottom edge and the Students heading is below it; at 1280 × 720 the row is still 510; at 800 wide the tiles stack; nothing scrolls sideways; every box is 12 px from the next; the two pages switch by click and by arrow key; flag off, `e2e/dashboard-layout.spec.js` passes untouched.

**Done when.** With the flag on, the first view at 1280 × 800 ends at the bottom of the tiles, and with it off the Dashboard is pixel for pixel today's.

### D3. The Competencies tile as drawn

**Goal.** Board D: each page says one thing per row, in one bar.

**Build.**

- **Curricular, Level Mix:** one bar per competency in the Class Average bar's solid level colours with its 2 px gaps, a legend naming the four levels, and the column headed "Proficient or Above" over "21 of 27". The counts are `competencyDistribution`'s bands, as today's Level Mix reads them. The rows stay in the gradebook's order. One row is marked "Lowest" when it alone has the fewest at Proficient or above; a tie marks none. **Every row is the same height, and the tile never scrolls at the sizes above.** "Lowest" sits beside the number; "Proficient or Above" is a one-line column heading of its own. The board's "Processing and Analyzing" still wraps to two lines beside "Lowest" at 335 px: the builder checks the longest competency names in the curriculum bank at that width and keeps the rows equal.
- **Core, Self-Assessment:** one bar per competency in the self-assessment blues (`--self-1..4`, never the level colours: DECISIONS, "Dashboard cards" 4), the two lightest with a dark edge, a legend, the column headed "Self-Assessed", and a low row said in a word as well as a colour (the board's "Only 11 of 27").
- Each row is a button that names its counts. A click opens a small list in place: the students at each level (as today's pop-up lists them), "Show These N in Student Cards ↓" (filters and sorts the cards weakest first and scrolls to them, as a click on a competency does today) and "Open in Gradebook →".
- The other views (Class Average, Needs Support, Change, Evidence) keep their content and take the tile's width.
- In a Letter class the tile still bands by the four levels (`calc.js:3570-3589` bands by level in every grading style); the pop-up gives each student's level as the class shows it, through `calc.js`.

**Files.** `teacher/dash-competencies.js`, `teacher/dash-competencies.css` (new).

**Tests.** Unit: the "Proficient or Above" count against `competencyDistribution` for the sample class; Lowest on one row, none on a tie; a low Self-Assessed row; a Letter class. Browser: Board D's two pages at the board's sizes, light and dark; a row's list opens, filters the cards, and Escape closes it with the focus back on the row.

### D4. The Inbox, By Assessment

**Goal.** Board C1 and E2: what came in, by assessment, newest first, with one Assess button a row.

**Build.**

- `teacher/dash-inbox-model.js`, no HTML in it. From `getCourseSubmissions` and `GraderWork` it gives, for each piece with work shown: to grade, to return, returned, not in, the newest arrivals (name, time, pages, Late), how many are on paper, how many the teacher added, how many are new since the teacher last looked, and the students to grade in the order their work came in. It also gives the class's state: rows (four at most, the rest folded into one line), All Caught Up, or nothing taking work.
- **Work the teacher added** is never "new": one quiet "You Added" line. What To Grade counts is `GraderWork`'s, unchanged. The +N on a row counts students' own sends since the time kept on this device (`fv-dash-inbox-seen:<class>`). The time moves when the teacher leaves the Dashboard or changes class, so the counts hold still during a visit.
- `teacher/dash-inbox.js` and `.css`: the tile. Its header is "Inbox", the view pill and "Assignments →", and **no count** (the top bar's To Grade owns it). A row: page pictures, in a picture row at least 88 px tall so no page is under 80 px; an assessment with nothing in is a slim two-line row; the title, which is the link to the Work Wall; "6 in · 4 to grade · 20 not in"; the newest line; "Grade Submissions". Rows never overlap. A paper hand-in with no scan draws as a lined sheet with the student's name. Amber only on the word "Late".
- **Clicks**, as Board G: the title opens the Work Wall; Grade Submissions opens the grader on the students to grade, in the order their work came in, with Show on To Grade; "Assignments →" opens Assignments.
- **Views.** `DashInbox.addView({ key, label, hint, html, mount, unmount })`, so D6, D7 and D8 each add a file and never edit this one. The pill uses `DashOverview.viewMenuHtml`; the choice is kept per class (`fv-dash-inbox-view:<class>`), By Assessment first.
- **Fresh work.** The Dashboard calls `refreshStudentWork(cid)` when it draws, as Assignments does. When a piece is unsubmitted or deleted its page leaves the row, the others glide together and the count changes in place.
- **To Grade in the top bar.** With the Inbox on the page, a click or Enter scrolls it into view and gives it a 200 ms ring. With no Inbox (Send Work off, or the flag off) it opens Assignments on To Grade, as today.
- The Inbox shows where the To Grade cell shows: `GraderWork.workOnInClass(cid)`. Elsewhere the slot keeps Recent Assessments.

**Files.** `teacher/dash-inbox-model.js`, `teacher/dash-inbox.js`, `teacher/dash-inbox.css` (new); `teacher/dash-overview.js` (the To Grade cell: a few lines); `teacher/page-dashboard.js` (the click, the refresh, the leave time: a few lines); `teacher/app.html`, `sw.js`.

**Tests.** Unit, on the model: each count against `GraderWork` for the sample class; arrival order; teacher-added work never new; paper; four rows and the fold at 38 assessments; All Caught Up; a class with Send Work off; the "seen" time. `tests/work-lookups-fast.test.js` gains the model, so a class of 680 pieces stays fast. Browser (`e2e/dashboard-inbox.spec.js`, Demo Mode): the rows match the sample class; Grade Submissions opens the grader on the right student; the tile at the full column and at the split height; To Grade scrolls to the Inbox; a redraw keeps the view; no picture is asked for twice.

**Done when.** In Demo Mode and in Colin's test class the Inbox's "to grade" for every row adds up to the top bar's To Grade.

### D5. All Caught Up, and a drop on the tile

**Goal.** Board E1 and E1b: with nothing to assess, the list's space is the drop area from Add Work for the Class; and files dropped anywhere on the tile open that page with the files already placed.

**Build.**

- `AddWorkClass.open(cid, aid, opts)` learns two options: `files` (a list of files) and `drop` (the drop's own `DataTransfer`). After the page is drawn it hands them to the tray, exactly where a drop on the page hands them: `tray.takeDrop(drop)` or `tray.take(files)`. Nothing about matching, the Waiting tray or Split the Scan changes; a single PDF still opens Split the Scan. **`open` is called inside the drop handler itself**, with no wait before it, because a dropped folder can only be read then.
- At 299 px the drop area hides its icon so it fits.
- The Inbox's empty state: "Add Work For" with the three assessments most recently taking work, the next one due chosen; the drop area in Add Work's own words ("Drop the Scan, a Folder or Files", Choose Files…, Choose a Folder…, Split a Scan…); and under it two lines: work assessed but not returned ("Return Them →" opens Assignments at that piece, where Return N Graded and its question already live) and the next piece taking work with how many are not in ("Work Wall →").
- The area is Add Work's own: grey and dashed at rest, blue while files are held over it.
- **The whole tile takes a drop** in every view. While files are held over it one opaque overlay covers the list with one message ("Drop to Add to Light Refraction Lab"), for the newest assessment taking work; a file dropped for the wrong one is moved on the Add Work page with For.
- A drop of something that is not files does nothing. Add Work's own rules hold: nothing is saved until Add Work is pressed there.

**Files.** `teacher/add-work-class.js` (the two options), `teacher/dash-inbox-drop.js` (new), `teacher/dash-inbox.css`.

**Tests.** Unit: `open` with `files` places them as `takeFiles` does; with a folder drop it walks the folder; with neither it behaves as today (every existing Add Work test passes untouched). Browser (`e2e/dashboard-inbox-drop.spec.js`): a made-up drop of two named files on the tile opens Add Work with each under the right student and nothing saved; a drop while By Assessment shows; the overlay is not on screen at rest.

**Done when.** A real drag from Finder of a folder of named files, tried by the reviewer, lands every file under its student on the Add Work page.

### D6. Side by Side

Board C2. One assessment's work in a row that scrolls sideways, the pages as tall as the tile allows, to grade first. A student with several pages is a pile with the count on its corner; pointing at, focusing or tapping it spreads the pages sideways in 200 ms, pushing the others along, and it gathers when left. A click on a page opens the grader on that student, at that page. Files: `teacher/dash-inbox-side.js`, `.css`. Tests: the pile model; keyboard and touch; a 13-page pile; Reduce Motion. **"Compare 2" is not built** (see "Not in this plan"): the "0 picked" control is left off.

### D7. Flip Through

Board C3. One assessment at a time; the centre page faces the teacher at the stage's full height with its caption and Assess; the others stand to each side. Arrow keys, a click on a side page, a sideways scroll or swipe, and the strip under it all move the pile; up and down page through one student's pages. With Reduce Motion the pages swap without turning. Every page is also a button with the student's name, so the turned pages carry nothing a screen reader misses. Files: `teacher/dash-inbox-flip.js`, `.css`. Tests at 299 px and at the full column, and on the iPad's 450 px.

### D8. Roll Call

Board C4. The whole class in class-list order. At the Inbox's 299 px it shows name chips, not pictures: solid when work is in, dashed when not, a tick when returned, bold when waiting to be graded. With the whole column (before Bulletins is on, or on a taller window) the chips become pages where they fit at 80 px or more. A click on a page opens the grader. A click on an empty outline offers Add Work (that student, through the grader's own Add Work) and Mark Missing; "Add Work for the Class" opens the class page. **Mark Missing sets a status that can count as zero** (a Letter or Both class). It calls `Grader.setStatus`, the call the grader and gradebook already use, and adds no new rule; the PR says so for Colin's review, and follows whatever asking and Undo the gradebook's own Missing does. Files: `teacher/dash-inbox-roll.js`, `.css`.

### D9. Turn it on

- `dashRow` on by default; the old two-card row, its CSS and the tests that held it (`e2e/dashboard-layout.spec.js`'s equal-height tests) go, replaced by D2's.
- The iPad held upright: every rule in `teacher/tablet.css` (DECISIONS, "The desktop app on an iPad held upright"); `e2e/ipad-portrait.spec.js` passes at 744, 820 and 1024 with the row in place.
- `e2e-visual/pages.spec.js`'s Dashboard picture retaken; the help article's pictures retaken (`scripts/help-shots.mjs`) and its words checked against the page.
- The things the board still has wrong are checked right in the build: equal row heights in Competencies with the longest names; "Gradebook →" at 335 px; the busy day's spare band (26.5 px on the board, 24 at most); and the Bulletins tile's third row, which the board labels "Photo" (it is an announcement with a picture, named "Photo of the Board").
- DECISIONS and CLAUDE.md's Current state say it is on.
- **The check before it merges**, by someone who built none of it: every board, in a real browser, at 1280 × 800 and 390 px wide, light and dark, with the ad-block rules on, in a Proficiency, a Letter and a Both class, with Send Work on and off, against the board. Colin is sent pictures of the finished Dashboard beside today's, and can see it on `main` with the flag set on his own computer; a release is his word.

## Critical path, and what runs side by side

D1 → D2 → D4 → D5 → D9 is the path. D3 runs beside D4 (different files once D2 has moved the tile out). D6, D7 and D8 run beside D5, three builders at most, each in its own files. No slice waits on a decision.

The Bulletins tile (`docs/plans/bulletins-plan.md`, slice B1e) sits under the Inbox. It needs D2 merged; it lands with Bulletins' first stage, and until then the Inbox has the column (D2). Either build can be turned on first.

How this build sits beside Bulletins and Quizzes is in `docs/plans/quizzes-plan.md`, "Order across the three plans".

## One writer per file

| File                                                    | Writers, in order                                             |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `teacher/dash-overview.js`                              | D1, D2, D4 (the To Grade cell), Bulletins B1e (one mount), D9 |
| `teacher/dashboard.css`                                 | D1, D2, D9. Every other slice has its own stylesheet.         |
| `teacher/page-dashboard.js`                             | D2, D4, Bulletins B1e, D9                                     |
| `teacher/dash-insights.js`                              | D1                                                            |
| `teacher/dash-competencies.js`, `.css`                  | D2 makes it, then D3                                          |
| `teacher/dash-inbox.js`, `-model.js`, `.css`            | D4, then D5 (the stylesheet only)                             |
| `teacher/dash-inbox-drop.js`, `-side`, `-flip`, `-roll` | D5, D6, D7, D8: one each                                      |
| `teacher/add-work-class.js`                             | D5                                                            |
| `teacher/tablet.css`                                    | D9                                                            |
| `teacher/app.html`, `sw.js`                             | A line or two from each slice; merged one at a time           |
| `shared/build-flags.js`                                 | D1 makes it; D9 and Bulletins B1g each change one default     |

**Not touched:** `shared/calc.js`, `shared/grader.js`, `shared/data-student-work.js`, `shared/work-wall.js`, `shared/work-thumbs.js`, `teacher/page-assignments.js`, `teacher/dash-student-cards.js`, the roster, every migration and both edge functions.

## Decisions that are Colin's

Settled:

- The top bar and the student cards keep their look; the cards may start below the fold (Nov 17, quoted in rule 1).
- Changes a and b to the top bar, and To Grade jumping to the Inbox (Nov 17).
- The Inbox at two thirds, one Competencies tile at one third, the row taller, the Inbox header with no count (Nov 17).
- **Bulletins is stacked under the Inbox** in the left two thirds, with Competencies beside both, and the row takes the whole first view: Colin sent the stacked board and said "the 'students' row at the bottom can also be below the fold, to increase the size fo the above the fold boxes." Stacked is the orchestrating session's reading of that, told to him; it was decision 1.

Chosen by the orchestrating session under Colin's delegation, Nov 17 ("make whatever choices you think is best"). Told to him, not asked again:

- **The drop area matches the Add Work page**: grey and dashed at rest, blue while files are held over it. One drop style across the app. (Was decision 4.)
- **Side by Side and Flip Through both stay**; the Inbox opens on By Assessment. (5a.)
- **Work the teacher added shows as one quiet "You Added" line.** To Grade keeps exactly the meaning it has on `main`; nothing in this build changes what that number counts. (5b.)
- **"New since you last looked" is kept on the device.** No database change. (5c.)
- **With Send Work off, the slot shows Recent Assessments.** (5d.)
- The row's height fits the window; the left roster keeps its level badges; Competencies has a named Curricular | Core switch, marks the lowest row without re-sorting, and a row opens its students in place with "Show These in Student Cards" and "Open in Gradebook".
- **The Bulletins slot is never shipped empty**: until Bulletins' first stage lands, the Inbox takes the whole left column by the same sizing rule.

## Not in this plan

- **Compare 2** (the board's Side by Side). No Compare view exists in the app. It needs its own short design and its own decision.
- **"New since you last looked" on every computer.** It is kept on the device. On every computer would need a column and a migration.
- **A drop line for a class with Send Work off.** Add Work for the Class is offered in every class, but the Inbox, and so its drop area, shows only with Send Work on. A paper-only class opens Add Work from Assignments, as today. Worth a look once the row is on.
- **Return Them from the Dashboard.** The line opens Assignments, where the question already is. A second place that returns grades would be a second place that shows grades to students.
- **Any change to the top bar beyond a and b, to the student cards, or to the roster.** A "Today" strip is not re-proposed.
- **Quizzes.** It has a plan of its own, `docs/plans/quizzes-plan.md`, with ten settled decisions; nothing of it is built here.

## Risks

- **A card or the top bar changes by accident.** A shared CSS rule is edited and a card shifts by a pixel. `e2e-visual/pages.spec.js` and the reviewer's side-by-side with `main` are the guard; `teacher/dashboard.css` has three writers only.
- **A file under the wrong student** (D5). The drop goes into the same tray, by the same call, as a drop on the Add Work page; no matching code is written. Nothing is saved until Add Work.
- **A dropped folder read too late.** If `open` is not called inside the drop, a folder arrives empty in some browsers. The browser test drops a folder; the reviewer does a real drag.
- **Pictures.** Roll Call and Side by Side show a class's worth at once (27 to 30). They are signed in one call and held for the visit; the holder is released when the Dashboard is left. A slow connection shows the waiting grey at the same size, so nothing jumps.
- **The row's height on short windows.** Under 800 px tall the row stays 510 px and the window cuts its bottom; the page scrolls and nothing inside is squeezed. 200% zoom is a test case.
- **A squeezed Inbox.** With Bulletins under it the Inbox is 299 px at 1280 × 800. The board draws all four views at that height; Side by Side and Flip Through are the tightest, and each is checked in a browser at 299 px before it merges.
- **Two sources for one number.** The Inbox's "to grade" and the top bar's To Grade must agree always; both read `GraderWork`, and a test adds the rows up.
- **The board changes after this plan.** The review is still running. Briefs are written from the board on the day.

## Working rules

- Builders work in worktrees of their own cut from `origin/main`, commit and push in small steps, and never touch the main checkout (`/Users/brown_colin/FullVision` sits on an old branch).
- One PR per slice; `test-and-format` passes before merge; the slice's own tests and its one browser spec are run locally; main's e2e run is checked after merging and fixed next if red.
- Every slice has a review by someone who did not build it, given the code and the board, not the builder's conclusion. Every screen is tried in a real browser by someone other than its builder: 1280 × 800 and 390 px, light and dark, ad-block rules on.
- A fault of the same kind twice is fixed at its cause.
- No release without Colin's word.
