# One mark saves one mark: design (S19-C9)

Status: a design, revised after an independent review. Nothing here is built. It changes no app code.

It has two parts.

- **Part A, "Stop marks being lost":** three small steps. Each can be built and released alone. This part is to be approved and built first. A builder can follow it without reading Part B.
- **Part B, everything else:** speed, tidying, and two tabs sharing one saved copy. It is not approved until its own review passes.

This is item 8 of section 8 in [`handoff-review-plan.md`](handoff-review-plan.md). It carries S19-B4 (send an undone cell once), S19-B5 (make the score send private), S19-C9 (one mark saves one mark, redraw only what changed), S19-C10 (the phone's tap), Track E's tidying 3 (on-save hooks for `_saveCourseField`) and the fault closed PR 1263 tried to fix (a tab that is behind saving over newer marks).

Every `file:line` is on `origin/main` at `4336281f`. Short names: `page-gradebook.js` and `page-assignments.js` are in `teacher/`, `ui.js` is `teacher/ui.js`, `tab-grade.js` is `teacher-mobile/tab-grade.js`, `offline-queue.js` is `shared/offline-queue.js`, `speed.spec.js` is `e2e-perf/speed.spec.js`, `30-functions.sql` is `migrations/baseline/30-functions.sql` (the live server functions). Each claim about today is marked **reproduced** (a test was run; section 2 says how) or **seen in the code** (traced by reading, not run).

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
8. `docs/DECISIONS.md` has no "Wave 0 rulings (2026-11-13)" on this branch.
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

**When fault 4 happens, in the owner's terms.** The same class is open in two tabs of one browser while the computer is offline, or while the sync dot says changes are waiting. One of the two tabs is opened or reloaded during that time (a browser waking a sleeping tab by reloading it counts). Marks are entered in the other tab. Then, in the tab opened later, the teacher enters points, Complete or Incomplete, uses Clear Score, Cmd+Z, Undo of a fill or Delete Assessment, or enters any mark on pair or group work. When the connection returns, the marks the first tab entered since the second was opened are cleared on the server, or put back to their old values, with no message. Online it needs the later tab's class check to fail or take more than three seconds. A second computer cannot cause it: it has its own storage. Fault 7 is the same for statuses.

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

Three steps, in this order: step 4, step 5, step 1. Each is one PR and can be released alone. None needs any other step, the speed work, or the mark writers moved out of `shared/data.js`.

Each changes how a mark is saved, so each needs Colin, tests first, and an independent reviewer who tries to break it. Each is undone by reverting its one PR: what it keeps is in memory only, and nothing is stored or sent in a new shape.

For each step, "never worse than today" is argued against the same list: two tabs, offline then online, the outbox full, a re-key in the middle of a save, a class load in the middle of a save, an older build in the other tab, Demo Mode, and the 14-day purge of saved copies.

**How the differential run is used in Part A.** The run (`docs/differential-run.md`) stops at the first difference, and every id in it comes from one seeded generator, so one call added or removed shifts every id after it. Its second-tab block and its offline block never overlap (`scripts/differential-run.mjs:112-113`), so no tab in it is ever behind with no baseline. So the run cannot show a change in calls. Each step proves its intended change with unit tests and a two-page browser spec, and uses the run only to show that nothing else moved.

## Step 4. A whole-list save compares with this tab's own copy

Fixes faults 4 and 7, the only way today that one tab clears another tab's marks on the server.

**The rule.** When a whole-list save works out what this tab changed, it compares with what this tab itself last read or wrote. It never compares with the saved copy as another tab may have left it. Class settings already work this way (`shared/data.js:1740-1745`).

**What is kept.** For each class, in memory only, two texts: this tab's own copy of the scores and of the statuses. Each is the text of **this tab's memory** of that list at the last moment the tab read it from storage or wrote it to storage. It is defined as this tab's memory, not as whatever storage holds. Today the two are the same text at that moment, because every write puts the whole of memory in storage. If a later step ever writes anything else to storage (Part B, step 10b), the kept text stays this tab's memory. With each text go two counts, students and entries, for Part B's step 6.

**When it is recorded.**

- `_safeLSSet` (`shared/data.js:4927`): after a write that succeeded (`4929-4931`, and the second try at `4936-4938`), when the key is `gb-scores-…` or `gb-statuses-…`. No other key. A write that failed records nothing, so the tab behaves as main does after a failed write.
- `_loadCourseFromLS` (`4870`): the text read at `4874` and `4880`. If storage holds nothing, what was kept is forgotten.
- `_persistLoadedField` (`1753`), for scores and statuses, in both branches: the text it found unchanged and did not rewrite (`1766`, `1770`), and the text it wrote.
- `_rekeyField` (`2398`): a re-key made by another tab changes this tab's memory with no write here (`2405`). The kept text gets the same change the baseline gets at `2411`.

**When it is forgotten.** Wherever the baseline is forgotten: `_forgetServerState` (`1830`; called at `618-619` and `shared/data-courses-terms.js:179`).

**Where it is used.**

- `saveScores` (`6290`). The kept text is read first, before anything is written, and put in the same key space as the scores (`_migrateRubricScoreKeys`, as `6295` does, and `_applyIdRekeysToScores`, as `6291` does). Call it `before`. The saved copy as it is now (`prev`, `6295-6298`) is still read, and the guard still uses only that (`6302-6339`): **what is blocked does not change in this step.** `before` takes `prev`'s place in two lines: the group grades the save starts from (`6308`) and the fallback when there is no baseline (`6346`). The line after it, which leaves out marks of work that is gone (`6347`), still applies.
- `saveAssignmentStatuses` (`5900`). `before` takes `prev`'s place in two lines: the group check (`5907`) and the fallback (`5910`). It is read before `5904` writes.

**When nothing is kept** for the class (it was never loaded through the functions above, or the kept text cannot be read): `before` is `prev`. That is main's behaviour exactly. Tests that seed storage directly are in this case, so they pass unchanged.

**Tests that fail on main and pass after.** Each loads the class through `_loadCourseFromLS`, signed in, with the real outbox and the recording fake server.

1. Fault 4's recipe: no baseline; the other tab adds 10 marks to the saved copy; this tab enters points. One call. Main sends 11.
2. The other tab changes a mark's value; this tab enters points elsewhere. No call for the other tab's cell. Main sends the old value back.
3. Fault 7's recipe: the other tab adds Missing on three cells; this tab sets Late on another. One call. Main sends four.
4. With a baseline: the other tab clears one pair member's mark; this tab saves another cell through `saveScores`. Nothing is copied to the partner and nothing is sent for the pair.
5. A status the other tab changed on a pair or group member makes no group copy or clear in this tab.
6. A re-key from another tab, then a whole-list save: nothing is sent for the re-keyed rows.
7. A browser spec with two pages: offline, the second tab reloaded, marks in the first, points in the second, then online. The server receives no clear for the first tab's marks.

**Pins that must pass untouched.** `tests/score-guard-keeps-mark.test.js` (all 35; the guard is not changed), `tests/write-path-regressions.test.js`, `tests/data-scores-v2-dispatch.test.js`, `tests/id-rekey-and-points-clear.test.js` (a class copied to a new id still sends every mark), `tests/status-rejected-then-undone.test.js`, `tests/score-rejected-clear-retype.test.js`, `tests/pin-gradebook-writes.test.js`, `tests/pin-assignments-fills.test.js`, `tests/pin-phone-grade-writes.test.js`, `tests/marks-read-current-piece.test.js`, `e2e/guard-keeps-mark.spec.js`, `e2e/pin-gradebook-edits-reload.spec.js`, `e2e/pin-assignments-grading-reload.spec.js`, `e2e/pin-delete-assessment-then-grade.spec.js`, `e2e/gradebook-group-marks.spec.js`.

**The differential run.** The whole run, seeds 1, 2 and 3, both modes, `--offline --two-tabs`, with `--must-reach saveScores,setPointsScore,restoreScoreCells,saveAssignmentStatuses,setAssignmentStatus`. It must show 0 differences: in everything the run reaches, the kept text is the saved copy's text, so no call changes. A difference is a regression until the PR shows otherwise.

**Never worse than today.**

| Sequence                 | Why this step is not worse                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One tab                  | The kept text and the saved copy are the same text, so the same calls go.                                                                                                                                                                    |
| Two tabs                 | Main compares with the other tab's copy: it sends clears for that tab's marks, and copies or clears group grades from that tab's changes. This step sends only this tab's changes. Nothing main sends for this tab's own change is left out. |
| Offline then online      | The calls are worked out when the mark is made; the outbox is not touched.                                                                                                                                                                   |
| The outbox full          | With no baseline, main never sends a refused mark again, and nor does this. With a baseline nothing changes. Step 5 is the fix.                                                                                                              |
| A re-key mid-save        | The tab's own re-key rewrites the saved copy, which records the new text. Another tab's re-key changes the kept text as it changes the baseline. If the kept text ever held an old id, the worst is this tab's own marks sent a second time. |
| A class load mid-save    | A load that leaves the scores alone because the teacher was typing (`847-853`) records nothing. A load that is applied records the server's text, and then there is a baseline.                                                              |
| An older build elsewhere | It writes its old copy to storage. Main would compare with that copy and could send clears. This step compares with its own.                                                                                                                 |
| Demo Mode                | Nothing is sent. The group check uses this tab's own copy, as above. One tab is unchanged.                                                                                                                                                   |
| The 14-day purge         | If the saved copy is gone while the tab is open, main compares the class with itself and sends nothing. This step still sends this tab's change.                                                                                             |

**Cost.** One text for each list of each open class, about 1 MB for a 5,400-mark class (PR 1263, Review B). The text is the one just written, so nothing is copied.

## Step 5. A refused mark is sent when there is room

Fixes fault 10 for as long as the page stays open.

**The rule.** When the outbox refuses a score call, the cell is remembered. While any cell is remembered, the class is not read again from the server and the page is not reloaded for a new version. When there is room, the cell is sent as the difference between the baseline and what this tab holds now. A cell another tab has scored since is left alone.

**What is kept.** In memory only: a list of cells (class, student, work).

- **Put on the list:** in `_onWriteRefused` (`shared/data.js:2009`), when the refused call is a score call and the class has a baseline (`undo` is set and its field is `scores`; `1912-1937`, `1956-1971`). `_onWriteRefused` already puts that cell's baseline row back (`2017-2018`).
- **With no baseline:** nothing is remembered. That is main's behaviour.
- **Tried again:** after any call lands (`flush:success` in `_onOutboxEvent`, `2924`), after the outbox accepts a call following a refusal (`8502-8505`), and once a minute while the list is not empty. Never from inside its own send.
- **Taken off:** when the try is accepted; when there is nothing left to send (a later accepted write to the cell already moved its baseline on); when the class has no baseline or is no longer in memory.

**One try, for one cell.**

1. Take the cell's entries from the baseline and from memory. If the cell's ids were re-keyed, follow the re-key (`2038`).
2. Read the cell from the saved copy. If it holds a third value, neither what this tab holds nor what the baseline holds, another tab has scored it since: take the cell off the list, set its baseline row to what this tab holds so that no later whole-list save sends it either, and send nothing. A saved copy that is missing or unreadable tells nothing: go on.
3. Send the difference through the existing send, for that cell only (`persistScoreDiffToCanonical`, `5658`). A refused clear goes as a clear, a points cell as one call.
4. If the outbox accepted it, move the baseline on for the cell and take it off the list. If it refused again, the cell stays.

**Unsent writes.** `_hasUnsentWrites` (`1657`) also answers true while the list is not empty. That holds the class refresh (`830`) and the reload for a new version (`shared/auto-update.js:35`). One caller keeps today's test: `_evictOldestSavedCopy` (`4435`). Storage being full is one of the two reasons a call is refused, and blocking that clean-up would keep storage full.

**Tests that fail on main and pass after.**

1. Fault 10's recipe: the outbox full, a level refused, then room. The mark's call goes with no further score entered. On main it never goes.
2. A refused clear goes as a clear.
3. After the refusal the other tab writes a third value for the cell: nothing is sent for it now, or by a later whole-list save.
4. After the refusal the other tab writes its old copy (the cell back at the baseline's value): the mark is still sent.
5. A newer mark on the same cell is accepted first: one call in all, carrying the newer value.
6. While a cell is remembered the class is not refreshed, and the saved-copy clean-up still runs.
7. The student or work is re-keyed while remembered: the list still empties.
8. With no baseline nothing is remembered and main's calls go.

**Pins that must pass untouched.** `tests/offline-queue.test.js`, `tests/write-path-audit.test.js`, `tests/score-rejected-clear-retype.test.js`, `tests/signout-offline-queue.test.js`, `e2e/sync-loop.spec.js` (a failing server sets off no runaway requests).

**The differential run.** The whole run, as in step 4. It never fills the outbox, so it must show 0 differences.

**Never worse than today.**

| Sequence                 | Why this step is not worse                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One tab                  | The try sends what main's next whole-list save would send for that cell, from the same baseline, only sooner. Main may never send it.                                                                                        |
| Two tabs                 | A cell the other tab has scored since is not sent. Main sends this tab's older mark over it at the next whole-list save. The outbox is shared, and each tab hears when a call lands in any tab (`offline-queue.js:645-668`). |
| Offline then online      | The waiting calls go, each landing triggers a try, and the list empties.                                                                                                                                                     |
| The outbox full          | The case itself. A try that is refused again changes nothing.                                                                                                                                                                |
| Storage full             | The clean-up that frees storage is not held. The class refresh is held, so the mark stays on screen where main would drop it.                                                                                                |
| A re-key mid-save        | Test 7. A cell found in neither the baseline nor memory has nothing to send and comes off.                                                                                                                                   |
| A class load mid-save    | Held until the list is empty. Main lets the load replace the mark.                                                                                                                                                           |
| An older build elsewhere | Its old copy shows the cell at the baseline's value, so the mark is still sent (test 4).                                                                                                                                     |
| Demo Mode                | Nothing is sent or refused. The step does nothing.                                                                                                                                                                           |
| The 14-day purge         | A missing saved copy tells nothing, so the mark is sent.                                                                                                                                                                     |
| A reload                 | The list is lost, as the baseline is today. The mark can still be lost then (section 9).                                                                                                                                     |

A newer mark from another computer can still be overwritten by a late try, as by any call that waited offline. That is the server's rule today.

## Step 1. Undo sends each call once

Fixes fault 1.

**The rule.** An Undo hands the outbox the same calls as today, each one once. The first draft deleted the second send. That was wrong: there is a case where only the second send carries the mark.

**The case.** In a tab that is behind, the guard blocks Clear Score's save, but the page still sends `clear_score` (`page-gradebook.js:3095-3099`; `shared/grader.js:139-142`, `147-149`). Cmd+Z then puts the mark back in memory and its save is blocked too. On main the second send in `Grader.undoCell` (`shared/grader.js:156-160`) is what restores the mark on the server. Without it the server keeps the clear while the screen shows the mark, and the mark is gone at the next class load. Keeping the second send only when `saveScores` answered false is not enough: Clear Score can be blocked and the Undo let through, because the Undo holds one more entry and can sit just above the guard's line (`shared/data.js:6328`). Then the save answers true, its own comparison finds nothing to send (the baseline still holds the mark), and the clear stands.

**What is kept.** For the length of one action only: the calls the `saveScores` just before handed to the outbox and the outbox accepted, each as its name and contents. The outermost `saveScores` opens the record. It is emptied before the page's script next gives way, and when the next outermost `saveScores` starts.

**Where.**

- `saveScores` opens the record around its send (`shared/data.js:6344-6352`). A save the guard blocks, or a call the outbox refuses, records nothing.
- The three places the comparison hands a call to the outbox (`5269-5275`, `5281-5291`, `5707-5722`) note each accepted call while the save runs. During the second send they skip a call that is already in the record.
- The second sends stay where they are (`shared/grader.js:158`, `281`; `shared/data.js:6403`). They now skip what the save just sent. The comment "it goes up twice, as before" (`shared/grader.js:151-155`) is corrected.

**When nothing is in the record** (the save was blocked, or every call was refused): the second send goes whole, as on main.

**Tests.**

- Changed pins, failing on main once changed: the three that assert "twice" assert once (`tests/pin-gradebook-writes.test.js:921-927` and the cases after it, `tests/pin-phone-grade-writes.test.js:994-996`, `tests/pin-assignments-fills.test.js:140-142`), and `tests/grader.test.js`.
- New, passing on main and after, to pin what must not change: the case above (the server ends holding the mark); Clear Score blocked and its Undo let through (the same); a first send the outbox refused, where the second send still tries.
- New: offline then online, one waiting call for each undone cell.

**Pins that must pass untouched.** `tests/fill-undo-cells.test.js`, `tests/score-rejected-clear-retype.test.js`, `tests/gradebook-clear-score-undo-ticks.test.js`, `tests/gradebook-clear-undo-toast.test.js`, `e2e/pin-gradebook-edits-reload.spec.js`, `e2e/pin-assignments-grading-reload.spec.js`.

**The differential run.** This step removes calls, so the run cannot compare an Undo. The run first gets a switch that keeps every Undo out of a run (`--no-undo`: the `gradebookUndo` action, and the `undo` choice inside the fill, clear and Delete Assessment actions, `scripts/differential/actions.mjs:329`, `444-530`, `801`), with the random numbers still drawn so the rest of the sequence is the same. That switch is its own PR and is proved main against main. Then the run with `--no-undo`, three seeds, both modes, `--offline --two-tabs`, must show 0 differences.

**Never worse than today.** In every sequence the outbox is handed the same set of calls as on main, less a call identical to one it accepted a moment earlier in the same action. A repeat of an accepted call cannot change what the server ends with: it sets the same cell to the same value, straight after the first. So the list of sequences comes to one check: is anything skipped that was not just accepted? No. A blocked save and a refused call record nothing.

One thing gets better. On main, if the server rejects both copies of a call, the second puts the wrong row back in the baseline (it was taken after the save moved the baseline on; `shared/data.js:8490`, `6350`, `1976`). With one copy the right row goes back.

## What Colin and Karen will notice from Part A

- With one tab open and a connection: nothing.
- Two tabs on one class while offline or while changes are waiting: marks entered in one tab are no longer cleared by a points mark, a clear or an Undo in the other.
- After the outbox was full: the sync dot can turn green by itself once there is room, because the refused mark is sent. Until then the class is not refreshed from the server.
- Undo: nothing.

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
- the mass-loss check. It uses the counts kept in step 4 (this tab's own copy), so nothing is parsed. If the counts say this tab's memory has dropped the way the guard's rule means (`6249-6258`), the mark goes through `saveScores` exactly as today, guard and all.

What changes besides fault 5: a later points mark no longer sends again a cell the server rejected (the outbox's own one more try at the next page load stays, `offline-queue.js:1107-1129`); a refused cell is step 5's.

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

| Risk                                | What could go wrong                                                                                            | How it is caught or contained                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two tabs                            | Part A: a step sends less than it should for this tab's own change                                             | The "never worse" tables; each step's tests through the real load function; the pins that must pass untouched                                                                           |
| An older build in another tab       | It still has the faults Part A fixes                                                                           | The release rule: before a release, **every open FullVision tab is reloaded or closed**, on every computer                                                                              |
| Two devices                         | The later call wins for a cell, as today. A fill or Undo on a device that is behind can overwrite a newer mark | Not changed here. The refresh after two quiet seconds stays                                                                                                                             |
| Offline then online                 | Calls wait and go in order, as today. Over 500 waiting, a mark is refused                                      | Step 5 sends it when there is room. Across a reload it can still be lost (below)                                                                                                        |
| A failed write in the middle        | A network failure retries. A rejected write puts its baseline row back (`shared/data.js:1976`)                 | Unchanged in Part A. After step 6 a later points mark no longer sends a rejected cell again; `tests/score-rejected-clear-retype.test.js` pins the typed-over case                       |
| A class loading while a mark saves  | The load overwrites the mark                                                                                   | Every writer still flags the class as edited (`_markLocalWrite`). Step 5 also holds the load while a refused mark waits. `tests/write-path-regressions.test.js`                         |
| A re-key landing mid-save           | A mark is filed under an id the server never had                                                               | The re-key rewrites memory, the saved copy, the baseline and the waiting calls as today (`shared/data.js:2398-2412`), and step 4's kept text. `tests/id-rekey-and-points-clear.test.js` |
| The 14-day purge of saved copies    | A copy is removed while a tab still has the class open                                                         | Steps 4, 5 and 10a each treat a missing saved copy as telling nothing. The outbox is a different key and is never purged (`shared/data.js:4412-4426`)                                   |
| Storage full                        | The saved copy write fails                                                                                     | As today: the call still goes, the dot says so. Step 4 records nothing for a failed write. Step 5 does not hold the clean-up that frees storage                                         |
| Step 5 holds a refresh for too long | A class stays unrefreshed while a refused mark waits                                                           | It ends as soon as the outbox takes the mark: after any landed call, after any accepted call, and once a minute. A refresh is already held today while anything waits in the outbox     |
| The small redraw misses something   | A grade on screen is out of date until the next full redraw. No mark is affected                               | The full-redraw check in every browser test and the differential run; the constant that turns it off                                                                                    |
| The measured gain is too small      | Risk taken for nothing                                                                                         | Step 0 comes first and decides steps 2, 3 and 13                                                                                                                                        |

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
   **Recommended: not yet.** Step 5 covers the open page. First count how often the outbox refuses a score (the kind of write only, never its contents, as `_discardWrite` reports), then decide.
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

## What this design does not do

- It does not change grade math, any server function, or anything the server stores.
- It does not stop a device that is behind from winning over a newer mark on another device. That is the server's rule.
- It does not keep the saved copy right when two tabs write it (fault 3), unless step 10b is built.
- It does not keep a tab's screen in step with another tab any sooner than today.
- It does not fix a stale tab saving over the class's work list, roster, categories or settings (F2 and F3 in PR 1263).
- It does not make a mark the outbox refused outlast a reload.
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
