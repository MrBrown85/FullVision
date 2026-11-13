# One mark saves one mark: design (S19-C9)

Status: a design for review. Nothing here is built. It changes no app code.

This is item 8 of section 8 in [`handoff-review-plan.md`](handoff-review-plan.md). It carries S19-B4 (send an undone cell once), S19-B5 (make the score send private), S19-C9 (one mark saves one mark, redraw only what changed), S19-C10 (the phone's tap), Track E's tidying 3 (on-save hooks for `_saveCourseField`) and the fault closed PR 1263 tried to fix (a tab that is behind saving over newer marks).

Every `file:line` is on `origin/main` at `1ab3a6f0`. Short names: `page-gradebook.js` and `page-assignments.js` are in `teacher/`, `ui.js` is `teacher/ui.js`, `tab-grade.js` is `teacher-mobile/tab-grade.js`, `offline-queue.js` is `shared/offline-queue.js`, `speed.spec.js` is `e2e-perf/speed.spec.js`. Each claim about today is marked **reproduced** (a test was run; section 2 says how) or **seen in the code** (traced by reading, not run).

Words used here:

- **Mark:** a score a teacher gives: a level, points, Complete or Incomplete.
- **Cell:** one student on one piece of work. The outbox already uses this unit (`cell:<student>:<assessment>`, `shared/offline-queue.js:160-164`).
- **Saved copy:** the class's marks kept in the browser's storage under one key, `gb-scores-<class id>`.
- **Outbox:** the list of changes waiting to go to the server (`shared/offline-queue.js`).
- **Baseline:** this tab's picture of what the server holds (`_serverState`, `shared/data.js:1803`).
- **One-cell write:** a save that touches one cell. **Whole-list save:** `saveScores`, which is handed every mark in the class.
- **Behind:** another tab on the same computer has saved since this tab last read the saved copy.

## What the brief got wrong

These were checked before designing. The design is for the faults that exist.

1. **The phone's tap does not take 395 ms.** PR 1282 found the speed recorder was timing the screen sliding in. A tap draws in about 15 ms (`e2e-perf/speed.spec.js:233-237`; PR 1282's table). The phone already redraws only the row tapped (`teacher-mobile/tab-grade.js:2943-2952`). S19-C10 has nothing left to fix.
2. **One tap on a level already saves one mark.** It compares one cell and sends one call (`shared/data.js:5109-5158`). The whole class is compared only for points, Complete and Incomplete, clears, Undo and group copies (`saveScores`, `shared/data.js:6290`). What every tap does do for the whole class is rewrite the saved copy (section 1).
3. **An undone cell is sent twice, not more,** and only when the tab is online and is the tab that sends. Offline, or in a second tab, the outbox folds the two into one (`shared/offline-queue.js:921-942`, `767-769`; seen in the code, not run). No control on the phone reaches its Undo (`tests/pin-phone-grade-writes.test.js:25-27`).
4. **The score send is on no export list.** `persistScoreDiffToCanonical` is not on `window.GB` (`shared/data.js:8799`). It is callable because every top-level function in a plain script is. One test allowlist names it (`tests/grader-guard.test.js:44`).
5. **`_saveCourseField` names five other areas, not four** (`shared/data.js:4991-5000`).
6. **A tab that is behind clears another tab's marks on the server in one case only** (no baseline; section 2, faults 4 and 7). In the common case it harms only this computer's saved copy.
7. `docs/schema.generated.sql` holds each server function's first line only. The bodies were read from `migrations/`. Two old ones (`set_score_status`, `save_score_comment`) have no migration; they were read from `docs/backend-design/write-paths.sql:1592-1630`, which is design history and may not match the live database.
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
- **The server.** Each call writes one row, found by student and work (and competency or criterion). There is no key and no version: the last call to arrive wins (`migrations/20261022_score_modifier.sql:31-64`; `migrations/20261027_score_comments.sql:82`). A database trigger raises the class's version number (`docs/schema.generated.sql`, `course_sync_cursor_score_gradebook`).
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

| #   | Fault                                                                      | What a teacher could see                                                                                           | Can a mark be lost?                                  | How often                                                                                                                | Evidence           |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 1   | Undo sends each cell twice                                                 | Nothing                                                                                                            | No. Time only.                                       | Every Undo while online                                                                                                  | Reproduced         |
| 2   | The score send can be called from any file                                 | Nothing                                                                                                            | No                                                   | Always                                                                                                                   | Seen               |
| 3   | A tab that is behind writes its old copy over the saved copy               | Marks entered in the other tab are missing after a reload without a connection. They return at the next class load | Signed in: no, the server keeps them. Demo Mode: yes | Two tabs on one class, both used within about two seconds, or both offline                                               | Reproduced         |
| 4   | A tab that is behind, with no baseline, clears the other tab's marks       | Marks entered in the other tab are gone everywhere                                                                 | **Yes, on the server**                               | Rare: two tabs, and the saving tab opened offline or before its class check finished                                     | Reproduced         |
| 5   | A tab that is behind has one points or Complete mark blocked               | The red "Score save blocked" message. The mark is gone after a reload                                              | **Yes, that one mark**                               | Rare: two tabs, and the other tab has just added far more marks than the class held, as a first fill in a new class does | Reproduced         |
| 6   | A tab that is behind changes Draft and Returned for cells it never touched | A Draft badge that is wrong until the server's rows are read again                                                 | No                                                   | Two tabs, student page on                                                                                                | Seen               |
| 7   | Fault 4, for Missing, Excused and Late                                     | A status set in the other tab is taken off                                                                         | Yes, the status                                      | As fault 4                                                                                                               | Seen               |
| 8   | One tap does whole-class work                                              | Nothing measured                                                                                                   | No. Time only.                                       | Every tap                                                                                                                | Reproduced         |
| 9   | The gradebook redraws the whole page for one score                         | A pause while typing down a column, on a slow computer (not measured)                                              | No. Time only.                                       | Every score typed in the gradebook                                                                                       | Seen               |
| 10  | A mark the outbox refuses is not sent again by later level taps            | The sync dot is red. The mark shows, but the server never gets it, and it is gone after the next full class load   | **Yes**                                              | Rare: 500 changes waiting, or the browser's storage full                                                                 | Reproduced in part |
| 11  | `_saveCourseField` calls five other areas by name                          | Nothing                                                                                                            | No                                                   | Always                                                                                                                   | Seen               |

How the reproductions were run. Faults 1 and 5 are asserted by tests already on main, named below; they were run and pass. Faults 3, 4, 8 and 10 were run in two throwaway vitest files, not committed, built on the harness of `tests/score-guard-keeps-mark.test.js:1-140` (signed in, the real outbox, the recording fake server), with 30 students. The second tab is a direct write of `gb-scores-<class id>`, as that file's `otherTabFills` does (`308-310`). Storage writes, parses and copies were counted by wrapping `localStorage.setItem`, `JSON.parse` and `structuredClone`. The outbox was filled with 500 waiting calls through `window.v2Queue.enqueue`.

How each happens:

1. **Undo twice.** `saveScores` sends what changed. Then three callers send the same change again: `Grader.undoCell` (`shared/grader.js:156-160`), `Grader.undoOnPhone` (`279-283`) and `restoreScoreCells` (`shared/data.js:6402-6403`). Online, the first call has already left, so the second cannot replace it and goes too (`offline-queue.js:932`). Reproduced by pins that pass on main and assert it: `tests/pin-gradebook-writes.test.js:921-927`, `tests/pin-phone-grade-writes.test.js:994-996`, `tests/pin-assignments-fills.test.js:140-142`. The two grader callers also send when `saveScores` refused the save.
2. **Callable from anywhere.** A plain function at `shared/data.js:5658`.
3. **Old copy over the saved copy.** Each tab holds the class in its own memory. Every writer writes its whole memory to the one shared key (`5143`, `5378`, `5449`, `5519`, `5580`, `4999`). A tab re-reads the class only from the server, only after two quiet seconds with nothing waiting to send (`828-843`). Offline that never comes. Reproduced: the saved copy held 40 marks, 10 of them from the other tab; one level typed in the tab that was behind left 31. The server was sent only the one mark.
4. **No baseline.** A whole-list save works out what to send by comparing the class with the baseline. With no baseline it falls back to the saved copy as it is now (`6346`, `1824-1826`), which the other tab may have written. The other tab's marks then look like marks this tab removed, and a clear is sent for each (`5690-5700`). A tab has no baseline when it opened from a saved copy flagged as edited on this computer (`4323-4332`, `4334-4338`), which is any copy graded on since its last load from the server (`4219-4233`), and the server has not answered yet: offline, or a slow or failed load (`4793-4800`). Reproduced: one points mark sent 10 clears for the other tab's marks.
5. **Blocked.** The guard compares the tab's old memory with the fuller saved copy and takes the difference for a mass loss (`6302-6339`). Reproduced by `tests/score-guard-keeps-mark.test.js:335-343`, which passes on main, and pinned in the browser by `e2e/guard-keeps-mark.spec.js:149`.
6. **Draft and Returned.** The "before" is read from the saved copy (`7221`) and the "after" from this tab's memory, and every cell is compared (`7249-7262`). The other tab's marks read as cleared here. The server's own rows are read back afterwards (`7123`).
7. **Statuses.** The same fallback: `shared/data.js:5900-5914`.
8. **Whole-class work.** Section 1.
9. **Whole page.** `page-gradebook.js:2476-2478`, `3660`, `3671`, `563`.
10. **Refused mark.** The mark stays in memory and the saved copy; the call is dropped; the writer answers false (`5148-5153`); the dot goes red (`2025-2028`, `140-143`). Only a later whole-list save sends it again, because only that compares the class with the baseline (`1836-1844`). Reproduced: with the outbox full, a level was refused; a later level on another cell did not send it; a later points mark did. Seen, not run: a page load from the server then replaces memory and the saved copy, and the mark is gone (`4323-4332`, `1753-1755`).
11. **Named calls.** `_noteRubricsSet`, `clearProfCache`, `_returnedSets`, `_markLocalWrite`, `_broadcastChange` (`4991-5000`). The five one-cell score writers each repeat part of that list by hand, in a different order.

Left as they are, and pinned: a + or − on some screens sends the Overall Comment again (`5281`); the gradebook's Clear Score sends each clear and then `clear_score` (`page-gradebook.js:3095-3099`).

## 3. The design

### The rule

**A tab writes, sends and redraws only the cells it changed itself.**

Today a tab writes everything it holds, and works out what to send by comparing two whole copies. Every fault from 3 to 7 is that rule meeting a second tab. The design never takes another tab's copy into this tab's memory. That is what failed in PR 1263: a tab that had caught up adopted a stale copy, and an error in the catch-up stopped the save.

### What one tap does after the change

1. The screen calls the grader, as today.
2. The writer changes the one cell in memory, as today. It keeps that cell's old entry for step 4.
3. **The saved copy.** One private function writes it. If the saved copy is still the text this tab last read or wrote, it writes the whole class from memory, exactly as today. If another tab has written since, it reads the saved copy and puts in only this tab's own cells: every cell this tab has changed since it last loaded the class from the server. If anything in that goes wrong, it writes the whole class as today.
4. **Draft and Returned.** The rule runs on that one cell, with the old entry from step 2. One tab gets the same rows as today.
5. **The server.** One call for the cell, as a level sends today. Points, Complete and Incomplete do the same.
6. The baseline moves on for that cell, as today.
7. Group work copies to partners, as today. Each partner is one more changed cell.
8. One list of on-save hooks runs: throw away the saved sums, flag the class as edited, tell other tabs, and hand the screen the list of cells that changed.
9. The screen redraws those cells and what depends on them.

### What is compared and sent

- **One mark:** nothing is compared beyond the cell itself. One call.
- **Many cells at once** (Undo, Undo of a fill, Clear Score, Delete Assessment, group copies): the whole-list save stays, with its guard. Its "before" becomes what this tab last read or wrote, never the saved copy as another tab left it. With one tab these are the same text, so nothing changes. Class settings already learned this (`shared/data.js:1740-1745`).
- **Missing, Excused and Late** keep their whole-list save, with the same own "before".

### A tab that is behind

- **How a tab knows.** It keeps the text of the saved copy it last read or wrote. If storage holds other text, another tab saved. No new storage key. PR 1263 did seven such reads for each mark, and its Review B measured the save at 1.6 ms either way (5.4 ms against 4.0 ms at quarter speed). This design does one read.
- **What it does.** It never refuses a single mark and never copies the other tab's marks into its memory. It writes its own cells onto the saved copy as it is now. The saved copy ends up holding both tabs' marks. The server is sent this tab's cells only.
- **Own cells.** The list is kept in memory. It is emptied when this tab reads the class again: from the server when signed in, from storage in Demo Mode (`shared/data.js:4021`). A load that leaves the scores alone because the teacher was typing (`847-853`) does not empty it.
- **The same cell in both tabs.** The mark the teacher entered last wins. The server already works this way.
- **Undo is the exception.** Undo means "put back, unless scored again since" (`shared/data.js:6358-6364`; DECISIONS, "Set Everyone To" 3). When the tab is behind, Undo also looks at the saved copy, and skips any cell that no longer holds what it is undoing. This only ever makes Undo do less.
- **The guard.** When the tab is behind, the guard judges this tab's own change: what it last read or wrote against what it is saving. A real mass loss is still blocked. Being behind is no longer mistaken for one.
- **An older build in another tab,** or any writer outside the one function, writes its whole old copy. This tab then puts its own cells back on top. Cells it loaded from the server and never changed are not put back; the next class load restores them. That is the one case where main happens to do better (it rewrites everything). It is listed in section 7.
- **What the teacher is told.** Nothing. There is nothing to report: the mark is saved. A save this computer cannot keep still shows on the sync dot only (`shared/data.js:140-143`). The red message stays for a real mass loss.
- **The screen** of the tab that is behind still catches up at the next refresh, as today.

### Undo sends once

The three extra calls are deleted. `saveScores` already sends the change. When `saveScores` refuses a save, nothing is sent, which is right: nothing was saved.

### The send becomes private

`persistScoreDiffToCanonical` is renamed `_sendScoreDiff`. After Undo sends once, `saveScores` is its only caller. `tests/grader-guard.test.js` drops it from the allowlist and fails if any file but the mark writers' file names it. The tests that call it directly call `saveScores` instead.

### A refused mark is sent when there is room

When the outbox refuses a score, the cell is remembered in memory. The next score write in that class, or the next call the outbox sends, tries it again. Today only a whole-list save does this. Without this step, moving points to a one-cell write would take that retry away.

### The redraw

Only the desktop gradebook needs it. The Assignments cards and the phone already redraw one row. The grader dialog redraws itself only; step 0 says whether that is worth changing.

What depends on a cell:

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

Three rules keep it honest:

1. **One builder.** The code that builds a row for the full page builds it for the small redraw. They cannot disagree.
2. **The full redraw is the check.** In tests, after every score, the page is also drawn in full and the two results must match exactly. The browser tests and the differential run switch this on. It is off for teachers.
3. **When in doubt, the full redraw.** A filter or sort that depends on scores (To Return only, for one) redraws the whole page as today.

### Offline and the outbox

Unchanged. Every call still goes through `_writeRpc` and the outbox, under the same cell key, with the same retry and the same replacing of an unsent call. The design removes calls (the second Undo send) and adds one (a refused mark tried again). It changes no call's name or contents.

### Why sending twice is still safe

The old score calls take no key (CLAUDE.md rule 7; DECISIONS, "Student page build answers" 11). Each sets one cell to one value, so the same call twice leaves the same result. The outbox sends one cell's calls in order, one at a time, so the teacher's last choice lands last from this computer. Nothing here weakens that. No new server call is added.

### The other ways a mark is made

| Case                         | After the change                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fills and Set Everyone To    | One cell at a time, as today. Each is a one-cell write.                                                                                                                                                                     |
| Group and pair work          | As today (`_groupWrite`, `_syncGroupFrom`). The "before" a group copy is judged from is this tab's own, so a mark the other tab cleared is never copied to a partner.                                                       |
| Rubric criteria              | One cell each, as today.                                                                                                                                                                                                    |
| Checklist boxes              | As today in the first steps. A later step gives ticks, statuses and Draft and Returned rows the saved-copy rule.                                                                                                            |
| Draft and Returned           | The same rule (`shared/grade-state.js`), run on the changed cell. Return still follows the cell's score calls in the outbox (`offline-queue.js:165-178`, `1205`).                                                           |
| Ids not yet from the server  | As today: a save first moves marks onto the server's id (`shared/data.js:2038`), and the outbox holds a call behind its create (`2331`, `8485-8486`). A re-key applies the same change to the list of this tab's own cells. |
| The class copied to a new id | As today (`shared/data.js:618-641`): it sends every mark, because it starts from nothing.                                                                                                                                   |

### What stays exactly as it is

Grade math. Every server function. The outbox. The two-second quiet wait and the class refresh. The mass-loss guard for one tab. Which screens call which grader action. What a level tap saves and sends. The phone. Demo Mode's behaviour with one tab. The oddities pinned today (the comment sent again with a + or −; Clear Score's extra `clear_score`).

## 4. The server

**No server change is proposed.** No SQL.

The stale-tab fault is two tabs sharing one browser's storage. The server never sees it, so the browser can and must fix it.

Two devices are a different matter: the server takes the last call to arrive for a cell. That is unchanged (section 8, question 1). A server check would have to refuse a write. The app already in teachers' browsers sends no version, so every one of its score writes would be refused or waved through unchecked. A refused write becomes a failed write that is dropped after one more try (`offline-queue.js:1107-1129`). One refusal of this kind exists already: `upsert_tag_score` refuses a competency score on rubric work (`migrations/20261027_score_comments.sql:99-101`), and a call it refuses ends in the failed list.

## 5. What Colin and Karen will notice

The aim is nothing but speed. Everything else, however small:

- **Gradebook:** typing scores down a column is quicker, by an amount step 0 will state. The scroll place and the selected cell stay as today.
- **Phone:** nothing. It is already 15 ms.
- **Undo:** nothing.
- **Two tabs on one class:** a mark typed in the tab that is behind is no longer blocked with the red message. The other tab's marks no longer go missing from this computer's copy. The tab that is behind still shows the other tab's marks a moment later, as today.
- **Undo in a tab that is behind:** it leaves alone a cell the other tab has scored since. Today it would overwrite it.
- **The red "Score save blocked" message:** rarer. It shows only for a real mass loss.
- **The sync dot after the outbox was full:** it can turn green by itself once there is room, because the refused mark is sent.
- **Reports, grades, the student page:** nothing.

## 6. The steps

The plan puts item 7 (moving the mark writers out of `shared/data.js`, move only) before this item, and this design keeps that order. The column "Needs item 7" says only whether a step could not be built without it. One PR at a time on `shared/data.js`, `teacher/page-gradebook.js` and `teacher/page-assignments.js` (plan, section 4).

| #   | Step                                                                       | Kind                  | Needs item 7 | Size   | Risk   |
| --- | -------------------------------------------------------------------------- | --------------------- | ------------ | ------ | ------ |
| 0   | Measure a desktop score entry                                              | Tests only            | No           | Small  | None   |
| 1   | Undo sends once (S19-B4)                                                   | Behaviour             | No           | Small  | Low    |
| 2   | Gradebook rows built by one builder                                        | Move only             | No           | Medium | Low    |
| 3   | Gradebook redraws the rows that changed                                    | Behaviour (screen)    | No           | Medium | Medium |
| 4   | A whole-list save's "before" is this tab's own                             | Behaviour (two tabs)  | No           | Small  | Medium |
| 5   | A refused mark is sent when there is room                                  | Behaviour (rare)      | No           | Small  | Low    |
| 6   | Points, Complete and Incomplete save as one cell                           | Behaviour             | No           | Small  | Medium |
| 7   | The score send becomes private (S19-B5)                                    | Rename                | Better after | Small  | Low    |
| 8   | One function writes the scores copy; on-save hooks (Track E 3)             | Move only             | Yes          | Medium | Medium |
| 9   | Draft and Returned runs on the changed cell                                | No change for one tab | Yes          | Small  | Medium |
| 10  | A tab that is behind writes only its own cells; Undo checks the saved copy | Behaviour (two tabs)  | Yes          | Medium | High   |
| 11  | The guard judges the tab's own change                                      | Behaviour (two tabs)  | Yes          | Small  | High   |
| 12  | The same for statuses, ticks and Draft and Returned rows                   | Behaviour (two tabs)  | Yes          | Medium | Medium |
| 13  | The grader dialog redraws less                                             | Behaviour (screen)    | No           | Small  | Low    |

For every step: tests first. A behaviour step needs Colin (it changes how a mark is saved or drawn) and an independent reviewer who tries to break it. Undo for every step is reverting its one PR; nothing is written to the server or the saved copy in a new shape, so a revert leaves no data behind.

**Step 0. Measure.** `e2e-perf/speed.spec.js` only. It adds, timed in the page as PR 1282 did for the phone: a score typed in the gradebook's Scores view, a key in the Competencies view, a level on an Assignments card, a level in the grader dialog, Set Everyone To on 30 students; each at full and quarter speed, with the student page off and on. It records and fails nothing. It decides steps 3 and 13 (section 8, question 5).

**Step 1. Undo sends once.** `shared/grader.js:158`, `281`; `shared/data.js:6403`.

- Pins before: `tests/pin-gradebook-writes.test.js`, `tests/pin-phone-grade-writes.test.js`, `tests/pin-assignments-fills.test.js`, `tests/grader.test.js`, `tests/fill-undo-cells.test.js`, `tests/score-rejected-clear-retype.test.js`, `e2e/pin-gradebook-edits-reload.spec.js`, `e2e/pin-assignments-grading-reload.spec.js`.
- Changed pins: the three that say "twice" say once.
- New tests: one call for each undone cell, with a baseline and without; offline then online, one waiting call for each cell; an Undo that `saveScores` refuses sends nothing.
- Differential run: the saved copy and the screens show 0 differences. The calls differ only where build A repeats a call it already sent in the same step. The run is taught to fold exactly that, the fold is listed in `NORMALISE` (`scripts/differential/compare.mjs`), and it is taken out after the release.

**Step 2. One row builder.** `teacher/page-gradebook.js`: the row and Class Average code inside `renderScoresTable` (`1852`) and `renderDetailedTable` (`1376`) becomes functions the full page calls. Pins: `tests/pin-gradebook-writes.test.js`, `e2e/pin-gradebook-edits-reload.spec.js`, `e2e/pin-gradebook-sort-filter.spec.js`, `e2e/gradebook-group-marks.spec.js`. Proof: the page's HTML is the same text before and after, on the pins and on the differential run's screens (`--screens-every 1`).

**Step 3. Redraw the rows that changed.** `teacher/page-gradebook.js` (`_redrawCompetencyCell` at `2468`, the Scores view's `commit` at `3626`, `_restoreUndo` at `2554`).

- New tests: after each kind of score entry, the page equals a full redraw (the check in section 3); group work; a rubric criterion that feeds two competencies; the To Return filter falls back to the full redraw; focus and scroll are kept.
- A constant turns it off (`FV_CELL_REDRAW`, like `FV_CACHE_FIRST`), removed two releases later.
- Differential run: 0 differences. The branch build runs with the full-redraw check on, and the check must never fire.

**Step 4. This tab's own "before".** `shared/data.js`: `_safeLSSet` (`4927`), `_loadCourseFromLS` (`4870`) and `_persistLoadedField` (`1753`) record the text read or written for the scores and status keys; `saveScores` (`6346`, `6308`) and `saveAssignmentStatuses` (`5910`) use it when there is no baseline.

- Pins before: `tests/score-guard-keeps-mark.test.js`, `tests/write-path-regressions.test.js`, `tests/data-scores-v2-dispatch.test.js`, `tests/id-rekey-and-points-clear.test.js`, `tests/status-rejected-then-undone.test.js`, `e2e/guard-keeps-mark.spec.js`.
- New tests: fault 4 and fault 7, failing on main (two tabs, one storage, no baseline: no clear is sent for the other tab's marks or statuses); one tab sends exactly what main sends; a class copied to a new id still sends every mark.
- A site that forgets to record makes the tab think it is behind. The cost is its own cells sent again, never another tab's cleared.
- Cost: the tab keeps the last text of each open class's scores and statuses in memory, about 1 MB for a 5,400-mark class (PR 1263, Review B).
- Differential run: one tab, 0 differences. With `--two-tabs`, the only difference allowed is a clear build A sends for a cell that tab never wrote.

**Step 5. A refused mark.** `shared/data.js`: `_onWriteRefused` (`2009`), `_onOutboxEvent` (`2912`). Pins before: `tests/offline-queue.test.js`, `tests/write-path-audit.test.js`, `tests/score-rejected-clear-retype.test.js`. New test: fault 10, failing on main. Differential run: 0 differences (the run never fills the outbox).

**Step 6. Points as one cell.** `_setPointsScoreOne` and `_setCompletionMarkOne` (`shared/data.js:7700-7747`) save and send as `_upsertScoreOne` does. They keep four things `saveScores` did for them: moving marks onto server ids first (`6291`), one call for a points cell however many competencies it has (`5662-5672`), dismissing a failed write the teacher has typed over (`6349`), and a block when this tab's memory has lost most of what it last wrote (counted when the text is recorded, so nothing is parsed).

- Pins before: step 4's, and `tests/score-complete-incomplete.test.js`, `tests/pin-grader-dialog-writes.test.js`, `e2e/pin-delete-assessment-then-grade.spec.js`.
- Changed pins: `tests/score-guard-keeps-mark.test.js:335` and `e2e/guard-keeps-mark.spec.js:149` (the mark in the tab that is behind is now saved and sent). Each other two-tab case in that file is decided again in the PR, test first.
- Until step 10, that mark is saved the way a level is today: the other tab's marks leave this computer's copy until the next class load. The server keeps them.
- Differential run: one tab, 0 differences in the saved copy, the calls and the screens.

**Step 7. Private send.** The rename in section 3. Pins before: step 1's. `tests/grader-guard.test.js:44`, `tests/data-scores-v2-dispatch.test.js:240-253`, `tests/grade-return-data.test.js:279-313`. Differential run: 0 differences.

**Step 8. One writer, and hooks.** In the mark writers' file. Every place that writes the scores copy calls one function: the five one-cell writers (`shared/data.js:5143`, `5378`, `5449`, `5519`, `5580`), `saveScores` (`6341`), the clean-up after Delete Assessment (`shared/data-assessments.js:446`), Edit a Copy's move (`shared/data-rubrics.js:505`), the re-key (`shared/data.js:2405`) and the class load (`1753`). `_saveCourseField` and that function run one list of hooks in place of the named calls. Each writer keeps its own order of effects where the order can be seen (a refused level does not tell other tabs, `shared/data.js:5153-5156`). A new test fails if any other code writes `gb-scores-`. Pins before: every pin named in steps 1, 4 and 6, and `e2e/pin-phone-grade-tab.spec.js`. Proof: the method for mark-touching moves (DECISIONS, "Marks may be moved"): 0 differences on three seeds, both modes, offline and two tabs.

**Step 9. Draft and Returned on one cell.** The one-cell writers pass the cell's old entry instead of reading the saved copy (`shared/data.js:7217-7262`). Pins: `tests/grade-return-data.test.js`, `tests/fixtures/grade-state-cases.json`, `e2e/marks-read-current-piece.spec.js`. New test: fault 6. Differential run: one tab, 0 differences, the `gb-grade-returns-` text included.

**Step 10. Own cells.** The saved-copy rule and the Undo rule in section 3.

- New tests, two and three tabs with their own memory and one storage, outbox and server: faults 3 and 5; both orders offline then online; an older build's whole write in the middle; storage full in one tab; the write throwing (it falls back to main's write); a re-key between the two tabs; Delete Assessment in one tab and a mark in the other; Undo of a fill after the other tab scored five of its cells (R1 in `tests/score-guard-keeps-mark.test.js:439`); pair work (R9, `459`).
- The two reviews of PR 1263 are the first attack list.
- Differential run: one tab, 0 differences. With `--two-tabs`, every difference must be a mark build A's saved copy lost and build B's kept.

**Step 11. The guard.** `saveScores` (`shared/data.js:6302-6339`). The twelve cases in `tests/score-guard-keeps-mark.test.js:319-476` are decided one by one, test first: an empty list, one student's marks, or a save that drops most of this tab's own marks stays blocked; a save whose own change is small goes through.

**Step 12. Statuses, ticks, rows.** The same function for `gb-statuses-`, `gb-rubric-checks-` and `gb-grade-returns-`. They are already keyed by cell. Pins before: `tests/status-rejected-then-undone.test.js`, `tests/pin-class-results-mark-missing.test.js`, `tests/gradebook-clear-score-undo-ticks.test.js`, `tests/grade-return-data.test.js`. New tests: step 10's, for a status, a tick and a row.

**Step 13. Grader dialog.** `teacher/page-assignments.js:15917-15950`, `16029`. Only if step 0 says so. Pins before: `tests/pin-grader-dialog-writes.test.js`, `e2e/group-grader.spec.js`. The same full-redraw check as step 3.

## 7. Risks and how each is caught

| Risk                                     | What could go wrong                                                                                                                                                    | How it is caught or contained                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two tabs                                 | The own-cells write drops or brings back a mark                                                                                                                        | Step 10's two-tab and three-tab tests; PR 1263's reviews as the attack list; any error falls back to main's write                                                                                                                    |
| Two tabs, one on an older build          | The older tab writes its old copy; marks this tab loaded and never changed stay out of the saved copy until the next class load                                        | The server keeps them. Before a release every computer opens the app and waits for a green dot (DECISIONS, "Class settings on two computers" 5)                                                                                      |
| Two devices                              | The later call wins for a cell, as today. A fill or Undo on a device that is behind can overwrite a newer mark                                                         | Not changed here. The refresh after two quiet seconds stays. Section 8, question 1                                                                                                                                                   |
| Offline then online                      | Calls wait and go in order, as today. Over 500 waiting, a mark is refused                                                                                              | Step 5 sends it when there is room. Across a reload it can still be lost (section 9)                                                                                                                                                 |
| A failed write in the middle             | A network failure retries. A rejected write puts its baseline row back (`shared/data.js:1976`). After step 6 a later points mark no longer sends a rejected cell again | The outbox's own one more try at the next page load stays. `tests/score-rejected-clear-retype.test.js` pins the typed-over case                                                                                                      |
| A class loading while a mark saves       | The load overwrites the mark                                                                                                                                           | Every writer still flags the class as edited (`_markLocalWrite`), through the hooks. A load that skips the scores does not clear the own-cells list. `tests/write-path-regressions.test.js`                                          |
| A re-key landing mid-save                | A mark is filed under an id the server never had                                                                                                                       | The re-key rewrites memory, the saved copy, the baseline and the waiting calls as today (`shared/data.js:2398-2412`), and the own-cells list. `tests/id-rekey-and-points-clear.test.js`, `tests/rubric-save-rekeys-in-place.test.js` |
| The 14-day purge of saved copies         | A copy is removed while a tab still has the class open                                                                                                                 | The tab finds no text in storage and writes the whole class, as today. The outbox is a different key and is never purged (`shared/data.js:4412-4426`)                                                                                |
| Storage full                             | The saved copy write fails                                                                                                                                             | As today: the call still goes, the dot says so. The cell stays on the own-cells list, so a later write puts it in                                                                                                                    |
| The small redraw misses something        | A grade on screen is out of date until the next full redraw. No mark is affected                                                                                       | The full-redraw check in every browser test and the differential run; the constant that turns it off                                                                                                                                 |
| A step changes what one tab saves        | Colin or Karen sees a difference                                                                                                                                       | The differential run on three seeds, both modes, offline, before each merge (`docs/differential-run.md`)                                                                                                                             |
| The measured gain is too small to matter | Risk taken for nothing                                                                                                                                                 | Step 0 comes first and decides steps 3 and 13                                                                                                                                                                                        |

## 8. Open questions, each with a recommended answer

The lines on published views are my reading of each author's published work. None of them has seen this design.

1. **Should the server refuse a write from a device that is behind?**
   **Recommended: no.** Keep the last call wins for a cell, and make no server change.
   - Kleppmann (_Designing Data-Intensive Applications_, chapter 5): last write wins quietly throws away one of two writes made at the same time, and is a poor choice where losing a write is not acceptable; his answer there is a version check. A write that follows another is not that case: it replaces it. One teacher moving between two devices mostly makes the second kind. His view points toward a version check for the first kind, which here is a device that was offline for a while.
   - Nygard (_Release It!_): every link to another system fails in time, so decide what the failure looks like before adding one. A refusal here becomes a dropped write, with no screen to put it right.
   - So: not now. Ask again if two teachers ever share a class, or once a refused write has somewhere to go.
2. **When a tab is behind, merge quietly or refuse and say so?**
   **Recommended: merge by cell and say nothing.** The mark is saved, so there is no problem to report (rule 5).
   - Kleppmann (the same chapter, and his work on merging edits made apart): keep both changes when they touch different things, and merge at the finest unit that makes sense. Here that is a cell.
   - Nygard: a failure in new code should be contained, not passed on. Any error in the merge falls back to the write that works today.
3. **Should a tab take the other tab's marks into its memory at once, so its screen is never behind?**
   **Recommended: not in this item.** The saved copy and the server are safe without it, and the screen catches up as today. It would be a second way for two tabs to disagree.
   - Kleppmann (the research on merging he writes about): passing each change between copies needs every message delivered, once; merging onto one shared copy does not.
4. **A switch for the small redraw, and the full-redraw check in tests?**
   **Recommended: yes to both.** The switch is a constant, removed two releases later. The check never runs for teachers.
   - Fowler's site ("ParallelChange", "Feature Toggles"): keep the old path beside the new one until the new one is proven, then remove it and the switch.
   - Beck (_Tidy First?_): the move-only step (2) and the behaviour step (3) are separate PRs.
5. **How slow must the gradebook be for step 3 to be worth it?**
   **Recommended:** build step 3 only if step 0 shows a typed score takes more than 100 ms to draw at quarter speed. Build step 13 only on the same test.
   - Fowler (_Refactoring_, on performance): measure before tuning. Beck: the smallest change that removes the pain.
6. **Should every one-cell write, levels too, check that this tab's memory has not collapsed?**
   **Recommended: yes, in step 10,** where the answer to a collapse is to write own cells only, not to block. Today a level tap after such a fault rewrites the saved copy with almost nothing.
   - Nygard: contain a fault where it is found, so it cannot spread to what is saved.
7. **Should the red "Score save blocked" message move to the sync dot?**
   **Recommended: leave it.** The plan lists the remaining toasts as a feature PR of their own. After step 11 it shows only for a real mass loss. Colin's call.
8. **Should a refused mark outlast a reload?**
   **Recommended: not yet.** First count how often the outbox refuses a score (the kind of write only, never its contents, as `_discardWrite` reports), then decide.
9. **Fix the phone's Undo send though no button reaches it?**
   **Recommended: yes, in step 1.** The plan keeps `undoLastScore` for a phone Undo button (section 8, item 16).

## 9. What this design does not do

- It does not change grade math, any server function, or anything the server stores.
- It does not stop a device that is behind from winning over a newer mark on another device. That is the server's rule.
- It does not keep a tab's screen in step with another tab any sooner than today.
- It does not fix a stale tab saving over the class's work list, roster, categories or settings (F2 and F3 in PR 1263). Only marks, and in step 12 statuses, ticks and Draft and Returned rows.
- It does not make a mark the outbox refused outlast a reload.
- It does not change the phone, the Assignments cards, or the pinned oddities (the comment sent again with a + or −; Clear Score's extra `clear_score`).
- It does not rewrite the screens' many-cell actions into lists of cells. `saveScores` stays for them (`docs/write-path-plan.md`, Phase 5).
- It does not move the mark writers. That is plan item 7.
- It does not bring the write-path docs up to date. That is S19-B7, after this.
