# One mark saves one mark: design (S19-C9)

Status, 2026-11-13. This document is kept as the record of why step 4 is built the way it is. Merging it approves nothing else in it.

- **Step 4:** built, merged (PR 1336) and released on 2026-11-13.
- **Step 5:** not to be built. Colin ruled on 2026-11-13 after two reviews of it and one of its redesign (`DECISIONS.md`, "A refused score is not resent; refusals are counted first"). Refused writes are counted instead (PR 1360).
- **Step 1:** ready to build, not started. It changes nothing a teacher sees.
- **Part B:** not approved. Steps 10b, 11 and 12 are parked.
- **What came next:** a design for a time on every score was written and reviewed (draft PR 1361, closed without merging). The review advised measuring first, and Colin agreed: the app counts how often a waiting score meets a newer one on the server before anything more is designed.

It has two parts.

- **Part A, "Stop marks being lost":** three small steps, each one PR that can be released alone. Step 4 is released. Step 1 is next. Step 5 is parked, and its section says why. A builder can follow Part A without reading Part B.
- **Part B, everything else:** speed, tidying, and two tabs sharing one saved copy. It is not approved until its own review passes.

This is item 8 of section 8 in [`handoff-review-plan.md`](handoff-review-plan.md). It carries S19-B4 (send an undone cell once), S19-B5 (make the score send private), S19-C9 (one mark saves one mark, redraw only what changed), S19-C10 (the phone's tap), Track E's tidying 3 (on-save hooks for `_saveCourseField`) and the fault closed PR 1263 tried to fix (a tab that is behind saving over newer marks).

Every `file:line` is on `origin/main` at `4336281f`. Short names: `page-gradebook.js` and `page-assignments.js` are in `teacher/`, `ui.js` is `teacher/ui.js`, `tab-grade.js` is `teacher-mobile/tab-grade.js`, `offline-queue.js` is `shared/offline-queue.js`, `speed.spec.js` is `e2e-perf/speed.spec.js`, `30-functions.sql` is `migrations/baseline/30-functions.sql` (the live server functions). Each claim about today is marked **reproduced** (a test was run; section 2 says how) or **seen in the code** (traced by reading, not run). The parts revised on 2026-11-13 (Part A, and the last entry of "Changes after review") name functions and files instead of lines: find each by name on `origin/main`, which was at `43bf8048`, after step 4 had merged.

Step numbers are the first draft's, so they match the review: Part A is steps 4, 5 and 1, in that order.

Words used here:

- **Mark:** a score a teacher gives: a level, points, Complete or Incomplete.
- **Cell:** one student on one piece of work. The outbox already uses this unit (`cell:<student>:<assessment>`, `shared/offline-queue.js:160-164`).
- **Saved copy:** the class's marks kept in the browser's storage under one key, `gb-scores-<class id>`.
- **Outbox:** the list of changes waiting to go to the server (`shared/offline-queue.js`).
- **Baseline:** this tab's picture of what the server holds (`_serverState`, `shared/data.js:1803`).
- **One-cell write:** a save that touches one cell. **Whole-list save:** `saveScores`, which is handed every mark in the class.
- **Behind:** another tab in the same browser has saved since this tab last read the saved copy.

## What the brief got wrong

These were checked before designing. The design is for the faults that exist.

1. **The phone's tap does not take 395 ms.** PR 1282 found the speed recorder was timing the screen sliding in. A tap draws in about 15 ms (`e2e-perf/speed.spec.js:233-237`; PR 1282's table). The phone already redraws only the row tapped (`teacher-mobile/tab-grade.js:2943-2952`). S19-C10 has nothing left to fix.
2. **One tap on a level already saves one mark.** It compares one cell and sends one call (`shared/data.js:5109-5158`). The whole class is compared only for points, Complete and Incomplete, clears, Undo and group copies (`saveScores`, `shared/data.js:6290`). What every tap does do for the whole class is rewrite the saved copy (section 1).
3. **An undone cell is sent twice, not more,** and only when the tab is online and is the tab that sends. Offline, or in a second tab, the outbox folds the two into one (`shared/offline-queue.js:921-942`, `767-769`; seen in the code, not run). No control on the phone reaches its Undo (`tests/pin-phone-grade-writes.test.js:25-27`).
4. **The score send is on no export list.** `persistScoreDiffToCanonical` is not on `window.GB` (`shared/data.js:8799`). It is callable because every top-level function in a plain script is. One test allowlist names it (`tests/grader-guard.test.js:44`).
5. **`_saveCourseField` names five other areas, not four** (`shared/data.js:4991-5000`).
6. **A tab that is behind clears another tab's marks on the server in one case only** (no baseline; section 2, faults 4 and 7). In the common case it harms only this computer's saved copy.
7. `docs/schema.generated.sql` holds each server function's first line only. The bodies cited here are the live ones in `migrations/baseline/30-functions.sql`.
8. `docs/DECISIONS.md` had no "Wave 0 rulings (2026-11-13)" when this was first written. It has now, and ruling 1 covers this design.
9. PR 1320 removed none of the listed faults.

## 1. What happens today when a teacher taps one score

### Which writer a mark goes through

| What the teacher does                                    | Writer                                                                                            | Kind                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| A level, a + or −, a rubric criterion's level            | `upsertScore` → `_upsertScoreOne` (`shared/data.js:8171`, `5109`)                                 | One cell                             |
| Points, Complete, Incomplete                             | `setPointsScore` → `_setPointsScoreOne` → `saveScores` (`8175`, `7710-7747`)                      | Whole list                           |
| A comment (overall, criterion, competency)               | `_saveScoreCommentOne`, `_saveRubricCriterionNote`, `_saveTagCommentOne` (`5488`, `5339`, `5422`) | One cell                             |
| Missing, Excused, Late                                   | `setAssignmentStatus` → `saveAssignmentStatuses` (`5954`, `5900`)                                 | Whole status list                    |
| A checklist box                                          | `_setRubricCheckOne` (`shared/data-rubrics.js:533`)                                               | One call; whole tick list to storage |
| Clear Score, Cmd+Z, Undo of a fill, Delete Assessment    | `saveScores` (`shared/grader.js:139-142`, `156-160`, `178-180`, `287-289`)                        | Whole list                           |
| A group or pair partner's copy                           | `_syncGroupFrom` → `saveScores` (`shared/data.js:7932`, `7987`)                                   | Whole list                           |
| Set Everyone To, a row or column fill, Set Unmarked to … | The one-cell actions above, once for each cell (`page-assignments.js:8053`)                       | One cell each                        |

Every screen calls these through `shared/grader.js` (`shared/grader.js:16-24`).

### A level, step by step

| #   | What happens                                                                                                                                                                                                  | Where                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | The screen calls the grader.                                                                                                                                                                                  | Gradebook `page-gradebook.js:3898`; Assignments `page-assignments.js:7973`, `15925`; phone `tab-grade.js:2943` |
| 2   | A score on Missing or Excused work is refused. Group work is wrapped so partners get a copy afterwards.                                                                                                       | `shared/data.js:8171-8173`, `8157-8169`                                                                        |
| 3   | The student's entry for that cell is found in memory and changed. One cell is compared.                                                                                                                       | `shared/data.js:5111-5139`                                                                                     |
| 4   | Only when the class's student page is on: the whole saved copy is read back from storage, and every cell of the class is compared, to keep Draft and Returned right. With it off this step does nothing.      | `shared/data.js:5142-5144`, `7217-7222`, `7239-7262`                                                           |
| 5   | The whole class's marks are turned into text and written to storage as one key.                                                                                                                               | `shared/data.js:5143`                                                                                          |
| 6   | The class is flagged as edited, so a class load in flight cannot overwrite the mark.                                                                                                                          | `shared/data.js:5146`, `185-191`, `847-853`                                                                    |
| 7   | One call is handed to the outbox: `upsert_tag_score`, `upsert_rubric_score` or `upsert_score`. A second call, `save_score_comment`, goes when the caller passes the comment again (a + or − on some screens). | `shared/data.js:5150`, `5195-5291`, `8477-8516`; `shared/grader.js:131-133`, `270-272`                         |
| 8   | The baseline is moved on for that one cell.                                                                                                                                                                   | `shared/data.js:5154`, `5162-5173`                                                                             |
| 9   | Other tabs are told the class changed.                                                                                                                                                                        | `shared/data.js:5156`, `1042-1050`                                                                             |
| 10  | The screen redraws (below).                                                                                                                                                                                   |                                                                                                                |

**Reproduced** (throwaway vitest check, 30 students): one level tap makes one storage write of the whole class, no read of it, and one call.

### Points, Complete and Incomplete differ

These go through `saveScores` (`shared/data.js:6290-6356`). One tap then:

- reads and parses the whole saved copy (`6295-6298`);
- runs the mass-loss guard on the whole class (`6302-6339`) and scans the class's group work (`6308`);
- writes the whole class to storage (`6341`, `4989-5001`);
- compares every cell of the baseline with every cell of the class to find what to send (`6348`, `5658-5701`);
- copies the whole class as the new baseline (`6350`, `1814-1818`).

**Reproduced** (same check): one points tap makes one storage write, one parse of the whole saved copy, one copy of the whole class, and one call (`upsert_score`).

### The outbox, the server and the way back

- **The outbox.** Every call goes through `_writeRpc` to the outbox (`shared/data.js:8477-8516`). Calls for one cell go one at a time, in order (`offline-queue.js:160-164`, `1205`). A newer unsent call for the same cell replaces the older one (`289-298`, `921-942`). Network failures retry for as long as it takes (`1089-1105`). A call the server rejects goes to the failed list, is tried once more at the next page load, then dropped (`1107-1129`). The outbox holds 500 calls or 5 MB (`92-93`); past that a call is refused and nothing is sent (`886`, `shared/data.js:2009`).
- **Offline.** Steps 1 to 9 are the same. The call waits in the outbox, which is kept in storage (`offline-queue.js:1208`).
- **The server.** Each call sets one cell, found by student and work (and competency or criterion). Most write one row. Two do more: `clear_score` deletes every competency and criterion row of the cell (`30-functions.sql:2545`), and `upsert_tag_score` on points or Complete work deletes the competency row and writes the score row (`10498`). There is no key and no version: the last call to arrive wins (`upsert_score`, `10353`). A database trigger on the row moves the class's sync row on, which carries a version number (`docs/schema.generated.sql:1072`, `272-277`).
- **The way back.** The page hears the new version. If it is the echo of this page's own write, nothing is reloaded (`shared/data.js:907-911`, `863-900`). If it came from another device or tab, the class is read again once this tab has sent everything and been quiet for two seconds (`780-843`), and the page is redrawn (`1445`).

### What is redrawn

| Screen                       | After one mark                                                                                                            | Where                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Gradebook, Competencies view | The whole page, and the roster beside it                                                                                  | `page-gradebook.js:2468-2478` → `276-563`                       |
| Gradebook, Scores view       | The whole page, even when the box was left unchanged                                                                      | `page-gradebook.js:3626-3673`                                   |
| Assignments cards            | That row's buttons and the one student's roster grade                                                                     | `page-assignments.js:7965-7977`, `8120-8140`; `ui.js:2034-2052` |
| Grader dialog                | The dialog's parts and the one roster grade, not the page                                                                 | `page-assignments.js:15917-15932` → `2421-2424` → `12547-12592` |
| Phone Grade tab              | That row's buttons, the thumbnail and the Return bar                                                                      | `tab-grade.js:2943-2952`                                        |
| Dashboard and other pages    | Nothing: they are not on screen. Their saved sums are thrown away on every write and worked out again when the page opens | `shared/data.js:5141`, `4992`                                   |

### What has been measured, and what has not

| Number                                      | Value                            | Source                                                                  |
| ------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Phone: tap to mark drawn                    | 15 ms (14 ms at quarter speed)   | PR 1282, measured in the page                                           |
| The save itself, one mark, 5,400-mark class | 1.6 ms (4.0 ms at quarter speed) | PR 1263, Review B. Reported there; not measured again here.             |
| Assignments card: click to saved            | 199 ms (432 ms at quarter speed) | PR 1263, Review B. It does not say how the click was timed.             |
| Gradebook: a typed score to the page drawn  | **Not measured by anyone**       | The recorder times a right-click, not a score (`speed.spec.js:144-158`) |
| Any of these with the student page on       | **Not measured by anyone**       |                                                                         |

So the save is already fast. If a teacher feels a wait, it is the redraw on the desktop. Nobody has measured that. Step 0 does.

## 2. The faults, each with evidence

| #   | Fault                                                                      | What a teacher could see                                                                                           | Can a mark be lost?                                  | Evidence                       |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------ |
| 1   | Undo sends each cell twice                                                 | Nothing                                                                                                            | No. Time only.                                       | Reproduced                     |
| 2   | The score send can be called from any file                                 | Nothing                                                                                                            | No                                                   | Seen                           |
| 3   | A tab that is behind writes its old copy over the saved copy               | Marks entered in the other tab are missing after a reload without a connection. They return at the next class load | Signed in: no, the server keeps them. Demo Mode: yes | Reproduced, and by the review  |
| 4   | A tab that is behind, with no baseline, clears the other tab's marks       | Marks entered in the other tab are gone everywhere, with no message                                                | **Yes, on the server**                               | Reproduced, and by the review  |
| 5   | A tab that is behind has one points or Complete mark blocked               | The red "Score save blocked" message. The mark is gone after a reload                                              | **Yes, that one mark**                               | Reproduced, and by the review  |
| 6   | A tab that is behind changes Draft and Returned for cells it never touched | A Draft badge that is wrong until the server's rows are read again. In Demo Mode the other tab's drafts are lost   | No                                                   | Seen; reproduced by the review |
| 7   | Fault 4, for Missing, Excused and Late                                     | A status set in the other tab is taken off                                                                         | Yes, the status                                      | Seen                           |
| 8   | One tap does whole-class work                                              | Nothing measured                                                                                                   | No. Time only.                                       | Reproduced                     |
| 9   | The gradebook redraws the whole page for one score                         | A pause while typing down a column, on a slow computer (not measured)                                              | No. Time only.                                       | Seen                           |
| 10  | A mark the outbox refuses is not sent again by later level taps            | The sync dot is red. The mark shows, but the server never gets it, and it is gone after the next full class load   | **Yes**                                              | Reproduced, and by the review  |
| 11  | `_saveCourseField` calls five other areas by name                          | Nothing                                                                                                            | No                                                   | Seen                           |

**When fault 4 happens, in the owner's terms.** The same class is open in two tabs of one browser while the computer is offline, or while the sync dot says changes are waiting. One of the two tabs is opened or reloaded during that time (a browser waking a sleeping tab by reloading it counts). Marks are entered in the other tab. Then, in the tab opened later, the teacher enters points, Complete or Incomplete, uses Clear Score, Cmd+Z, Undo of a fill or Delete Assessment. (A level on pair or group work was listed here and is not a route: the level writes this tab's memory to the saved copy first, so the group save that follows compares with this tab's own marks.) When the connection returns, the marks the first tab entered since the second was opened are cleared on the server, or put back to their old values, with no message. Online it needs the later tab's class check to fail or take more than three seconds. A second computer cannot cause it: it has its own storage. Fault 7 is the same for statuses.

**How often the others happen.** Fault 1: every Undo while online. Fault 3: two tabs on one class, both used within about two seconds of each other, or both offline. Fault 5: two tabs, and the other tab has just added far more marks than the class held, as a first fill in a new class does. Fault 6: two tabs, student page on. Faults 8 and 9: every tap. Fault 10: 500 changes waiting, or the browser's storage full.

**How the reproductions were run.** Faults 1 and 5 are asserted by tests already on main, named below; they were run and pass. Faults 3, 4, 8 and 10 were run in two throwaway vitest files, not committed, built on the harness of `tests/score-guard-keeps-mark.test.js:1-140` (signed in, the real outbox, the recording fake server), with 30 students. The second tab is a direct write of `gb-scores-<class id>`, as that file's `otherTabFills` does (`308-310`). Storage writes, parses and copies were counted by wrapping `localStorage.setItem`, `JSON.parse` and `structuredClone`. The outbox was filled with 500 waiting calls through `window.v2Queue.enqueue`. The review then reproduced faults 3, 4, 5, 6 and 10 on main on its own.

How each happens:

1. **Undo twice.** `saveScores` sends what changed. Then three callers send the same change again: `Grader.undoCell` (`shared/grader.js:156-160`), `Grader.undoOnPhone` (`279-283`) and `restoreScoreCells` (`shared/data.js:6402-6403`). Online, the first call has already left, so the second cannot replace it and goes too (`offline-queue.js:932`). Reproduced by pins that pass on main and assert it: `tests/pin-gradebook-writes.test.js:921-927`, `tests/pin-phone-grade-writes.test.js:994-996`, `tests/pin-assignments-fills.test.js:140-142`. The two grader callers also send when `saveScores` refused the save. That second send is not always waste: see step 1.
2. **Callable from anywhere.** A plain function at `shared/data.js:5658`.
3. **Old copy over the saved copy.** Each tab holds the class in its own memory. Every writer writes its whole memory to the one shared key (`5143`, `5378`, `5449`, `5519`, `5580`, `4999`). A tab re-reads the class only from the server, only after two quiet seconds with nothing waiting to send (`828-843`). Offline that never comes. Reproduced: the saved copy held 40 marks, 10 of them from the other tab; one level typed in the tab that was behind left 31. The server was sent only the one mark.
4. **No baseline.** A whole-list save works out what to send by comparing the class with the baseline. With no baseline it falls back to the saved copy as it is now (`6346`, `1824-1826`), which the other tab may have written. The other tab's marks then look like marks this tab removed, and a clear is sent for each (`5690-5700`). A tab has no baseline when it opened from a saved copy flagged as edited on this computer (`4323-4332`, `4334-4338`), which is any copy graded on since its last load from the server (`4219-4233`), and the server has not answered yet. The check waits for as long as anything is waiting in the outbox, which every tab shares (`828-834`, `1657-1666`); the page stops waiting for it after three seconds (`4349-4379`). So: offline, the outbox paused by an expired sign-in, a failed load (`4793-4800`), or a slow one. Reproduced: one points mark sent 10 clears for the other tab's marks.
5. **Blocked.** The guard compares the tab's old memory with the fuller saved copy and takes the difference for a mass loss (`6302-6339`). Reproduced by `tests/score-guard-keeps-mark.test.js:335-343`, which passes on main, and pinned in the browser by `e2e/guard-keeps-mark.spec.js:149`.
6. **Draft and Returned.** Two halves. The rule's "before" is read from the saved copy (`7221`) and its "after" from this tab's memory, and every cell is compared (`7249-7262`), so the other tab's marks read as cleared here. And the tab writes its whole cached set of rows, which lacks the other tab's rows (`_saveGradeReturns`, `6940-6941`). Signed in, the server's own rows are read back afterwards (`7123`).
7. **Statuses.** The same fallback: `shared/data.js:5900-5914`.
8. **Whole-class work.** Section 1.
9. **Whole page.** `page-gradebook.js:2476-2478`, `3660`, `3671`, `563`.
10. **Refused mark.** The mark stays in memory and the saved copy; the call is dropped; the writer answers false (`5148-5153`); the dot goes red (`2025-2028`, `140-143`). Only a later whole-list save sends it again, because only that compares the class with the baseline (`1836-1844`). Reproduced: with the outbox full, a level was refused; a later level on another cell did not send it; a later points mark did. A page load from the server then replaces memory and the saved copy, and the mark is gone (`4323-4332`, `1753-1755`).
11. **Named calls.** `_noteRubricsSet`, `clearProfCache`, `_returnedSets`, `_markLocalWrite`, `_broadcastChange` (`4991-5000`). The five one-cell score writers each repeat part of that list by hand, in a different order.

Left as they are, and pinned: a + or − on some screens sends the Overall Comment again (`5281`); the gradebook's Clear Score sends each clear and then `clear_score` (`page-gradebook.js:3095-3099`).

---

# Part A. Stop marks being lost

Three steps: step 4, step 5 and step 1. Each is one PR and can be released alone. None needs any other step, the speed work, or the mark writers moved out of `shared/data.js`.

| Step | What it does                                        | Where it stands                                    |
| ---- | --------------------------------------------------- | -------------------------------------------------- |
| 4    | A whole-list save compares with this tab's own copy | Built, merged (PR 1336) and released on 2026-11-13 |
| 5    | A refused mark is sent again                        | Parked. Not to be built from this document yet     |
| 1    | Undo sends each call once                           | Ready to build. It does not wait for step 5        |

Each changes how a mark is saved, so each needs Colin, tests first, and an independent reviewer who tries to break it. Each is undone by reverting its one PR: what it keeps is in memory only, and nothing is stored or sent in a new shape.

For each step, "never worse than today" is argued against the same list: two tabs, a phone and a laptop, offline then online, the outbox full, storage nearly full, a re-key in the middle of a save, a rejected create, a class load in the middle of a save, an older build in the other tab, Demo Mode, and the 14-day purge of saved copies.

**How the differential run is used in Part A.** The run (`docs/differential-run.md`) stops at the first difference, and every id in it comes from one seeded generator, so one call added or removed shifts every id after it. So it can show that nothing else changed only up to the first place a fix acts. Step 4's run showed this. Seeds 1 and 2 had no difference. Seed 3 stopped at step 354: a tab with no baseline saved while the other tab's newer mark sat in the saved copy, and main sent three calls that step 4 does not. That was the fix acting, and the rest of seed 3 was never compared. (The tab had no baseline because one call never left the run's outbox: its fake server did not answer the category list. PR 1343 fixed that.) So each step proves its intended change with unit tests and a two-page browser spec, and plans its run so that the fix never acts in it. The run then shows that nothing else moved.

## Step 4. A whole-list save compares with this tab's own copy

**Built, merged and released.** PR 1336 merged on 2026-11-13 after an independent review and went to the live site the same day (release PR 1347). This section says what was built.

It fixes faults 4 and 7, the only way one tab cleared another tab's marks on the server.

**The rule.** When a whole-list save works out what this tab changed, it compares with what this tab itself last read or wrote. It never compares with the saved copy as another tab may have left it. Class settings already worked this way (`_settingsRead`).

**What is kept.** For each class, in memory only, two texts: this tab's own copy of the scores and of the statuses (`_keptText`, `_keepText` and `_keptValue` in `shared/data.js`). Each is the text of this tab's memory of that list at the last moment the tab read it from storage or wrote it there. If a later step ever writes anything else to storage (Part B, step 10b), the kept text stays this tab's memory. The two counts this design asked for, students and entries, were not built. Step 6 adds them if it is built.

**When it is recorded.**

- `_safeLSSet`: after a write that succeeded, on the first try or the second, for `gb-scores-…` and `gb-statuses-…` only. A write that failed records nothing.
- `_loadCourseFromLS`: the text it reads for the scores and for the statuses (the `keep` argument of `_safeParseLS`). If storage holds nothing, or the text cannot be read, what was kept is forgotten.
- `_persistLoadedField`: the text it wrote, and the text it found unchanged and did not rewrite.
- `_rekeyField`: a re-key made by another tab changes this tab's memory with no write here. The kept text gets the same change the baseline gets.

**When it is forgotten.** With the baseline, in `_forgetServerState`.

**Where it is used.**

- `saveScores`. The kept text is read first, before anything is written, and put in the same key space as the scores (`_applyIdRekeysToScores`, `_migrateRubricScoreKeys`). It takes the saved copy's place in two lines: the group grades the save starts from, and the fallback when there is no baseline. The guard still reads only the saved copy, so what is blocked did not change.
- `saveAssignmentStatuses`. The same two lines: the group check and the fallback.

**When nothing is kept** for the class, or the kept text cannot be read, the save starts from the saved copy, as it did before the step.

**The proof, as run for the PR.**

- `tests/whole-list-save-own-copy.test.js`, 17 tests. Ten failed before the step and pass after: fault 4's and fault 7's recipes, a changed mark not sent back, the two group checks, Demo Mode, a re-key from another tab, a second class. Two pass on both, to pin what must not change. Five each pin one line the review found unpinned.
- `e2e/two-tabs-behind-keeps-marks.spec.js`. Two pages on one class. The second opens while a write waits, so it has no baseline. Marks go in the first and a points mark in the second, then the connection returns. Every mark arrives.
- Every pin this design named passed untouched. No test file was edited.
- `tests/setup.js` gained one line, `_keptText = {}`, in the reset that starts each test as a fresh session. Without it one test's kept text reached the next. `tests/file-size-baseline.json` was raised for `shared/data.js`.
- The differential run was not 0 differences, as this design had said it must be. See Part A's opening.

**Never worse than before the step.**

| Sequence                 | Why this step is not worse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One tab                  | The kept text and the saved copy are the same text, so the same calls go.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Two tabs                 | Before, a save compared with the other tab's copy: it sent clears for that tab's marks, and copied or cleared group grades from that tab's changes. Now it sends only this tab's changes. Nothing it sent for this tab's own change is left out.                                                                                                                                                                                                                                                                                        |
| Offline then online      | The calls are worked out when the mark is made; the outbox is not touched.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The outbox full          | With a baseline nothing changes. With no baseline there is one rare sequence where this step is worse. Tab A has no baseline and holds a mark the outbox refused. Tab B's stale write drops that mark from the saved copy. Before, tab A's next whole-list save sent the mark again by accident, because it compared with the saved copy. Now it does not. The mark is lost at the next class load unless that save came first. It needs no fix of its own. Step 5 would not cover it: it remembers nothing for a tab with no baseline. |
| A re-key mid-save        | The tab's own re-key rewrites the saved copy, which records the new text. Another tab's re-key changes the kept text as it changes the baseline. If the kept text ever held an old id, the worst is this tab's own marks sent a second time.                                                                                                                                                                                                                                                                                            |
| A class load mid-save    | A load that leaves the scores alone because the teacher was typing records nothing. A load that is applied records the server's text, and then there is a baseline.                                                                                                                                                                                                                                                                                                                                                                     |
| An older build elsewhere | It writes its old copy to storage. Before, a save compared with that copy and could send clears. Now it compares with its own.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Demo Mode                | Nothing is sent. The group check uses this tab's own copy, as above. One tab is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The 14-day purge         | If the saved copy is gone while the tab is open, the old code compared the class with itself and sent nothing. Now the save still sends this tab's change.                                                                                                                                                                                                                                                                                                                                                                              |

**Cost.** One text for each list of each class the tab has loaded. `preloadClasses` loads every class, so a tab keeps a scores text and a statuses text for each. The total is bounded by what the browser's storage holds, a few MB. The phone keeps them too: it loads `shared/data.js`. The text is the one just written, so nothing is copied.

## Step 5. A refused mark is sent again (parked)

**Parked on 2026-11-13. Do not build it from this document yet.** It would fix fault 10. Step 1 does not wait for it.

Two things stop it.

1. The version that was reviewed sent a refused mark as soon as the outbox had room. That is worse than main in a plain sequence with a phone and a laptop, given below. None of the fixes the second review offered changes that.
2. The version in this section replaces it and closes that sequence. It is a new way of working and has had no review. Two rare sequences are left in which it is still worse than main. Nothing kept in the browser can close them, because the server keeps no version for a score and takes the last call to arrive.

The rule set for this step was: in every sequence, no worse than main. Step 5 does not meet it. This design recommends parking it. Open question 8 is the decision, and it is Colin's. Until then fault 10 stays as it is on main.

**Why the reviewed version was dropped.**

1. The laptop is offline with 500 changes waiting. The teacher scores a cell on the laptop. The outbox refuses the call and the sync dot turns red.
2. On the phone, which is online, the teacher scores the same cell again with another level.
3. The laptop reconnects. One waiting call lands, so there is room, and the reviewed step 5 sends the laptop's mark. It lands after the phone's.

On main the laptop's mark is never sent, and at its next class load the laptop shows the phone's. The reviewed step 5 put the older mark over the newer one. Main already does that for each of the 500 marks that were waiting; the step would have done it for the refused ones too. Nothing in the browser's storage or outbox shows the phone's mark, so no test made at the moment of sending can see it. The laptop can see it only by reading the class from the server first. That is the rule below.

**The rule.** A refused mark is not sent when there is room. It waits for the next time this tab reads the class from the server, which main does without being asked. If the server still holds, for that cell, what this tab last knew, the tab puts its mark back and sends it. That is what the teacher would do by typing the lost mark again at that moment. In every other case the load goes ahead as on main and the mark is gone, as on main.

**Nothing is held.** Step 5 asks for no class refresh, holds no refresh and holds no reload. `_hasUnsentWrites` is not changed. Until the class is next read, the page does what main does.

The second review asked for a bound on the hold (F2). The bound is none. Main already holds every class refresh, and the reload for a new version, while any call waits in the outbox (`_waitForQuietCourse`, `_autoUpdateOutboxBusy`). Room for a refused call comes in only two ways. A waiting call lands, and then main's own hold is already in force. Or the storage clean-up runs (`_evictOldestSavedCopy`), which happens when this tab next writes to storage and finds it full. So a hold of step 5's own adds time only when nothing waits and storage is full with nothing to clean up, and no wait ends that. And any hold, however short, keeps this tab from seeing another device's marks for as long as it lasts. In the new rule the class load is what sends the mark, so there is nothing to hold.

**What is kept.** In memory only, in one module variable: for each class, the cells (student and work) that have a refused score call.

**Put on the list.** In `_onWriteRefused`, when the refused call is `upsert_score`, `upsert_tag_score`, `upsert_rubric_score` or `save_score_comment`, and the class has a baseline (`undo` is set and its field is `scores`). `_onWriteRefused` already puts that cell's baseline row back. With no baseline nothing is remembered, which is main's behaviour. A refused `clear_score` or `save_score_report_note` is not remembered either: the comparison below cannot send those two calls again, and main does not.

**Taken off the list.** Whenever a cell comes off without being sent, nothing is sent for it and its baseline row is left as it is. A later whole-list save in this tab then does what main does.

- **A call for the cell lands, from any tab.** `flush:success` in `_onOutboxEvent`, matched by the entry's key, `cell:<student>:<work>`. Either another tab scored the cell, or this tab scored it again and that call was accepted. A cell that also has an earlier call of this tab's still waiting comes off this way too, and is left to main.
- **The class's baseline is forgotten** (`_forgetServerState`), or the class is no longer in memory.
- **A check at the class load fails.** The checks are below.
- **There is nothing to send.** The cell's entries in this tab's memory are the same on the server as its baseline's.

**At a class load that brings the class again** (`_bundleToCache`).

1. Before anything is replaced, copy three things for each remembered cell of the class: the cell's entries in the baseline, the cell's entries in this tab's memory, and how this tab's copy of the work is scored (scoring mode, points total, rubric, competencies). Follow re-keys (`_idRekeys`).
2. Apply the load exactly as today.
3. If the load left this tab's scores alone because the teacher was typing (`_refreshMustSkip`), stop: the cells stay on the list for the next load. If the load replaced the scores but did not end with the class flagged as fresh, the cells come off. That is main's result.
4. Otherwise, once the class is flagged as fresh and its saved copy's details are written, check each cell. All of these must hold, or the cell comes off:
   - the student and the work are in the class as loaded, and both ids can be sent (`_isSendableId`);
   - the work is scored the way this tab's copy was: the same scoring mode, points total, rubric and competencies;
   - the cell is not Missing or Excused (`isScoreLocked`);
   - the server's entries for the cell are the same on the server as the baseline's were. If they differ, someone else has scored the cell;
   - this tab's entries differ from the server's, so there is something to send;
   - no call that names the student and the work waits in the outbox (`window.v2Queue.queued`, for the score calls, `clear_score` and `set_score_status`). One can wait only if another tab scored the cell while the class was being read.
5. Put back the cells that passed, in one write shaped like the end of `_upsertScoreOne`. The cell's entries in memory become this tab's entries from step 1, each keeping the server's Note for the Report, since no score call carries it. Then `clearProfCache`, `_gradeBefore`, the saved copy written, `_gradeAfter` and `_markLocalWrite`. Nothing is copied to pair or group partners: each partner's cell was refused on its own and is judged on its own.
6. Send each cell, as below, then `_broadcastChange`.

**At a class check that answers "not changed"** (`bundle.not_modified` in `_doInitData`). Memory and the baseline are untouched. The server has just said its version of the class is the one this tab holds, so nothing has changed in the class that this tab does not know of. A remembered cell is sent if its student and work are in the class and can be sent, it is not Missing or Excused, this tab's entries differ from the baseline's, and no call for it waits in the outbox. Nothing is written to memory.

**Sending one cell.** The difference between the cell's baseline entries and this tab's entries goes through the existing send, for that cell only: `persistScoreDiffToCanonical`, handed one student's entries for one piece of work on each side. It sends what main's next whole-list save would send for the cell. Then:

- **At least one call was accepted and none was refused:** the baseline row becomes this tab's entries and the cell comes off the list.
- **Any call was refused:** the cell stays. `_onWriteRefused` puts the baseline row back, as today.
- **No call went at all** (an id that cannot be sent): the cell comes off and the baseline is left alone.

This needs a count of accepted calls beside `_writeRefusals`, added in `_writeRpc`. The send is never called from inside `_writeRpc` or from inside a save. It runs after the server's answer to the class load has arrived, when no save is running that could take a refusal here for its own.

**Same on the server.** Two sets of entries for one cell are the same when, competency by competency or criterion by criterion, they hold the same score, the same + or −, and the same Overall Comment, criterion comment and Went Beyond note. When the server's entries are compared with the baseline's, the Note for the Report counts too. A proficiency 0 and no entry are both unscored. On points and Complete work a 0 is a score, so there the comparison also asks `isScoreEntered` of both sides. Ids, dates and `created` are not compared: a load rebuilds them. Both sides are read in the same key space (`_migrateRubricScoreKeys`), as `saveScores` reads its "before". Any doubt reads as "not the same", which gives main's result.

**With no cell remembered, none of this runs.** It costs one look at an empty list at the top of `_bundleToCache`, one at the "not changed" answer, and one in `_onOutboxEvent`.

**Where.** `shared/data.js` only: `_onWriteRefused`, `_writeRpc` (the count), `_onOutboxEvent`, `_bundleToCache`, the "not changed" branch of `_doInitData`, and `_forgetServerState`. `shared/offline-queue.js` is not changed. A class loaded without the bundle (an older server) is not changed: there the mark is gone at the load, as on main.

**Never worse than main, sequence by sequence.**

| Sequence                                | Why this step is not worse                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One tab, offline then online            | Until the class is read again nothing differs from main. At that load main drops the mark. This step puts it back and sends it, because the server still holds what the tab knew.                                                                                            |
| A phone and a laptop                    | The phone's mark is in what the load brings, so the cell is not the same on the server and comes off. The laptop shows the phone's mark, as on main.                                                                                                                         |
| Two tabs                                | The other tab's call for the cell waits in the outbox, and then no class load can start (`_waitForQuietCourse`); or it has landed, and then the landing took the cell off the list; or it was made while the class was being read, and then the last check finds it waiting. |
| Two tabs, both refused on the same cell | Main loses both marks. Here the tab that reads the class first sends its mark, and the other tab's then comes off. That may be the older of the two. See the judgement below the two sequences.                                                                              |
| The outbox full                         | The case itself. A send refused again leaves the mark in memory and on the list for the next load. A refusal starts no request, so nothing loops.                                                                                                                            |
| Storage nearly full                     | The put-back is a write like any other: if the saved copy cannot be written, the call still goes, as today. The clean-up that frees storage is not held.                                                                                                                     |
| A rejected create                       | The work or the student is not in the class as loaded, so nothing is put back and nothing is sent.                                                                                                                                                                           |
| A re-key in the middle                  | The cell's ids are followed through `_idRekeys` each time they are used.                                                                                                                                                                                                     |
| A class load in the middle of a save    | A load that skips the scores leaves the list alone. The put-back flags the class as edited, like every writer.                                                                                                                                                               |
| An older build elsewhere                | Its stale write to the saved copy is not read by this step. Its calls are seen as any tab's are.                                                                                                                                                                             |
| The work changed on another device      | Scored another way, or the cell set to Missing or Excused: the cell comes off.                                                                                                                                                                                               |
| Demo Mode                               | Nothing is refused. The step does nothing.                                                                                                                                                                                                                                   |
| The 14-day purge                        | The saved copy is not read by this step.                                                                                                                                                                                                                                     |
| A reload                                | The list is lost, as the baseline is. The mark is lost then, as on main.                                                                                                                                                                                                     |
| No baseline                             | Nothing is remembered. Main's behaviour, with step 4's one rare sequence.                                                                                                                                                                                                    |

**Where it is still worse than main.** In both, this step sends the older mark and it lands last. Main would have lost the older mark and kept the other.

1. **There and back.** While the refused mark waits, the same cell is scored on another device and then put back to exactly what it was, or scored and then cleared. The server's cell then reads as untouched.
2. **The same half second.** The same cell is scored on another device, or in another tab, in the moment between the server answering this tab's class load and this tab's call landing. Main has this gap for every tap. Here it is open for a mark that main would not have sent.

One sequence is a judgement. Two tabs each hold a refused mark for the same cell. Main loses both and shows the value from before. This step sends the mark of whichever tab reads the class first, which may be the older one, and the other is lost. Whether an older mark is worse than neither is for Colin to say with the two above.

One more difference is not a loss. If the cell's grade was returned to the student from another device in between, the put-back is a change to a returned grade, as typing it again would be. In a class that holds grades it shows as a draft until it is returned.

**Proof plan.** Tests first. Each unit test is signed in, with the real outbox and the recording fake server, in a new file, `tests/refused-mark-after-class-load.test.js`, built on `tests/whole-list-save-own-copy.test.js`. The class is loaded from a bundle through `_bundleToCache`, as `tests/data-class-bundle.test.js` does, so it has a baseline and a version. The outbox is filled to its limit with `window.v2Queue.enqueue`, as `tests/write-path-audit.test.js` does. "The class is read again" is a second `_bundleToCache` with the bundle the test says the server holds, or `initData` with the fake server answering `not_modified`.

Tests that fail on main and pass after:

1. Fault 10's recipe. A level is refused. The outbox empties. The class is read again and the server still holds the old level. Memory holds the teacher's level, one call carries it, the baseline row holds it, and nothing is left remembered.
2. The same, where the class check answers "not changed". One call goes. Memory and the saved copy are not written.
3. A refused clear goes as a clear.
4. A refused points mark and a refused Complete mark: one `upsert_score` each.
5. (F5) The server's answer rebuilds the cell's entry with another id, date and `created` and the same score: the cell reads as the same and the mark is sent. A proficiency 0 on one side and no entry on the other read as the same.
6. (F3) A cell with a level and an Overall Comment sends two calls. After the load the outbox has room for one. The cell stays remembered, the baseline row is the server's again once the refusal's undo has run, and the next load sends both.
7. The student or the work is re-keyed while the cell is remembered: the mark goes under the server id.
8. With the student page on, the put-back runs the Draft and Returned rule once for the cell, as a typed mark does.
9. A mark refused again after the put-back stays in memory, and the next load tries once more. The number of `get_class_bundle` requests is the number the test made.
10. A load that skipped the scores because the teacher typed keeps the mark in memory, and the next load that does not skip sends it.
11. Two classes: a refused mark in the second is still sent when the second is next read, after the first was read in between.
12. Pair work: the member's mark and the partner's copy were both refused. Each is sent once, and no group copy is made on top.

Tests that pass on main and after, to pin what must not change:

13. (The phone and the laptop.) The server's answer holds another level for the cell: memory shows the server's, no call is sent for the cell, and a later whole-list save sends nothing for it.
14. (F1) A call for the cell lands from another tab after the refusal, and the server's answer then shows the cell at the baseline's value: nothing is sent.
15. (F1) Another tab's call for the cell is queued while the class check is out, and the check answers "not changed": nothing is sent then. A points mark elsewhere in this tab then sends what main sends, the refused level included, because the baseline was left alone. The same at a load that brings the class again: nothing is put back.
16. (F2) Nothing is held. With a cell remembered and the outbox empty, `_hasUnsentWrites()` is false, `_waitForQuietCourse` resolves, `_evictOldestSavedCopy` is not blocked, `_autoUpdateOutboxBusy()` is false, and the refusal has asked for no class refresh.
17. (F3) The work was made offline and its create is rejected while the cell is remembered. The load brings the class without the work: no entry for it is put in memory or the saved copy, nothing is sent, and the baseline is untouched.
18. (F4) While a cell is remembered and the outbox has room for one call, a level on another cell is accepted, answers true, and its baseline row moves on. Nothing is sent for the remembered cell from inside that save.
19. (F5) On Complete work, Incomplete (a 0) on one side and no entry on the other read as not the same: nothing is put back.
20. The load brings the cell as Excused; the work changed from proficiency to points; the student was withdrawn. In each, nothing is put back.
21. A load that replaced the scores and skipped another field puts nothing back.
22. This tab scores the cell again and that call is accepted before the load: one call in all, the newer.
23. No baseline: nothing is remembered, and the calls are main's.
24. After the class's baseline is forgotten, a later load puts nothing back.
25. With no call refused, a class load leaves the same saved text and sends the same calls as before the step.

**The browser spec.** `e2e/refused-mark-after-class-load.spec.js`: "outbox full: a refused mark is sent after the next class load, and a cell the other tab scored is left alone". Two pages on one class in one browser.

1. Page A loads the class. Writes start to fail, so calls wait. The outbox is filled to its limit.
2. In A the teacher gives student 1 and student 2 a level on the same work. Both calls are refused, both levels show, and the dot is red.
3. The connection returns, with the last waiting call held back. Page B opens and gives student 2 another level. Its call is accepted, because there is room now.
4. The held call is let go and everything lands. Page A reads the class again, as it does on main when another tab saves.
5. The server received A's level for student 1, once, after the class load. It never received A's level for student 2. A shows its own level for student 1 and B's for student 2, and the dot is green.

On main the server never receives student 1's level, and A shows the old one.

**Pins that must pass untouched.** `tests/offline-queue.test.js`, `tests/write-path-audit.test.js`, `tests/write-path-regressions.test.js`, `tests/data-class-bundle.test.js`, `tests/score-rejected-clear-retype.test.js`, `tests/signout-offline-queue.test.js`, `tests/whole-list-save-own-copy.test.js`, `tests/grade-return-data.test.js`, `tests/grade-return-server.test.js`, `e2e/sync-loop.spec.js` (a failing server sets off no runaway requests), `e2e/two-tabs-behind-keeps-marks.spec.js`.

**The differential run.** The whole run, seeds 1, 2 and 3, both modes, `--offline --two-tabs`. The step acts only after the outbox refuses a call, and the run never fills the outbox. So the fix never acts in it, the whole run is compared, and it must show 0 differences. The PR says how it checked that no call was refused on either side: the warning "not queued" in the page's console is the sign. A difference is a regression until the PR shows otherwise.

**What a builder must also do.** Add the new module variable to the reset in `tests/setup.js`, beside `_keptText`. Raise `tests/file-size-baseline.json` for `shared/data.js`. Write tests 1 to 12 first and see them fail on main.

**Before it is built.** Colin's answer to open question 8, and an independent review of this section. It has had none.

## Step 1. Undo sends each call once

Fixes fault 1. Ready to build. It does not wait for step 5.

**The rule.** An Undo hands the outbox the same calls as today, each one once. The first draft deleted the second send. That was wrong: there is a case where only the second send carries the mark.

**The case.** In a tab that is behind, the guard blocks Clear Score's save, but the page still sends `clear_score` (`Grader.clearScoreOnServer`). Cmd+Z then puts the mark back in memory and its save is blocked too. On main the second send in `Grader.undoCell` is what restores the mark on the server. Without it the server keeps the clear while the screen shows the mark, and the mark is gone at the next class load. Keeping the second send only when `saveScores` answered false is not enough: Clear Score can be blocked and the Undo let through, because the Undo holds one more entry and can sit just above the guard's line. Then the save answers true, its own comparison finds nothing to send (the baseline still holds the mark), and the clear stands. The second review reproduced this on main: Clear Score was blocked at 11 entries against a line of 12, the Undo's save passed at 12 and sent nothing, and only the second send put the mark back.

**The three second sends.** `Grader.undoCell` and `Grader.undoOnPhone` in `shared/grader.js`, and `restoreScoreCells` in `shared/data.js`. Each calls `saveScores` and then `persistScoreDiffToCanonical`.

**What is kept.** For the length of one action only: the calls the `saveScores` just before handed to the outbox and the outbox accepted, each as its name and contents. The outermost `saveScores` opens the record. It is emptied in a microtask (a job the browser runs as soon as the script that is running ends), so before the page next gives way, and when the next outermost `saveScores` starts.

**Where.**

- `saveScores` opens the record around its send. A save the guard blocks records nothing. A call the outbox refuses is not recorded.
- The three places a score call is handed to the outbox note each accepted call while a save's record is open: the two in `_persistScoreToCanonical` (the score call, and `save_score_comment`), and `window.upsertCellScore`.
- **The skip is on only inside a second send.** Each of the three second sends tells `persistScoreDiffToCanonical` that it is one, with an argument only they pass. Only for the length of that call do the three places skip a call that is in the record. At every other time they send. Every level a teacher taps goes through the same three places (`_upsertScoreOne` calls `_persistScoreToCanonical`), and `window.upsertCellScore` can be called by any file. A one-cell write later in the same task, with the same contents as a recorded call, must go. Today `persistScoreDiffToCanonical` is the only caller of `window.upsertCellScore`, and no screen calls it. The rule does not lean on that.
- The second sends stay where they are. They now skip what the save just sent. The comment "it goes up twice, as before" on `Grader.undoCell` is corrected.

**When nothing is in the record** (the save was blocked, or every call was refused): the second send goes whole, as on main.

**Tests.**

- Changed pins, failing on main once changed: the three that assert "twice" assert once (`tests/pin-gradebook-writes.test.js`, `tests/pin-phone-grade-writes.test.js`, `tests/pin-assignments-fills.test.js`), and `tests/grader.test.js`.
- New, passing on main and after, to pin what must not change:
  - the case above: the server ends holding the mark;
  - Clear Score blocked and its Undo let through: the same;
  - a first send the outbox refused, where the second send still tries;
  - an Undo of a fill where the outbox takes some calls and refuses the rest: only the accepted ones are skipped;
  - a level tapped in the same task right after an Undo, with the same contents as a call the Undo's save sent: it is sent;
  - a direct `window.upsertCellScore` call in the same task: it is sent.
- New: offline then online, one waiting call for each undone cell.

**Pins that must pass untouched.** `tests/fill-undo-cells.test.js`, `tests/score-rejected-clear-retype.test.js`, `tests/gradebook-clear-score-undo-ticks.test.js`, `tests/gradebook-clear-undo-toast.test.js`, `e2e/pin-gradebook-edits-reload.spec.js`, `e2e/pin-assignments-grading-reload.spec.js`.

**The differential run.** This step removes calls, so the run cannot compare an Undo. The run first gets a switch, `--no-undo`, that keeps every Undo that sends scores out of a run:

- the `gradebookUndo` action, and the `undo` choice inside the fill, clear and Delete Assessment actions (`scripts/differential/actions.mjs`);
- the phone's Undo, which is the run's own `phoneUndo` action (`PHONE_ACTIONS` and `phoneRun` in `scripts/differential-run.mjs`; it calls `Grader.undoOnPhone`). The first list left it out.

The random numbers are still drawn and the action is still chosen, so the rest of the sequence is the same. The switch is its own PR and is proved main against main. Then the run with `--no-undo`, three seeds, both modes, `--offline --two-tabs`, must show 0 differences. With every Undo out, the fix never acts, so the whole run is compared.

**Never worse than today.** In every sequence the outbox is handed the same set of calls as on main, less a call identical to one it accepted a moment earlier in the same action. A repeat of an accepted call cannot change what the server ends with: it sets the same cell to the same value, straight after the first. So the list of sequences comes to two checks. Is anything skipped that was not just accepted? No: a blocked save and a refused call record nothing. Is anything skipped outside a second send? No: the skip is off everywhere else. The second review ran the rule against five sequences and it held in each: the case above; both saves blocked; offline, where main's repeat only replaced the waiting call; a full outbox; and a fill's Undo that was partly refused.

One thing gets better. On main, if the server rejects both copies of a call, the second puts the wrong row back in the baseline, because its row was taken after the save had moved the baseline on. With one copy the right row goes back.

## What Colin and Karen will notice from Part A

- **With one tab open and a connection:** nothing.
- **Step 4, released:** with two tabs on one class while offline or while changes are waiting, marks entered in one tab are no longer cleared by a points mark, a clear or an Undo in the other.
- **Step 1:** nothing.
- **Step 5, parked:** nothing. Fault 10 is as it was. When the sync dot has turned red because the outbox was full, a mark entered then can show on screen and be gone after the next class load.
- **Step 5, if it is built:** that mark stays, and is sent when the class is next read, unless the same cell was scored somewhere else in between. The class refreshes when it does today: nothing is held.

---

# Part B. Everything else

Not approved. It needs its own review. The order: step 6, step 7, then steps 0, 2 and 3 only if step 0's measurement asks for them, then 8, 9 and 10a. Steps 10b, 11 and 12 are described so they can be judged, and this design recommends not building them now. Step 13 only if measured.

| #   | Step                                                           | Kind                  | Needs the mark writers moved (plan item 7) | Size   | Risk   |
| --- | -------------------------------------------------------------- | --------------------- | ------------------------------------------ | ------ | ------ |
| 6   | Points, Complete and Incomplete save as one cell               | Behaviour             | No                                         | Small  | Medium |
| 7   | The score send becomes private (S19-B5)                        | Rename                | Better after                               | Small  | Low    |
| 0   | Measure a desktop score entry                                  | Tests only            | No                                         | Small  | None   |
| 2   | Gradebook rows built by one builder                            | Move only             | No                                         | Medium | Low    |
| 3   | Gradebook redraws the rows that changed                        | Behaviour (screen)    | No                                         | Medium | Medium |
| 8   | One function writes the scores copy; on-save hooks (Track E 3) | Move only             | Yes                                        | Medium | Medium |
| 9   | Draft and Returned runs on the changed cell                    | No change for one tab | Better after                               | Small  | Medium |
| 10a | Undo leaves alone a cell another tab has scored since          | Behaviour (two tabs)  | No                                         | Small  | Low    |
| 10b | A tab that is behind writes only its own cells                 | Behaviour (two tabs)  | Yes                                        | Large  | High   |
| 11  | The guard judges the tab's own change                          | Behaviour (two tabs)  | Yes, and 10b                               | Small  | High   |
| 12  | The same for statuses, ticks and Draft and Returned rows       | Behaviour (two tabs)  | Yes, and 10b                               | Medium | Medium |
| 13  | The grader dialog redraws less                                 | Behaviour (screen)    | No                                         | Small  | Low    |

The plan puts item 7 before this item, and this design keeps that order. For every step: tests first; a behaviour step needs Colin and an independent reviewer; undo is reverting its one PR. A step that adds or removes calls proves that with unit tests and a two-page browser spec, and uses the differential run, with the changed action switched off, only to show nothing else moved.

## Step 6. Points, Complete and Incomplete save as one cell

Fixes fault 5: a single mark is never blocked for being in a tab that is behind.

`_setPointsScoreOne` and `_setCompletionMarkOne` (`shared/data.js:7700-7747`) keep the code that builds the entries exactly as it is (the `uid()` id, the work's date, `scoreTypeFor`, the key order; `7723-7744`), so the saved text is the same. Only the last line changes: in place of `saveScores` they save and send as `_upsertScoreOne` does (`5140-5157`). They keep what `saveScores` did for them:

- moving the whole class's marks onto server ids first (`6291`), not only the cell's;
- one call for a points cell however many competencies it has (`5662-5672`);
- dismissing a failed write the teacher has typed over (`6349`), called as it is today;
- the mass-loss check. It uses two counts, students and entries, of this tab's own copy. Step 4 as built keeps the text only, so this step adds the counts where the text is recorded, and nothing is parsed at the tap. If the counts say this tab's memory has dropped the way the guard's rule means (`6249-6258`), the mark goes through `saveScores` exactly as today, guard and all.

What changes besides fault 5: a later points mark no longer sends again a cell the server rejected (the outbox's own one more try at the next page load stays, `offline-queue.js:1107-1129`); a refused cell is fault 10, which step 5 would fix.

A mark in a tab that is behind is then saved the way a level is today: the other tab's marks leave this computer's copy until the next class load, and the server keeps them (fault 3, unchanged).

- Pins before: step 4's, and `tests/score-complete-incomplete.test.js`, `tests/pin-grader-dialog-writes.test.js`, `e2e/pin-delete-assessment-then-grade.spec.js`.
- Changed pins: `tests/score-guard-keeps-mark.test.js:335` and `e2e/guard-keeps-mark.spec.js:149` (the mark is saved and sent). The three other cases in that file that use a points mark to reach the guard (`359`, `398`, `411`) are decided again in the PR, test first.
- Differential run: the whole run with `--must-reach setPointsScore,setCompletionMark`, 0 differences, because one tab sends the same call and stores the same text.

## Step 7. The score send becomes private

After step 1 the grader still makes the second send itself. This step moves `Grader.undoCell`'s and `Grader.undoOnPhone`'s two lines into one data-layer function, renames `persistScoreDiffToCanonical` to `_sendScoreDiff`, takes it off the allowlist (`tests/grader-guard.test.js:44`) and makes that test fail if any file but the mark writers' names it. Tests that call it directly (`tests/data-scores-v2-dispatch.test.js:240-253`, `tests/grade-return-data.test.js:279-313`) go through `saveScores`. Pins: step 1's. Differential run: 0 differences.

## Steps 0, 2, 3 and 13. Speed

**Step 0. Measure.** `e2e-perf/speed.spec.js` only. Timed in the page, as PR 1282 did for the phone: a score typed in the gradebook's Scores view, a key in the Competencies view, a level on an Assignments card, a level in the grader dialog, Set Everyone To on 30 students; at full and quarter speed; with the student page off and on. It records and fails nothing.

**The test for going on.** Build steps 2 and 3 only if a typed score takes more than 100 ms to draw at quarter speed. Build step 13 on the same test for the grader dialog.

**Step 2. One row builder (move only).** `teacher/page-gradebook.js`: the row and Class Average code inside `renderScoresTable` (`1852`) and `renderDetailedTable` (`1376`) becomes functions the full page calls. Pins: `tests/pin-gradebook-writes.test.js`, `e2e/pin-gradebook-edits-reload.spec.js`, `e2e/pin-gradebook-sort-filter.spec.js`, `e2e/gradebook-group-marks.spec.js`. Proof: the page's HTML is the same text before and after, on the pins and on the differential run's screens (`--screens-every 1`).

**Step 3. Redraw the rows that changed.** `teacher/page-gradebook.js` (`_redrawCompetencyCell` at `2468`, the Scores view's `commit` at `3626`, `_restoreUndo` at `2554`). What depends on a cell:

| On screen                                                  | Redrawn after one mark                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| The student's row: every cell, and the overall grade       | Yes. A rubric level can change the student's other cells         |
| The rows of the student's pair or group partners           | Yes                                                              |
| The Class Average under that column, and the class overall | Yes                                                              |
| The To Grade and To Return buttons                         | Yes                                                              |
| That student's grade in the roster                         | Yes (`refreshSidebarGrades`, already exists)                     |
| Class Results, when open                                   | Yes (`ClassResults.refresh`, as today)                           |
| Every other row and column                                 | No                                                               |
| The dashboard                                              | No. It is not on screen; it works its sums out again when opened |

Three rules keep it honest. The same code builds a row for the full page and for the small redraw. In tests, after every score, the page is also drawn in full and the two must match exactly; the browser tests and the differential run switch that check on, and it is off for teachers. A filter or sort that depends on scores (To Return only, for one) redraws the whole page as today. A constant turns the small redraw off (`FV_CELL_REDRAW`, like `FV_CACHE_FIRST`), removed two releases later. Differential run: 0 differences, the branch build running with the check on, and the check never firing.

**Step 13. Grader dialog.** `teacher/page-assignments.js:15917-15950`, `16029`. Pins: `tests/pin-grader-dialog-writes.test.js`, `e2e/group-grader.spec.js`. The same check as step 3.

The Assignments cards and the phone already redraw one row. Nothing changes there.

## Step 8. One function writes the scores copy, and on-save hooks

Move only, in the mark writers' file. Every place that writes the scores copy calls one function: the five one-cell writers (`shared/data.js:5143`, `5378`, `5449`, `5519`, `5580`), `saveScores` (`6341`), the clean-up after Delete Assessment (`shared/data-assessments.js:446`), Edit a Copy's move (`shared/data-rubrics.js:505`), the re-key (`shared/data.js:2405`) and the class load (`1753`). `_saveCourseField` and that function run one list of hooks in place of the named calls (`4991-5000`). Each writer keeps its own order of effects where the order can be seen (a refused level does not tell other tabs, `5153-5156`). A new test fails if any other code writes `gb-scores-`.

It is needed for step 10b. For step 9 and for Track E's tidying it is a convenience. Pins: every pin named in steps 1, 4 and 6, and `e2e/pin-phone-grade-tab.spec.js`. Proof: the method for mark-touching moves (DECISIONS, "Marks may be moved"): 0 differences on three seeds, both modes, offline and two tabs.

## Step 9. Draft and Returned runs on the changed cell

The one-cell writers pass the cell's old entry to the rule instead of reading the whole saved copy and comparing every cell (`shared/data.js:7217-7262`). One tab gets the same rows as today.

It fixes **half** of fault 6: the rule no longer reads the other tab's marks as cleared. The other half stays: a tab that is behind still writes its whole cached set of rows (`6940-6941`), and in Demo Mode the other tab's drafts are dropped. Only step 12 would fix that. Step 9's test claims only the first half.

Pins: `tests/grade-return-data.test.js`, `tests/fixtures/grade-state-cases.json`, `e2e/marks-read-current-piece.spec.js`. Differential run: 0 differences, the `gb-grade-returns-` text included.

## Step 10a. Undo leaves alone a cell another tab has scored since

Undo means "put back, unless scored again since" (`shared/data.js:6358-6364`; DECISIONS, "Set Everyone To" 3). Today a tab that is behind cannot see that the other tab scored the cell, and its Undo overwrites the newer mark on the server.

**The rule.** Before an Undo puts a cell back, it also reads that cell from the saved copy. If the saved copy holds a **third value**, neither what is being undone nor what was there before it, another tab has scored the cell: the Undo skips it. Anything else tells nothing, and the Undo goes on as today: the same value, the value from before (an older build's stale copy reads this way), or no saved copy at all (the 14-day purge, storage cleared).

It lives in `restoreScoreCells` (`6365`) and in the two cell Undos (`shared/grader.js:156`, `279`). It can only make an Undo do less, and only where another tab wrote. New tests: R1 in `tests/score-guard-keeps-mark.test.js:439` without the fill that trips the guard; an older build's copy; an empty saved copy. Differential run with `--no-undo`: 0 differences.

## Step 10b. A tab that is behind writes only its own cells

This is the fix for fault 3. The review broke the first draft of it four ways. Below is the rule made whole, then why this design recommends not building it now.

**The invariant.** Once a tab has seen another tab's write, it stops writing its whole memory. From then until it next loads the class, each write changes only cells this tab wrote itself, and only where nobody has written since. It never takes another tab's marks into its memory.

**What a tab keeps for each class.**

1. The storage text it last read or wrote. Used for one thing: to notice another tab's write.
2. Its own copy from step 4: the text of its own memory. Used as the "before" of a whole-list save and for the counts. These two are never the same thing again once the tab has merged.
3. Its own cells: for each cell it has written since it last loaded the class, what it last wrote there and what was there before its first write.
4. A flag: merging. Once set it stays set.

**One write.**

1. If the flag is not set and storage holds the text in (1), write the whole of memory, as today.
2. Otherwise set the flag, read the saved copy, and for each own cell:
   - a cell this action is writing: put in what memory holds. The teacher's newest action wins.
   - the saved copy holds what this tab last wrote: leave it.
   - the saved copy holds what was there before this tab wrote: put this tab's value back. A stale whole write, as an older build makes, dropped it.
   - the saved copy holds a third value: another tab scored it later. Keep that, and take the cell off the list.
3. Write the result, and record it as (1). (2) is this tab's memory, as always.
4. A missing saved copy, or any error: write the whole of memory, as today.

**When the list is emptied and the flag cleared.** At the line where memory is replaced, not when the load finishes: in `_persistLoadedField` for the scores (`shared/data.js:1755`), and in `_loadCourseFromLS` (`4874`), which is also how a signed-in tab re-reads storage after a failed load (`4800`) or while writes wait (`1619`). A mark typed during the rest of a load is then on the new list.

**The review's sequences against the rule.**

| Finding | Sequence                                                          | Under the rule                                                                                               |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F1      | A tab that is behind types y (merges), then z                     | The flag is still set, so z merges too. The other tab's mark stays.                                          |
| F2      | After a merge, a whole-list save with no baseline, or the guard   | Both use (2), this tab's memory, which holds none of the other tab's marks. No clears, no false mass loss.   |
| F5      | An older build writes its stale copy, then this tab undoes a fill | Step 10a: the cells read as the value from before, not a third value, so the Undo goes on.                   |
| F6      | A types X=3, B types X=4, A types Y                               | The saved copy holds 4, a third value for A. A keeps 4 and takes X off its list.                             |
| Loads   | A mark typed while a load's later reads are still running         | The list was emptied when memory was replaced, so the mark is on the new list.                               |
| Demo    | An older build's whole write, then this tab writes                | Marks this tab loaded and never changed are not put back. On main they are. This is a loss the rule accepts. |

**What the rule still cannot do.**

- It cannot tell another tab putting a cell back to its earlier value from a stale copy that never had this tab's value. It treats both as stale.
- It does not put back marks this tab loaded and never changed, when an older build has written over them. Signed in, the next class load restores them. In Demo Mode they are lost, where main keeps them.
- It does not bring this tab's screen up to date. That waits for the refresh, as today.

**Recommendation: do not build 10b, 11 or 12 now.**

After Part A and steps 6, 9 and 10a, here is what is left of the two-tab faults for a signed-in class:

- The other tab's marks can be missing from this computer's saved copy until the next class load. A teacher sees that only by reloading with no connection. The server has them.
- A bulk action (Clear Score, Undo, an Undo of a fill) in a tab that is far behind can still show the red message and not apply. No mark is lost by it.
- A Draft badge can be wrong in a tab that is behind until the server's rows are read again.
- In Demo Mode, which holds only sample data, two tabs can still lose each other's marks.

None of these loses a real class's mark. Step 10b is the largest and riskiest step here: four things kept for each class, a mode that must not lapse, a three-way choice for each cell, and exact moments for emptying. Its first draft lost marks in the saved copy four ways. It sits on the path every mark takes.

The cause is that the saved copy is one text for the whole class, shared by every tab. A rule laid over that can only guess who wrote a cell last. The lasting fix is to store one record for each cell, so a tab can only ever write its own cell. That is a storage change of its own (`docs/write-path-plan.md`, "Out of scope").

A simpler rule was weighed: a tab that is behind refuses whole-list saves and reloads the class first. It turns a quiet fault into a refused action, which needs a message (rule 5). Offline it has nothing fresh to reload but the saved copy, and taking that into memory is what failed in PR 1263. Not recommended.

Step 11 (the guard judging this tab's own change) and step 12 (the same rule for statuses, ticks and Draft and Returned rows) only make sense on top of 10b. Without 10b, letting a blocked bulk save through would write the stale copy over the other tab's marks, which is what the guard is there to stop (PR 1250).

## What Colin and Karen will notice from Part B

- **Gradebook:** typing scores down a column is quicker, if step 0 says steps 2 and 3 are worth building. The scroll place and the selected cell stay as today.
- **Phone:** nothing. It is already 15 ms.
- **Two tabs:** a single points, Complete or Incomplete mark in the tab that is behind is saved, not blocked with the red message (step 6). An Undo leaves alone a cell the other tab has scored since (step 10a).
- **Reports, grades, the student page:** nothing.

---

# Both parts

## The server

**No server change is proposed.** No SQL.

Faults 3 to 7 are two tabs sharing one browser's storage. The server never sees them, so the browser must fix them.

Two devices are a different matter: the server takes the last call to arrive for a cell (`30-functions.sql:10353`). That is unchanged. A server check would have to refuse a write. The app already in teachers' browsers sends no version, so every one of its score writes would be refused or waved through unchecked. A refused write becomes a failed write that is dropped after one more try (`offline-queue.js:1107-1129`). One refusal of this kind exists already: `upsert_tag_score` refuses a competency score on rubric work (`30-functions.sql:10498`), and a call it refuses ends in the failed list.

**Why sending a call twice is safe.** The old score calls take no key (CLAUDE.md rule 7; DECISIONS, "Student page build answers" 11). Each sets one cell to one value, so the same call twice leaves the same result. The outbox sends one cell's calls in order, one at a time. A failed call is dropped when a newer call to the same target lands or is waiting (`offline-queue.js:1051`, `1153-1170`, `1504-1511`). The one gap, on main today and not changed here: a rejected call is tried once more at the next page load even if a newer value has gone by a different call, such as `clear_score` after a rejected level.

## Risks and how each is caught

| Risk                                        | What could go wrong                                                                                                       | How it is caught or contained                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two tabs                                    | Part A: a step sends less than it should for this tab's own change                                                        | The "never worse" tables; each step's tests through the real load function; the pins that must pass untouched                                                                             |
| An older build in another tab               | It still has the faults Part A fixes                                                                                      | The release rule: before a release, **every open FullVision tab is reloaded or closed**, on every computer                                                                                |
| Two devices                                 | The later call wins for a cell, as today. A fill or Undo on a device that is behind can overwrite a newer mark            | Not changed here. The refresh after two quiet seconds stays                                                                                                                               |
| Offline then online                         | Calls wait and go in order, as today. Over 500 waiting, a mark is refused                                                 | Fault 10, unchanged while step 5 is parked. Step 5 would send the mark after the next class load, unless the cell was scored somewhere else. Across a reload it can still be lost (below) |
| A failed write in the middle                | A network failure retries. A rejected write puts its baseline row back (`shared/data.js:1976`)                            | Unchanged in Part A. After step 6 a later points mark no longer sends a rejected cell again; `tests/score-rejected-clear-retype.test.js` pins the typed-over case                         |
| A class loading while a mark saves          | The load overwrites the mark                                                                                              | Every writer still flags the class as edited (`_markLocalWrite`). `tests/write-path-regressions.test.js`                                                                                  |
| A re-key landing mid-save                   | A mark is filed under an id the server never had                                                                          | The re-key rewrites memory, the saved copy, the baseline and the waiting calls as today (`shared/data.js:2398-2412`), and step 4's kept text. `tests/id-rekey-and-points-clear.test.js`   |
| The 14-day purge of saved copies            | A copy is removed while a tab still has the class open                                                                    | Steps 4 and 10a each treat a missing saved copy as telling nothing. Step 5 does not read the saved copy. The outbox is a different key and is never purged (`shared/data.js:4412-4426`)   |
| Storage full                                | The saved copy write fails                                                                                                | As today: the call still goes, the dot says so. Step 4 records nothing for a failed write. Step 5 holds nothing, so the clean-up that frees storage runs as today                         |
| Step 5 sends an older mark over a newer one | The two sequences named in step 5: the same cell scored on another device and put back, or scored in the same half second | Step 5 is parked until Colin rules on them. Every check that fails leaves main's result. Nothing is held, so no refresh waits on a refused mark                                           |
| The small redraw misses something           | A grade on screen is out of date until the next full redraw. No mark is affected                                          | The full-redraw check in every browser test and the differential run; the constant that turns it off                                                                                      |
| The measured gain is too small              | Risk taken for nothing                                                                                                    | Step 0 comes first and decides steps 2, 3 and 13                                                                                                                                          |

## Open questions, each with a recommended answer

The lines on published views are my reading of each author's published work. None of them has seen this design.

1. **Build step 10b (and 11 and 12)?**
   **Recommended: no, not now.** The reasons are under step 10b.
   - Kleppmann (_Designing Data-Intensive Applications_, chapter 5, and his work on merging edits made apart): to merge safely you must know, for each item, which change came after which. One shared text holds no such record, so a merge laid over it has to guess. His work points to storing each item with its own history.
   - Nygard (_Release It!_): do not put a new way to fail on the busiest path without need.
   - Beck (_Tidy First?_): take the small steps that pay now; leave the costly one until it is needed.
2. **Should the server refuse a write from a device that is behind?**
   **Recommended: no.** Keep the last call wins for a cell.
   - Kleppmann (the same chapter): last write wins quietly throws away one of two writes made at the same time, and is a poor choice where losing a write is not acceptable; his answer there is a version check. A write that follows another is not that case: it replaces it. One teacher moving between two devices mostly makes the second kind. His view points toward a version check for the first kind, which here is a device that was offline for a while.
   - Nygard: every link to another system fails in time, so decide what the failure looks like before adding one. A refusal here becomes a dropped write, with no screen to put it right.
   - So: not now. Ask again if two teachers ever share a class, or once a refused write has somewhere to go.
3. **Should a refused mark outlast a reload?**
   **Recommended: not yet.** Step 5, if it is built, covers the open page only. First count how often the outbox refuses a score (the kind of write only, never its contents, as `_discardWrite` reports), then decide. Nobody has counted one yet. The count is a small change of its own and is not part of any step here.
4. **How slow must the gradebook be for steps 2 and 3 to be worth it?**
   **Recommended:** more than 100 ms to draw a typed score at quarter speed.
   - Fowler (_Refactoring_, on performance): measure before tuning. Beck: the smallest change that removes the pain.
5. **A switch for the small redraw, and the full-redraw check in tests?**
   **Recommended: yes to both.**
   - Fowler's site ("ParallelChange", "Feature Toggles"): keep the old path beside the new one until the new one is proven, then remove it and the switch.
6. **Should the red "Score save blocked" message move to the sync dot?**
   **Recommended: leave it.** The plan lists the remaining toasts as a feature PR of their own. Colin's call.
7. **Fix the phone's Undo send though no button reaches it?**
   **Recommended: yes, in step 1.** The plan keeps `undoLastScore` for a phone Undo button (section 8, item 16).
8. **Step 5: bring it back, or leave fault 10 as it is?**
   **Recommended: park it.** It does not meet the rule it was given, and the version in this document has had no review. Bringing it back needs two things: Colin's word that the two sequences under "Where it is still worse than main" are acceptable, and an independent review of the new rule. Counting refused scores first (question 3) would show whether it is worth either. Both sequences need the same cell scored on two devices, either within the same half second or back to exactly where it was. Fault 10 itself needs only a full outbox, and then loses every mark entered until there is room.
   - Kleppmann (_Designing Data-Intensive Applications_, chapter 7, on lost updates): a check made by the client and then a write is a race, unless the store itself compares versions as it writes. His work points to the lasting fix, a version on each score checked by the server. That is a server change, and question 2 says why it is not proposed now.
   - Nygard (_Release It!_, "Fail Fast"): a system that cannot take more work should say so at once, and not accept work it may not keep. That points at the refusal itself: a mark that shows on screen though the outbox did not take it. Changing that needs a message, and rule 5 leaves only the sync dot.
   - Beck (_Tidy First?_): do not pay for a change before there is a reason to. No refused score has been counted.

## What this design does not do

- It does not change grade math, any server function, or anything the server stores.
- It does not stop a device that is behind from winning over a newer mark on another device. That is the server's rule.
- It does not keep the saved copy right when two tabs write it (fault 3), unless step 10b is built.
- It does not keep a tab's screen in step with another tab any sooner than today.
- It does not fix a stale tab saving over the class's work list, roster, categories or settings (F2 and F3 in PR 1263).
- While step 5 is parked, it does not fix fault 10: a mark the outbox refused is still lost at the next class load. If step 5 is built, such a mark still does not outlast a reload.
- It does not change the phone, the Assignments cards, or the pinned oddities (the comment sent again with a + or −; Clear Score's extra `clear_score`).
- It does not rewrite the screens' many-cell actions into lists of cells. `saveScores` stays for them (`docs/write-path-plan.md`, Phase 5).
- It does not move the mark writers. That is plan item 7.
- It does not bring the write-path docs up to date. That is S19-B7, after this.

## Changes after review

Each finding was checked against the code before it was taken.

| Finding                                                          | Verdict                                                                                                                                                                                                                                                                                                                                                 | Where the document changed         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| F1. "Behind" lapses after one merged write                       | Accepted. The merging flag stays set until the list is emptied.                                                                                                                                                                                                                                                                                         | Step 10b                           |
| F2. One text doing two jobs                                      | Accepted. Step 4's kept text is defined now as this tab's memory, apart from the storage text.                                                                                                                                                                                                                                                          | Step 4, "What is kept"; step 10b   |
| F3. Step 1 alone loses a mark after a blocked Clear Score        | Accepted. The fix offered (keep the second send when `saveScores` answered false) leaves one sequence worse than main: Clear Score blocked, its Undo let through at the guard's line (`shared/data.js:6328`). Step 1 now skips only a call the outbox accepted a moment before, which covers both.                                                      | Step 1                             |
| F4. Step 5's retry can land an older mark over a newer one       | Accepted, with two changes. The "another tab changed it" test is the third-value test, because a stale whole write also changes the cell (fault 3) and must not cancel the retry. Remembered cells count as unsent for the refresh and the reload, but not for `_evictOldestSavedCopy` (`shared/data.js:4435`), or a full storage could never be freed. | Step 5                             |
| F5. The Undo check skips everything after an older build's write | Accepted. Third value only; a missing copy tells nothing.                                                                                                                                                                                                                                                                                               | Step 10a                           |
| F6. A merge writes this tab's older value over the other tab's   | Accepted, in the three-value form: a cell back at its earlier value is a stale write, not a newer mark.                                                                                                                                                                                                                                                 | Step 10b                           |
| F7. The differential run cannot check a step that changes calls  | Accepted. Checked: it stops at the first difference; the second-tab and offline blocks never overlap (`scripts/differential-run.mjs:112-113`). Folding repeated calls is dropped.                                                                                                                                                                       | Part A's opening; each step's run  |
| Emptying the own-cells list at the right moment                  | Accepted.                                                                                                                                                                                                                                                                                                                                               | Step 10b                           |
| Step 4 and re-keys; nothing kept; where the text is recorded     | Accepted. A re-key from another tab changes the kept text as it changes the baseline, which also covers competency ids that `_applyIdRekeysToScores` does not.                                                                                                                                                                                          | Step 4                             |
| Step 9 fixes half of fault 6                                     | Accepted.                                                                                                                                                                                                                                                                                                                                               | Fault 6; step 9                    |
| The release rule                                                 | Accepted.                                                                                                                                                                                                                                                                                                                                               | Risks                              |
| An older build in Demo Mode under step 10                        | Accepted, as a loss the rule cannot avoid.                                                                                                                                                                                                                                                                                                              | Step 10b                           |
| Step 6: entry shape, key order, re-key the whole class           | Accepted. Also: when the counts say memory dropped, the mark goes through `saveScores` as today, so one tab's outcomes match.                                                                                                                                                                                                                           | Step 6                             |
| "Each call writes one row" is wrong                              | Accepted (`30-functions.sql:2545`, `10498`).                                                                                                                                                                                                                                                                                                            | Section 1, "The server"            |
| "The last choice lands last" fails after a reload                | Partly disputed. A failed call is dropped when a newer call to the same target lands (`offline-queue.js:1051`, `1153-1170`) or is waiting at the reload (`1504-1511`). It holds only when the newer value went by a different call.                                                                                                                     | "Why sending a call twice is safe" |
| Fault 4's "how often" left out two routes                        | Accepted. The owner's statement is used, with one correction: a changed mark is put back to its old value, not cleared.                                                                                                                                                                                                                                 | Section 2                          |
| Is step 10 worth building                                        | This design's answer is no, with what is lost by stopping.                                                                                                                                                                                                                                                                                              | Step 10b; open question 1          |

### Second review of Part A (2026-11-13)

An independent reviewer went through Part A again after the revision above. Its verdicts: step 4 holds; step 5 holds with six changes; step 1 holds with two. Each finding was checked against `origin/main` after PR 1336. Each fix the review offered was then tested the way a design is: by looking for a sequence of teacher actions in which the fix loses or changes a mark that main keeps.

The outcome for step 5 is not the review's. Its findings F1 to F5 all stand, but the step fails on a sequence the review did not raise: a phone and a laptop (step 5, "Why the reviewed version was dropped"). The step was redesigned around that, and is parked.

| Finding                                                                                | Does it stand                                                                                                                                                                                                                            | The fix offered, and what was done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1. The saved copy cannot show a newer mark from another tab                           | Yes, and more widely than reported. This tab's own next write puts its whole memory over the saved copy, so the other tab's value is gone before the try reads it; and the try ran straight after such a write.                          | Use the outbox as the witness, and settle the cell's baseline. Adopted with two changes. The data layer cannot read which tab made a call (`window.v2Queue.queued` and the `flush:success` event carry no tab), so the test is any call for the cell, waiting or landed, since the refusal. And the baseline is never settled. The sequence: one cell, two competencies. Tab A's level on the first is refused. Tab B scores the second; its call replaces a waiting one, so the full outbox takes it. Settling A's cell then stops A's next points mark from sending A's level, which main sends. |
| F2. The hold covers every class and never ends                                         | Yes. `_hasUnsentWrites` is read by `_waitForQuietCourse`, `_initClassData`, `_evictOldestSavedCopy`, `_unsentWritesGone` (Save Categories, the Return Grades switch, the draft count), `_fetchGradeReturns` and `_autoUpdateOutboxBusy`. | A hold for one class, with a bound. Rejected. While any hold lasts, this tab cannot see another device's marks. The sequence: the laptop, with nothing waiting to send, holds its refresh for a refused mark. The teacher scores ten cells on the phone. On the laptop, Set Unmarked to … fills those ten cells, because the laptop still shows them empty, and its calls land over the phone's. On main the laptop had refreshed and the fill passed them by. The bound chosen is none: nothing is held (step 5, "Nothing is held").                                                              |
| F3. "Accepted" is not defined; a mark on work whose create was rejected counts as sent | Yes. `_persistScoreToCanonical` returns without sending when an id cannot be sent, and counts no refusal.                                                                                                                                | Accepted means a call was taken, or nothing differs; an id that cannot be sent comes off the list with the baseline left alone. Adopted with a change: accepted means at least one call taken and none refused. The sequence: a level and its Overall Comment are two calls, and the outbox has room for one. By the fix's wording the cell is sent and forgotten with one call refused. Also added: nothing is put back unless the load brought back the student and the work.                                                                                                                    |
| F4. A try inside another save's send makes that save think it was refused              | Yes. `_upsertScoreOne`, `saveScores` and `saveAssignmentStatuses` each count refusals across their own send.                                                                                                                             | Run the try in a microtask. Adopted in substance. In the new rule the send runs after the server's answer to a class load, when no save is running, so no microtask is needed. Had it been kept, it had to be queued after the refusal's own microtask, which puts the baseline row back, or it would read the cell as already sent.                                                                                                                                                                                                                                                               |
| F5. Whole entries are compared, so a rebuilt entry reads as changed                    | Yes. A class load rebuilds each entry with its own id, date and `created`.                                                                                                                                                               | Compare what the server holds: score, + or −, and the three comments, with a proficiency 0 equal to no entry. Adopted, with one addition, and used for the comparison the new rule makes. `_scoreEntryRemoteChanged` reads a missing score as 0, so on points and Complete work the comparison also asks `isScoreEntered` of both sides. Without that a cleared cell and an Incomplete read the same.                                                                                                                                                                                              |
| F6, step 1. `--no-undo` misses the phone's Undo                                        | Yes. It is the run's own `phoneUndo` action, outside `actions.mjs`.                                                                                                                                                                      | Adopted as offered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F6, step 1. The skip must apply only inside the three second sends                     | Yes, with one fact corrected. No screen calls `window.upsertCellScore` today: `persistScoreDiffToCanonical` is its only caller. The stronger reason is that every level a teacher taps goes through the same three hand-off places.      | Adopted. The skip is on only while one of the three second sends runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F6, step 5. No browser spec is named, and no test for F1 to F5                         | Yes.                                                                                                                                                                                                                                     | Adopted: step 5's proof plan names the spec and labels the tests for each finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F6, step 4. "The run must show 0 differences" is not settled                           | Settled by the build: it was wrong. Seed 3 showed the fix acting at step 354.                                                                                                                                                            | Part A's opening and step 4 now say what the run showed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Step 4. A level on pair or group work is not a route to fault 4                        | Yes. The level writes this tab's memory to the saved copy first, so the group save that follows compares with this tab's own marks.                                                                                                      | Section 2 is corrected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Step 4. "The outbox full" row leaves out one sequence                                  | Yes. It is the one sequence in which step 4, now released, is worse than the code before it.                                                                                                                                             | The row says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Step 4. The cost is one pair of texts for each class, on the phone too                 | Yes. `preloadClasses` loads every class.                                                                                                                                                                                                 | "Cost" is corrected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Step 5 as a whole                                                                      | It does not meet "no worse than main in every sequence". The reviewed version fails on a phone and a laptop. The new version fails on two rare sequences that no rule kept in the browser can close.                                     | Redesigned and parked. Open question 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
