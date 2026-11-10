# FullVision Architecture

This document describes the current application architecture at a stable, high level. It is intentionally not the place for task tracking, migration history, or temporary production issues.

Use this file for system shape and runtime boundaries.
Use the backend-design docs for implementation detail and the live handoff/backlog docs for current work.

## System overview

FullVision is a teacher-facing web application with two shipped runtime surfaces:

- Desktop SPA at `teacher/app.html`
- Mobile PWA at `teacher-mobile/index.html`

Both surfaces share the same core client runtime:

- authentication in `shared/supabase.js`
- local cache and data orchestration in `shared/data.js`
- offline retry infrastructure in `shared/offline-queue.js`
- grading and reporting calculations in `shared/calc.js`

The app persists teacher data through Supabase Auth plus a public RPC surface. It is deployed as a static site on Netlify, with environment values injected into HTML at request time by an edge function.

## Runtime surfaces

### Login and account entry

- `login.html` and `login-auth.js` handle sign-in, sign-up, password reset, and Demo Mode entry.
- Authenticated users are routed into the teacher experience.
- Teachers are the only accounts. Students answer questionnaires and read phone reports on the student page (`s/index.html`; `s/student.js`, the shell, then its screens in `s/questionnaire.js` and `s/report.js`; `shared/phone-report-view.js`) with a code from their slip, through the `student-submit` Supabase edge function. A student card's screens are `s/app.js` (the card, Is This You?) and `s/assignments.js` (the Assignments list), with `s/student-data.js` feeding `shared/calc.js` from the student's own page (`calc.js` and `constants.js` are fetched only when the list is about to open, so a slip never loads them); they run in Demo Mode only (`/s/#demo-card`) until the card routes exist. There is no parent portal.

### Desktop SPA

- Entry point: `teacher/app.html`
- Router: `teacher/router.js`
- Main page modules:
  - `page-dashboard.js`
  - `page-assignments.js`
  - `page-student.js`
  - `page-gradebook.js`
  - `page-observations.js`
  - `page-starters.js`: Observations › Starters (`/observations/starters`)
  - `page-reports.js`: Reports, with two tabs. The Term Questionnaire is `report-questionnaire.js` (one student at a time: the student strip, What FullVision Has, the Comment Bank and the Teacher Comment); its Comment Bank is data in `shared/comment-bank.js` and a pure engine in `teacher/comment-bank.js` (`facts` reads one student's term from the data layer; `context`, `fits`, `fill`, `parts` decide what is offered). Generate assembles a draft from the bank's sentences; no model writes text (docs/DECISIONS.md). Progress Reports are `report-studio.js`, `report-sheets.js` (forms, layout and fit) and `report-blocks.js` (one renderer per printed block). Every report surface (these, the Quick Report and its Feedback Pages, Sent to Phones, Print Grades, Export) reads grades through `report-scores.js` (`ReportScores`): one table says which set of scores each surface uses (all work today), `withReportScores` runs a report in it, and its readers are the only way a report file reads a score, comment, note, tick or status from the data layer. `tests/report-score-seam.test.js` holds that.
- Shared desktop UI shell: `teacher/ui.js`

The desktop app is a single-page app on real paths: `/dashboard`, `/assignments`, `/gradebook`, `/observations`, `/observations/starters`, `/reports` and `/student?id=…`. Netlify serves `teacher/app.html` at each of them and `teacher/router.js` draws the page with `history.pushState`; the list is repeated in `netlify.toml`, `sw.js`, `serve.json` and the local servers, and `tests/app-routes.test.js` keeps them in step. Old `/teacher/app.html#/…` links are rewritten to the clean address at boot. Page modules render into shared mount points for the dock, sidebar, page toolbar, and main content area.

### Mobile PWA

- Entry point: `teacher-mobile/index.html`
- Shell: `teacher-mobile/shell.js`
- Shared pieces: `components.js` (`MComponents` / `MC`), `card-stack.js`, `card-widgets.js`, `card-widget-editor.js`
- Main tab modules:
  - `tab-students.js`, with `students-list.js` and `student-detail.js`
  - `tab-observe.js`
  - `tab-grade.js`, with `sweep.js`
- It also loads `teacher/obs-capture.js` and `teacher/obs-card.js` from the desktop.

The mobile experience reuses the same shared auth, data, queue, and calculation layers as desktop, but presents them through a separate shell and touch-first UI.

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
9. `shared/data.js`
10. `shared/offline-queue.js`
11. `shared/auto-update.js`
12. `shared/calc.js`
13. `shared/grade-state.js` (the Draft and Returned rule; a class whose student page is off returns every save at once)
14. `shared/grader.js` (`Grader`, the one module a screen writes a grade through)
15. `shared/rubric-draft.js`
16. `shared/rubric-checks.js`

The phone loads the same list without `link-nav.js`, `reporting-term-presets.js` and `rubric-draft.js`.

Desktop or mobile modules then layer on top of that shared runtime.

### Static and lazy-loaded assets

- `curriculum_data.js` and `curriculum_by_course.json` are the static BC curriculum index the app loads, generated from the bank in `data/bc-curriculum-*.json` by `scripts/build-curriculum-bank.mjs` (Ministry text, folders and codes, I Can statements). Treat them as reference data, not core boot state, and regenerate rather than edit them.
- `shared/seed-data.js` builds the Demo Mode sample class.
- `shared/auto-update.js` reloads a long-open tab after a deploy at a safe moment, without a prompt.

## Boot and session flow

### Desktop boot

Desktop boot is orchestrated by `Router.boot()` in `teacher/router.js`:

1. `requireAuth()`
2. `initAllCourses()`
3. `initData(activeCourseId)`
4. `loadSeedIfNeeded()`
5. `migrateAllStudents()`
6. route initial render

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
- **A save or drag sent with no answer** is kept as `tried` (in memory, and in the draft below, new rows with a `key`). A server list equal to it is this computer's own save, never "changed on another device"; edits typed after it are unsaved edits over that list. A save held back because this computer's other writes had not gone (`why: 'waiting'`) is not said to need a connection.
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

Behind a per-class build switch (`course.student_page_enabled`, off for every class until its teacher turns it on; `docs/plans/student-page-build-plan.md`). With the switch off none of this runs and nothing here is asked of the server.

- **The two settings** (`student_page_enabled`, `return_grades`) are columns on `course`. They reach the client on the course row inside `get_class_bundle`. The switch counts for a signed-in teacher only once the server has said it is on (`_serverSaysStudentPage`, kept in the class's saved-copy record, not in its settings object): a value the device merely holds (a restored backup, a copied class) shows nothing and sends nothing. The switch is offered only in Class Settings › Student Page when the app is opened at an address carrying `?build=student-page` (`teacher/cm-student-page.js`).
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

The app is designed around teacher-owned classroom workflows rather than student or parent self-service access.

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
