# FullVision Architecture

This document describes the current application architecture at a stable, high level. It is intentionally not the place for task tracking, migration history, or temporary production issues.

Use this file for system shape and runtime boundaries.
Use the backend-design docs for implementation detail and the live handoff/backlog docs for current work.

## System overview

FullVision is a teacher-facing web application with three shipped runtime surfaces:

- Desktop SPA at `teacher/app.html`
- Mobile PWA at `teacher-mobile/index.html`
- The student page at `s/index.html`, which students open with a printed card (students have no logins; see Runtime surfaces)

The two teacher surfaces share the same core client runtime:

- authentication in `shared/supabase.js`
- local cache and data orchestration in `shared/data.js`
- offline retry infrastructure in `shared/offline-queue.js`
- grading and reporting calculations in `shared/calc.js`

The student page loads its own smaller set (see Student page): it has no sign-in, no data layer and no cache, and it reads `shared/calc.js` and `shared/constants.js` only through `s/student-data.js`.

The app persists teacher data through Supabase Auth plus a public RPC surface. It is deployed as a static site on Netlify, with environment values injected into HTML at request time by an edge function.

## Runtime surfaces

### Login and account entry

- `login.html` and `login-auth.js` handle sign-in, sign-up, password reset, and Demo Mode entry.
- Authenticated users are routed into the teacher experience.
- Teachers are the only accounts. Students have no logins: they open the student page (`s/index.html`) with a code, either from a questionnaire or report slip or from a printed student card, through the `student-submit` Supabase edge function. See Student page below. There is no parent portal.

### Desktop SPA

- Entry point: `teacher/app.html`
- Router: `teacher/router.js`
- Main page modules:
  - `page-dashboard.js`; its Class Settings screen is `dash-class-manager.js`, which reads a roster file a teacher imports (CSV or tab text, column matching, dates) through `cm-roster-file.js`, and draws the block picker and the first screen for a teacher with no classes through `cm-block-picker.js`, and draws its Where These Appear help panel through `cm-std-help.js`, and its Reporting Terms section through `cm-terms.js`
  - `page-assignments.js`; its assessment form's competency picker (Choose Competencies, the Codes and List views, the focus box and type to narrow) is `assign-competency-picker.js`; the descriptor bar (a rubric level's or a competency level's wording while it is hovered, focused or held, on the class grid and in the grader) is `assign-descriptor-bar.js`
  - `page-student.js`; its Work tab, and the Work Wall (one assessment's work side by side), are `work-wall.js`, with every picture of student work loaded through `shared/work-thumbs.js`; the Grades tab's Group By (which assessments fall in each category, unit, type or rubric) is `student-groups.js`; the Edit Student dialog (also opened from the Term Questionnaire) is `student-edit-dialog.js`
  - `page-gradebook.js`; its Export CSV is `gradebook-csv.js`, and the grid's hover, scroll sync, sticky Overall column, header height and slanted headers are `gradebook-chrome.js`
  - `page-observations.js`
  - `page-starters.js`: Observations › Starters (`/observations/starters`)
  - `page-reports.js`: Reporting, with two tabs (Term Questionnaire and Print Reports). The Term Questionnaire is `report-questionnaire.js` (one student at a time: the student strip, What FullVision Has, the Comment Bank and the Teacher Comment; it is being split into `report-qn-*.js` pieces, `report-qn-browse-cases.js` holds Browse Sentences' cases and `report-qn-voice-observations.js` holds the Observations card, the student's Voice card and the class's report parts, the split plan being `docs/plans/questionnaire-file-map.md`); its Comment Bank is data in `shared/comment-bank.js` and a pure engine in `teacher/comment-bank.js` (`facts` reads one student's term from the data layer; `context`, `fits`, `fill`, `parts` decide what is offered). Generate assembles a draft from the bank's sentences; no model writes text (docs/DECISIONS.md). Progress Reports are One Report (docs/DECISIONS.md, "One Report"): `report-one.js` (`ReportOne`: the parts, the four Setups, the model saved as `reportConfig.one`, the readers that turn a class's saved Quick Report choices or built form into a model without rewriting either, and `layoutStudent`, which answers `page-reports.js`'s layout seam for the preview, the fit line, Everyone, Print Reports and the printed copies), `report-one-panel.js` (the panel: Setup, Changes Apply To, the parts in print order with a switch each, options, Feedback Pages, Add a Part), `report-one-page.js` (what the pages do on screen: Hide, leave a row off, rename a heading, Choose Assessments, Edit Questions and Edit Wording; everything it adds is `no-print`) and `report-one-comment.js` (the Teacher Comment edited where it prints, tracked, saved to the Term Questionnaire; unsaved changes never print). `report-sheets.js` reads the saved form model and is the placing engine (`pack`: rows fill a side, a table splits between its rows under "(continued)", the Parent / Guardian Response docks at the foot of the last side); `report-blocks.js` draws each block; `grade-report.js` draws the Assessments table, the Categories summary, the grade line and the Feedback Pages; `report-issues.js` keeps the printed copies. Nothing in these computes a grade. Every report surface (these, Print Grades, Export) reads grades through `report-scores.js` (`ReportScores`): one table says which set of scores each surface uses (all work today), `withReportScores` runs a report in it, and its readers are the only way a report file reads a score, comment, note, tick or status from the data layer. `tests/report-score-seam.test.js` holds that.
- Shared desktop UI shell: `teacher/ui.js`

The desktop app is a single-page app on real paths: `/dashboard`, `/assignments`, `/gradebook`, `/observations`, `/observations/starters`, `/reports` and `/student?id=…`. Netlify serves `teacher/app.html` at each of them and `teacher/router.js` draws the page with `history.pushState`; the list is repeated in `netlify.toml`, `sw.js`, `serve.json` and the local servers, and `tests/app-routes.test.js` keeps them in step. Old `/teacher/app.html#/…` links are rewritten to the clean address at boot. Page modules render into shared mount points for the dock, sidebar, page toolbar, and main content area. The Reports page's scripts (`report-sheets.js` to `page-reports.js`) are not in `teacher/app.html`: `teacher/router.js` loads them on demand, in order, the first time the Reports route opens (`_onDemand`), and `sw.js` precaches them so Reports still opens offline. Assignments' rubric scripts (`rubric-library.js`, `rubric-bank.js`) load the same way before Assignments first draws. Scripts one button uses load the first time it is pressed, through `Router.withScripts`: `grades-print.js` (Print Grades), `grading-setup-copy.js` (Copy Grading Setup) and `vendor/qrcode.js` (any sheet of QR slips or student cards, in `QrSlips.printSheet`); a file that cannot be fetched brings up a Try Again question. `tests/reports-on-demand.test.js` checks every on-demand file is precached, exists and is not also a tag.

### Mobile PWA

- Entry point: `teacher-mobile/index.html`
- Shell: `teacher-mobile/shell.js`, with `tab-bar.js` (the tab bar, and the tab last used on this device, which the app reopens on)
- Shared pieces: `components.js` (`MComponents` / `MC`), `card-stack.js`, `card-widgets.js`, `card-widget-editor.js`
- Main tab modules:
  - `tab-students.js`, with `students-list.js` and `student-detail.js`
  - `tab-observe.js`
  - `tab-grade.js`: the list of assessments and the speed grader, with `sweep.js` and `grade-photos.js` (the student's work on a grading card and a student's To Grade list), `add-work.js` (Add Work: photographing a student's paper work) and `markup.js` (Mark Up: drawing on a page of the work)
- It also loads `shared/obs-capture.js`, `shared/obs-card.js` and `shared/work-wall.js` (the Work Wall, from the Grade tab's row menu) from the desktop.

The mobile experience reuses the same shared auth, data, queue, and calculation layers as desktop, but presents them through a separate shell and touch-first UI.

### Student page

- Entry point: `s/index.html`. A student reaches it with a code from a slip (one questionnaire or one phone report) or from a printed student card (the student's page for a class). The server answers every request through the `student-submit` edge function (`supabase/functions/student-submit/`); a teacher's browser has slips and cards made through the `teacher-cards` edge function (`supabase/functions/teacher-cards/`), which draws each code once and keeps nothing.
- A slip is `s/student.js` (the shell), then `s/questionnaire.js` and `s/report.js`, with `shared/phone-report-view.js`.
- A card is `s/app.js` (the card, Is This You?, After Done, Switching Classes, the page's frame and its four tabs) and `s/assignments.js` (To Do, Sent, Back and All Assignments). Both draw from `shared/student-view.js`, the one builder the student page and Preview as Student share, and from `s/page-view.js`, the one drawing of a class's page (a pure function of the view, with its look in `s/page-view.css`), which Preview as Student loads too.
- Card screens that come with a piece of work: `s/send.js` (Check and Send: photographing and sending work, Unsend or Replace), `s/feedback.js` (See Your Work, with the teacher's marks and Show Marks), `s/handouts.js` (a teacher's handout, one page at a time) and `s/reflect.js` (Reflect on Feedback and the teacher's answer).
- `s/student-data.js` turns the student's page reply into the shape `shared/calc.js` reads, so a result on the student page is worked out by the same code as the teacher's gradebook cell. `calc.js` and `constants.js` are fetched only when the list is about to open, so a slip never loads them.
- A real card asks the student-submit routes: `card-routes.ts` (card, verify, add-card, page, seen, done), `forms-routes.ts` (the Questionnaires and My Reports tabs), `send-routes.ts`, `feedback-routes.ts`, `handout-routes.ts` and `revision-routes.ts`; a slip uses `slip-routes.ts` and `handler.ts`. Demo Mode (`/s/#demo-card`, with variants such as `#demo-card-send`) answers the same routes on the device and sends nothing. Send Work, Reflect on Feedback and the rest of the page sit behind the per-class build switch (`course.student_page_enabled`) described below, and a class's page is drawn exactly as before when they are off.

## Shared client architecture

### Script and module model

The app uses vanilla JavaScript with browser-global IIFE modules rather than a bundler-driven framework runtime.

Shared runtime modules load before desktop or mobile page modules, in this order on the desktop (`teacher/app.html`; `tests/docs-sync.test.js` checks it):

1. `shared/sentry-init.js`
2. `shared/html.js` (`esc`, the one escape helper)
3. `shared/link-nav.js`
4. `shared/loading-screen.js` (the loading screen, right after its empty `#app-loading`; the phone and the student page load it too)
5. Supabase SDK (`vendor/supabase.min.js`)
6. `shared/supabase.js`
7. `shared/constants.js`
8. `shared/reporting-term-presets.js`
9. `shared/data-utilities.js` (the small helpers every file uses: student names, dates, colours, ids and RPC results)
10. `shared/data.js`
11. `shared/data-rpc-wrappers.js` (the `window.v2` server calls: one small wrapper per RPC, from subjects and categories to reports, slips, phone reports and the assessment detail; `shared/data.js` makes `window.v2` and the plumbing they call)
12. `shared/data-learning-map.js` (the learning map: its sections, tags and competency groups, removed sections, and its save to the server)
13. `shared/data-categories.js` (categories: an assessment's category, the save to the server, the category write guard and Class Settings' category draft)
14. `shared/data-rubrics.js` (rubrics: the save to the server, Advanced Rubric checkboxes, printed rubrics and competency descriptors)
15. `shared/data-assessments.js` (assessments: the save to the server, duplicate, tags and collab, and clearing the marks of deleted work)
16. `shared/data-config-settings.js` (class settings: saveConfig, getCourseConfig and saveCourseConfig, the changed-only settings patch and the old-settings write guard)
17. `shared/data-observations.js` (observations: quick observations, sentence starters, custom tags and the tag resolver)
18. `shared/data-term-ratings.js` (term ratings and report preferences: the Term Questionnaire's ratings, comments and attendance, the report setup, and the teacher's card, dashboard and view settings)
19. `shared/data-student-records.js` (student records: flags, goals and goal dates, Core Competency self-assessments, reflections and notes; and the class's modules)
20. `shared/data-student-cards.js` (student cards: the printed cards that open a student's page, and Cards Work Until)
21. `shared/data-student-work.js` (student work: what students sent and the settings that let them send, group work's reader, work a teacher adds, and the same for a signed-in teacher from the server)
22. `shared/data-feedback-live.js` (Mark Up and Reflect on Feedback for a signed-in teacher: the server's marks, reflections and revision requests, laid over with this device's writes not yet answered)
23. `shared/data-markup.js` (Mark Up: the teacher's marks on a page of student work as Demo Mode keeps them, the readers both kinds of class share, and Return with the marks)
24. `shared/data-reflect.js` (Reflect on Feedback: a student's reflection on returned work, the class's Reflect on Feedback and Show My Learning switches, and Send Answer)
25. `shared/data-revisions.js` (Revisions: returning work for another try, its edit and Take Back, the student's revision in Demo Mode, and Before and After)
26. `shared/data-roster.js` (the class list: students, enrolment, adding and editing a student, and the roster helpers)
27. `shared/data-withdrawn.js` (withdrawn students: withdrawing and re-enrolling, the Withdrawn list, permanent delete, and putting a withdrawn student's marks aside)
28. `shared/data-overrides.js` (hand-set levels: the teacher's section overrides with their reasons, and the calculated level shown beside one)
29. `shared/data-profile-summaries.js` (student profile summaries: each student's flags, goals, reflections, hand-set levels and notes as a class loads)
30. `shared/data-courses-terms.js` (classes and reporting terms: create, rename, archive and delete a class, the grading scale, reporting terms, switching class and blocks)
31. `shared/data-demo.js` (Demo Mode: the sample class's script, the student features switch, Reset Demo Data and Leave Demo Mode)
32. `shared/data-curriculum-index.js` (the BC curriculum index and the learning map built from it)
33. `shared/offline-queue.js`
34. `shared/overwrite-count.js` (counts, for Sentry only, how often a score that waited in the outbox meets a newer one on the server; reads, never writes)
35. `shared/auto-update.js`
36. `shared/calc.js`
37. `shared/grade-state.js` (the Draft and Returned rule; a class whose student page is off returns every save at once)
38. `shared/grader.js` (`Grader`, the one module a screen writes a grade through)
39. `shared/rubric-draft.js`
40. `shared/rubric-checks.js`

The phone loads the same list with these differences: it leaves out `shared/link-nav.js` and `shared/reporting-term-presets.js`; it loads `shared/rubric-draft.js` later, after `shared/student-voice.js` and before `shared/competency-wording.js` (`teacher-mobile/index.html`), not in its place in the list; and it adds `shared/sign-in.js` right after `shared/supabase.js`.

Desktop or mobile modules then layer on top of that shared runtime.

### Other shared modules

Modules in `shared/` that are not in the boot list above, each loaded by the page that needs it:

- `shared/sign-in.js`: what the two sign-in screens (`login.html` and the phone's sign-in card) share: Try Demo Mode, the Restore Account prompt, where a password reset link lands, Check Your Inbox after Create Account.
- `shared/device.js`: tells a phone from a desktop (`isPhone`, `prefersMobileApp`, `teacherAppPath`), so a teacher lands in the right app; loaded by `login.html` and `launch.html`.
- `shared/core-self.js`: which reporting term the Core Competency self-assessments are read for, and each student's step in it (the teacher's student page, `teacher/page-student.js`, and the dashboard's Core Competencies card read it, so they agree on the term).
- `shared/questionnaire-templates.js`: the questionnaire templates the database seeds, generated by `scripts/questionnaire_templates.py --js`; Demo Mode and a signed-out page read them from here. Do not edit it by hand.
- `shared/photo-shrink.js`: every photo is made smaller before it uploads (type check, shrink to a JPEG, upright orientation, GPS and camera details dropped); it builds no HTML and sends nothing.
- `shared/photo-readers.js`: the PDF reader `shared/photo-shrink.js` asks for, backed by pdf.js in `vendor/pdfjs/`, fetched only when a PDF is first opened.
- `shared/photo-queue.js`: photos waiting to send, kept in IndexedDB until the server has them (the outbox in `shared/offline-queue.js` holds JSON and cannot hold a photo); it has no network code, the caller supplies the upload. The student page and both teacher apps use it.
- `shared/markup-draw.js`: Mark Up's drawing and hit-testing, plain functions over a page's marks, so the desktop's Mark Up and the phone's draw and erase the same way (`window.MarkupDraw`).
- `shared/bank-comment.js`, `shared/bank-proficiency.js`, `shared/bank-core-competencies.js` and `shared/bank-sets.js`: slices of the BC curriculum bank, built by `scripts/build-curriculum-bank.mjs` from `data/bc-*.json` (do not edit). They are the wording Generate uses to name a competency and its next step, the four level descriptors for printed Tag Rubrics (loaded when a rubric is printed), each Core Competency's name and description (loaded the first time the assessment form's hover shows) and the per-course-set wording.

### Static and lazy-loaded assets

- `curriculum_data.js` and `curriculum_by_course.json` are the static BC curriculum index the app loads, generated from the bank in `data/bc-curriculum-*.json` by `scripts/build-curriculum-bank.mjs` (Ministry text, folders and codes, I Can statements). Treat them as reference data, not core boot state, and regenerate rather than edit them.
- `shared/seed-data.js` builds the Demo Mode sample class.
- `shared/auto-update.js` reloads a long-open tab after a deploy at a safe moment, without a prompt.

## Boot and session flow

### Desktop boot

Desktop boot is orchestrated by `Router.boot()` in `teacher/router.js`:

1. `requireAuth()` is asked, not waited for
2. `initAllCourses({ signInCheck })`: with this teacher's class list saved on the device it returns at once and the server's list answers beside the re-check; otherwise it waits for the re-check first
3. `initData(activeCourseId)`
4. `loadSeedIfNeeded()`
5. `migrateAllStudents()`
6. route initial render

Until the re-check passes the page is locked, nothing is sent, and no server answer is shown (`class-loading-plan.md`, "Start-up order").

### Mobile boot

Mobile boot in `teacher-mobile/shell.js` follows the same core pattern:

1. check session
2. `initAllCourses()`
3. `initData(activeCourseId)`
4. `loadSeedIfNeeded()`
5. `migrateAllStudents()`
6. render the active mobile tab shell

### Authentication behavior

`shared/supabase.js` owns:

- Supabase client initialization
- sign-in and sign-up
- password re-authentication for sensitive actions
- session refresh
- sign-out and local data clearing
- unauthenticated redirects back to `login.html`

The current account lifecycle also includes:

- restore-on-sign-in handling for soft-deleted teacher accounts
- long-form session-expiry recovery for narrative/reporting surfaces
- full local data wipe on sign-out for shared-device safety

## Data and persistence model

### Core model

The current app is local-first in the UI, but not local-only in source of truth.

At runtime, the client uses:

- in-memory `_cache` for synchronous reads
- localStorage as durable browser cache and offline fallback
- explicit Supabase RPC dispatch for server persistence
- `window.v2Queue` for queued retry behavior when applicable

This is no longer the older generic “local blob plus background bridge” design. The active model is domain-specific dispatch over the v2 RPC surface.

### Boot reads

Global boot state is loaded by `initAllCourses()` and `initData()` in `shared/data.js`.

Current signed-in flow:

- `bootstrap_teacher(...)` ensures teacher bootstrap state exists
- `list_teacher_courses()` provides course-level boot metadata
- `get_class_bundle(courseId)` hydrates the active course cache in one request (gradebook, learning map, rubrics, observations, term ratings, report config); `get_gradebook(courseId)` is the fallback when the bundle RPC isn't available
- `get_student_profile(enrollmentId)` supports deeper student detail reads

Legacy per-course fan-out reads are no longer the active architecture.

### Writes

Local writes update `_cache` and localStorage first so the UI stays responsive.
Remote persistence then happens through explicit v2 helpers and dispatchers, including `window.v2.*` methods for:

- course and policy updates
- roster and student writes
- assessment CRUD
- score and rubric writes
- observations
- term ratings
- report configuration and preferences
- imports and restore flows

#### Class settings

The decisions are in `docs/DECISIONS.md`, "Class settings on two computers"; these are the engineering choices that carry them out.

- **A save sends what changed.** `saveCourseConfig` and `updateCourse` send `update_course(p_course_id, p_patch)`. `saveCourseConfig` builds the patch from the settings, then drops every key equal to the copy this page started from: a clone taken when the class loaded from the server or was last saved (the `courseConfigs` server-state baseline), or, while the class has not loaded from the server this session, a clone of what the page read from the browser's storage (`_settingsRead`), never the storage as another tab has since left it. A save that changes nothing sends nothing.
- **A load replaces the device's copy.** `_applyBundleCourseConfig` takes every setting from the course row, the calculation method and decay weight included; `_applyBundleCourseRow` refreshes the class list's row (name, grading style, time zone, late work policy). The older load (`get_gradebook`) does the same. This device's queued changes are laid back over the row (`_unsentCourseChanges`), and a row edited while a load is in flight is left for the next pass.
- **Two devices changing the same setting:** the later save stays, and neither is told. This was not asked of the owner; it is what `update_course` does.
- **A copy saved before the fix** may hold the device's own old method beside an unchanged version number, for which the server answers "not modified". The saved copy's record carries `settings: 1` once its settings came from the server; a copy without it is shown at once but downloaded in full once.
- **A method the server never got.** When the course row has never been updated since it was made (`updated_at` equals `created_at`), no computer has changed a setting of the class on the server, so a method or decay weight this device holds that differs is not an old copy: it is sent up once instead of overwritten. This is a class restored from a backup by the build before the fix, which sent the server Average 65% whatever the backup held. `restoredCourse` in `shared/backup-restore.js` now takes the method from the backup's settings.
- **What a queued settings write carries.** Each patch this build queues carries the mark `_changed_only`, taken out as it is sent (`_sendableCoursePatch`, in the one place every `update_course` passes). An unmarked patch naming a setting only a whole copy ever carried is an older build's: it is compared with the server's row (`_oldSettingsWrite`) and dropped if nothing differs, discarded if anything does.
- **A discarded write** (`_discardWrite`) tells Sentry the kind of write, never its content; has the class read again; and is kept in the failed list with no retry, so the sync dot is red. No later write and no page load clears it until its class has been read again from the server (`until_reload`, `markReloaded` in `shared/offline-queue.js`), and it goes with the page load after that. Two classes are never read again, so the class list ends it (`_releaseDiscardsByClassList`, `releaseDiscarded`): a class gone from `list_teacher_courses` at once, an archived one at the next page load (a write discarded on the page itself stays). Until the class has loaded again, the load's "send up a setting only this device has" rule stands aside for it (`noSendUp`), so nothing of the discarded save reaches the server by another route.
- **Categories.** Class Settings' Save Categories and its drag read `list_categories`, compare it with the list the form was opened with, and send, asked of the server directly and never left in the outbox (`saveCategoriesNow`, `reorderCategoriesNow`). A drag made with other edits unsaved waits for Save, because `reorder_categories` numbers only the rows it is sent. Copy Grading Setup checks first (`categoriesStillCurrent`) and saves through the outbox with the list it was made over kept beside it (the entry's `guard`). A `save_categories` that waited in the outbox (a retry, a later page) is read against the server first (`_guardCategorySave`): already there, dropped; the list it was made over, sent; anything else, discarded. An older build's entry has no guard, so it goes only when the server already holds its list. Copy Grading Setup's guard also names the class copied from (`guard.copy`), so a copied list discarded this way leaves the same note on the class as one not copied at once.
- **A save or drag sent with no answer** is kept as `tried` (in memory, and in the draft below, new rows with a `key`). A server list equal to it is this computer's own save, never "changed on another device"; edits typed after it are unsaved edits over that list. A save held back because this computer's other writes had not gone (`why: 'waiting'`) is not said to need a connection. Discard My Changes with such a list outstanding reads the server's list and shows it (`_cmCatFollowServer`), or does so the next time Class Settings draws the categories if there is no connection. A category list that reaches the server clears the class's "not copied" note (`_clearCategoriesNotCopied`).
- **Nothing typed is lost with a refused category save.** `gb-category-draft-<cid>` keeps the unsaved edits (no connection) or what was typed (changed elsewhere) on the device until saved, discarded or dismissed, and the note Copy Grading Setup leaves on a class whose categories it did not copy. It is kept only as long as the class's saved copy: the 14-day purge and storage eviction take it too.

### Offline and retry

`shared/offline-queue.js` exposes `window.v2Queue`, which provides:

- queued writes
- retry with backoff
- dead-letter handling
- queue stats
- subscription hooks for UI surfaces

Desktop UI currently exposes queue and offline state through:

- offline banner
- the sync dot (green saved, yellow syncing, red a problem; the tooltip says which). No count or popover (removed Oct 2026: the number next to the teacher's name confused people).

The queue is the active retry mechanism for flows that opt into queued dispatch.

### Draft and Returned, and student cards

Behind a per-class switch (`course.student_page_enabled`, off for every class until its teacher turns it on in Class Settings › Student Page, which every class has; `docs/plans/student-page-build-plan.md`). With the switch off none of this runs and nothing here is asked of the server.

- **The two settings** (`student_page_enabled`, `return_grades`) are columns on `course`. They reach the client on the course row inside `get_class_bundle`. The switch counts for a signed-in teacher only once the server has said it is on (`_serverSaysStudentPage`, kept in the class's saved-copy record, not in its settings object): a value the device merely holds (a restored backup, a copied class) shows nothing and sends nothing. The switch is the first card on Class Settings › Student Page, for every class (`teacher/cm-student-page.js`).
- **They are sent only by the actions that change them**, through `saveReturnSettings`: the Return Grades choice, the build switch, and a class made on the device going up with the choice it was made with (Duplicate Class). `saveCourseConfig` sends neither and cannot change either, so a device holding an old copy of a class's settings cannot put an old choice back by saving something else. A change that starts a class holding grades (the switch on, When I Return Them) is asked of the server directly and made on the device only when the server has answered. A change that stops it first asks the server how many grades wait (`course_draft_count`), then is made on the device and queued; the server returns what waits by a trigger and the device does the same to its rows.
- **The rows** (one per student per assessment: Draft or Returned, and what the student was last given) are kept by database triggers (`grade_return`). The client reads them with `list_course_grade_returns` after the class loads, after a change from another device, and once its own writes have landed, into the `gradeReturns` cache Demo Mode also uses. Between a save and that read the row is the one `shared/grade-state.js` works out: the same rule as the triggers, held to them by `tests/fixtures/grade-state-cases.json`. Rows read from before a newer local change are never applied. A DIBELS benchmark has no row on either side.
- **Return** (`Grader.returnGrades`) is optimistic on the device and goes to the server as `return_grades`, one call for each student, through the outbox under the cell's key (`cell:<student>:<assessment>`), so it follows that cell's score writes; the outbox also holds it behind any queued write to the whole student or the whole piece of work, and such a write behind it.
- **A refused write** of a Return or of either setting has the class read again whole (settings and rows), and that read is retried like any failed class load, so the device converges on the server. So does an ask of the server that fails or goes unanswered (a change that starts holding, the count of drafts): the server may have made the change and only its answer been lost.
- **Student cards** (`teacher/student-cards.js`): `issue_student_cards` and `list_student_cards` are asked for online with the teacher waiting, as slip codes are; `mark_student_cards_printed` goes through the outbox. A signed-in teacher's card codes are held in memory only, and are read only while the Student Cards list is on the page. Cards print on the questionnaire slips' sheet (`QrSlips.printSheet`).
- **Demo Mode** runs all of it on the device (`gb-grade-returns-<cid>`, `gb-student-cards-<cid>`) and sends nothing.

### Cross-tab behavior

The browser cache remains shared across tabs. Cross-tab state coordination still uses browser messaging and storage events where needed, but the old generic realtime bridge is not the primary architecture anymore.

## Domain architecture

### Teacher-facing scope

FullVision is organized around a teacher-owned data model:

- teachers
- courses
- students and enrollments
- assessments and scores
- observations
- term/report artifacts (`term_rating`: the comment as plain text, the six work habits, approval, attendance totals)
- preferences and report configuration

The app is designed around teacher-owned classroom workflows. Students have no logins and there is no parent portal: a student opens the student page with a printed card or a slip, and sees only what the teacher has returned.

### Grading model

The current grading architecture supports two parallel grading pipelines:

- proficiency reporting
- letter/percentage reporting

Courses select a `grading_system` of:

- `proficiency`
- `letter`
- `both`

Current desktop grading behavior is category-driven:

- categories drive the letter/percentage pipeline
- proficiency remains based on sections, tags, and score evidence
- desktop assignments, gradebook, and report/header flows now use category-aware logic

This means the older “summative/formative is the primary grading architecture” framing is no longer accurate as a system-level description.

## Demo data

Demo Mode is the only sample data. `shared/seed-data.js` builds the Science 8 sample class, local-only, without Supabase. Signed-in teachers start with no classes; the Welcome Class bootstrap was removed on 2026-10-13 (`migrations/20261013_bootstrap_without_welcome_class.sql`).

## Deployment architecture

### Build and publish

- `scripts/build.sh` copies the public app into `dist/`
- Netlify publishes `dist/` from the `production` branch; a release is one pull request from `main` into `production`, and merging to `main` deploys nothing
- `netlify/edge-functions/inject-env.js` injects `SUPABASE_URL` and `SUPABASE_KEY` into HTML responses
- the same edge function sets a per-request CSP nonce

### Local signed-in development

`scripts/dev-local.mjs` mirrors the Netlify HTML injection behavior locally:

- serves files directly from the repo
- injects Supabase env vars into HTML
- sets a CSP matching production behavior closely enough for local auth testing

### Service worker and PWA behavior

- `sw.js` is registered by both desktop and mobile entry points
- the manifest and service worker provide installability and cached asset behavior
- each release gives `sw.js` a new cache name and, from `scripts/sw-fingerprints.mjs`, a SHA-256 for every precached file but the HTML pages; the new worker's install copies a file from the previous cache only when the old version recorded the same fingerprint and the stored bytes hash to it, and downloads the rest (`docs/plans/caching-plan.md`, step 3). The source `sw.js` has no fingerprints and downloads everything
- a file the install saved is answered from that saved copy without asking the network, but only for a page that names the worker's own release: `scripts/build.sh` writes the cache name into `login.html`, `launch.html`, `teacher/app.html` and `teacher-mobile/index.html` as `<meta name="fv-release">` (`scripts/sw-release-pages.mjs`), and the worker reads it from each page it hands over. HTML is always asked of the network first. A page from another release, a page with no tag (the student page) and a page the worker has lost track of get their files from the network first (`docs/plans/caching-plan.md`, section 8)

## Source-of-truth documents

This file is intentionally high-level. For authoritative detail, use:

- [`README.md`](../README.md) for repo entry and run instructions
- [`CLAUDE.md`](../CLAUDE.md) for the working rules every session follows
- [`docs/ROADMAP.md`](ROADMAP.md) for the open-work list and [`docs/DECISIONS.md`](DECISIONS.md) for settled decisions
- [`docs/backend-design/HANDOFF.md`](backend-design/HANDOFF.md) and [`codex.md`](../codex.md) for history (not maintained)
- [`schema.sql`](../schema.sql) and [`docs/backend-design/rls-policies.sql`](backend-design/rls-policies.sql) for deployed reference artifacts
- [`docs/backend-design/read-paths.md`](backend-design/read-paths.md) and [`docs/backend-design/write-paths.md`](backend-design/write-paths.md) for backend design detail

## What this document should not carry

To reduce future drift, this file should not become:

- a task tracker
- a migration diary
- a production incident log
- a list of temporary test counts
- a duplicate of `HANDOFF.md`

If a fact is expected to change frequently, it belongs in the handoff or backlog docs, not here.
