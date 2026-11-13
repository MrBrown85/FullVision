# A version for every score: design

Status: a design for review, written 2026-11-13. Nothing here is approved or built. This document changes no code and no SQL.

It answers one ruling. On 2026-11-13 the owner parked the resend of a refused score (step 5 of [`one-mark-save-design.md`](https://github.com/MrBrown85/FullVision/blob/claude/align-one-mark-design/docs/plans/one-mark-save-design.md), on branch `claude/align-one-mark-design`) and asked for the lasting fix: the server must be able to tell an older score from a newer one. How a score is saved today is in sections 1 and 2 of that document and is not repeated here.

Code is cited by file and function name on `origin/main` at `6e9b88fd`. Server functions are in `migrations/baseline/30-functions.sql`; tables are in `docs/schema.generated.sql`. Nothing was read from the live database.

Words used here:

- **Cell:** one student on one piece of work.
- **Part:** one thing in a cell that one call sets: the score and its + or −, one competency's level, one rubric criterion's row, one checklist box, the Overall Comment, the status (Missing, Excused, Late), the Note for the Report.
- **Outbox:** the list of changes waiting to go to the server (`shared/offline-queue.js`).
- **Made:** the moment the teacher made a change. **Arrived:** the moment the server got it. Offline, these can be hours apart.
- **Timed write:** a score call that says how long ago it was made. **Untimed write:** a call that does not. Every build of the app in use today sends untimed writes.

## 1. The problem

The server keeps no record of when a part was last changed. Every score function overwrites by student and work, and the last call to arrive wins (`upsert_score`, `upsert_tag_score`, `upsert_rubric_score`, `save_score_comment`, `set_score_status`, `clear_score`, `set_rubric_check`). Arrival order is not the order the teacher worked in. Three results follow; section 6 takes them one by one.

## 2. What a "newer" score is, and who decides

| Option                                                                                                                          | What it costs                                                                                                                                                                                                                        | What it cannot do                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) A version number on each part. The browser sends the number it saw; the server refuses a write made against an older number | A number kept on the server and in the browser's memory, saved copy and outbox. Every answer must hand back the new number. A write queued behind another for the same part needs its number rewritten when the first lands          | It cannot say which of two changes the teacher made last. It only knows the writer had not seen the other. So it refuses the teacher's latest tap whenever the device was behind. Phone scores a cell at 10:00; laptop, offline, scores it at 10:30; the laptop's score is refused. Today it lands. That is worse than today unless a screen shows the refusal, and project rule 5 allows none |
| (b) The time the teacher made the change goes with the write. The server keeps, for each part, the change made last             | One small table, one line added to each score function, and a rule for clocks (below). The browser's saved copy and the class load do not change                                                                                     | It trusts the device to know how long a change waited. It cannot tell that the teacher acted on an out-of-date screen: a fill made on a laptop that is behind is a new change and wins, as today                                                                                                                                                                                               |
| (c) The server compares its own row time with the time the browser last read the class                                          | No new column for live rows: the score rows have `updated_at`. But a cleared part has no row, so cleared parts need a record anyway. And the tab's own writes move the row time, so it must learn the server's time after each write | The same as (a): it refuses the latest tap from a device that is behind                                                                                                                                                                                                                                                                                                                        |

**Recommended: (b), in this form.** One teacher on two devices does not make rival scores. The later one is what the teacher means. So "newer" is "made later", and the server decides, inside the same transaction as the write.

**The rule, in seven points.**

1. A timed write carries two extra values: how long ago it was made, in milliseconds (`p_ago_ms`), and a random id for the browser that sent it (`p_writer`), made once and kept in that browser's storage. It says nothing about the device. The outbox works out the first at each try, from the time the entry was queued (`created_at`, set in `enqueue`).
2. The server works out the made time on its own clock: its time now, less `p_ago_ms`. A device's clock being wrong by a fixed amount changes nothing, because only a difference of two readings of that clock is sent. No write can claim a time later than its arrival.
3. For each part the server keeps the made time of the last timed write and the browser that sent it.
4. A timed write is refused when another browser's timed write to the same part was made later. Otherwise it is applied exactly as today, and its time is recorded.
5. **The same browser is never refused against itself.** One browser has one outbox, which sends a cell's calls in order (`_pump`). Without this rule, two quick taps on one cell could be put out of order by a slow first request.
6. **An untimed write is applied exactly as today** and leaves the record of times alone.
7. A tie goes to the later arrival, as today.

**The clock rule.** The made time is right only if the device's clock kept running true while the write waited. So the browser reads the server's clock (a new read, `get_server_time`) when it starts, when it comes back online, and before it sends anything that waited more than 60 seconds. Each queued entry records how far this device's clock was from the server's when it was made; the last reading is kept in the browser's storage, so a tab opened offline has one. If that gap has moved by more than 30 seconds at send time, the clock was changed while the write waited, and the write goes untimed. So does a write that waited with no gap recorded, and any write when the clock cannot be read within 5 seconds. An age under zero is sent as zero. The server treats an age over one year as untimed.

So a clock that was changed turns the protection off for the writes that waited through the change: they are taken as today. A change too small for the check to see, under 30 seconds, can make a score look that much older or newer than it is. So two changes to one part, made on two devices within about half a minute of each other, can land in either order. They can today.

**How the rule treats each case.**

| Case                                     | What happens                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clocks that disagree                     | No effect: point 2                                                                                                                                                                                                                                                     |
| Written offline, delivered hours later   | It carries its age. It lands unless the part was changed later on another device                                                                                                                                                                                       |
| One cell that is several rows            | Each part is judged on its own. A criterion scored on the laptop and another scored later on the phone both stand, as today. Judging the whole cell would drop the laptop's criterion, which today is kept, so it is not done                                          |
| A comment saved beside a level, a status | Separate parts, judged apart                                                                                                                                                                                                                                           |
| Points, Complete, Incomplete             | One part, the score. `upsert_tag_score` on such work is judged as the score, since it writes the score row                                                                                                                                                             |
| Pair and group work                      | The browser already sends one call for each partner's cell (`_syncGroupFrom`, `saveScores`). Each is judged on its own                                                                                                                                                 |
| Clear Score                              | A timed `clear_score` removes only the parts not changed later by another browser, and records the clear. A part score made before a later clear is refused, even for a part that was never scored. A part removed by a level of 0 keeps its time, so it stays removed |
| Undo                                     | A new change, made at the time of the Undo. It wins over what it undoes and loses to anything made later elsewhere                                                                                                                                                     |
| Draft and Returned                       | The draft rule runs from row changes (`_grade_return_on_change`). A refused write changes no row, so it changes no draft and no returned grade                                                                                                                         |
| A whole-list save                        | `saveScores` sends one call for each part it finds changed (`persistScoreDiffToCanonical`). Each carries the time of the save and is judged on its own. A part the save sends by mistake carries a fresh time: see section 7                                           |

## 3. What happens to the write that loses

**The server's answer.** The function writes nothing and raises one error with a code of its own (`FV001` here; the migration fixes the name) and the message "a newer score stands". Nothing else changes: no row, no audit row, no draft, no class version. Only a timed write can get this answer, so only a build that sends times can ever see it.

**What the browser does.** The send wrapper turns that one error into a finished write before the outbox judges it, the way `_isGoneOnDelete` turns "not found" on a delete into done. So:

- The entry leaves the outbox as landed (`flush:success`). It does not go to the failed list. The baseline row is not put back, so a later whole-list save does not send the old score again with a fresh time.
- The tab finds the class that holds the work, as `_baselineCidOf` does, and forgets its version number (`_classVersion`), so its next read brings the whole class. If that class is open, the tab asks for the read now (`_handleExternalCourseUpdate`). It waits, as every refresh does, until nothing is waiting to send and the class has been quiet for two seconds (`_waitForQuietCourse`).
- Sentry gets a count: the kind of call only, never its contents.

**What the teacher sees.** The sync dot is amber while the outbox empties and then green. It never turns red for this. There is no banner, toast or list.

- On the device that was behind: the cell keeps showing its own older score until the class is read again, seconds after the outbox empties. Then it shows the newer score.
- On the other device: nothing changes.
- For a class that is not open: nothing until it is opened. Opening it reads the whole class.

This needs no new message. One thing is for the owner to rule on, as decision 2: a cell on the device that was behind changes to the newer score with no word. Today the opposite happens with no word: the newer score is replaced by the older one on every device.

`clear_score` never gets this answer as a whole. It clears what it may and answers as today. Each part the clear's own browser knew of was sent first as a level of 0 (`Grader.clearScore`, `saveScores`), and each of those is told on its own.

## 4. Old copies of the app

**What the shipped app sends today.** Named values only, no time and no id: `upsert_score` (`p_enrollment_id`, `p_assessment_id`, `p_value`, and `p_modifier` on proficiency work), `upsert_tag_score`, `upsert_rubric_score`, `save_score_comment`, `set_score_status`, `clear_score`, `set_rubric_check`, `save_score_report_note` (`_persistScoreToCanonical`, `_saveScoreCommentOne`, `_persistStatusDiffToCanonical`, `window.clearScore`, `_setRubricCheckOne`, `saveScoreReportNote`).

**What the server does with it.** The two new values default to null. A call without them runs the function's body as it is today, line for line, and touches no time. The database tests show this by running one long script of untimed calls against the functions before and after and comparing every table.

**Mixed builds.**

| Devices                                     | Result                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Both on an old build                        | Today's behaviour                                                                                                                                            |
| The device that was behind is old           | Its writes are untimed and land as today. Not fixed, not worse                                                                                               |
| The other device is old                     | Its newer write leaves no time, so the timed older write lands as today. Not fixed, not worse                                                                |
| Both new                                    | Fixed                                                                                                                                                        |
| Two tabs in one browser on different builds | They share one outbox and one tab sends. An old tab sending: untimed. A new tab sending: timed, using each entry's `created_at`, which old builds also write |

Leaving the times alone is never worse than today. A timed write is refused only when another browser's timed write, made later, was already applied to that part. The refused write was therefore never the newest, whatever untimed writes came between.

An untimed write could have been given its arrival time. That would fix the third row, but it is worse than today in one sequence: an old phone's offline score arrives and takes a time later than a newer score still waiting on the laptop, and the laptop's score is then refused. So it is left out.

**A new build and a server without the change.** The browser sends times only after `get_server_time` has answered in this page session. If the server does not have it, every write goes untimed. If a timed call is ever answered "no such function", it is sent once more untimed and timing stays off for the session.

## 5. Demo Mode

`_writeRpc` returns at once in a Demo session and nothing reaches the outbox. All the new browser code runs from the outbox's send and its events, so none of it runs. A unit test asserts that scoring in Demo Mode queues nothing and reads no clock.

## 6. The three results, B1 to B3, and step 5's sequences

| Sequence                                                                                                                                                 | Today                                                                                   | After (both devices on the new build)                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Result 1.** The laptop goes offline with changes waiting. At 10:00 it scores cell X. At 10:30 the phone scores X. The laptop reconnects                | The laptop's 10:00 score lands over the phone's 10:30 score                             | **Closed.** The laptop's write for X is refused; X keeps the phone's score; the laptop shows it after its next read. The laptop's other cells land        |
| The same, in the other order: phone at 10:00, laptop offline at 10:30                                                                                    | The laptop's lands last. Right, by luck                                                 | The laptop's is the later one and lands                                                                                                                   |
| **Result 2.** The laptop's outbox is full. Its score for X is refused by the outbox and never queued. The phone scores X later                           | The laptop's score is never sent and is lost at the laptop's next class load (fault 10) | **The same.** This design does not resend. Its root cause is closed: a resend that carries the made time cannot land over a newer score. Section 7        |
| **Result 3.** Step 4's one sequence left: a tab with no baseline holds a refused score, and another tab's out-of-date write drops it from the saved copy | The score is lost at the next class load                                                | **The same.** It is a refused score. It closes only with a resend                                                                                         |
| **B1.** Laptop offline. Phone sets X to 2 at 09:00. Laptop sets X to 4 at 10:00. Phone sets X back to 3 at 10:30                                         | Waiting write: 4 lands over 3                                                           | **Closed** for a waiting write: 10:00 is older than 10:30. For a refused write there is nothing to judge until a resend exists, and then it is closed too |
| **B2.** The phone scores X in the gap between the laptop reading the class and the laptop's write landing                                                | The laptop's write lands last                                                           | **Closed.** The made time decides, not the arrival                                                                                                        |
| **B3.** On the phone the teacher taps the level X already has. `_upsertScoreOne` sends nothing                                                           | The laptop's older change lands                                                         | **Not closed.** The server never hears of the tap. Closing it means sending a call for a tap that changes nothing; not proposed                           |
| **Step 5, "there and back" and "the same half second"**                                                                                                  |                                                                                         | These are B1 and B2                                                                                                                                       |
| **Step 5, two tabs each holding a refused score for one cell**                                                                                           | Both are lost                                                                           | **Not closed.** Two tabs are one browser, so point 5 of the rule does not order them. A resend step must settle this itself                               |

**Never worse than today, by sequence.**

| Sequence                                  | Why this design is not worse                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| One device                                | Every write is the same browser's, so none is ever refused (point 5). The calls differ from today's only by the two values                   |
| Two tabs in one browser                   | One outbox and one id: as one device                                                                                                         |
| A phone and a laptop                      | Result 1, both orders                                                                                                                        |
| Offline then online                       | The age is worked out at each send. The clock rule covers a clock changed in between                                                         |
| The outbox full                           | The outbox refuses the call before anything is sent, as today. Nothing new is stored for it                                                  |
| Storage nearly full                       | The browser id and the clock reading are held in memory if they cannot be saved. With neither, writes go untimed                             |
| A re-key in the middle                    | `rewrite` keeps the entry's `created_at`. The two values are added at send, after the ids are final                                          |
| A rejected create                         | The writes waiting on it are dropped, as today (`dropBlockedOn`)                                                                             |
| A class load in the middle of a save      | Unchanged. The read asked for after a refusal waits for quiet and skips a field edited since (`_refreshMustSkip`), like any refresh          |
| A retry after a lost answer               | The same browser's, so it is applied again. If another device's newer score landed in between, it is refused. Today it lands over that score |
| A rejected write tried again at page load | `_retryDeadOnLoad` keeps `created_at`, so the try carries its true age and cannot land over another device's newer score. Today it can       |
| An older build elsewhere                  | Section 4                                                                                                                                    |
| Demo Mode                                 | Section 5                                                                                                                                    |
| The 14-day purge of saved copies          | Nothing here reads the saved copy                                                                                                            |
| Site data cleared, or a new browser       | A new browser id. The outbox went with the old one, so nothing of that browser's is still waiting to be ordered against it                   |

## 7. What is not fixed

- **A refused score is still not sent again.** After this design a resend is safe against landing over a newer score, if it carries the time the score was made. It still needs somewhere to keep the score when the outbox or storage is full. That is a later step with its own design and review. It is not promised here.
- **A refused score that a later whole-list save happens to send** (fault 10's accidental rescue) carries the time of that save, not the time the score was made. It can land over a newer score, as today.
- **A change made on an out-of-date screen is a new change.** Set Unmarked to … on a laptop that is behind fills a cell the phone has scored, as today. Option (a) would catch this; it is the price of (b). A later step could send fills as "only if still blank".
- **The Overall Comment that goes up again with a + or −** (`_persistScoreToCanonical`) carries a fresh time, so an old comment can land over a newer one, as today.
- **A score and a status are separate parts.** A score made before a later Excused still lands under it, as today.
- **A Return queued behind a refused score still lands** and returns the newer score that stands. Today it returns the older score.
- **B3**, above.
- **Old builds:** section 4.
- **Not timed:** `fill_rubric`, `clear_row_scores` and `clear_column_scores` (no screen calls them), `move_rubric_scores`, `import_json_restore`, DIBELS scores, Return, Mark Up, and the grade-scans skill's writes. They work as today. A restored class and a moved criterion start with no times.
- **Two tabs sharing one saved copy** (faults 3, 5 and 6 of the other design) are a browser matter and are untouched.

## 8. The database change

Described for review. The migration is not written here.

**One new table, `public.score_time`.** `enrollment_id` and `assessment_id` (each a foreign key with `on delete cascade`), `part` (text: `value`, `comment`, `status`, `note`, `clear`, or `tag:`, `crit:` or `check:` with the row's id), `changed_at` (timestamptz), `writer` (text, 8 to 64 characters). Primary key on the first three; an index on `assessment_id`. Row security on with no policy, and every privilege revoked from `anon` and `authenticated`, so no browser can read or write it. A `same_teacher` trigger on its two links, like `score`. It is not in the realtime publication and has no sync-cursor trigger: recording a time must not move a class's version.

**No existing table changes.** No column is added to `score`, `tag_score`, `rubric_score` or `rubric_check_score`. Their policies, their `same_teacher`, `grade_return_*` and `course_sync_cursor_*` triggers, `get_class_bundle`, `get_gradebook`, `_grade_copy` and the student page's reads (`student_submit._returned_grade`, `student_submit.feedback`, `student_submit.markup`) are untouched. The edge functions write no score.

**Three new functions.**

- `fv_private.score_time_take(enrollment, assessment, part, ago_ms, writer)`: security definer, search path pinned, granted like `fv_private.report_note_hold`. It returns at once, doing nothing, when the age or the id is missing or out of range, or when the caller does not own the cell (`fv_owns_score_cell`). Otherwise it takes a transaction lock on the cell (`pg_advisory_xact_lock` on a hash of the two ids), works out the made time, raises `FV001` if another writer's time for the part is later (for the score, a competency or a criterion, the cell's `clear` time counts too), and records the writer and the later of the two times.
- `fv_private.score_time_clear(...)`: the same checks and lock for `clear_score`. It records the clear and returns the made time, or null for an untimed call.
- `public.get_server_time()`: returns `now()`. Signed-in users only. It is a read: it writes nothing, so project rule 7's key does not apply.

**Eight functions gain two optional values**, `p_ago_ms bigint default null` and `p_writer text default null`: the seven old one-cell score writes and `save_score_report_note`, which is the same cell's Note for the Report and would otherwise still be overwritten by a device that is behind.

- Seven of them gain one statement, after their own checks and before their body: a call to `score_time_take` with their part. Their bodies are otherwise today's text. `upsert_tag_score` picks its part after it has read the work's scoring mode; its inner call to `upsert_score` stays untimed.
- `clear_score` gains a timed branch: it deletes only the competency and criterion rows with no later time from another writer, and clears the score only on the same test. Its untimed branch is today's body.
- **Idempotency is as today.** The seven old writes still take no key and still overwrite one part, so a retry is safe: the same browser is never refused against itself, and a retry that arrives after another device's newer score is now refused, where today it lands over it. `save_score_report_note` checks its key first (`fv_idem_check`), as now.
- A function's values cannot be added in place. Each old signature is dropped and the new one created in the same transaction, with its grants restated from `migrations/baseline/60-grants.sql` (execute for `authenticated` and `service_role`, none for `public` or `anon`). A call in the old shape resolves to the new function through the defaults, before and after PostgREST reloads its list. The migration ends with `notify pgrst, 'reload schema'`.

**Backfill: none.** A part with no recorded time accepts any write, as today. A time matters only when a later write exists, and that write records it.

**Locks.** No row of any existing table is read or rewritten. Creating the empty table's two foreign keys takes a brief lock on `enrollment` and `assessment`; replacing functions locks no table. The time does not depend on table sizes. The migration sets `lock_timeout` to 3 seconds so it gives up instead of queueing behind a long transaction.

**Read-only queries to run on live first.** The counts size the new table; the rest are pre-checks.

```sql
select 'score' t, count(*) from public.score union all select 'tag_score', count(*) from public.tag_score
union all select 'rubric_score', count(*) from public.rubric_score
union all select 'rubric_check_score', count(*) from public.rubric_check_score
union all select 'enrollment', count(*) from public.enrollment union all select 'assessment', count(*) from public.assessment;

select p.oid::regprocedure as fn, md5(pg_get_functiondef(p.oid)) as md5, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('upsert_score','upsert_tag_score','upsert_rubric_score',
       'save_score_comment','save_score_report_note','set_score_status','clear_score','set_rubric_check')
 order by 1;   -- eight rows, one per name; each md5 as in migrations/baseline/function-md5.txt

select to_regclass('public.score_time') as table_free,
       to_regproc('public.get_server_time') as read_free,
       to_regproc('fv_private.score_time_take') as helper_free;   -- three nulls

show server_version;
```

**Undo, in two levels, both rehearsed on the local PostgreSQL 17.**

1. **Switch off.** Replace the two helpers with bodies that do nothing (`score_time_clear` returning null). Every call is then treated as untimed. The signatures stay, so a browser that still sends times keeps working. This is the undo to use while any build that sends times may still be cached on a device.
2. **Remove.** Drop and recreate the eight functions from the baseline text, drop the three new functions and the table. Only once no build that sends times is in use.

After it is applied, `docs/schema.generated.sql` and `migrations/baseline/` are regenerated in the same PR, which the drift check needs.

## 9. Build steps

Four PRs, in this order. Each can be released alone. New browser logic lives in a new file, `shared/score-time.js`, registered wherever `shared/data-rpc-wrappers.js` is (`teacher/app.html`, `teacher-mobile/index.html`, `sw.js`, `tests/setup.js`, `tsconfig.json`, `types/globals.d.ts`, `scripts/lint-ratchet.mjs`). `shared/data.js` is not changed in any step. `shared/offline-queue.js` is one line under its own limit; it gains two call sites, about four lines, and the PR raises its number in `tests/file-size-baseline.json` and says why.

**Step A. Test tools.** No app code.

- **Files:** `scripts/differential/compare.mjs` leaves `p_ago_ms`, `p_writer` and `get_server_time` out of what it compares. `tests/helpers/fake-supabase.js` can answer a named call with `FV001` and can keep a clock. `scripts/differential/fake-server.js` answers `get_server_time` and takes the two new values.
- **A teacher notices:** nothing.
- **Proof:** `tests/differential-fake-server.test.js` and `tests/differential-run-helpers.test.js`, extended for each new ability.

**Step B. The browser understands "a newer score stands".** Inert until a server sends it.

- **Files:** `shared/score-time.js` (the send wrapper that turns `FV001` into a landed write; the listener that forgets the class version, asks for the read and tells Sentry); `shared/constants.js` (the code and the list of timed calls); one line in `_runEntry` of `shared/offline-queue.js`.
- **A teacher notices:** nothing.
- **Unit tests** (`tests/score-kept-newer.test.js`, signed in, the real outbox, the fake server). Each sets up a class loaded from a bundle and one queued score that the fake answers with `FV001`. They assert: the entry is gone and the failed list is empty; `getSyncDotState` is never `error`; the cell's baseline row was not put back, so a points score on another cell sends nothing for it; the next `get_class_bundle` carries no version; after it, memory, the saved copy and the baseline hold the server's score; nothing is requested while another write waits; for a class that is not open the version is forgotten and nothing is requested; the same answer on the one more try after a reload (`_retryDeadOnLoad`) ends the entry. Pins that pass untouched: `tests/offline-queue.test.js`, `tests/offline-queue-dead-letter-reload.test.js`, `tests/write-path-audit.test.js`, `tests/data-class-bundle.test.js`.
- **Browser spec** (`e2e/score-kept-newer.spec.js`): one page; the fake answers `FV001` to one level and then serves a bundle with another level. The cell shows the server's level, the dot is green, and no toast or banner was ever in the page.
- **Comparison run:** whole, 0 differences. The fake never sends `FV001`, so the step never acts.

**Step C. The database.** Inert until a browser sends times. Shown to Colin as SQL; applied only on his OK.

- **Files:** one migration; the regenerated snapshot and baseline; `tests/db/table-owners.mjs`, `tests/db/function-args.mjs`, `tests/db/same-teacher.sql`; a new `tests/db/score-time.sql` run by `tests/db/run.mjs`.
- **A teacher notices:** nothing.
- **Database tests on the local PostgreSQL 17** (`scripts/db-rebuild.mjs`, then the migration):
  1. **Untimed is today.** One script calls all eight functions through every branch (new row, changed row, level 0, a comment kept and cleared, points work, a status, a clear that keeps the row and one that deletes it) on a database from the baseline and on one with the migration. Every score table, `score_audit`, `grade_return` and each class's version match row for row, and `score_time` is empty.
  2. An older timed write after a newer one from another writer: `FV001`; the row, the audit rows, the class version and `grade_return` are unchanged.
  3. The other arrival order: the newer one stands.
  4. The same writer, older: applied.
  5. Two criteria of one cell from two writers: both stand.
  6. A part removed by a newer level of 0, then an older write: refused, no row.
  7. A newer clear, then older writes to a scored part and to a never-scored part: both refused.
  8. An older clear after a newer score on one criterion of three: two rows gone, the newer one kept.
  9. Untimed after timed: applied, the time unchanged; then an older timed write from another writer is refused and a newer one applied.
  10. An age under zero, over a year, or with no id: treated as untimed.
  11. `upsert_tag_score` on points work is judged as the score.
  12. `save_score_report_note` replayed with its key returns the first answer and is not judged again.
  13. In a class set to When I Return Them, a refused write leaves the draft state alone.
  14. Teacher A calling with teacher B's ids: no time is recorded and B's rows do not change (the security rule tests, with the new table and functions added).
  15. Two sessions writing one cell at once, 200 rounds: no deadlock, and the later-made write stands.
  16. Exactly one function per name; a call in the old shape works.
  17. Both undo levels, then the migration again.
- **On live after applying:** the pre-check query again (eight rows, new fingerprints), and one untimed score from the released app in Colin's test class.

**Step D. The browser sends times.** The switch-on. Released only after step C is live; safe even if it is not (section 4).

- **Files:** `shared/score-time.js` (the browser id in `localStorage`, held in memory if storage is full; the clock reading; the age and the clock rule; the fall-back to untimed); one line in `enqueue` of `shared/offline-queue.js` to record the clock gap on the entry.
- **A teacher notices:** nothing, except in result 1's situation, where the device that was behind now shows the newer score. Sentry also counts each write sent untimed because the clock had moved, by kind of call only.
- **Unit tests** (`tests/score-time-send.test.js`, fake timers and the fake's clock). They assert: a score that waited an hour goes with an age of an hour and the browser's id; a replaced entry (`_coalesceIndex`) uses the newer made time; a retry sends a larger age; a re-keyed entry (`rewrite`) keeps its time; the device clock moved five minutes while waiting: untimed; no clock reading within 5 seconds: untimed; `get_server_time` missing: untimed for the session, and no later call asks again; a timed call answered "no such function": sent once more untimed; an entry queued by an old build with no clock gap that waited: untimed; Demo Mode: nothing queued, no clock read; storage full: the id is kept in memory and the write still goes.
- **Two-device browser spec** (`e2e/two-devices-newer-score-stands.spec.js`): two browser contexts with separate storage, one class, and a fake server that applies section 2's rule (a test-only copy; step C proves the real one). The laptop goes offline and scores X and Y. The phone scores X. The laptop reconnects. The server's X is the phone's and its Y is the laptop's; the laptop shows the phone's X after its read; both dots are green; no toast was shown. On main the server's X is the laptop's. A second case runs the other order and the laptop's X stands.
- **Comparison run:** seeds 1 to 3, both modes, `--offline --two-tabs`, with step A's change: 0 differences. The run's fake never refuses, so the fix never acts, and the whole run is compared.
- **Before the release:** every device opens the app online and waits for a green dot (DECISIONS, "Class settings on two computers" 5).

**Later, not in this design:** sending a refused score again with the time it was made; fills sent as "only if still blank".

## 10. Risks, and what would stop the build

| Risk                                              | What could go wrong                                                                                                               | How it is caught                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The device's clock is changed while a write waits | A new score looks old and is refused                                                                                              | The clock rule sends it untimed. Step D's tests move the clock. What is left is a change under 30 seconds                                                               |
| The timed path refuses a write it should take     | A score is dropped and the screen changes to the server's                                                                         | Step C's tests. The Sentry count of "a newer score stands": near zero in an ordinary week, so a jump is seen. Undo level 1 needs no release, only Colin's OK on its SQL |
| The untimed path differs from today               | An old build's scores behave differently                                                                                          | Step C, test 1                                                                                                                                                          |
| A new build meets a server without the change     | Every score call fails                                                                                                            | Times go only after `get_server_time` answers; "no such function" is sent once more untimed                                                                             |
| The answer is not understood by the browser       | The write goes to the failed list: a red dot, one more try at the next load, then dropped. The server still holds the newer score | Step B ships before any server can send it                                                                                                                              |
| The screen keeps the older score after a refusal  | The teacher reads a score the server does not hold                                                                                | The forced whole read. Step B's tests and spec                                                                                                                          |
| Two functions with one name                       | Calls in the old shape fail as ambiguous                                                                                          | Step C, test 16, and the pre-check on live                                                                                                                              |
| Locking                                           | A timed write waits on a cell lock and then on the class lock the draft rule takes                                                | One cell per call, always in that order. Step C, test 15                                                                                                                |
| The new table grows                               | One row for each part ever given a timed write                                                                                    | It goes with its student or work. The counts size it                                                                                                                    |

**Stop, and do not build, if:** step C's test 1 cannot show the untimed path equal to today; the owner will not accept decision 2 or decision 3; the two-device spec shows the device that was behind keeping its older score on screen; or a class is ever to be scored by two teachers. Two people do make rival scores, and option (a) with a screen for the loser would then be the right design.

## 11. Decisions for the owner

One at a time. The lines on published views are my reading of each author's work. None of them has seen this design.

1. **"Newer" means the change the teacher made last, judged by time; a device that was behind is not refused for being behind.**
   - Kleppmann (_Designing Data-Intensive Applications_, chapter 5): keeping only the last write throws the other away with no sign, and is a poor choice where a lost write is not acceptable; versions detect that two writes did not know of each other. Here both writes are one person's, and a version check would refuse the later one.
   - Shapiro, Preguiça, Baquero and Zawirski (the 2011 papers on replicated data types): a register that keeps the value with the latest time always settles on one value on every copy. It is sound when the times follow the real order.
   - Fowler (_Patterns of Enterprise Application Architecture_, "Optimistic Offline Lock", by David Rice): a version check finds the conflict at save and hands it back to the person. That needs a screen for the loser.
   - **Recommended: yes.**
2. **The device that was behind shows the newer score after its next sync, with no message.**
   - Nielsen (the ten usability heuristics, "visibility of system status"): people should be told what the system did. That argues for a quiet sign on the cell.
   - Helland and Campbell ("Building on Quicksand", 2009): a system that lets people work apart acts on guesses and must be able to put things right afterwards.
   - Kleppmann and others ("Local-first software", 2019): in their prototypes, conflicts turned out to be a smaller problem than they had feared.
   - **Recommended: no message.** Project rule 5 stands, and today's overwrite is silent too. Count the answers in Sentry. A quiet sign can be designed later if the count is not near zero.
3. **Accept the clock rule: a device whose clock was changed while scores waited loses the protection for those scores, and two changes to one part made within about half a minute on two devices can land in either order, as today.**
   - Lamport ("Time, Clocks, and the Ordering of Events in a Distributed System", 1978): separate machines' clocks cannot order events unless their error is bounded.
   - Kleppmann (chapter 8, "Unreliable Clocks"): do not order writes by clocks on different machines; a slow clock loses writes silently. The design sends an age and uses one clock, the server's, for that reason.
   - Kingsbury (the Jepsen reports, and "The trouble with timestamps", 2013): stores that keep the last write by time lose acknowledged writes when clocks are wrong; his tests set clocks wrong on purpose. Step D's do too.
   - **Recommended: accept.**
4. **Each part of a cell is judged on its own, so a cell can end with one criterion from the laptop and another from the phone, as it can today.**
   - Shapiro and others: keeping the latest value for each element merges two copies without losing what each changed on its own.
   - DeCandia and others ("Dynamo", 2007): merge versions that differ where you can, and do not drop one whole.
   - **Recommended: yes.** Judging the whole cell loses a score that today is kept.
5. **A device on an old build keeps today's behaviour until it updates; nothing forces the update.**
   - Fowler's site ("ParallelChange"): add the new way beside the old, move callers over, and remove the old only when no caller is left.
   - Nygard (_Release It!_, on versions): a service must go on serving the callers it already has.
   - **Recommended: yes,** with the release rule in step D.
6. **After this is live, count before building more: how often "a newer score stands" is answered, and how often the outbox refuses a score. Then decide on the resend and on fills.**
   - Beck (_Tidy First?_): pay for a change when there is a reason to.
   - Nygard ("Fail Fast"): a system that cannot keep work should say so at once. That is the refusal itself, which the resend would mend.
   - **Recommended: yes.** Nobody has counted a refusal yet.

Still Colin's in any case: the SQL before it reaches the live database, and each release.
