# Student page build plan (2026-11-09)

This plans the build of everything on the "Photo Submissions" artboard (https://claude.ai/artifact/GhXQnhDhoxsdfbvVq8QfjF) and the backend behind it. Nothing here is built yet. It is a plan only: no app code changes with it.

Sources: `CLAUDE.md`, `docs/DECISIONS.md` (to the Nov 8 entry), `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/STUDENT-VOICE-PLAN.md`, `docs/write-path-plan.md`, the artboard's 118 boards and its canvas notes, the kanban (cleanup card cp1), and a read of the code on `main` at `8dd4437f`. Where one of those did not say something, it was put to Colin as a question; his answers of Nov 9 are in section 6 and are written into the plan.

## How to read this

- Section 1 is the design: what is stored, where, and which code owns each rule.
- Section 2 is the work, cut into slices. Each slice ships something a teacher or student can use.
- Section 3 says which slices can run at the same time.
- Section 4 lists every point where work stops for Colin.
- Section 5 lists what could go wrong and the test or rule that stops it.
- Section 6 records Colin's answers to the plan's questions (Nov 9).

Words used here:

- **Slice:** one thin piece of the product, working end to end.
- **Tidying PR:** a pull request that reshapes code and changes no behaviour. The existing tests pass untouched.
- **Feature PR:** a pull request that adds behaviour.
- **Pin:** a test written before a reshape that records what the code does today.
- **Build switch:** a hidden per-class setting, off by default, that keeps unfinished work out of sight on `main`.
- **Returned copy:** what the student was last given for one piece of work.

## Rules every PR follows

1. The project rules in `CLAUDE.md` hold. The ones this build leans on: grade math only in `shared/calc.js`; grades shown only through `formatLevel` and `studentGradeSummary`; text into HTML only through `esc`; every feature works in Demo Mode; sync problems show on the sync dot only; a local id never reaches the database; every new write RPC takes `p_idempotency_key`.
2. Every PR passes `test-and-format` (vitest, the innerHTML audit, the database drift check, Prettier) and the browser tests before it merges. After a merge, check main's browser run.
3. A slice is a tidying PR, then a feature PR. They never mix.
4. Each agent works in its own worktree, cut from `origin/main`. Nobody works in the main checkout: it holds uncommitted work on `grader/comment-beside-checklist`.
5. Unfinished work sits on `main` behind the build switch or a Class Settings switch that is off by default.
6. No release without Colin's word. Merging to `main` deploys nothing.
7. A PR title starts with its id from this plan, for example `S1-T2`.

Two facts about CI shape the whole order of work (`scripts/check-db-drift.mjs`, `.github/workflows/ci.yml`):

- A file in `migrations/` fails CI until it is applied to the live database. So a migration PR cannot merge before Colin's OK.
- Code in `shared/`, `teacher/` or `teacher-mobile/` that names an RPC the live database lacks fails CI. So a PR that calls a new RPC cannot merge before that migration is applied.
- Applying a migration changes the live schema, so every open PR fails the schema snapshot check until `docs/schema.generated.sql` is refreshed on `main`. Apply migrations in batches, at a quiet moment, and merge the snapshot at once.

Migrations are tested locally only (Q18): on the throwaway Postgres harness in `migrations/local-test/`, never on a Supabase branch and never on `gradebook-prod`. Storage policies are tested there against a stand-in `storage.objects` table, and the edge function's handler with a fake database, as `tests/student-submit-handler.test.js` does today. The first real upload and the first real card scan happen on `gradebook-prod` after Colin's OK, in his own test class, with the build switch on for that class only.

Because of these, each feature is built in two steps where it touches the server: the screen first, working in Demo Mode with no RPC call, then a small "wire it up" PR once the batch is applied. Agents are never idle waiting for an approval.

---

## 1. Architecture

### 1.1 What exists today

- **Scores.** One `score` row per student per assessment (`value`, `status`, `comment`, `report_note`, `modifier`). `tag_score` holds a level per competency, `rubric_score` a level per criterion, `rubric_check_score` the Advanced Rubric ticks. No table has a draft or returned state.
- **Score writes.** `upsert_score`, `upsert_tag_score`, `upsert_rubric_score`, `save_score_comment`, `save_score_report_note`, `set_score_status`, `clear_score`, `set_rubric_check`, `move_rubric_scores`, plus `import_json_restore` for backups. The grade-scans skill writes the same RPCs straight through SQL, past the app.
- **Three graders.** `teacher/page-assignments.js` (the Assignments page and the grader dialog), `teacher/page-gradebook.js` (cells, keyboard, menus) and `teacher-mobile/tab-grade.js` (a full second copy). They share the `data.js` writers and a few helpers. There is no shared grader module.
- **Grade math.** `shared/calc.js` reads scores from the `data.js` cache in about 25 places (`getScores` at 11 sites, `getAssignmentStatus` at 12, and others). Results are cached by class and term. No SQL computes a grade.
- **The student page.** `s/index.html` and `s/student.js` open a questionnaire or a phone report from a 6-character slip code. It calls one Supabase Edge Function, `student-submit`, pinned to `ca-central-1`. The function calls `student_submit` schema functions over a direct database connection. The phone holds no key. It does not load `calc.js`.
- **Storage.** None. No bucket, no upload, no image code anywhere.
- **Offline.** The outbox (`shared/offline-queue.js`) keeps JSON in localStorage, capped at 5 MB. It cannot hold a photo.
- **Class switches.** Each is a column on `course`, written through `update_course`, read with `getCourseConfig`, saved with `saveCourseConfig`. `get_class_bundle` returns the whole course row, so a new column needs no bundle change.
- **Content Security Policy.** One policy for every page. A photo fetched from Supabase and shown from a `blob:` address already works. A PDF in a frame does not.

### 1.2 Draft and Returned

**The rule.** Every grade is Draft or Returned. The teacher's working copy stays in the score tables, as now. Beside it, one new row per student per assessment records what was returned.

**New table `grade_return`** (one row per `enrollment_id` + `assessment_id`):

| Column          | Meaning                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `is_draft`      | True when the working copy holds something the student has not been given.                                                                     |
| `returned_at`   | When the grade was last returned. Null means never.                                                                                            |
| `returned_copy` | The grade as last returned (levels, + and −, points, comments, ticks), kept only while a newer draft exists. When nothing is draft it is null. |
| `previous_copy` | The grade the student last saw before the newest return. It feeds "Updated" and "Was Developing".                                              |
| `updated_at`    | When a returned grade was last changed and returned again.                                                                                     |
| `seen_at`       | When the student last opened this piece. It feeds "3 Things Since You Last Looked".                                                            |

**New columns on `course`:** `student_page_enabled` (the build switch, default false) and `return_grades` (`on_return` or `on_save`: "When I Return Them" and "As Soon As I Save"). A new class starts on `on_return`. An existing class starts with no choice made, which works as `on_save`, until its teacher first opens Class Settings › Student Page, where When I Return Them is the choice shown first (Q8).

**How the state is kept.** Database triggers on `score`, `tag_score`, `rubric_score` and `rubric_check_score` keep `grade_return` right. A trigger cannot be forgotten by a new RPC, an old cached client, or the grade-scans skill.

- Build switch off, or Return Grades set to As Soon As I Save: every save is returned at once. Nothing changes for the teacher.
- Build switch on and When I Return Them: a save marks the grade Draft. If the grade was returned before, the trigger first keeps the returned values in `returned_copy`, so the student still has them.
- Missing, Excused and Late are never drafts. They show and count as soon as they are set (Q7).
- Grades written by the grade-scans skill go through the same triggers, so in a When I Return Them class they arrive as drafts for the teacher to check and return (Q9).
- `return_grades(p_assessment_id, p_enrollment_ids, p_idempotency_key)` returns one grade or many (Return, Return and Next, Return N Graded). It clears `returned_copy`, sets `returned_at`, and moves the old copy to `previous_copy`.
- Bulk paths have a named rule each, with a test: a restore keeps the state in the backup (an older backup restores as Returned); changing an assessment's rubric (`move_rubric_scores`) keeps the state; Duplicate Class and Copy Assessment copy no grades and no work.

**Existing scores become Returned** (Nov 8, decision 2). The migration adds one `grade_return` row, not draft, for every student and assessment that has a grade today. No score changes. No number changes.

**One reader for students.** One SQL function, `student_submit._returned_grade(enrollment, assessment)`, is the only way any student-facing function reads a grade. It gives back nothing for a grade never returned, `returned_copy` while a draft exists, and the working copy otherwise. Section 5 lists the tests that hold it.

**The same rule in the browser.** A new file, `shared/grade-state.js`, holds the rule as plain functions: how a save changes the state, and what state a piece of work is in (Not In, To Grade, Draft, Returned, Revising, with Missing, Excused and Late alongside). `data.js` calls it on every score write, so Demo Mode and offline work behave as the server does. One file of worked cases is run through both the JavaScript and the SQL, so the two cannot drift.

**The outbox.** A return is queued under the same key as that cell's score writes (`cell:<student>:<assessment>`), so it is sent after them, in order. It is never merged away with a score write.

**Server checks added while here.** `upsert_rubric_score` will refuse a criterion that is not on the assessment's rubric (today only a client comment claims this). `set_score_status` will refuse Missing on scored work (today a client-only rule). These close the "RPCs reject invalid writes from any screen" promise for the paths this build touches.

### 1.3 One calculation, two sets of scores

`calc.js` stays the only grade math. It gets one new option, not a second calculation.

- **Tidying.** Every place `calc.js` reads scores, statuses, points or completion marks goes through one small reader inside `calc.js`. The cache key gains the score set, so the two sets never share a cached number. No behaviour changes.
- **Feature.** `withReturnedOnly(fn)` runs `fn` with returned scores only, then puts things back, the way `setActiveTerm` already scopes a report to its term. `data.js` builds the returned set from the cache: the working copy where nothing is draft, `returned_copy` where a draft sits on a returned grade, and nothing where a grade was never returned.
- **The invariant.** When no grade is a draft, returned-only and all-work give the same number for every student. A test holds this on the Demo class and the eval fixture.

**Which grades each screen uses.** The artboard's table, with the screens it does not list marked as questions:

| Screen                                                              | Uses          | Source    |
| ------------------------------------------------------------------- | ------------- | --------- |
| Gradebook; both graders; phone student card; phone Grade tab        | All work      | Artboard  |
| Print Grades and Export                                             | All work      | Artboard  |
| Progress Reports                                                    | Returned only | Artboard  |
| Student page: Your Result, Back, My Learning                        | Returned only | Artboard  |
| Preview as Student                                                  | Returned only | Artboard  |
| MyEdBC Input                                                        | Returned only | Artboard  |
| Dashboard, Class Results, the teacher's student page, class backups | All work      | Colin, Q6 |
| Term Questionnaire and Generate; Sent to Phones                     | Returned only | Colin, Q6 |

Every new screen gets a row here before it is built.

### 1.4 One grader

A new file, `shared/grader.js`, becomes the only code that writes a grade from a screen. Desktop and phone keep their own layouts and call the same actions: set a level, + or −, points, Complete or Incomplete, a status, a checklist tick, a criterion comment, the Overall Comment, clear, fill, undo, Return, Return for Revision, Return N Graded. It also owns the rules that go with them (locks, the points limit, the state of a piece, the To Grade and To Return counts), so the gradebook filter, the dashboard cell and the phone tab cannot disagree.

A guard test fails if any file but `shared/grader.js` calls the score writers in `data.js`. It starts with today's counts as caps and the caps go to zero as each screen moves over, the way `tests/grade-format-guard.test.js` works.

### 1.5 Student cards and sessions

- **`student_card`** (public schema, the teacher's own rows): one live card per enrollment. It holds the code's hash and salt, when it was made, printed, last opened, locked and stopped, the wrong-try count, and the date it works until. The identity check is today's: birthday or student number, or `student.slip_password` when neither is on file. Five wrong tries lock it.
- **Teacher RPCs:** issue cards for a class, mark printed, unlock, reissue (stops the old code at once and keeps everything the student sent), and set the Cards Work Until date (default the class's last reporting date).
- **Sessions** (`student_submit` schema, no API access): a session belongs to a device, not to a card. A second table lists the enrollments that session has opened, one per card added. That is what makes Switching Classes work now and lets a passkey or another sign-in attach to the same session later with no rework (Nov 8, decision 13).
- **Questionnaire slips and phone-report slips keep working** as they do today, for one-offs.

The class's teacher can see a card's code again (Q10), so Print All and Show Card Code never stop a card the student holds: the code is stored for the teacher, readable only through `fv_owns_enrollment`, beside the hash the student path checks.

- **A device stays signed in until midnight (Pacific time) or until the student taps Done**, whichever comes first (Q11). A shared Chromebook still signs out on Done.
- **Today Only codes are not built** (Q12); they wait with Family Codes.

### 1.6 Submissions, Mark Up, reflections, revisions

New tables, all owned through `fv_owns_enrollment` or `fv_owns_assessment`:

| Table                 | Holds                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `submission`          | One per student (or group) per assessment per version: when it was sent, who sent it (student or teacher), on paper or not, the student's note, late or not, "Did You Do It?". |
| `submission_file`     | One per page: always a JPEG (a PDF arrives as one JPEG per page), its place in order, storage path, thumbnail path, size, a hash for the exact-duplicate check, rotation.      |
| `markup`              | Drawing data per page: the teacher's working copy and the copy the student was given. The photo itself is never changed.                                                       |
| `revision_request`    | What to Fix, Revise By, which criteria, and whether the grade is kept or hidden until the new version is graded.                                                               |
| `feedback_reflection` | Does the feedback make sense, the question, the plan, what went well, the teacher's answer, and "Does It Make Sense Now?".                                                     |

New columns on `assessment` (the form's Student Work card): Students Send (Nothing, Photos, Photos and Files), After the Due Date (Keep Accepting, Until a date, Stop), Group Work (Each Student, One per Group), Students See Your Mark Up. Keep Photos Until is per class only and is not on the assessment form (Q15). New columns on `course`: Send Work, Keep Photos Until, Reflect on Feedback, Show My Learning, each off or at its decided default.

A revision is version 2 of a submission. When its grade is returned it replaces the old one; version 1 keeps its returned grade as history for Before and After (Nov 8, decision 10).

### 1.7 Storage

- **One private bucket in the project's region (ca-central-1):** `student-photos`, JPEG only, 2 MB limit. The bucket limit is the server's refusal of an oversized photo.
- **PDFs become pages** (Q13, superseding the PDF part of Nov 8 decision 8). The browser reads a PDF up to 20 MB with Mozilla's pdf.js (in `vendor/`, loaded only for this step), turns each page into a shrunk JPEG like a photo, and uploads the pages. The PDF itself is not kept. Every page can then be marked up the same way.
- **HEIC on a Chromebook is converted in the browser** (Q14) by a HEIC decoder in `vendor/`, loaded only when such a file is chosen. It is likely to need the CSP to allow WebAssembly on the pages that upload; that change is shown to Colin in its PR, limited to those pages, and pinned by `tests/csp-directives.test.js`.
- **Layout:** `<course id>/<assessment id>/<enrollment id>/<submission id>/<file id>.jpg`, with the thumbnail beside it. One folder per class.
- **Policies:** a teacher reads, writes and deletes only under a class they own, by the same `fv_owns_course` check as every table. Students have no storage role at all.
- **Students upload** through a one-time upload link the edge function makes for one file in that student's folder. Supabase fixes that link's life at two hours; Colin accepted that (Q4), and the nightly check clears any file never committed.
- **Students view** their own pages through short-lived links the edge function makes. The page fetches the image and shows it from a `blob:` address, so the CSP does not change.
- **Location data.** The browser redraws every photo before upload, which drops GPS and camera details. When a submission is committed, the edge function checks each photo and strips any that remain.
- **Deletes follow the rows.** Unsend, Replace, Keep Photos Until, the 30-day class purge and deleting a withdrawn student all delete the files, not only the rows. A nightly check finds files with no row and rows with no file.
- **No second copy** (Nov 8, decision 6). A deleted photo cannot come back.

### 1.8 Edge function routes

The one function, `student-submit`, keeps its four routes and gains these. Each calls a `student_submit` SQL function, granted to `service_role` only. The anon role stays locked out of every function.

| Route                                 | Does                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `card`                                | Code in; first name, class and which identity check out.                    |
| `verify` (extended)                   | Identity check; starts or extends the device session.                       |
| `page`                                | The student's whole page for one class, rebuilt from the class's records.   |
| `add-card`, `done`                    | Add another class to the session; sign out.                                 |
| `send-start`, `send-finish`           | Make the submission rows and upload links; then check the files and commit. |
| `unsend`, `replace`                   | Before grading starts only.                                                 |
| `file-links`                          | Short-lived links to the student's own pages and thumbnails.                |
| `reflect`, `reply`                    | Reflect on Feedback; "Does It Make Sense Now?".                             |
| `seen`                                | Records what the student has looked at.                                     |
| `passkey-register`, `passkey-sign-in` | Later, in slice S15.                                                        |

`page` returns returned grades only, through the one reader in 1.2.

The card's routes are in `supabase/functions/student-submit/card-routes.ts` (`S0-F4`): `card`, `verify` for a card, `add-card`, `page`, `seen` and `done`. A `verify` that carries a slip's token is a slip's, as before; one that carries a card's code is the card's. A card's `verify` always starts a new session and ends the one the device sent, so a shared Chromebook signs the last student out; only `add-card` joins a session. Which of the two it is (`p_add`) is written into each route's statement and never read from the request (`S0-F4b`). The device's session token travels in the request body as `session`, as a slip's token does: no cookie, no header, never in the address, never in a log. Each route names its one SQL call and copies its reply field by field, so a field the SQL gains by mistake does not reach a phone.

### 1.9 Client modules

| File                                                                                                                                                         | New or changed | What it is                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/grade-state.js`                                                                                                                                      | New            | The Draft and Returned rule and the state of a piece, as plain functions.                                                                                  |
| `shared/grader.js`                                                                                                                                           | New            | The one grader (1.4).                                                                                                                                      |
| `shared/calc.js`                                                                                                                                             | Changed        | One reader for scores; `withReturnedOnly`.                                                                                                                 |
| `shared/data.js`                                                                                                                                             | Changed        | The `gradeReturns` cache field, the returned score set, and writers for cards, submissions, Mark Up, reflections and revisions.                            |
| `shared/photo-shrink.js`                                                                                                                                     | New            | File type check, shrink to about 2000 px JPEG, thumbnail, exact-match hash, the blurry check, PDF pages to JPEGs, HEIC to JPEG. Used on every upload path. |
| `shared/photo-queue.js`                                                                                                                                      | New            | Photos waiting to send, in IndexedDB. Used by the student page and both teacher apps.                                                                      |
| `shared/student-view.js`                                                                                                                                     | New            | Builds what one student sees, from returned grades only. Used by the student page and by Preview as Student, so the two are the same by design.            |
| `s/student-data.js`                                                                                                                                          | New            | Gives `calc.js` the few readers it needs from the student's own page data, the way the tests already swap those readers.                                   |
| `s/app.js`, `s/assignments.js`, `s/send.js`, `s/feedback.js`, `s/reflect.js`, `s/learning.js`                                                                | New            | The student page's screens.                                                                                                                                |
| `s/questionnaire.js`, `s/report.js`                                                                                                                          | Split out      | Today's questionnaire and phone-report screens, moved out of `s/student.js` unchanged.                                                                     |
| `teacher/cm-student-page.js`, `teacher/student-cards.js`, `teacher/preview-student.js`, `teacher/markup.js`, `teacher/work-wall.js`, `teacher/myed-input.js` | New            | Teacher screens.                                                                                                                                           |
| `teacher-mobile/grade-photos.js`, `teacher-mobile/add-work.js`                                                                                               | New            | Phone photo strip, Mark Up host and camera capture.                                                                                                        |

`s/` starts loading `shared/constants.js` and `shared/calc.js`. It still loads no Supabase client, no key and no Sentry.

**Offline photos.** A photo waits in IndexedDB under a local id. The submission record goes through the outbox and comes back with server ids; only then does the photo upload, to a path built from those ids. A teacher sees a problem on the sync dot only. A student sees Not Sent Yet. Sign Out wipes the photo store, as it wipes `fv-report-issues` today.

### 1.10 Demo Mode, piece by piece

| Piece                                        | In Demo Mode                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Draft and Returned                           | The same rule runs in `shared/grade-state.js`, kept in localStorage. No RPC.                                                                           |
| Student cards                                | Cards are made on the device with random codes. Print works.                                                                                           |
| The student page                             | Opens from Preview as Student, and from a demo address on `/s/` as today's `#demo` does. It never calls the edge function.                             |
| Sample work                                  | Drawn sample pages ship with the app, on a new Science 8 assessment, Cell Microscope Lab: 2 to grade, 1 to return, the rest returned (the Demo board). |
| Sending and adding work                      | Photos are shrunk and kept in IndexedDB on the device. Nothing uploads.                                                                                |
| Mark Up, reflections, revisions, My Learning | Saved on the device like any Demo Mode change.                                                                                                         |
| Passkeys                                     | A stand-in that walks the same screens without saving a key.                                                                                           |
| MyEdBC Input                                 | Works on the Demo class.                                                                                                                               |

`tests/demo-mode-no-server-calls.test.js` is extended to cover each new module, `s/` included.

---

## 2. Slices, in order

Order is by value to teachers. PR ids: P pins behaviour, T tidies, F adds a feature, M is a migration, W wires a finished screen to the server.

### S0. Walking skeleton

**Goal.** A teacher grades one piece (Draft), returns it (Returned), and the student scans their card and sees that one grade. It proves the Draft and Returned line end to end, server included.

**Boards.** Plan: How a Grade Moves (the Draft and Returned tiles only); Student: Scan or Type Your Card; Student: Is This You?

**PRs.**

- `S0-P1` Pin the save paths. Tests only: the untested paths found in the code read (`moveRubricScores` on the client, `_carryOverallToCompetencies`, Class Results' Mark Missing, the phone's Overall Comment), and the first SQL tests of the score RPCs on the throwaway Postgres harness in `migrations/local-test/`.
- `S0-P2` Pin the math. Tests only: a golden file of every student's overall, letter, percent and each competency level for the Demo class and the eval fixture.
- `S0-T1` `calc.js`: one reader for scores; the score set in the cache key. No behaviour change.
- `S0-T2` Add `shared/grade-state.js` and `shared/grader.js` as pass-throughs; move the grader dialog's writes in `page-assignments.js` onto them; add the guard test with caps.
- `S0-T3` Split `s/student.js` into a shell plus `s/questionnaire.js` and `s/report.js`. No behaviour change.
- `S0-M1` (Batch A) `grade_return`, the two course columns, the triggers, the backfill, `return_grades`, the two server checks.
- `S0-M2` (Batch A) `student_card` and its teacher RPCs.
- `S0-M3` (Batch A) Sessions and the `card`, `verify` and `page` SQL functions.
- `S0-F1` `withReturnedOnly` in `calc.js`, with the invariant test. Colin reviews it as math-adjacent (section 4).
- `S0-F2` Desktop grader: "Draft Saved. Not returned yet." and Return, behind the build switch, in Demo Mode.
- `S0-F3` Student page: card, identity check, and a plain Assignments list that shows the returned result, in Demo Mode.
- `S0-F4` Edge function routes `card`, `verify`, `page`, with handler tests.
- `S0-W1` Wire F2 and F3 to the server once Batch A is applied; a bare Student Cards list with Print so a real card exists.

**Files.** `shared/calc.js`, `shared/data.js`, `shared/grade-state.js`, `shared/grader.js`, `teacher/page-assignments.js`, `s/*`, `supabase/functions/student-submit/*`, `migrations/`, `schema.sql`, `docs/schema.generated.sql`, `tests/`, `e2e/`, the script lists (`teacher/app.html`, `teacher-mobile/index.html`, `s/index.html`, `sw.js`, `tests/setup.js`, `tests/setup-mobile.js`), `docs/ARCHITECTURE.md`.

**Tests.** Unit: the grade-state cases (shared with SQL), the invariant, the guard, the handler. SQL: a draft never comes back from `page`; anon and other teachers get nothing; existing scores read as Returned after the backfill. Browser: grade, see Draft, open the student view (nothing), Return, see the result.

**Demo Mode.** The whole loop runs on the device.

**Switch.** `course.student_page_enabled`, off. With it off, every screen and every number is as today.

**Done when.** In the local harness and then in Colin's own test class, a real card opens a real page that shows a returned grade and never a draft; with the switch off, the golden file and every existing test pass unchanged.

### S1. Draft and Returned on every grading screen

**Goal.** Wherever a teacher grades, a grade is a draft until returned, it is marked, and returning is one tap.

**Boards.** Plan: How a Grade Moves; Plan: Which Grades Each Screen Uses; Plan: Grader Parts, Desktop and Phone; Teacher: Gradebook With Submissions (Draft cells, the key, Return 3 Graded); Phone: Grade Tab, To Return; Phone: Student Card With a Draft to Return; Teacher: Class Settings, Student Page (the Return Grades row); Student: A Returned Grade Was Updated.

**PRs.**

- `S1-T1` Gradebook and Class Results writes move onto `shared/grader.js`.
- `S1-T2` Phone Grade tab writes move onto `shared/grader.js`; its undo stops saving the whole score list (a cp1 item).
- `S1-T3` Assignments page (list, rubric grid, ledgers, fills, Set Everyone To) moves onto `shared/grader.js`. Guard caps reach zero.
- `S1-T4` Class Settings: add an empty, hidden Student Page tab to `CM_TABS` (new file `teacher/cm-student-page.js`).
- `S1-F1` Gradebook: dashed Draft cells, the key, the column's Return N Graded, the "N to return" filter.
- `S1-F2` Desktop grader and Assignments page: the To Return and Returned counts, Return N Graded, Draft beside Return.
- `S1-F3` Phone: Return and Next, the To Return tab with Return N, the student card's To Return list.
- `S1-F4` Class Settings › Student Page: Return Grades (When I Return Them, As Soon As I Save), with the line about changed grades.
- `S1-F5` A change to a returned grade: it waits as a draft under When I Return Them and shows at once under As Soon As I Save; the student page marks it Updated. While it waits, the student and reports keep the grade returned, and the teacher sees the Draft mark, "Draft Saved. Not returned yet." and one line, "Jordan still sees the grade you returned Nov 3." (Q2).

**Files.** `shared/grader.js`, `teacher/page-gradebook.js`, `teacher/class-results.js`, `teacher/page-assignments.js`, `teacher-mobile/tab-grade.js`, `teacher-mobile/card-widgets.js`, `teacher/dash-class-manager.js`, `teacher/cm-student-page.js`, the CSS beside each.

**Migrations.** None beyond Batch A.

**Tests.** Unit: counts agree across gradebook, grader and phone for the same class; fills and undo keep the state right; group grades return together. Browser: the Draft cell, Return N Graded, phone Return and Next, the setting.

**Demo Mode.** Full.

**Switch.** The build switch. Return Grades shows only when it is on.

**Done when.** Every row of the Grader Parts board reads "Same" in the app; the guard test's caps are zero; with the switch off nothing has changed.

### S2. Reports, printing and exports with drafts

**Goal.** A family never sees a draft, and the teacher is asked, not surprised.

**Boards.** Teacher: Printing Reports With Drafts; Plan: Which Grades Each Screen Uses (Progress Reports, Print Grades and Export).

**PRs.**

- `S2-T1` Report surfaces read grades through one entry in `teacher/page-reports.js` so the score set is chosen in one place.
- `S2-F1` Progress Reports use returned grades only. Print Reports with drafts names them and offers Return Them, Then Print; Print Without Them; Cancel.
- `S2-F2` The Term Questionnaire's facts, Generate and Sent to Phones use returned grades only (Q6).

**Files.** `teacher/page-reports.js`, `teacher/report-blocks.js`, `teacher/report-studio.js`, `teacher/report-questionnaire.js`, `teacher/comment-bank.js`, `teacher/phone-reports.js`, `teacher/grades-print.js` and `teacher/export-all.js` (to confirm they stay on all work).

**Tests.** Unit: a class with one draft prints the returned number on a report and the all-work number on the grade sheet. Browser: the dialog and each of its three buttons.

**Demo Mode.** Full. **Switch.** The build switch.

**Done when.** With a draft in the class, no report surface shows it without the teacher choosing to return it.

### S3. Student cards and sign-in

**Goal.** A teacher prints one card per student for the course, and a student gets in with it on a phone or a Chromebook.

**Boards.** Teacher: Student Cards (Print, Unlock, Reissue); Teacher: Reissue a Lost Card; Student: Scan or Type Your Card; Student: Is This You? Birthday or Student Number; Student: Is This You? Card Password; Student: After Done; Student: Switching Classes; Student: Signing In on a Chromebook; Class Settings, Student Page (the Student Cards row).

**PRs.**

- `S3-T1` `teacher/qr-slips.js`: lift the eight-to-a-page print sheet into a helper both slips and cards use.
- `S3-F1` Student Cards page: the list with its filters (All, Not Printed, Locked, Never Opened), Print All, Print N New Cards, the print preview, Cards Work Until.
- `S3-F2` Unlock, and Reissue with its dialog (Reissue, Show Code; Reissue and Print).
- `S3-F3` Student sign-in screens, phone and Chromebook, the locks, Done, and Switching Classes with Add Another Card.
- `S3-W1` Wire to Batch A.

**Files.** `teacher/student-cards.js` (new), `teacher/qr-slips.js`, `teacher/cm-student-page.js`, `shared/data.js`, `s/app.js`, `s/student.css`, the edge function.

**Tests.** SQL: a reissued code stops at once and the student's work stays; five wrong tries lock; a card past its date is refused; one session can hold two classes; rate limits. Unit: the print sheet. Browser: print preview, reissue, sign-in on phone and Chromebook sizes.

**Demo Mode.** Cards on the device; the demo student page opens from them. **Switch.** The build switch.

**Done when.** Colin prints cards for his test class, signs in as two students in two classes on one phone, and a reissued card's old code no longer opens.

### S4. The student page: assignments, feedback, Questionnaires, Reports, Preview as Student

**Goal.** A student sees what is due and what came back, with the teacher's feedback in the class's grading style. A teacher can see exactly that page first.

**Boards.** Student: To Do Card; All Assignments; Returned Work; Your Feedback (Rubric, Advanced Rubric, Single-Point, Points); The Whole Rubric; All Caught Up; What Changed Since You Last Looked; Questionnaires Tab; My Reports Tab; Your Feedback on a Chromebook; Questions on a Chromebook; Reports on a Chromebook; Teacher: Preview as Student.

**PRs.**

- `S4-T1` `shared/student-view.js`: build one student's page from the cache, returned only. Nothing uses it yet.
- `S4-F1` Student page shell: the four tabs (Assignments, My Learning, Questionnaires, Reports), the To Do, Sent and Back counts, phone and Chromebook layouts.
- `S4-F2` Assignment cards and All Assignments with search and filters.
- `S4-F3` Your Feedback for each scoring type, What the Levels Mean, The Whole Rubric.
- `S4-F4` Questionnaires and Reports tabs: today's questionnaires and phone reports, opened from the card's session.
- `S4-F5` What Changed Since You Last Looked.
- `S4-F6` Preview as Student, with the Phone and Chromebook toggle and the Jordan Sees and Jordan Doesn't See lists.
- `S4-W1` Wire to the server.

**Files.** `shared/student-view.js`, `s/*`, `teacher/preview-student.js` (new), `teacher/cm-student-page.js`, `shared/phone-report-view.js`, the edge function's `page` and `seen`.

**Migrations.** Batch A covers it (`seen_at` is on `grade_return`).

**Tests.** Unit: the page built by `student-view.js` from a fixture equals the page built from the server's `page` output for the same fixture; `calc.js` loads and runs on `s/` with only `s/student-data.js`; every level, letter and percent on the page comes through `calc.js` (the format guard gains `s/`). Browser: each feedback board in Proficiency, Letter and Both classes; Preview as Student.

**Demo Mode.** Full, through Preview and the demo address. **Switch.** The build switch.

**Done when.** Preview as Student and the real page show the same thing for the same student, and a draft appears on neither.

### S5. Sending work: photos, and PDFs as pages

**Goal.** A student sends photos or a PDF for an assessment the teacher set to take work.

**Boards.** Teacher: Student Work Settings on an Assessment; Class Settings, Student Page (Send Work, Keep Photos Until); Student: Camera; Check and Send; Sent; Not Sent Yet; One Page Didn't Send; Blurry Photo, Retake; Sending Late; Closed Assignment; Sent, Being Graded; Unsend or Replace; Page on a Chromebook, Sending a File.

**PRs.**

- `S5-T1` `shared/photo-shrink.js` and `shared/photo-queue.js`, with tests, used by nothing yet.
- `S5-M1` (Batch B) `submission`, `submission_file`, the assessment and course columns, the teacher RPCs and the student functions.
- `S5-M2` (Batch B) The two buckets and their policies.
- `S5-F1` Assessment form: the Student Work card, without Keep Photos Until. Class Settings: Send Work and Keep Photos Until.
- `S5-F2` Student: camera and file choice, Check and Send with the note, Sent, Sending Late, Closed.
- `S5-F3` Student: Not Sent Yet, One Page Didn't Send, the blurry check, Unsend and Replace.
- `S5-F4` Edge routes `send-start`, `send-finish`, `unsend`, `replace`, `file-links`, with the server's location check.
- `S5-F5` Demo Mode sample work: the drawn pages and the Cell Microscope Lab assessment (the Demo board). The Science 8 class moves from `constants.js` into `seed-data.js` here (a cp1 item).
- `S5-W1` Wire to Batch B.

**Files.** `shared/photo-shrink.js`, `shared/photo-queue.js`, `shared/data.js`, `shared/seed-data.js`, `shared/constants.js`, `shared/supabase.js` (sign-out wipe), `teacher/page-assignments.js` (the form), `teacher/cm-student-page.js`, `s/send.js`, the edge function, `assets/` (sample pages), `privacy.html`.

**Tests.** Unit: a 12-megapixel photo comes out near 2000 px and under the size limit with no location data; a Word file is refused with "Save it as a PDF first"; a two-page PDF becomes two JPEG pages; a HEIC file becomes a JPEG; the queue survives a reload and sends in order; Sign Out empties it. SQL and storage, in the local harness: a teacher cannot read another teacher's folder; a student link writes one file in one folder; a photo over 2 MB is refused; Unsend deletes the files; Unsend is refused once grading has started. Browser: send on phone and Chromebook, offline then online, a failed page.

**Demo Mode.** Photos stay on the device. **Switch.** The build switch, then Send Work (off), then Students Send on the assessment (Nothing).

**Done when.** In Colin's test class, a student sends two photos from a phone and a PDF from a Chromebook, offline included, and Unsend leaves no file behind.

### S6. Desktop: grading a submission

**Goal.** The teacher sees what came in and grades it with the work beside the rubric.

**Boards.** Teacher: Grader With a Photo Submission; Grader With Nothing In; Grader, Focus on Work; Focus Panel (Advanced Rubric, Single-Point Rubric, Points, Complete or Incomplete); Assignments Page With Submissions; Gradebook With Submissions (To Grade cells, the camera mark, the hover card); Dashboard, To Grade Cell.

**PRs.**

- `S6-T1` Grader dialog: lift the student header and the scoring panel into parts that can sit beside a work pane. No behaviour change.
- `S6-F1` The work pane: pages, Whole Page and Fit Width, the student's note, Focus on Work and its panels for each scoring type.
- `S6-F2` Nothing In: Add Work (Choose Files, shrunk the same way), Grade From Paper, Set To.
- `S6-F3` The To Grade, To Return, Returned, Not In and All filters and counts; the exact-match "Same photo as" note.
- `S6-F4` Assignments page with submissions; gradebook To Grade cells, camera mark and hover card.
- `S6-F5` Dashboard To Grade cell, in every state on its board.
- `S6-W1` Wire to Batch B.

**Files.** `teacher/page-assignments.js`, `teacher/assignments.css`, `teacher/page-gradebook.js`, `teacher/page-dashboard.js`, `teacher/dash-overview.js`, `shared/grader.js`, `shared/photo-queue.js`.

**Tests.** Unit: the dashboard cell, the gradebook filter and the grader counts give the same numbers; a group counts once. Browser: grade from photos, add work for a student, grade from paper, each Focus panel.

**Demo Mode.** On the sample work. **Switch.** The build switch and Send Work. With Send Work off there is no To Grade cell and the dashboard is as today.

**Done when.** The counts on the artboard's worked example hold in a test built from it (7 to grade, 3 to return, 14 returned, 4 not in, then 6, 3, 15, 4 after one return).

### S7. Phone: grading and adding work

**Goal.** The teacher grades submissions and photographs a paper pile from the phone.

**Boards.** Teacher: Grade Tab, To Grade First; Row Menu; All Caught Up; Filter That Applies As You Tap; Phone Speed Grader With Photos; Speed Grader Scrolled, Photo Pinned; Phone Grader, Advanced Rubric; Add Work for a Student; Add Work, Then the Next Student Not In; Adding Work for a Student Who Already Sent Some; Student Card With To Grade; View Profile, To Grade First; Grader on One Student's Work; Add Work, Then Grade It.

**PRs.**

- `S7-T1` Phone Grade tab: split the list from the grader inside `tab-grade.js`, and lift the photo strip host into `teacher-mobile/grade-photos.js`.
- `S7-F1` Grade tab: To Grade by default, the row menu, All Caught Up, the new filter.
- `S7-F2` Speed grader with photos, the pinned photo, the Advanced Rubric layout.
- `S7-F3` Add Work: camera, Save and Next, the already-sent choice (Add as More Pages, Replace Them, Skip).
- `S7-F4` Student card To Grade widget (a new card widget, on by default), View Profile's list, the grader on one student's work.
- `S7-W1` Wire to Batch B.

**Files.** `teacher-mobile/tab-grade.js`, `teacher-mobile/grade-photos.js`, `teacher-mobile/add-work.js`, `teacher-mobile/card-widgets.js`, `teacher-mobile/card-stack.js`, `teacher-mobile/student-detail.js`, `teacher-mobile/shell.js`.

**Tests.** Unit: photos added offline wait and send; an assessment made offline is re-keyed before its photos send (kanban f2, fixed here). Browser at the phone size: each board.

**Demo Mode.** Full. **Switch.** As S6.

**Done when.** A pile of four papers is photographed and graded on a phone in airplane mode and arrives whole when it reconnects.

### S8. Photo lifecycle

**Goal.** Photos leave when they should, and nothing is left behind. This slice must merge before any release that lets a real class turn Send Work on.

**Boards.** None drawn. From the canvas note "Not drawn, still needed" and the Behind the Boards plan. The reminder and the warnings are drafted on the artboard by the slice's agent and approved by Colin before they are built (Q22).

**PRs.**

- `S8-M1` (Batch D) Deletes that follow the rows: the 30-day class purge and `delete_withdrawn_student` remove the files too; the Keep Photos Until job and its one-week reminder; the nightly check for strays.
- `S8-F1` The reminder and the plain "photos go for good" lines on Keep Photos Until, Unsend, Delete Class and Delete Student.
- `S8-F2` Class backup and Download All My Data leave photos out and say so: "Photos of student work are not in this file." (Q22). Sentry never receives an image (a test on `shared/sentry-init.js`).

**Files.** `migrations/`, `teacher/dash-class-manager.js`, `teacher/cm-student-page.js`, `shared/backup-restore.js`, `teacher/export-all.js`, `shared/sentry-init.js`, `privacy.html`.

**Tests.** In the local harness: purge a class and count zero files; delete a student and count zero files; run the date job past the date; plant a stray file and a row with no file and see both reported. Grades, comments and Mark Up survive each.

**Demo Mode.** The reminder and warnings show; nothing is stored to delete. **Switch.** Send Work.

**Done when.** Every way a row can go takes its files with it, proven in the local harness and checked once in Colin's test class. Deletes data: Colin's review.

### S9. Mark Up

**Goal.** The teacher writes on the work; the student sees it when the work is returned.

**Boards.** Teacher: Mark Up; Phone: Mark Up a Photo; Student: Returned Photo With Marks; the Mark Up rows on Preview as Student and Your Feedback ("3 notes on your work").

**PRs.**

- `S9-T1` The work pane exposes a page surface a drawing layer can sit on.
- `S9-M1` (Batch C) `markup` and `save_markup`; Return copies the working marks to the student's copy.
- `S9-F1` Desktop Mark Up: Pen, Highlight, Note, Tick, Cross, Eraser, Notes on This Page.
- `S9-F2` Phone Mark Up: one finger draws, two fingers move.
- `S9-F3` Student: See Your Work with Show Marks. Marks follow Students See Your Mark Up.
- `S9-W1` Wire.

**Files.** `teacher/markup.js`, `teacher/page-assignments.js`, `teacher-mobile/grade-photos.js`, `s/feedback.js`.

**Tests.** Unit: marks are data over the photo and the stored file's hash never changes; an erased mark is gone before return; a draft's marks never reach `page`. Browser: draw, erase, return, see it as the student.

**Demo Mode.** Full. **Switch.** Send Work.

**Done when.** A mark made and erased before Return is never sent to the student, checked at the server.

### S10. Reflect on Feedback

**Goal.** After work comes back, a student says if the feedback made sense, asks a question and makes a plan. The teacher answers in the grader.

**Boards.** Student: Reflect on Feedback; Reflect, Not Sure; Reflection Sent; Your Teacher Answered; Next Assignment, With Your Plan; Check and Send, Did You Follow Your Plan?; Reflect on Feedback on a Chromebook; Teacher: Grader, Returned Work With a Reflection; Student Page, Learner Profile With Reflections; Dashboard, Questions From Students; the reflection rows on Assignments Page With Submissions and the gradebook's Question Waiting mark.

**PRs.**

- `S10-T1` Learner Profile: lift its section list so a Reflections on Feedback section can be added.
- `S10-M1` (Batch C) `feedback_reflection`, the course switch, the student `reflect` and `reply` functions, the teacher's answer RPC.
- `S10-F1` Student: the three steps, Not Sure with Ask, Sent, Your Teacher Answered.
- `S10-F2` The plan on the next assignment and "Did You Do It?" (Yes, Partly, Not This Time), shown as the student's word ("Jordan says…").
- `S10-F3` Teacher: the reflection in the grader with Send Answer; Save as Observation.
- `S10-F4` Learner Profile's Working On, Reflecting So Far and Reflections on Feedback; the dashboard's Questions From Students; the gradebook and profile marks. Answering clears all three.
- `S10-W1` Wire.

**Files.** `s/reflect.js`, `s/assignments.js`, `s/send.js`, `teacher/page-assignments.js`, `teacher/learner-profile.js`, `teacher/student-voice.js`, `teacher/page-dashboard.js`, `teacher/page-gradebook.js`, `teacher/cm-student-page.js`.

**Tests.** SQL: a reflection is accepted only on returned work, only from its own student; "Only Mr. Brown sees this" answers never appear in any student or family output. Unit: the plan lands on the next assignment in that class. Browser: the whole loop, both sizes.

**Demo Mode.** Full. **Switch.** Reflect on Feedback (off).

**Done when.** A question asked on the student page shows in three teacher places and one answer clears all three.

### S11. Revisions

**Goal.** The teacher returns work for another try; the new version's grade replaces the old when returned.

**Boards.** Teacher: Return for Revision; Grading a Revision, Both Versions; Phone: Return for Revision; Student: Needs Revision; Before and After a Revision; Before and After on a Chromebook; the Revising tile on How a Grade Moves; the Revising cell and "1 Revised" on the gradebook and dashboard boards.

**PRs.**

- `S11-T1` The grader's Return area becomes one part both layouts fill.
- `S11-M1` (Batch C) `revision_request`, submission versions, `return_for_revision`.
- `S11-F1` The Return for Revision sheet, desktop and phone: What to Fix, Revise By, which criteria, keep or hide the grade.
- `S11-F2` Student: Needs Revision, Send My Revision, Before and After.
- `S11-F3` Grading both versions, with "Was Developing + on the Oct 30 version".
- `S11-W1` Wire.

**Files.** `shared/grader.js`, `shared/grade-state.js`, `shared/calc.js` (a hidden grade is a draft, Q5, so likely no change), `teacher/page-assignments.js`, `teacher-mobile/tab-grade.js`, `s/assignments.js`, `s/feedback.js`.

**Tests.** Unit: the old grade counts until the new one is returned, then only the new one counts, in all-work and returned-only; version 1 and its grade are still readable. Browser: the loop on both sizes.

**Demo Mode.** Full. **Switch.** Send Work.

**Done when.** The board's worked example holds: 2.7 · 67% before, 3.0 · 75% after, and both show on Before and After. This changes what counts in the grade math: Colin's review in the PR (Nov 8, decision 10).

### S12. Group work

**Goal.** One group sends once and is graded once; one member can be changed.

**Boards.** Teacher: Grading Group Work; Student: Group Work; the group rows on the dashboard board ("4 Groups").

**PRs.** `S12-T1` the submission reader takes a group. `S12-M1` (Batch C) group submissions. `S12-F1` student group card with Add a Page. `S12-F2` grader: one work pane for the group, Students in This Group, Change One Student. `S12-W1` wire.

**Files.** `teacher/assign-collab.js`, `teacher/page-assignments.js`, `shared/data.js` (`_groupWrite`), `s/assignments.js`, `s/send.js`.

**Tests.** A group counts once in every count; a member graded separately returns on their own; a missing or excused member is left out, as today.

**Demo Mode.** Full. **Switch.** Send Work.

**Done when.** The board's example holds: To Grade 4 means four groups.

### S13. My Learning

**Goal.** A class that turns it on shows each student their own skills and grade, from returned work only.

**Boards.** Student: My Learning (Proficiency Class); One Skill; My Learning (Letter Grade Class); Falling Grade, 3 Missing; Skills Across Two Courses; Nothing Marked Yet; One Skill, First Piece; One Skill, Top Step; Points-Only Class; Letter and Skills; My Learning on a Chromebook; Class Settings, Student Page (Show My Learning, See What They'd See).

**PRs.** `S13-T1` `student-view.js` gains a learning section built from existing `calc.js` functions. `S13-F1` the switch and See What They'd See. `S13-F2` the My Learning screens for each grading style. `S13-F3` One Skill with How It's Going and Your Work.

**Files.** `shared/student-view.js`, `shared/calc.js` (only for what does not exist yet: "Up from Developing a month ago": returned work dated on or before 30 days ago, Q16), `s/learning.js`, `teacher/cm-student-page.js`, `teacher/comment-bank.js` and `shared/bank-comment.js` (read only, for Next Step).

**Migrations.** The `show_my_learning` column (Batch C).

**Tests.** Unit: no class average or other student's data is in the page data; a draft changes nothing on My Learning; Next Step text is the comment bank's and I Can text the curriculum bank's, word for word; each grading style matches its board. Browser: each board.

**Demo Mode.** Full. **Switch.** Show My Learning (off).

**Done when.** With the switch off the tab shows nothing of a grade; with it on, every number equals what the teacher's returned-only view gives. Any new function in `calc.js`: Colin's review.

### S14. Seeing everyone's work

**Goal.** One assessment's work side by side, and one student's work in one place.

**Boards.** Teacher: Work Wall for One Assessment; Teacher: Student Page, Work Tab.

**PRs.** `S14-T1` thumbnails load through one helper. `S14-F1` Work Wall. `S14-F2` the Work tab. Evidence Picks are not built until drawn (Q19).

**Files.** `teacher/work-wall.js`, `teacher/page-student.js`, `teacher-mobile/tab-grade.js` (the row menu's Work Wall).

**Tests.** Thumbnails only until a page is opened; sorting and the level filters.

**Demo Mode.** Sample work. **Switch.** Send Work.

**Done when.** The wall for a class of 28 loads thumbnails only.

### S15. Passkeys

**Goal.** "Cards enrol, passkeys return." After the first card scan, a student can come back with Face ID, a fingerprint or the phone's PIN.

**Boards.** None drawn. From the Behind the Boards row. The slice's agent drafts the screens on the artboard for Colin's approval first (Q22).

**PRs.** `S15-M1` (Batch E) a keys table and the SQL behind two routes. `S15-F1` the offer after the first card check, and coming back with it. `S15-F2` a shared Chromebook signs in from the student's own phone. `S15-F3` the teacher removes a device's key.

**Files.** `s/app.js`, the edge function, `teacher/student-cards.js`, `privacy.html`.

**Tests.** A student with no passkey loses nothing; cards, the identity check and slips still work; no face or fingerprint data reaches the server; a removed key stops working.

**Demo Mode.** A stand-in walks the screens. **Switch.** The build switch.

**Done when.** Every S3 test still passes with passkeys on. It needs no Microsoft or Google sign-in.

### S16. MyEdBC Input and the Export Sheet

**Goal.** Marks and comments laid out the way MyEd wants them, from returned grades only.

**Boards.** MyEdBC Plugin: Reports › MyEdBC Input (FullVision); MyEdBC Plugin: Export Sheet in MyEd Order (FullVision).

**PRs.** `S16-T1` Reports gains a third tab host. `S16-M1` (Batch F) what Mark Ready and Save need to keep. `S16-F1` the MyEdBC Input table with the 500-character limit, Generate, Mark Ready. `S16-F2` the Export Sheet with Download CSV, Print and Copy. `S16-F3` it asks before using a class with drafts, as Progress Reports does.

**Files.** `teacher/page-reports.js`, `teacher/myed-input.js`, `teacher/report-questionnaire.js`, `shared/calc.js` (read only: `levelCode`).

**Tests.** The MyEd code for a level is what `calc.js` gives (2.6 rounds to PRF, the board's note); rows are in MyEd's order; a draft is never exported unasked.

**Demo Mode.** Full. **Switch.** A hidden Reports tab until it is done. It follows `docs/plans/myed-integration.md`.

**Done when.** The export for a test class matches MyEd's row order by hand.

### S17. The MyEd extension: not in this build

Colin, Nov 9 (Q25): not now. MyEdBC Input and the Export Sheet (S16) still ship. The three extension boards stay on the artboard for later.

### S18. Term Questionnaire: In Their Words

**Goal.** A student's own words can be added to a comment or a report, quoted exactly.

**Boards.** Teacher: Term Questionnaire, In Their Words; Teacher: Term Questionnaire, Sentence Options Menus; Teacher: Reports With Student Page Work.

**PRs.** `S18-T1` the Add Here menu takes a sentence from a new source. `S18-F1` the "her words" Next Step sentence and its Options menu. `S18-F2` the From the Student Page report blocks (In Their Words, Their Goal).

**Files.** `teacher/report-questionnaire.js`, `teacher/comment-bank.js`, `shared/comment-bank.js`, `teacher/report-blocks.js`.

**Tests.** The answer is quoted exactly; a "To you only" answer is never offered; Generate never adds it by itself; words only, never a photo.

**Demo Mode.** Full. **Switch.** None needed: it is offered, never automatic. The questionnaire part can start any time; quoting a plan waits for S10.

**Done when.** The board's example comment is reproduced in Demo Mode.

### S19. Handoff review

The rest of cleanup card cp1, after the build: what is still in `data.js` and the big page files, the write-path plan's Phase 6, dead code, and the docs. Not a phase of this build.

### Where the cleanup card's items land

| cp1 or kanban item                                    | Slice                |
| ----------------------------------------------------- | -------------------- |
| One shared grader                                     | S0-T2, S1-T1 to T3   |
| `calc.js` returned-only                               | S0-T1, S0-F1         |
| The outbox for photos                                 | S5-T1                |
| Save one mark at a time (the phone's whole-list undo) | S1-T2                |
| Tests for who can see what                            | S0, S3, S5 SQL tests |
| An assessment made offline is never re-keyed (f2)     | S7                   |
| The outbox has no cross-tab lock (s14)                | S5-T1, for photos    |
| The Science 8 demo class out of `constants.js` (t6)   | S5-F5                |
| Everything else                                       | S19                  |

---

## 3. Parallel-work map

### Tracks

| Track             | Owns these files                                                                | Slices, in order                                          |
| ----------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A. Server         | `migrations/`, `supabase/functions/`, `schema.sql`, `migrations/local-test/`    | Batch A, B, C, D, E, F                                    |
| B. Math           | `shared/calc.js`, its tests                                                     | S0-P2, S0-T1, S0-F1, then S13 and S11 if needed           |
| C. Desktop grader | `teacher/page-assignments.js`, `teacher/assignments.css`                        | S0-T2, S0-F2, S1-T3, S1-F2, S6, S9, S10-F3, S11, S12      |
| D. Gradebook      | `teacher/page-gradebook.js`, `teacher/class-results.js`                         | S1-T1, S1-F1, S6-F4, S10-F4                               |
| E. Phone          | `teacher-mobile/*`                                                              | S1-T2, S1-F3, S7, S9-F2, S11-F1                           |
| F. Student page   | `s/*`, `shared/student-view.js`, `shared/phone-report-view.js`                  | S0-T3, S0-F3, S3-F3, S4, S5, S9-F3, S10, S11-F2, S12, S13 |
| G. Uploads        | `shared/photo-shrink.js`, `shared/photo-queue.js`                               | S5-T1                                                     |
| H. Class Settings | `teacher/cm-student-page.js`, `teacher/student-cards.js`, `teacher/qr-slips.js` | S1-T4, S1-F4, S3, S5-F1, S8-F1                            |
| I. Reports        | `teacher/page-reports.js`, `teacher/report-*.js`, `teacher/myed-input.js`       | S2, S16, S18                                              |

Tracks A, B, F, G and I share no files with each other or with C, D and E. They can all run from the first night.

### Files only one agent may change at a time

- `shared/data.js`. Every track needs it. Each new feature area adds its code in one marked block, and one agent at a time holds the file. Keep `data.js` PRs small and merge them first.
- `teacher/page-assignments.js` and `teacher-mobile/tab-grade.js`. One PR at a time each, in the order in the table.
- `teacher/dash-class-manager.js`. S1-T4 adds the tab hook once; after that Class Settings work stays in `cm-student-page.js`.
- The script lists: `teacher/app.html`, `teacher-mobile/index.html`, `s/index.html`, `sw.js`, `tests/setup.js`, `tests/setup-mobile.js`, and the list in `docs/ARCHITECTURE.md` that `tests/docs-sync.test.js` checks. A new file touches all of them. Add them in the PR that adds the file, and expect to rebase.
- `docs/schema.generated.sql`. Only the migration batch PR changes it.

The session that hands out the work keeps one list of who holds each of these files, and gives a file to the next PR only when the last one has merged.

### What waits for what

- `S0-P1` and `S0-P2` come first. Nothing reshapes `calc.js` or a save path before its pin is on `main`.
- **PR 955 must merge before `S0-T2`.** It carries the Nov 6 grader work that sat uncommitted on `grader/comment-beside-checklist`, in `page-assignments.js` and `tab-grade.js`, the two files the grader tidying reshapes. Colin approved merging it (Q23).
- `S0-T2` before `S1-T1`, `S1-T2` and `S1-T3`. Those three are in different files and run side by side.
- `S0-T1` before `S0-F1`. `S0-F1` before S2, S4 and S16-F3.
- Batch A applied before any `W` PR in S0 to S4. Batch B before S5 to S7 wiring. Batch C before S9 to S13 wiring. Batch D before a real class turns on Send Work.
- S3 before real students use S4. S4 before S5's student screens. S5 before S6 and S7. S6 before S9, S11, S12 and S14.
- S8 before the release that opens Send Work.
- S15 after S4 works.
- S16 and S18 need only `S0-F1`.

### A first night, as an example

Six agents, six worktrees, no shared files: (1) `S0-P1`; (2) `S0-P2` then `S0-T1`; (3) `S0-T3`; (4) Batch A's SQL and its tests on the throwaway Postgres; (5) `S5-T1`; (6) `S16-T1` or `S18-T1`. By morning Colin has one batch of SQL to read and nothing was blocked on him.

---

## 4. Approval queue

Each row stops only the work listed. Everything else keeps moving.

| #   | What Colin is asked                                                                                                                                                                                                  | When                         | It unblocks           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------- |
| 1   | This plan, and the answers in section 6. Answered Nov 9.                                                                                                                                                             | Now                          | Batch A's final SQL   |
| 2   | **Batch A.** One read of three migrations: `grade_return` with its backfill (existing scores become Returned; no score or number changes), cards, sessions and the page reader. Plus the first edge function deploy. | Once it passes on a branch   | S0 to S4 wiring       |
| 3   | **Math review 1.** `S0-F1`, the returned-only option. The proof offered: with no drafts, every number in the golden file is unchanged.                                                                               | With Batch A                 | S2, S4, S16-F3        |
| 4   | **Batch B.** Submissions, the two buckets and their policies, the second edge deploy. Unsend and Replace delete files. Also Colin's own step: spend cap off and usage alerts at about 70% (Nov 8, decision 7).       | When S1 is in review         | S5 to S7 wiring       |
| 5   | **Batch C.** Mark Up, reflections, revisions, group submissions, the My Learning switch. Third edge deploy.                                                                                                          | When S5 is in review         | S9 to S13 wiring      |
| 6   | **Math review 2.** `S11`: a revision's new grade replaces the old (Nov 8, decision 10).                                                                                                                              | With S11                     | S11 merge             |
| 7   | **Math review 3.** `S13`: anything new in `calc.js` for My Learning.                                                                                                                                                 | With S13                     | S13 merge             |
| 8   | **Batch D. Deletes data.** Photo deletion on class purge, student delete and Keep Photos Until; the nightly check.                                                                                                   | Before Send Work is released | The Send Work release |
| 9   | **Batch E.** Passkeys, with the privacy page change.                                                                                                                                                                 | After S4 is live             | S15                   |
| 10  | **Batch F.** MyEd tables.                                                                                                                                                                                            | Any time                     | S16 wiring            |
| 11  | **Releases.** Suggested points, each on Colin's word: after S2 (nothing visible, switch off); after S4 (cards and the read-only page, for Colin's own classes); after S8 (photo submissions); then as he likes.      | His call                     | Teachers seeing it    |

How a batch is tested before Colin sees it: every migration runs on the throwaway Postgres harness with its tests, storage policies against the harness's stand-in storage table, and the edge function's handler with a fake database. No Supabase branch is used (Q18). The PR shows the SQL, the test results, and what the batch does to existing rows in one paragraph. After it is applied, the first real check is in Colin's own test class.

---

## 5. Risks

| Risk                                                                                        | What stops it                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The graders drift apart again                                                               | One module, `shared/grader.js`. The guard test fails if any other file calls a score writer. One browser test walks the Grader Parts board row by row on desktop and phone.                                                                                                                                                               |
| A draft leaks to a student                                                                  | Students read grades through one SQL function. SQL tests: for a run of saves and returns, `page` always equals the grade at the last return. A test greps `student_submit` for any other read of the score tables. The page is checked in Colin's test class with a real card.                                                            |
| A draft leaks to a family                                                                   | Reports choose their score set in one place (S2-T1). A test prints a class with a draft and looks for the draft's value in the output.                                                                                                                                                                                                    |
| Returned-only and all-work disagree when they should not                                    | The invariant test: no drafts means the same numbers, for every student in two fixtures.                                                                                                                                                                                                                                                  |
| The browser's rule and the server's rule differ                                             | One file of worked cases runs through `shared/grade-state.js` and through the SQL triggers.                                                                                                                                                                                                                                               |
| Preview as Student differs from the real page                                               | Both are built by `shared/student-view.js`. A test compares its output with the server's `page` output for one fixture.                                                                                                                                                                                                                   |
| A write path skips the state (restore, rubric change, grade-scans, an old cached client)    | The state is kept by triggers on the tables, not by each RPC. Each bulk path has its own named test.                                                                                                                                                                                                                                      |
| A return is sent before the last score                                                      | The return shares the cell's outbox key, so it goes after that cell's writes. A test queues a score then a return offline and checks the order sent.                                                                                                                                                                                      |
| A local id reaches the database or a storage path                                           | A photo uploads only after its record has server ids. The path is built from those ids. A test fails on any upload whose path holds a local-shaped id. Kanban f2 is fixed in S7.                                                                                                                                                          |
| Photos orphaned in storage                                                                  | Every delete of a row deletes its files in the same step. The nightly check reports strays both ways. Tests in the local harness purge a class and delete a student and count zero files.                                                                                                                                                 |
| A photo is lost offline                                                                     | The photo stays in IndexedDB until the server confirms it. Tests: reload mid-send, go offline mid-send, fill the device.                                                                                                                                                                                                                  |
| Two tabs send the same photo                                                                | The photo queue takes a lock before it sends. The server ignores a second commit of the same file.                                                                                                                                                                                                                                        |
| The CSP blocks a photo or a PDF, or gets loosened to fix it                                 | Photos are fetched and shown from `blob:`, which the policy allows today. `tests/csp-directives.test.js` gains a line pinning `img-src`, `connect-src`, `frame-src` and `object-src` as they are. PDFs become JPEG pages in the browser (Q13). The HEIC decoder's CSP change is reviewed in its PR and limited to the upload pages (Q14). |
| A student's location is stored                                                              | The browser redraws every photo. The server checks again on commit. A test uploads a photo with GPS data and reads the stored file.                                                                                                                                                                                                       |
| A huge file fills storage                                                                   | The bucket limit: 2 MB a page. A PDF over 20 MB is refused in the browser. The shrink step runs on every upload path, tested for each.                                                                                                                                                                                                    |
| A card code is guessed                                                                      | The identity check, the lock after five wrong tries, today's rate limits, and a limit of 20 sends per card per hour (Q20).                                                                                                                                                                                                                |
| Student data leaves Canada                                                                  | Storage is in the project's region. The edge function already refuses to run outside `ca-central-1`; the new routes go through the same check. `s/` loads no Sentry.                                                                                                                                                                      |
| The grade math changes by accident                                                          | The golden file from `S0-P2` must pass unchanged in every PR that does not say "math" in its title.                                                                                                                                                                                                                                       |
| A migration turns every open PR red                                                         | Batches are applied at a quiet moment and the snapshot merges at once (see the rules above).                                                                                                                                                                                                                                              |
| Storage policies or the edge function fail on first real use, with no branch to try them on | They are tested against stand-ins in the local harness and the handler tests. After a batch is applied, the first real card scan and upload are in Colin's test class alone, with the build switch on for it only. A failed check there stops the next batch.                                                                             |
| The switch is off but something still changed                                               | A browser test runs the regression smoke suite with the build switch off after every slice.                                                                                                                                                                                                                                               |
| Demo Mode calls the server                                                                  | `tests/demo-mode-no-server-calls.test.js` covers each new module and `s/`.                                                                                                                                                                                                                                                                |
| The student page gets too slow on a school Chromebook                                       | `s/` loads `calc.js` only on tabs that show a grade. Page weight is measured in S4 and again in S13.                                                                                                                                                                                                                                      |

---

## 6. Colin's answers (2026-11-09)

Colin answered the 25 questions one at a time on Nov 9. Each answer is written into the plan above. The ones that change a recorded decision or a project rule are also in `docs/DECISIONS.md`, "Student page build answers (2026-11-09)".

| #   | Question                                                    | Answer                                                                                                                                                                                                |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Product shape's "No LMS features: no assignment submission" | Replaced by a new DECISIONS entry: students can send photos and PDFs of their work; still no content pages, discussions or quizzes. `CLAUDE.md`'s opening line follows.                               |
| 2   | Editing a returned grade under When I Return Them           | The student and reports keep the returned grade until it is returned again. The teacher sees the Draft mark and one line: "Jordan still sees the grade you returned Nov 3."                           |
| 3   | Idempotency keys on today's score RPCs                      | Leave them; every new RPC takes a key. `CLAUDE.md` rule 7 names the old ones as overwrite-only exceptions.                                                                                            |
| 4   | Upload links live two hours                                 | Accepted. The nightly check clears files never committed.                                                                                                                                             |
| 5   | A grade hidden during a revision                            | It counts only in the teacher's views, like any draft.                                                                                                                                                |
| 6   | Screens the Which Grades board leaves out                   | Returned only for anything a family reads (Term Questionnaire facts, Generate, Sent to Phones); all work for the teacher's own views (Dashboard, Class Results, the teacher's student page, backups). |
| 7   | Missing, Excused and Late                                   | Never drafts: they show and count at once.                                                                                                                                                            |
| 8   | Where existing classes start                                | As Soon As I Save, until the teacher first opens Class Settings › Student Page. New classes start on When I Return Them.                                                                              |
| 9   | Grades from the grade-scans skill                           | Drafts, in a When I Return Them class.                                                                                                                                                                |
| 10  | Seeing a card's code again                                  | Yes. Stored for the class's teacher only.                                                                                                                                                             |
| 11  | How long a device stays signed in                           | Until midnight, or until Done.                                                                                                                                                                        |
| 12  | Today Only codes                                            | Not built; they wait with Family Codes.                                                                                                                                                               |
| 13  | PDFs                                                        | Each page becomes a JPEG in the browser, using pdf.js for that step; the PDF is not kept. This changes the PDF part of Nov 8 decision 8.                                                              |
| 14  | HEIC files on a Chromebook                                  | Converted in the browser. The CSP change it needs is shown to Colin in its PR.                                                                                                                        |
| 15  | Keep Photos Until                                           | Per class only; off the assessment form.                                                                                                                                                              |
| 16  | "Up from Developing a month ago"                            | Returned work dated on or before 30 days ago, compared with now.                                                                                                                                      |
| 17  | Handed In Paper                                             | The piece moves to Sent, marked "Handed in on paper", with no photos.                                                                                                                                 |
| 18  | Supabase branches for testing                               | No. Local tests only; the first real check is in Colin's test class after he applies a batch.                                                                                                         |
| 19  | Evidence Picks                                              | Not built until drawn.                                                                                                                                                                                |
| 20  | Sends per card                                              | 20 an hour.                                                                                                                                                                                           |
| 21  | Undrawn items that follow from decided rules                | Built without boards.                                                                                                                                                                                 |
| 22  | Photos in backups; undrawn items that need words            | Backups and Download All My Data leave photos out and say so. Agents draft the rest on the artboard for Colin to approve first.                                                                       |
| 23  | The uncommitted grader branch                               | Merge it (PR 955) once its checks pass.                                                                                                                                                               |
| 24  | When a real class can turn on Send Work                     | After the privacy page ships with S5; Colin decides at release time.                                                                                                                                  |
| 25  | The MyEd extension                                          | Not now. S17 is out of this build; S16 still ships.                                                                                                                                                   |

### Left open by the answers

- **Midnight in which time zone.** The plan uses Pacific time, the class's default `course.timezone`. Say if it should be the student's device clock instead.
- **Without a Supabase branch,** storage policies and the edge function are first tried together on `gradebook-prod`. The plan limits that to Colin's own test class with the build switch on for it alone, and adds a risk row for it.
- **The artboard** still says the upload link expires in minutes, shows Keep Photos Until on the assessment form, and shows PDFs kept as files. The boards are not changed by this PR.
