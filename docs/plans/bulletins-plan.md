# Bulletins build plan (2026-11-17)

**Status (Nov 17, night).** A plan. Nothing is built. No builder starts until Colin says the plan is good. His eight decisions of Nov 17 are settled and are not reopened here. Seven more are open (see "Decisions that are Colin's"); no slice that rests on one starts before it is settled.

**What it is.** A one-way class feed. The teacher posts a bulletin; students read it on the first tab of their page; the teacher sees who has seen it. A Quick Poll and a Whiteboard are two kinds of bulletin, and either opens full screen on the classroom TV with Present. Students cannot post or reply, apart from Whiteboard sentences, every one of which reaches the teacher first.

**The name** (Colin, Nov 17: "Let's call it Bulletins, then."). Bulletins is the teacher's top tab, the student's first tab, the phone app's tab and the Dashboard tile. One post is a bulletin; Post is the verb. Whiteboard and Photo of the Board keep their names. Tables, functions, routes and classes are named from "bulletin".

**Board.** "Bulletin Board Artboard" (https://claude.ai/artifact/FjK3VcG1A6M31nn8vVVB38): A1 to A3 (the Dashboard tile), B1 to B3 (the teacher's page, writing a bulletin, who has seen it), C1 to C3 (the student's tab), D (Quick Poll), E1 and E2 (Whiteboard), F (Learner Profile). An independent review is still running; the designer will republish it with the new name and with boards for the teacher's phone. **Every builder's brief is written from the board as it stands that day, not from this plan's summary of it.**

## Rules every slice follows

1. **One way.** No route lets a student write words that another student can read, except a Whiteboard sentence the teacher has shown.
2. **The server enforces every rule a screen shows.** A screen that hides something is not the rule; the function that answers is. Each rule in "Privacy" has a test that asks the server directly.
3. **Paused, withdrawn and closed are refused in one place.** Every student function begins with `student_submit._session_class`, which already refuses a paused student, a withdrawn student, a class with its page off and an expired or stopped card (`_card_refusal`, patched by `migrations/2026111720_student_page_per_student.sql:220-225`). Whether a student may see one bulletin is one shared function, used by every student function, never copied into each.
4. **No new party, credential or copy of student data.** Everything stays in `gradebook-prod` in `ca-central-1`, behind the card sign-in and the `student-submit` edge function. No embedded players, no push service, no link previews, nothing fetched from a linked site.
5. **Nothing existing is tightened.** No function the released app calls changes its answer. The app in teachers' browsers and on students' phones keeps working before, during and after each apply.
6. **Dark until whole.** The teacher's tab, the phone's tab, the Dashboard tile and the student's tab draw only when the build flag `bulletins` is on (`shared/build-flags.js`, made by the Dashboard plan's slice D1). It is off in every released build, Demo Mode included, until B1g. Later stages (polls, Whiteboard, Learner Profile) each have their own flag in the same file.
7. **Until the server has it, the app offers nothing.** A signed-in class with no `list_bulletins` shows no Bulletins and sends nothing (the rule Per-student options 8 set). The student page shows no tab when the `bulletins` route is not there.
8. **Demo Mode works** for every slice.
9. **Every write is idempotent** through `p_idempotency_key` (`fv_idem_check`, `fv_idem_store`; CLAUDE.md rule 7). A student's writes repeat safely by their own shape (one row per student per bulletin).
10. **Hidden means hidden.** An Undo bar, a confirm, a menu or a composer that is closed is checked in a browser to be out of sight at rest. The board's own Undo bar showed before any click because a CSS `display` rule beat the `hidden` attribute; the Quizzes board had the same fault. It is a line in every brief and a check in every review.
11. **No name an ad blocker hides.** Classes and ids start with `bulletin-` (teacher) or `sp-bulletin-` (student). None is on the list today (`tests/fixtures/adblock-hidden-names.txt`; `.post-ad`, `.feed-ad` and their kin are, so nothing is named `post-…` or `feed-…`). `tests/adblock-names.test.js` stays green and the reviewer's browser check runs with the rules on.
12. Text reaches HTML only through `esc`. A student's sentence is always text, never HTML. Labels in Title Case, hints in plain sentences.
13. Motion 150 to 250 ms; a new bulletin glides in; nothing fades in; nothing moves under Reduce Motion.
14. **Nothing here is a grade.** No count, reaction, answer or sentence reaches `calc.js`, a report, the Comment Bank or Generate.

## What exists already

Traced on `main` at `68cf3dd8` on Nov 17. File and line as they stand there.

### The teacher's app

- **Top tabs** are `TB_PAGES` (`shared/constants.js:996-1002`), drawn by `renderDock` with no per-class condition. A page is a path (`/assignments`), not a hash. A new page is named in eight places, and `tests/app-routes.test.js` and `tests/sw-precache.test.js` fail if one is missed: `teacher/router.js` (`_routes` `:5-13`, `_titles` `:15-23`, the dock branch `:332-338`), `teacher/app.html`, `sw.js` (`PRECACHE_URLS` and `APP_ROUTES` `:272-280`), `netlify.toml`, `serve.json`, `scripts/e2e-server.mjs`, `scripts/dev-local.mjs`, and the tab list in `e2e/phone-width-desktop-pages.spec.js:42-48`.
- **A feature with tables of its own and no outbox**: sticker codes. `shared/data-scan-labels.js` calls the server directly (`_callRpcWithAuthGuard`, `:214`) with a new idempotency key per press, shows the answer where the teacher pressed, and never touches the sync dot. Bulletins follow it (see "How it is built").
- **Handouts cannot be reused for a bulletin's files.** `assessment_resource.assessment_id` is `not null` (`migrations/2026111170_handouts_links.sql:336-356`), and the table's rules, the storage rules, the upload queue and the student functions all test the assessment. A PDF's pages sit in `student-photos` under `<class>/handouts/…`; that bucket has a fence that names every allowed path (`:1124-1139`) and a nightly sweep that reads its names (`:1085-1110`). Adding a path there means changing both.
- **Deleting stored files** is by a queue: a row's delete trigger writes the paths to `submission_file_removal` (`2026111170:443-462`), and the `student-submit` function's worker deletes them every ten minutes (`send-routes.ts:161-162`, cron job `fv_photo_removal`). The worker deletes only paths that match a pattern it knows (`supabase/functions/_shared/storage-rest.ts:76`, `:86`).
- **A class's purge** is a cascade: `fv_retention_cleanup` deletes the class 30 days after it is deleted (`migrations/20261012_course_soft_delete.sql:119-175`), and a table with `references course(id) on delete cascade` goes with it (`course_opened`, `2026111704:144-147`). A student deleted for good is `delete from enrollment` (`20261019_withdraw_students.sql:140-201`); a table with `references enrollment(id) on delete cascade` goes with them (`scan_label`, `2026111710:145`). Withdrawing a student deletes nothing.
- **A table only functions touch**: `scan_label` has row security on, no policy and no grant to anyone (`2026111710:156-157`); three `security definer` functions answer for the signed-in teacher's own class. New tables are named in `tests/db/table-owners.mjs`, or its run fails.
- **Live updates.** The teacher's app uses Supabase Realtime for one thing: a class's `course_sync_cursor` row (`shared/data.js:957-967`), the only table in the `supabase_realtime` publication (checked on the live database, Nov 17). It carries a version number and no student data. Everything else is a pull, at most every 30 seconds. The board's "the TV view reads answers live through Realtime, which the teacher app already uses" would put students' answers on a new channel; this plan does not (see "How it is built").
- **Full screen** has one precedent: `requestFullscreen` on the student Overview (`teacher/page-student.js:2968-2969`). There is no TV view yet.
- **The Dashboard** is one string (`teacher/page-dashboard.js:186-339`). Two tiles already ask for data of their own and draw again when it arrives: `StudentVoice.load` (`:248-258`) and the photo-expiry line (`shared/photo-expiry.js:60-73`, once per page load).
- **Learner Profile** is `_profileTabHtml` (`teacher/page-student.js:2303`), a list of sections in order; `teacher/learner-profile.js` is pure HTML from a model. A new section is one more function in that list.
- **Observations.** `addQuickOb(cid, sid, text, dims, sentiment, context, …)` (`shared/data-observations.js:194`). The shared dialog is `ObsCapture.openDialog` (`shared/obs-capture.js:1752`); it has no option for words already filled in.
- **The teacher sees nothing a student has opened today.** `TEACHER_SEES_OPENED = false` (`teacher/student-page-students.js:45`), and the server sends a teacher no `seen_at`, because whether a teacher sees which feedback a student opened is still open (DECISIONS, "Per-student options" 4). Colin's decision 4 for Bulletins settles Seen **for bulletins only**. It does not turn Feedback Opened on, and this plan does not touch `grade_return.seen_at`.
- **Backups and exports** name what they hold. The class backup is a fixed list of fields (`teacher/dash-class-manager.js:8084`); Download All My Data is a fixed list of sheets (`teacher/export-all.js`). A new table is in neither until it is added.

### The teacher's phone app

- Three tabs: `TABS = ['students', 'observe', 'grade']` (`teacher-mobile/tab-bar.js:12`), three buttons in `teacher-mobile/index.html:191-225`, drawn by `_renderTab` (`teacher-mobile/shell.js:724-745`).
- A photo is taken with a file input that opens the camera (`capture="environment"`, `teacher-mobile/add-work.js:254`) and made smaller with `PhotoShrink.prepare` (`:371` onward), the same call the desktop uses. There is no class-level photo anywhere in the phone app: every photo today belongs to one student's work.
- The phone loads `shared/data.js` and its friends, so a data layer written once serves both.

### The student page

- **Tabs** are named in four places in `s/page-view.js`: `TABS` (`:2145-2157`), `TAB_BODIES` (`:1646-1649`), `TAB_IDS` (`:2278`) and `newsOf` (`:2163-2173`), which makes each tab's red count. The bar is drawn twice (top for a Chromebook, bottom for a phone). `e2e/student-card-shell.spec.js:33` and `tests/student-card-shell.test.js:48-66` hold the list to three.
- **The opening tab** is set in one place: `s/app.js:2278-2289`, inside `openPage`, "A class opened afresh starts on Assignments". It runs only when no page is held, so coming back to an open class keeps the tab; the tab is kept in memory, not in storage.
- **The page is read once.** `openPage` asks the `page` route (`s/app.js:2267`) and nothing asks it again: no timer, no read on focus. The one exception is Reflect, which asks `forms` again when its tab is pressed and its copy is over 20 seconds old (`:1906`). Bulletins need a route and a freshness rule of their own.
- **Every route is on three lists**: the edge function's (`handler.ts:274-295`), the page's own `CLASS_ROUTES` (`s/app.js:2329-2356`), and the reply's allowed keys (`card-routes.ts:348-360` for `page`; `tests/student-submit-allow-list.test.js` holds SQL and TypeScript to the same keys). A key not on the list is dropped.
- **The edge function** reaches the database over its own connection and calls `student_submit` functions; it never validates a session itself (`index.ts:35`, `:84-86`). Its tests run under Node with stand-in database calls (`tests/student-submit-*.test.js`).
- **Seen, for returned work**: a row counts once it has been 60% on screen for 600 ms in a tab someone is looking at (`s/app.js:1534-1654`), sent in batches. Bulletins use the same rule and the same watcher.
- **Write limits** are per card per hour, counted in `student_submit.write_log`, whose `kind` is a closed list: `reflect`, `seen`, `finish`, `answer` (`migrations/2026111150_student_page_last_changes.sql:222`). A new kind means widening that check.
- **Students' phones cannot use Realtime.** `s/index.html` loads no Supabase library and holds no key, only the project's address (`:23-25`); a card sign-in is not a Supabase sign-in. The board assumed this; it is right.
- **Links.** A link on an assignment card opens at once (`s/page-view.js:741-751`). "Open this website in a new tab?" exists only inside the handout viewer, as a private function (`shared/handout-viewer.js:379-413`).
- **Pages to swipe through**: `s/page-carousel.js` is written for handouts (`kind === 'handout'`, `:48-75`).
- **Groups.** A group exists only on an assessment (`assessment.collab_config`), read by `student_submit._group_members` (`migrations/2026111120_markup_reflect_revise.sql:1391-1411`). The student page shows a group as counts only: "no name of anyone in the group" (`shared/student-view.js:963`). The board's Whiteboard shows "for Cece, Noor and Sam" on a student's phone, which that rule forbids today (decision 8).
- **Demo Mode** on the student page is its own world: hand-written sample data in `s/app.js` (`demoPage`, `:1041-1075`; `DEMO_ANSWERS`, `:1150`). It shares one thing with the teacher's Demo Mode, read-only: the per-student options kept in `localStorage` (`s/student-data.js:743-753`).
- **Preview as Student** draws the student's page from the teacher's own data with the student page's own code (`teacher/preview-student.js:45-63`) and sends nothing.

### Live numbers

gradebook-prod, read only, counts only, Nov 17.

| Count                                                         |                          |
| ------------------------------------------------------------- | ------------------------ |
| Classes, and classes with the student page on                 | 7, and 4                 |
| Students in those 4 classes (smallest, middle, largest class) | 106 (22, 27, 30)         |
| …with a working card                                          | 84                       |
| …who have ever opened it, and in the last 24 hours            | 82, and 66               |
| Students whose page is paused                                 | 0                        |
| Student sessions open now                                     | 52                       |
| Assessments with groups set                                   | 4 of 149                 |
| Tables Realtime publishes                                     | 1 (`course_sync_cursor`) |

What they decide: 22 of 106 students have no card, so a "Seen by 18 of 26" that counts them would never reach 26 (decision 6). About 66 phones a day is the load any refresh timer is sized for. Groups are rare, so My Group is the last piece of the Whiteboard, not the first.

## How it is built

- **A bulletin is posted while online; nothing is queued.** Posting, editing and deleting call the server directly and show the answer where the teacher pressed ("Posting…", then the bulletin, or "That didn't post. Try again."), as sticker codes do. The server's id comes back in the answer, so no local id is ever made (CLAUDE.md rule 6 cannot be broken) and `shared/data.js` is not touched. A bulletin that went out an hour after it was written, when the Wi-Fi came back, would be worse than one that says it did not post. The words being written are kept on the device until the post lands.
- **A bulletin's files** (a photo, a PDF's pages) are JPEG pages made in the browser by `PhotoShrink.prepare`, uploaded before Post is pressed, in a private bucket of their own, `bulletin-files` (JPEG only, 2 MB a page), as handout files got `handout-files`. A bucket of its own means the fence and the nightly sweep on `student-photos` are not changed. Same project and region; no new party or key. A web page, a text file or an EPUB on a bulletin is not in the first stage (see "Not in this plan").
- **The teacher's screens ask on a timer, and only while they are showing.** The Bulletins page: when it opens, after each of the teacher's own writes, and every 15 seconds while its tab is the one being looked at. The Dashboard tile: when the Dashboard draws, at most every 30 seconds. Present and the Whiteboard queue: every 2 seconds, for that one bulletin. One teacher's screen asking every 2 seconds is 30 small reads a minute. Nothing rides Realtime, so no student's answer is ever on a channel.
- **The student's page asks the `bulletins` route**: when the class opens, when the Bulletins tab is pressed and its copy is over 20 seconds old (Reflect's rule), when the student comes back to the tab from elsewhere, and every 30 seconds while the Bulletins tab is showing in a tab someone is looking at. Thirty phones in one room is one read a second. The answer carries the open class's bulletins and, for every class on the device, how many are new, for the red count and for "2 new" in Your Classes.
- **The opening rule needs that answer before the first draw.** `openPage` asks `page` and `bulletins` together. If `bulletins` has not answered within one second of `page`, the class opens on Assignments and the tab fills in when it arrives.
- **Nothing existing is patched for stage 1 except three small things**: the `write_log.kind` check gains `bulletin`; the removal worker learns the new bucket's path pattern; `tests/db/table-owners.mjs` gains the new tables. `student_submit.page` and `_session_classes` are not changed: the counts come from the new route.
- **A contract first.** B1a's first commit is `migrations/local-test/bulletins-contract.md` (as handouts have `handouts-links-contract.md`): every table, column, function, argument and answer below, exact. B1b, B1c, B1d and B1f build to it.

### The contract in outline

Tables, all in `public`, row security on, no policy, no grant: only the functions below touch them.

| Table               | Holds                                                                                                                                                                           | Goes with                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `bulletin`          | class, kind (announcement, reminder, poll, whiteboard), words, a link's address and name, pinned until, a linked assessment, Reactions on, shown again at, posted at, edited at | its class (cascade)                                       |
| `bulletin_file`     | class, bulletin (empty until posted), photo or PDF, name, pages, bytes, state                                                                                                   | its bulletin or class; its delete queues the stored files |
| `bulletin_seen`     | bulletin, student (enrolment), when first seen                                                                                                                                  | its bulletin; its student (cascade)                       |
| `bulletin_reaction` | bulletin, student, one of Got It, Done, I Have a Question, when                                                                                                                 | the same                                                  |
| `bulletin_answer`   | stage 2: bulletin, student, the choice, when                                                                                                                                    | the same                                                  |
| `bulletin_sentence` | stage 3: bulletin, student, the group-mates it is also for, words, sent at, shown at, deleted at                                                                                | the same                                                  |

The teacher's functions (`public`, signed-in teachers only, each checks `fv_owns_course`):

- Stage 1: `list_bulletins(class)` (the bulletins with their files, each with Seen by N of M and the reaction counts, and how many students can see the class's Bulletins); `post_bulletin`; `edit_bulletin`; `delete_bulletin`; `start_bulletin_file`, `finish_bulletin_file`; `list_bulletin_seen(bulletin)` (names: not seen yet, seen, each reaction); `show_bulletin_again`.
- Stage 2: `close_bulletin`; `bulletin_live(bulletin)` (a poll's totals, and names for the teacher).
- Stage 3: `show_bulletin_sentences(bulletin, sentence ids)`; `delete_bulletin_sentence`; `restore_bulletin_sentence`; `fv_bulletin_cleanup()` on a timer of its own.
- Stage 4: `bulletin_student_summary(student)`.

The student's functions (`student_submit`, run only by the edge function) and their routes:

- Stage 1: `bulletins` → route `bulletins`; `bulletin_seen` → `bulletin-seen`; `bulletin_react` → `bulletin-react`; `bulletin_file_links` → `bulletin-files` (links that last 60 seconds, as a handout's).
- Stage 2: `bulletin_answer` → `bulletin-answer`.
- Stage 3: `bulletin_sentence` → `bulletin-sentence`.

Limits the first migration sets, the author's and easy to change, listed for Colin: a bulletin's words 2,000 characters; a link is http or https, 2,000 characters; 20 pages on one bulletin; 2,000 bulletin pages a class; a student's reactions and Seen marks 120 an hour.

## Migrations

Each is its own file, small enough to send whole through Supabase's `apply_migration` (40 KB at most; the one that could not be sent was 140 KB). Each is tested on embedded PostgreSQL 17 with a pre-check, a post-check and a tested undo, shown to Colin, applied only on his OK, and then the snapshot (`docs/schema.generated.sql`) and the baseline are refreshed from live. None is ever tried against `gradebook-prod`.

| Migration                  | Adds                                                                                                                                                                                       | Changes that exists                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| M1 `…_bulletins`           | `bulletin`, `bulletin_file`, `bulletin_seen`, `bulletin_reaction`; the teacher's eight stage 1 functions; the `bulletin-files` bucket and its four storage rules; the file-removal trigger | Nothing                                                                                                           |
| M2 `…_bulletins_student`   | `student_submit.bulletins`, `bulletin_seen`, `bulletin_react`, `bulletin_file_links`; the shared "may this student see this bulletin" function                                             | `student_submit.write_log`'s `kind` check gains `bulletin` (a constraint swapped in one transaction)              |
| M3 `…_bulletin_polls`      | Poll choices and Closed on `bulletin`; `bulletin_answer`; `close_bulletin`, `bulletin_live`; `student_submit.bulletin_answer`                                                              | `list_bulletins` and `student_submit.bulletins` (this plan's own, guarded by md5) answer with polls               |
| M4 `…_bulletin_whiteboard` | `bulletin_sentence`; Names on Screen on `bulletin`; the three sentence functions; `student_submit.bulletin_sentence`; `fv_bulletin_cleanup` and its timer                                  | The same two functions answer with sentences. `fv_retention_cleanup` is not touched: the clean-up is its own job. |
| M5 `…_bulletin_profile`    | `bulletin_student_summary`                                                                                                                                                                 | Nothing                                                                                                           |

Each migration follows the checklist: every function it replaces is checked against the live `md5(pg_get_functiondef(…))` and stops with nothing changed if it differs; guards first, one transaction, a lock timeout, safe to run again; a fast stop and a full removal, each proven; pre-check counts in the header; the PR body one review a non-specialist can read, ending "what you accept by applying this".

The edge function is deployed after M2 (and after M3 and M4), on Colin's OK with that migration, and never before the functions it calls exist. The version before it is kept to put back.

## Slices

One PR per slice. A migration's PR is pushed once, after it is applied, with the live snapshot, so CI runs once and passes.

| Slice       | What                                                                    | Waits for                                  | Builder | Review     |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------ | ------- | ---------- |
| **Stage 1** | **Bulletins, Seen and reactions**                                       |                                            |         |            |
| B1a         | The contract; M1 (the teacher's side of the database)                   | Colin's go; decision 6                     | Opus    | Fable high |
| B1b         | M2 (the student's side); the edge routes; the removal worker            | The contract                               | Opus    | Fable high |
| B1c         | The data layer and the teacher's Bulletins page                         | The contract to build; M1 applied to merge | Sonnet  | Opus       |
| B1d         | The student's first tab                                                 | The contract; the gear-menu PR; decision 2 | Sonnet  | Opus       |
| B1e         | The Dashboard tile                                                      | B1c; the Dashboard plan's D2; decision 1   | Sonnet  | Opus       |
| B1f         | The phone app: the feed, Seen by, write a bulletin, a photo on the spot | B1c                                        | Sonnet  | Opus       |
| B1g         | Turn it on: the flag, the privacy page, Download All My Data, help      | B1a to B1f; decision 9; Colin's look       | Sonnet  | Fable      |
| **Stage 2** | **Quick Polls and Present**                                             |                                            |         |            |
| B2a         | M3; the `bulletin-answer` route                                         | Stage 1 on                                 | Opus    | Fable high |
| B2b         | The teacher: make a poll, names and totals, Close, Present; the phone   | B2a's contract                             | Sonnet  | Opus       |
| B2c         | The student: answer a poll                                              | B2a's contract                             | Sonnet  | Opus       |
| **Stage 3** | **Whiteboard**                                                          |                                            |         |            |
| B3a         | M4; the `bulletin-sentence` route; the clean-up                         | Stage 2; decisions 3 and 7                 | Opus    | Fable high |
| B3b         | The teacher: the queue, Show These N, Undo, the TV                      | B3a's contract                             | Sonnet  | Opus       |
| B3c         | The student: write a sentence                                           | B3a's contract                             | Sonnet  | Opus       |
| B3d         | The phone: the queue                                                    | B3b                                        | Sonnet  | Opus       |
| B3e         | My Group                                                                | B3c; decision 8                            | Opus    | Fable      |
| **Stage 4** | **Learner Profile**                                                     |                                            |         |            |
| B4a         | M5                                                                      | Stage 3                                    | Opus    | Fable high |
| B4b         | The Learner Profile section; Add as Observation                         | B4a                                        | Sonnet  | Opus       |

### B1a. The contract and the teacher's side of the database

**Build.** `migrations/local-test/bulletins-contract.md`, then M1 as in "Migrations". Seen by N of M is counted in the database: N is the students who have seen it, M is the students who can (decision 6); both leave out a withdrawn student and a paused one. `delete_bulletin` deletes the bulletin and everything students did on it, and queues its files; **it deletes data, so its PR says so for Colin's review** (CLAUDE.md rule 2). A file started and never posted is dropped after two hours, as an unfinished handout is.

**Tests** (a script of scenarios, `migrations/local-test/bulletins.py`, in the shape of `scan_labels.py`): post, edit, delete; another teacher can read and change nothing; a paused and a withdrawn student are in neither N nor M; a student deleted for good takes their rows; a purged class takes everything and queues every file; the same key twice posts once; two posts at once; the defaults; apply; undo. `npm run test:db` with the migration loaded.

**Done when.** Colin has the SQL and the plain-words PR, and the pre-check on live shows nothing the migration would touch.

### B1b. The student's side, and the edge routes

**Build.** M2. `supabase/functions/student-submit/bulletin-routes.ts` with the four routes, registered in `handler.ts` beside the others; every reply rebuilt from an allowed list of keys; a bulletin's file paths checked against the new bucket's pattern before they are signed. The removal worker (`_shared/storage-rest.ts`, `send-routes.ts`) learns `bulletin-files` and its path pattern, and deletes nothing it cannot match.

What a student is sent for a bulletin: its kind, words, link, files, times, whether Reactions is on, their own Seen and their own reaction. Never a count, never a name, never another student's anything. `bulletin_seen` keeps the first time only, so a repeat changes nothing. `bulletin_react` is refused when Reactions is off for that bulletin.

**Tests.** The scenarios script: a student of another class gets nothing; a paused student is refused on every route, mid-session too; a withdrawn student; a class with its page off; an expired card; Reactions off; the hourly limit; the answer holds no key outside the allowed list (`tests/student-submit-allow-list.test.js` gains the new routes). Handler tests under Node for each route. A test that the worker refuses a path outside the pattern.

### B1c. The data layer and the teacher's page

**Build.**

- `shared/data-bulletins.js`: reads and writes as in "How it is built"; Demo Mode keeps bulletins on the device in `gb-bulletins-<class>` (added to the keys Reset Demo Data and deleting a class clear, `shared/data-courses-terms.js:144-202`), with the sample class's bulletins from the board in `shared/seed-data.js`.
- `teacher/page-bulletins.js` and `teacher/bulletins.css`: the page at `/bulletins`, the tab after Assignments (boards B1 to B3). The box at the top opens in place; four kinds in one choice, with Quick Poll and Whiteboard not offered until their stages; a reminder's Until date and its linked assessment (it unpins itself after the date); a link with its name; + Add a File and a photo; Let Students React, off by default; Post the only blue button. The feed: pinned first, then newest first, one grey line of facts on each. "Seen by 18 of 26" opens the list under the bulletin, not seen first, with Show It Again on These N Phones. The ⋯ menu: Edit, Pin or Unpin, Delete (asks first and says what goes).
- A class with its Student Page off: the page says so in a sentence with a link to Class Settings, and Post still works.
- The eight places a new page is named.

**Files.** `shared/data-bulletins.js`, `teacher/page-bulletins.js`, `teacher/bulletins.css` (new); `shared/constants.js` (`TB_PAGES`), `teacher/router.js`, `teacher/app.html`, `sw.js`, `netlify.toml`, `serve.json`, `scripts/e2e-server.mjs`, `scripts/dev-local.mjs`, `shared/seed-data.js`, `shared/data-courses-terms.js`, `e2e/phone-width-desktop-pages.spec.js` (a line or a few each).

**Tests.** Unit: the data layer in Demo Mode and against stand-in server answers (posted, refused, no server function yet, a late answer for another class). Browser (`e2e/bulletins-teacher.spec.js`, Demo Mode, flag on): write each kind, pin, edit, delete, the Seen list; the composer and the confirm are not on screen at rest; flag off, no tab.

### B1d. The student's first tab

**Build.**

- `s/bulletins.js` (the screen: asking, the freshness rule, Seen, reactions, files) and `s/bulletins-view.js` (pure HTML from a view, so Preview as Student can draw it). `s/page-view.js` gains the tab in its four lists, first in the bar; `s/app.js` gains the four routes in `CLASS_ROUTES` and the opening rule.
- The feed (boards C1 to C3): the teacher's bulletins as bubbles, oldest at the top, a red New line, opened at the New line or at the newest. The tab's red count is the bulletins not seen. "2 new" beside each class in Your Classes.
- Seen by the rule returned work uses. Reactions: three words, one tap, their own choice shown, nothing about classmates.
- A file's pages swipe sideways in the bubble; a tap opens the page full size. `s/page-carousel.js` is written for handouts, so the slice either teaches it a second kind of source or draws its own from the same parts; the builder says which in the PR.
- A link is a card with the site's name. A tap asks "Open this website in a new tab?" with the address; the question moves out of the handout viewer into one shared function both use. Links on assignment cards keep opening at once; that is a separate question for Colin, listed under "Found on the way".
- A reminder linked to an assignment carries that card's status band and opens the card.
- **The opening rule** as Colin settles it (decision 2).
- Demo Mode: the demo card reads the demo teacher's bulletins from the device, read-only, as it reads the per-student options; with none, the board's samples. Preview as Student shows the tab and sends nothing, a Seen mark included.
- Built on top of the gear-menu PR (it replaces Log Out and the class picker in `s/page-view.js`, `s/app.js` and `s/student.css`), which lands first.

**Files.** `s/bulletins.js`, `s/bulletins-view.js`, `s/bulletins.css` (new); `s/page-view.js`, `s/app.js`, `s/index.html`, `s/student-data.js`, `shared/student-view.js`, `shared/handout-viewer.js`, `teacher/preview-student.js`, `teacher/app.html`, `sw.js`.

**Tests.** Unit: the four tab lists agree; the opening rule in each case (bulletins, none, the answer late, the answer failed, coming back to an open class); the count; Seen sent once; a reply with an unknown key ignored. `tests/student-card-shell.test.js` and `e2e/student-card-shell.spec.js` change from three tabs to four with the flag on and stay three with it off. Browser (`e2e/bulletins-student.spec.js`): the demo card at 390 px opens on Bulletins at the New line; a reaction; a link asks first; no confirm on screen at rest.

### B1e. The Dashboard tile

Boards A1 to A3: the pinned reminder and the latest bulletins, one line each with Seen by; Write a Bulletin; Open Bulletins →. A row opens that bulletin on the page, scrolled to and outlined. Empty: "Nothing Posted Yet" at the filled height. Where it sits is decision 1; the tile is built for the place Colin picks, and mounts in the Dashboard plan's row (D2). Files: `teacher/dash-bulletins.js`, `.css` (new); one mount line each in `teacher/dash-overview.js` and `teacher/page-dashboard.js`.

### B1f. The phone app

Colin, Nov 17: "add the bulletin board to the teacher app as well, so that they can post from their phone".

**Where it lives: a fourth tab, Bulletins.** The three tabs are each one job about students (find one, observe one, grade one); a bulletin is about the class, and belongs under none of them. Four tabs fit the bar. `MTabBar`'s list, `index.html`'s buttons and `_renderTab` each gain one entry.

**Build.** `teacher-mobile/tab-bulletins.js`: the feed and Seen by (the same list, not seen first); Write a Bulletin with an announcement, a reminder, a link, a file, and **Photo of the Board**: the camera opens, the photo is made smaller by `PhotoShrink.prepare` as every photo is, the composer reminds the teacher once to check for students' faces, and Post sends it. It uses `shared/data-bulletins.js`: the same functions as the desktop page, no second write path. Demo Mode works.

**What waits.** Making a Quick Poll and reading its totals come to the phone in B2b. The Whiteboard queue comes in B3d, where it matters most (decision 7): on touch, the first tap crosses a sentence out and shows Delete and Keep; the second deletes.

**Tests.** Unit on the tab's model; browser at 390 px in Demo Mode: write a bulletin with a made-up photo and see it in the feed; the tab is absent with the flag off.

### B1g. Turn it on

- The `bulletins` flag on by default.
- `privacy.html`: what is stored (that a student has seen a bulletin and when, a reaction), who sees it (their teacher only), how long (with the class). The page promises teachers an email before a change to how student information is stored takes effect: **Colin sends it before the release that carries this slice.**
- Download All My Data gains a Bulletins sheet. The class backup does not hold bulletins, as it does not hold handouts; its note says so.
- A help article for the page, with pictures (`scripts/help-shots.mjs`).
- DECISIONS and CLAUDE.md's Current state.
- **The check before it merges**, by someone who built none of it: every board in a real browser, the teacher's page at 1280 × 800, the student's tab and the phone app at 390 px, light and dark, ad-block rules on, against the board; then a signed-in pass in Colin's test class: post, open the card on a phone, watch Seen by rise, pause that student and see them leave the count and lose the tab. Then Colin looks at it with the flag set on his own devices before the default changes.

### Stage 2. Quick Polls and Present

Board D. A poll is a bulletin with choices (the teacher's own, Scale 1 to 5, or the class's groups). A student taps once and can change it until Close. The teacher's page shows totals and, on opening it, names; **Present** shows totals only, full screen, building as answers arrive (asked every 2 seconds). Present opens full screen in place and can also open in a window of its own to drag to a second screen. Students see their own answer and "Your teacher sees your answer. The class sees totals only." The server refuses an answer on a closed poll and a choice that is not one of the bulletin's. A poll is not a reflection: it is not kept on reports and feeds nothing. "A groups poll becomes the groups" (the board's pleasant surprise) is the last item of the stage and is dropped from it if it would touch the assessment form.

### Stage 3. Whiteboard

Boards E1 and E2, with Colin's rule (Nov 17): "the whiteboard messages from students should filter first to the teacher before being 'approved' when the teacher hovers it- it crosses out, and when clicked, it deletes."

- Every sentence lands in the teacher's queue. Nothing reaches the TV until the teacher presses Show These N on the TV, and that press shows exactly the sentences the queue listed: one that arrived since waits.
- Pointing at a sentence crosses it out; a click deletes it. The server marks it deleted at once, so it can never be shown; Undo is offered (how long is decision 3); after that it is removed for good, and the clean-up removes any a closed laptop left behind. A deleted sentence counts for nothing and is kept nowhere.
- Keyboard: Tab or the arrow keys move a focus ring without crossing anything out; Delete or Backspace deletes the one in focus. Touch: the first tap crosses out and shows Delete and Keep.
- The student's phone says "Sent to your teacher" for every sentence and never changes, so a deleted one looks like any other. A student never sees another student's sentence on a phone, only on the TV.
- The TV shows sentences without names unless Names on Screen is on for that bulletin.
- The server refuses a sentence on a closed bulletin, caps its length, and allows a set number per student per bulletin (decision 3).
- **Where the teacher approves** when the laptop is mirrored to the TV is decision 7, and it shapes B3b and B3d.
- **My Group** (B3e) reads an assessment's groups, and is last. Whether a student's phone may name their group-mates is decision 8.

### Stage 4. Learner Profile

Board F. A section in the Learner Profile tab (the board calls it "On the Bulletin Board"; it takes the new name): bulletins seen, polls answered, sentences shown on the TV and how many of those with a group; then the student's own shown sentences. Counts and the student's words; no percent, no level, nothing that feeds a grade. **Add as Observation** opens the observation dialog with the sentence filled in (`ObsCapture.openDialog` gains an option for the words) and saves through the observation call that exists. A participation grade is not in this design: it would be grade math and runs against BC's reporting policy.

## Critical path, and what runs side by side

Stage 1's path is: Colin's go and decision 6 → the contract → M1 written, reviewed and **shown to Colin** → applied → M2 and the edge routes shown to Colin → applied and deployed → B1c, B1d and B1f merge → B1g.

- **Colin's two OKs on SQL are the narrowest points.** CI's database check fails any app code that calls a function the live database does not have (`scripts/check-db-drift.mjs` reads `shared`, `teacher` and `teacher-mobile`), so B1c and B1f cannot merge before M1 is applied. The SQL is brought to him as soon as it is reviewed, not when the screens are ready.
- **While the database is in review, three builders work in Demo Mode**: B1c (the teacher's page), B1d (the student's tab), and, once B1c's data layer has merged or settled, B1f (the phone). B1a and B1b are two builders with two test databases, both building to the contract.
- B1e waits for the Dashboard's row and decision 1; it is not on the path to turning Bulletins on, which can happen with the tile to follow.
- Stages 2, 3 and 4 follow in order. Each stage's migration is brought to Colin early in the same way.

## One writer per file

| File                                                                                             | Writers, in order                                                                  |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `s/page-view.js`, `s/app.js`, `s/student.css`                                                    | The gear-menu PR (in flight), then B1d. Later stages write `s/bulletins*.js` only. |
| `s/bulletins.js`, `s/bulletins-view.js`, `s/bulletins.css`                                       | B1d, B2c, B3c, B3e                                                                 |
| `supabase/functions/student-submit/handler.ts`                                                   | B1b (one registration)                                                             |
| `supabase/functions/student-submit/bulletin-routes.ts`                                           | B1b, B2a, B3a                                                                      |
| `supabase/functions/_shared/storage-rest.ts`, `send-routes.ts`                                   | B1b                                                                                |
| `shared/data-bulletins.js`                                                                       | B1c, B2b, B3b, B4b                                                                 |
| `teacher/page-bulletins.js`, `teacher/bulletins.css`                                             | B1c, B2b, B3b                                                                      |
| `teacher/bulletins-present.js`                                                                   | B2b makes it, then B3b                                                             |
| `teacher-mobile/tab-bulletins.js`                                                                | B1f, B2b, B3d                                                                      |
| `teacher-mobile/index.html`, `tab-bar.js`, `shell.js`                                            | B1f                                                                                |
| `teacher/dash-overview.js`, `teacher/page-dashboard.js`                                          | The Dashboard plan's D1, D2 and D4, then B1e (one mount line each)                 |
| `teacher/dashboard.css`                                                                          | The Dashboard plan only. The tile has its own stylesheet.                          |
| `shared/handout-viewer.js`, `shared/student-view.js`, `teacher/preview-student.js`               | B1d                                                                                |
| `teacher/page-student.js`, `teacher/learner-profile.js`, `shared/obs-capture.js`                 | B4b                                                                                |
| `shared/constants.js`, `teacher/router.js`, `netlify.toml`, `serve.json`, the two server scripts | B1c                                                                                |
| `teacher/app.html`, `sw.js`                                                                      | A line or two from each slice; merged one at a time                                |
| `shared/build-flags.js`                                                                          | The Dashboard plan's D1 makes it; B1g and each later stage change one line         |
| `privacy.html`, `teacher/export-all.js`                                                          | B1g                                                                                |

**Not touched:** `shared/calc.js`, `shared/data.js`, `shared/offline-queue.js`, `shared/photo-queue.js`, `teacher/page-assignments.js`, `student_submit.page`, `_session_class`, `_card_refusal`, `fv_retention_cleanup`, the `student-photos` bucket and its rules, and every handout table and function.

## Privacy

Student privacy is the first test of every choice here. The lines about what a privacy officer would say are readings of published guidance; the real people have to be asked (decision 9).

**What is stored about a student.**

| What                                              | Stage | Kept as                                    |
| ------------------------------------------------- | ----- | ------------------------------------------ |
| That they saw a bulletin, and when they first did | 1     | one row per student per bulletin           |
| Their reaction, if Reactions is on                | 1     | one row, replaced when they change it      |
| Their answer to a poll                            | 2     | one row, replaced until the poll is closed |
| A Whiteboard sentence, and who it is also for     | 3     | one row per sentence                       |

Nothing else: no device, no place, no address beyond the keyed hash the card sign-in already logs for 30 days. No reason is ever kept for a deleted sentence.

**Who can read it.** The class's own teacher, through functions that check the class is theirs. The student, their own rows only. A classmate, nothing: no name, no count, no reaction. On the TV: a poll's totals, and shown sentences without names unless the teacher turns Names on Screen on for that bulletin. No role can read the tables directly. Seen and reactions are for the teacher only (Colin's decision 4).

**How it goes.** A bulletin deleted: everything under it, and its files. A student deleted for good: every row of theirs. A class deleted: everything, at the 30-day purge. A sentence the teacher deletes: marked at once, removed for good after Undo. A withdrawn student's rows stay with their record, as their scores do, and are left out of every count and list. The year-unopened rule for students' photos does not touch a bulletin's files; like handouts they stay while the class exists. A Photo of the Board may catch students in it, so the composer reminds the teacher, once, to check for faces.

**What the server enforces, each with a test that asks it directly.**

- A paused student, a withdrawn student, a class with its page off, a stopped or expired card: refused on every route, in the middle of a session too.
- A student is sent only their own class's bulletins and only their own Seen, reaction, answer and sentences.
- A paused or withdrawn student is in no Seen count and no list.
- A reaction only where Reactions is on; an answer only while the poll is open and only one of its choices; a sentence only while the bulletin is open, within the length and the number allowed.
- A sentence is never sent to the TV view until the teacher has shown it; a deleted one never.
- A link is http or https. Nothing is fetched from it. A student's phone asks before it opens.
- A teacher reads and changes only their own classes' bulletins.

**No new party.** No push service, no embedded player, no preview fetched from a linked site, no Realtime channel carrying a student's answer. One more private bucket in the same project and region.

**The privacy page** is updated in B1g, and teachers are emailed before the release that carries it, as the page promises.

## Decisions that are Colin's

Settled on Nov 17, not reopened:

1. One-way feed: students read, react and answer polls; no replies or posts except Whiteboard sentences the teacher approves.
2. Its own page; the first tab on the student page; on the teacher's side a top tab after Assignments.
3. A full tile on the teacher Dashboard with the latest few and their Seen counts.
4. Seen and reactions visible to the teacher only; Seen always recorded; Reactions a per-bulletin switch, off by default: Got It, Done, I Have a Question.
5. Link cards only, no embedded players.
6. Quick Polls are bulletins; names on the teacher's screen, totals only on the TV.
7. Whiteboard sentences anonymous on the TV by default, Names on Screen per bulletin; every sentence reaches the teacher first; pointing crosses out, clicking deletes; one button shows the rest.
8. Learner Profile: counts and the student's own sentences; no grade, no percent.

And: the name is Bulletins; the teacher's phone app gets it too, with a photo on the spot.

Open. Each goes to him one at a time, with what the council would say and a pick. Numbers 1 to 5 follow the session brief; 6 to 9 were found while tracing.

1. **Where the Bulletins tile sits on the Dashboard**: tabs with the Inbox, a row of its own, or stacked in the left two thirds. He chose a full tile; the Dashboard designer's pick (tabs) puts the bulletins one click away. Gates B1e.
2. **What the student page opens on.** The designer's pick: Bulletins whenever the class has one, else Assignments. Gates B1d.
3. **The designer's numbers**: three Whiteboard sentences per student per bulletin, and an 8-second Undo. The app's other Undo is 5 seconds (Per-student options 6). Gates B3a.
4. (Dashboard: is the drop area blue at rest. `dashboard-inbox-plan.md`.)
5. (Dashboard: the designer's four picks. `dashboard-inbox-plan.md`.)
6. **Who counts in "Seen by N of M".** 22 of the 106 students in classes with the student page on have no working card. If M counts them, a bulletin never reaches "26 of 26" and Not Seen Yet always names students who cannot sign in. Gates B1a.
7. **Where the teacher approves Whiteboard sentences when the laptop is mirrored to the TV.** The queue with names would itself be on the TV. The ways out: approve from the phone app; a TV window dragged to a second screen; or a queue that hides words until pointed at. Gates B3b and B3d.
8. **May a student's phone name their group-mates?** The board's Whiteboard says "for Cece, Noor and Sam". Today's student page never names anyone in a group. Gates B3e.
9. **Go ahead before the district privacy officer has been asked?** Bulletins record what each student has seen and, later, what they answered and wrote. On sticker codes Colin chose to go ahead; this holds more. Gates B1g, not the building.

Taken from the board as drawn unless Colin says otherwise, and listed for him afterwards: Show It Again on These N Phones; a reminder that unpins itself after its date; no push; the author's limits under "The contract in outline"; a fourth tab on the phone; posting needs a connection.

## Not in this plan

- **Quizzes.** Its board has no decisions.
- **A web page, a text file or an EPUB on a bulletin.** The board lists them. They need the sealed frame's storage rules for a second kind of owner; a photo or a PDF covers the first stage. Its own slice after stage 1, if Colin wants it.
- **Web Push**, or any notice outside the page.
- **Replies, comments or a student's own posts.**
- **Bulletins in the class backup, Duplicate Class or Copy to Another Class.** As with handouts.
- **A participation grade.**
- **Turning on Feedback Opened** for returned work. Colin's Seen decision is for bulletins.
- **Realtime for anything new.**
- **The confirm on assignment-card links.** See below.

## Found on the way, for Colin, not started

1. **Assignment-card links open at once**; only links inside a handout ask first. Bulletins will ask. Making assignment cards ask too is a one-line change in behaviour for every student, so it is his call.
2. **A publication named `zero_data` on the live database** lists 142 tables across every schema, the sign-in and vault schemas included. Nothing subscribes to it (the only two replication slots are Supabase Realtime's own), so nothing is being sent anywhere. It looks left over from an earlier tool. Removing it is one statement, on his OK.
3. **`student_submit.seen` has no hourly limit and does not check that a piece was returned** (`migrations/2026110904_student_sessions_page.sql:657-683`): a signed-in student can mark any piece of their own class as seen. It shows nothing to anyone and only that student's own row changes. Worth tightening when that function is next opened.
4. **The Dashboard board's "Compare 2"** is a view the app does not have (`dashboard-inbox-plan.md`).
5. Two header comments say the Work Wall and its pictures are "Demo Mode only" (`shared/work-wall.js:20`, `shared/work-thumbs.js`); both work signed in.

## Risks

- **A student sees what they should not.** Another student's name, a sentence not shown, a bulletin of another class. Every such rule is in the database, each has a test that asks the server directly, and both database slices get a Fable review at high effort, given the code and the contract.
- **The first tab changes every student's page**, in every class with the student page on, the other teacher's too, on the day stage 1 is released. A class with nothing posted opens on Assignments exactly as today, with one more tab in the bar. The opening rule is one place in the code and has a test for each case.
- **A sentence on the TV that should not be there.** The server never sends the TV view an unshown or deleted sentence; Show is for the listed sentences only; and decision 7 settles where the queue is looked at.
- **Load from refresh timers.** Sized for today (about 66 phones a day, 30 in a room: one read a second). At a school's scale the timers need measuring first; the plan does not claim more.
- **The edge function is the live path for every student, every day.** Each deploy adds routes and changes none; the version before is kept to put back; the handler's tests run before every deploy.
- **The removal worker deletes files.** It learns one new pattern and still deletes nothing it cannot match. A wrong pattern means files are left, not lost.
- **Half a feature in a release.** The flag is off until a stage is whole, on every surface.
- **CI and the live database.** App code that calls a new function cannot merge until the migration is applied. The SQL goes to Colin early so screens do not sit finished and waiting.
- **The board changes after this plan.** Reviews are still running and phone boards are coming. Briefs are written from the board on the day.

## Working rules

- **Models.** Routine screens, wiring and test fixes on Sonnet; migrations, the edge function and anything about who can read what on Opus; the orchestrator on Fable. Every slice has a review on Opus or Fable by someone who did not build it, given the code and not the builder's conclusion; migrations and server rules get Fable at high effort.
- Builders work in worktrees of their own cut from `origin/main`, commit and push in small steps, and never touch the main checkout (`/Users/brown_colin/FullVision` sits on an old branch). A read-only agent is pointed at a folder checked to be at `origin/main`.
- One PR per slice; `test-and-format` passes before merge; the slice's own tests and its one browser spec are run locally; main's e2e run is checked after merging and fixed next if red.
- Every screen is tried in a real browser by someone other than its builder, at 1280 × 800 and 390 px, light and dark, ad-block rules on, against the board.
- A fault of the same kind twice is fixed at its cause.
- No migration is tried against `gradebook-prod`. No release without Colin's word.
