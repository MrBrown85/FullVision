# Add Work for the Class build plan (2026-11-17)

**Status.** Plan only. Nothing is built. Colin chose Option B on Nov 17 ("go with option b"): a page of its own, opened from the assessment card's menu and from a button on the Work Wall. Option A (dropping straight onto the Work Wall) is not being built.

**What it is for.** A teacher scans a pile of paper work on the school photocopier, which emails one big PDF. From one page, on a computer, the teacher adds each student's pages for one assessment in a few minutes. Nothing is saved until the teacher presses Add Work.

**Boards.** The "Photo Submissions" artboard (https://claude.ai/artifact/GhXQnhDhoxsdfbvVq8QfjF), rows "Option B: Add Work for the Class, its own page" and "More pleasant surprises", and the board "Plan: Adding Work for the Class, Council and Recommendation". The Option A boards stay on the artboard as the road not taken.

## Rules every slice follows

1. **Nothing is saved until Add Work.** Files are placed and checked on the page, in memory only. Leaving the page with files placed asks first.
2. **File names never leave the computer.** A name is read in the browser to find the student, then dropped. `PhotoShrink.prepare` puts the file's name on each page (`page.name`, kept by `shared/photo-queue.js` until the page is up), so this page renames every page (`page-1.jpg`) before it hands them on.
3. **Nothing reads handwriting, and no outside service is called.** Blank pages, stickers and upside-down pages are found by looking at the picture in the browser.
4. **Not In stays Not In.** This page never sets Missing, Late or a zero. Handed In on Paper is set only by the teacher's click.
5. **Each student is one write.** Adding goes through the calls that exist (`addStudentWorkPages`, `replaceStudentWorkPages`, `markStudentWorkOnPaper` in `shared/data-student-work.js`), one student at a time. A dropped connection loses nothing and repeats nothing; upload trouble shows only on the sync dot (CLAUDE.md rule 5).
6. **The whole scan is never uploaded.** It is split on the computer; only each student's own pages go up, shrunk as every page is.
7. **Every drop space is also a button.** "Drop, or click to choose", and the page works with the keyboard alone.
8. **Demo Mode works** for every slice. Anything unfinished stays behind the per-class build switch.
9. Labels in Title Case, hints in plain sentences, "assess" not "mark". Motion 150–250 ms; a file glides to its row, nothing fades in.
10. Text goes into HTML only through `esc` (`npm run audit:html`). A late answer from a file read or a save checks that the page still shows the same class and assessment before it draws.

## What exists already

Traced in the code on Nov 17.

- **Writes.** `addStudentWorkPages(cid, sid, aid, pages, { mode })` with `new` and `add`, `replaceStudentWorkPages`, `markStudentWorkOnPaper`. Signed in, they call `start_work_upload`, `finish_work_upload` and `mark_handed_in_paper`; in Demo Mode they keep the pages on the device. Answers already cover every case this page needs: `sent`, `already_sent`, `on_paper`, `too_many_pages`, `class_full`, `uploading`, `not_found`, `nothing_sent`.
- **Limits.** A piece of work holds 30 pages (`STUDENT_WORK_MAX_PAGES`). A class holds 10,000 pages and 5 GB. An upload link lasts two hours. A class set of 28 students at two pages is about 56 pages and 20–30 MB, well inside all three.
- **Files.** `PhotoShrink.prepare(file, opts)` turns a photo or each PDF page into a JPEG about 2000 px on the long side, with a thumbnail, no location data. It already takes `opts.maxPages` and `opts.onProgress`. It refuses a PDF over 20 MB (`MAX_PDF_BYTES`, no option yet) or over 20 pages (DECISIONS, "Student page build rulings" 18). pdf.js is in `vendor/pdfjs/`, loaded only when a PDF is chosen (`shared/photo-readers.js`).
- **The shared file step.** `_prepareWorkFiles`, `_addWorkRefusal` and `_addWorkAnswer` in `teacher/page-assignments.js` are what the grader's Add Work and the row's + both use.
- **Where it opens.** `_cardMoreMenuHtml` in `teacher/page-assignments.js` builds the card menu (Class Results, Print, Work Wall); `openWorkWall` is the pattern for a page over the Assignments page. The Work Wall's menu item shows only where `GraderWork.workShown` is true.
- **QR codes.** `vendor/qrcode.js` (MIT) prints them for cards and slips. Reading one uses the browser's `BarcodeDetector` (`s/app.js`), which Chrome has and Safari and Firefox on a computer do not.
- **Stored names.** `submission_file` holds no file name; a page's path is made from ids.

## Slices

One PR per slice. Each slice ends usable on its own.

| Slice | What                                                                                                                                | Database change  | Waits for                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------- |
| B0    | This plan, the DECISIONS entry, the ROADMAP line                                                                                    | No               | Nothing                                 |
| B1    | The page: one file per student, Column and Grid, Add as More Pages / Replace Them / Skip, On Paper, the list of who is still Not In | No               | B0                                      |
| B2    | Split the Scan: drop the emailed PDF, pages per student, type names, blank backs left out, turn a page                              | No               | B1, and Colin's page limit (decision 1) |
| B3    | A folder matched by name: the Waiting tray, close spellings, two students with one last name                                        | No               | B1                                      |
| B4    | Sticker sheets: print one sheet per student, the scan sorts itself                                                                  | Yes (decision 3) | B2, and decisions 3 and 4               |
| B5    | Small touches: Set Up Like Last Time, a page dragged between pieces, the answer key, grade in the order of the scan                 | No               | B2                                      |
| B6    | One pile, two classes; a late paper's own assessment                                                                                | No               | B2 and B3                               |
| B7    | The scan shared from the phone's mail                                                                                               | No               | B2, and a check on a real iPhone        |

B2 and B3 can be built at the same time by two builders once B1 is merged: they share only the staging model, which B1 fixes.

### B0. Record the choice

- `docs/DECISIONS.md`: a new entry, "Add Work for the Class (2026-11-17)", with Colin's choice of Option B, the rules the build follows, the build order, and what is still his to decide.
- `docs/ROADMAP.md`: one line under open work.
- This file.

### B1. The page, one file per student

**Goal.** From the assessment card's menu, a teacher opens Add Work for the Class, puts a file on each student, and adds them all with one button.

**Boards.** Option B: Add Work for the Class, Column, Files Waiting; Option B: Grid, Close Spelling, Already Has Work, Moving a Page (without the close-spelling card, which is B3).

**Build.**

- A tidy first: move `_prepareWorkFiles`, `_addWorkRefusal` and `_addWorkAnswer` out of `teacher/page-assignments.js` into `shared/add-work-files.js`, unchanged, with the grader and the row's + calling the moved copies. No behaviour change; `tests/teacher-work.test.js` and `tests/grader-work-pane.test.js` stay green.
- `teacher/add-work-class.js` (`window.AddWorkClass.open(cid, aid, opts)`, `close`, `isOpen`) and `teacher/add-work-class.css`, a page over the Assignments page as the Work Wall is. Two parts inside it: a staging model with no HTML in it (place a file on a student, move it, take it off, the choice for a student who has work, On Paper), and the screen.
- Column and Grid, with the choice kept in `localStorage` for this teacher on this computer.
- A file dropped on a row or card, or chosen with the row's button, is shrunk at once (so a refusal such as "Save it as a PDF first" shows beside that file), then waits. A file dropped on another student's row moves.
- A student who already has work shows Add as More Pages, Replace Them, Skip. Work set to Handed In on Paper offers Replace Them or Skip only, as the data layer's `on_paper` answer requires.
- Add Work for N Students runs the students one after another. An answer of `already_sent` (work came in while the page was open) puts that student back with the three choices instead of failing. `class_full` stops the run and says so once. Students already added stay added.
- After adding: who is still Not In, each with On Paper or Leave Not In. Nothing else is set.
- The menu item, and a button in the Work Wall's header that opens the same page for the wall's assessment.

**Files.** `teacher/add-work-class.js`, `teacher/add-work-class.css`, `shared/add-work-files.js` (new); `teacher/page-assignments.js` (the menu item, the action, the moved functions: a few lines each); `shared/work-wall.js` (the button); `teacher/app.html` (two tags); `sw.js` (the file list).

**Tests.** Unit, on the staging model: place, move, take off, each choice, the count on the button, the run's order, each answer from the data layer, a page closed in the middle of a run. One browser spec, `e2e/add-work-class.spec.js`, in Demo Mode: open from the menu, choose a file for two students, add, and the Work Wall shows both. The speed guard for work lookups (`tests/work-lookups-fast.test.js`) covers the page's rows.

**Switch.** The menu item shows where the row's + (Attach Work) shows today. Widening it to every class is decision 2.

**Done when.** In Demo Mode and in Colin's test class, 28 files chosen one per student are added with one button, a student with work gets the three choices, and Unsubmit on one of them leaves the others alone.

### B2. Split the Scan

**Goal.** The teacher drops the photocopier's PDF. It is cut into one piece per student, the teacher types a few letters for each, and the pieces land on the class page ready for Add Work.

**Boards.** Option B: Split the Scan (Beyond the Ask); Surprise: Blank Backs, Upside Down, Set Up Like Last Time (the blank backs and the Turn button only).

**First, measure.** Before any limit is written down: take three real scans from the school copier (one-sided, two-sided, the longest class set) and record pages, megabytes, and how long the split takes on Colin's Mac and on a Chromebook. Decision 1 is made from those numbers.

**Build.**

- `PhotoShrink.prepare` gains `opts.maxPdfBytes`, used the way `opts.maxPages` already is. Only this page passes larger limits. Every other upload keeps 20 pages and 20 MB, and each student's piece keeps the 30-page limit.
- Pages are read one at a time (the loop that exists), with a count as they come. The PDF is never queued or uploaded.
- Pages per Student, with one page fewer or more on any piece. Class List Order, or No Order with a name box on each piece that takes two or three letters and Return. Each piece shows the top of its first page.
- A student named twice is flagged and cannot go on until one is changed. A piece with no name stays behind.
- Blank pages are left out, dimmed and still on screen, with one click to keep one. Found by how little ink the page has (the sharpness figure `PhotoShrink` already works out is the starting point); the threshold is set against the measured scans.
- Turn on any page redraws it upright before it is shrunk. Finding upside-down pages automatically is B5, after a short trial shows it can be trusted.
- Match the Named Pieces hands the pieces to B1's staging model. From there everything is B1.

**Files.** `teacher/add-work-split.js`, `teacher/add-work-class.css`, `shared/photo-shrink.js` (the one option), `teacher/add-work-class.js`.

**Tests.** Unit: the piece maths (pages per student, a moved line, a left-out blank, a kept blank), the name box (unique letters, two students, a student used twice), the larger limit refused everywhere else. Browser: a 12-page sample PDF becomes six pieces in Demo Mode and is added.

**Done when.** One of Colin's real class scans goes from the email to every student's work in under five minutes, and no page is under the wrong student.

### B3. A folder matched by name

**Goal.** A teacher who has already split and named the files drops the folder, and each file finds its student.

**Boards.** Option B: Add Work for the Class, Column, Files Waiting; Option B: Grid (the close-spelling card).

**Build.**

- `shared/name-match.js`, with no HTML and no data calls: a file name and the class list in, one student, several, or none out. First and last name in either order; spaces, dashes, underscores, capitals and accents ignored; a first name alone or a last name alone only when it is the only one in the class; a first name with a last initial.
- A close spelling (one or two letters off) is offered, never taken: "Is this Mateo?" with Yes or Someone Else.
- Two students who fit ("Chen.pdf") get a button each. No fit goes to the Waiting tray.
- Folders through drag and drop and through Choose a Folder. Files that are not photos or PDFs are passed over and counted in one line.

**Files.** `shared/name-match.js`, `teacher/add-work-class.js`, `teacher/add-work-class.css`.

**Tests.** Unit: a table of real-looking file names against a class list with two Chens, a hyphenated name, an accented name and a nickname. Browser: a folder of six files, one unmatched, in Demo Mode.

### B4. Sticker sheets

**Goal.** Each student keeps a sheet of small stickers. One on the first page of each paper, and a scanned pile sorts itself in any order.

**Optional, always.** A teacher who never prints stickers loses nothing: Split the Scan (B2) works without them, by typing names. A pile with stickers on some papers and not others uses the sticker where there is one and the name box where there is not.

**Boards.** Surprise: Sticker Sheets That Sort the Pile; Surprise: Handing Out Stickers, and Where the Assignment Comes From.

**This slice needs a database change**, which the artboard's note did not say. A sticker's code has to be the same on every computer the teacher uses, and a lost sheet has to be replaceable with the old code retired. Two ways:

- **A table of its own (recommended).** `scan_label`: one row per enrolment, a random code, and when it was retired. Two teacher RPCs, each idempotent (CLAUDE.md rule 7): issue the class's codes, and reissue one student's. RLS through `fv_owns_enrollment`. A reprint retires the old code. The SQL goes to Colin before anything is applied (rule 1), tested on embedded Postgres 17 with its undo.
- **The enrolment's own id in the code.** No migration, but a lost sheet cannot be replaced, and it needs a security review that no route treats an enrolment id as proof of who is asking.

**Build, after decision 3.**

- Print: one sheet per student, 80 stickers (Avery 5167 size), from Class Settings beside Print Student Cards, through `vendor/qrcode.js`. A plain-paper version of the same page.
- Read: in Split the Scan, each page is checked for a code; a code starts that student's piece. Chrome's own reader is used where the browser has one. For Safari and Firefox on a computer, either a small reader added to `vendor/` (loaded only on this page, licence checked) or the name boxes from B2: decision 4.
- A sticker names the student only. The assessment is chosen when the scan is dropped.

**Before building.** One sheet printed and scanned on the school copier at its usual setting, to prove a sticker this small reads. The privacy check in decision 5.

### B5. Small touches

Set Up Like Last Time (the teacher's last choices, kept in `localStorage`; no student data). A page dragged from one piece to the next. The answer key set aside as a reference: it needs somewhere to be kept and the Work Wall's Compare to show it, so it gets its own short design before building. The grader opened in the order of the scan. Upside-down pages found automatically, if the trial in B2 shows it can be trusted.

### B6. Two classes in one pile; a late paper

Pieces go to the right class when the same assessment (by name) is in both, which means reading a second class's list and writing to it from one page. A late paper from an earlier assessment gets its own choice on its piece; that choice never sets Late.

### B7. From the phone's mail

On Android the installed app can receive a shared PDF. On an iPhone a web app cannot, so the path is Save to Files, then Choose Files. Checked on a real iPhone before anything is promised.

## Hot files

- **This track's:** `teacher/add-work-class.js`, `teacher/add-work-split.js`, `teacher/add-work-class.css`, `shared/add-work-files.js`, `shared/name-match.js`.
- **Shared and risky, a few lines each, one builder at a time:** `teacher/page-assignments.js`, `shared/work-wall.js`, `shared/photo-shrink.js`, `teacher/app.html`, `sw.js`.
- **Not touched:** `shared/data-student-work.js`, `shared/grader.js`, `shared/calc.js`, the edge functions, and every migration until B4.

## Decisions that are Colin's

1. **The page limit for a class scan** (B2 waits on it). Ruling 18 caps a PDF at 20 pages, and a PDF over 20 MB is refused. A class scan is 50 to 60 pages, 112 when two-sided. Proposed after the measuring step: a larger limit for this page only, with every other upload unchanged.
2. **Whether the page is offered in classes without the student page.** Recommended: yes. Paper is where it helps most.
3. **How a sticker's code is kept** (B4): a table of its own, or the enrolment's id. Recommended: the table.
4. **Reading stickers outside Chrome** (B4): add a small reader to `vendor/`, or fall back to typing names.
5. **The sticker privacy check** (B4): that the code says nothing about the student and cannot sign anyone in. This needs the district privacy officer's view, not mine.
6. **The sticker's design and the cost of label stock**: about 28 sheets per class per term.
7. **Whether a sticker names the student only** (B4). Colin asked on Nov 17 whether it should also say the assignment. Recommended: the student only, so one sheet lasts the term; the assessment is chosen when the scan is dropped.

## Risks

- **A page under the wrong student.** If the work is returned through the student page, another student sees it. Rule 1, the first-page picture on every row, the close-spelling check and the twice-named check exist for this. Each slice's browser test asserts on who got which page.
- **A long scan on a slow computer.** Reading 112 pages takes time and memory. The measuring step sets the limit; pages are read one at a time and the count shows progress.
- **Blank pages.** Faint pencil could read as blank. Left-out pages stay on screen, dimmed, and the threshold is set from real scans.
- **Two sessions.** Work that arrives from a student while the page is open is caught by the `already_sent` answer and turned back into the three choices.
- **`teacher/page-assignments.js` is 17,000 lines and busy.** B1 moves three functions out and adds one menu item. Nothing else there changes.

## Working rules

- Branch from `origin/main` in a worktree of your own. Never switch the main checkout's branch.
- One PR per slice; `test-and-format` passes before merge; run the slice's own test file and its one browser spec locally, then check main's e2e run after merging.
- No grade math changes in any slice. Nothing here deletes data except Replace Them, which already exists and already asks.
- Builders on Opus. B4's migration and its review on Fable at high effort.
