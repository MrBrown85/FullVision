# The differential run

`scripts/differential-run.mjs` proves that two builds of FullVision behave the same for a teacher. It was built for the S19 split of `shared/data.js` (`docs/plans/handoff-review-plan.md`, Track E): code that reads, writes, returns, syncs or deletes marks may move to another file, but it may not change. Colin and Karen must see the same marks, their devices must keep the same saved copy, and the server must be sent the same calls in the same order. Every move of mark-touching code passes this run, main against the branch, before it merges.

It is not part of CI. Run it on a Mac before merging a move.

## How to run it

Build both sides first. A side is a repo checkout with `dist/` built, a built site folder on its own, or a URL serving one.

```bash
# main, in its own worktree
git -C ~/FullVision worktree add /tmp/main-build origin/main
(cd /tmp/main-build && npm ci && npm run build:e2e)
# the branch with the move
npm run build:e2e

TZ=UTC node scripts/differential-run.mjs --a /tmp/main-build --b . --seed 1 --steps 600 --mode both --offline --two-tabs
```

Options:

- `--seed <n>`: the seed of the action sequence. The same seed gives the same steps, so a run can be repeated. Use three seeds for a move (1, 2 and 3).
- `--steps <n>`: steps in each mode.
- `--mode signed-in|demo|both`: signed in against the fake server, Demo Mode, or both (the default).
- `--offline`: ten steps offline in every 200, then back online with the outbox drained. The second and third offline steps are fixed: a piece is made and graded, then a student is added and given a mark.
- `--two-tabs`: a second desktop tab open for a block of steps in every 200, taking about four in ten of the actions while it is open.
- `--screens-every <n>`: how often the screens are compared (default 25; always after the last step).
- `--must-reach <writer,writer,...>`: mark writers (names from `scripts/differential/writers.mjs`) the run must call on both sides. If any was not called, the run ends with exit code 3, even with no difference. A name that is not on the list is refused with exit code 2.

`--seed`, `--steps` and `--screens-every` take whole numbers written in digits. Anything else (`"7 a"`, `1e3`, nothing) is refused with exit code 2, so a typo cannot run a different sequence from the one it names.

It serves each built folder through `scripts/e2e-server.mjs` (the edge function and its CSP, as the browser specs get it) on a free port and stops each server by its process id when done. However the run ends, its servers are stopped and its temporary folder removed; a folder left by a run that was killed outright is removed by the next run.

What it prints: a progress line every 25 steps; at the end, per mode, the calls compared by name, the writer ledger (below) and one line with the steps run, the actions by kind, the keys, calls and screens compared and "0 differences". At the first difference it stops and prints the step, the action and what differed.

Exit codes:

- 0: no difference.
- 1: a difference.
- 3: no difference, but a `--must-reach` writer was not called on both sides. The run is no proof for that writer.
- 2: the run could not be done. A step over its 30-second limit is one (it names the step and action). So is a server the run started that stops while the run is going: the run ends at once and says that something outside it stopped the server. Run it again, alone if the machine is busy. So is the run finding that it asked the two builds different things: that is a fault in the run, to be fixed in the run.

Speed on an M5 Pro: 600 steps in both modes with `--offline --two-tabs` take eight to ten minutes with two other runs going, less alone. Three seeds can run at once.

## What it does

Build A and build B each get a browser context. The same seeded sequence picks an action, does it in A and in B, lets both finish, and compares them. After every step it compares:

1. **The device's saved copy.** Every `localStorage` key, as the exact text stored, so a change in key order counts. That covers the `gb-` keys (`_DATA_KEYS` in `shared/data.js` and the rest, the Draft and Returned rows in `gb-grade-returns-…` among them), `fv-sync-queue-v1` and `fv-sync-dead-letter-v1` (the outbox and its dead letters, `shared/offline-queue.js`) and every other key the app writes. Also every IndexedDB database and store the page has (`fv-photo-queue`, `fv-report-issues`), record by record.
2. **The calls sent to the server**, signed in: name, parameters and order, tab by tab. Every call is written down as it is made, outside the page's own life (`scripts/differential/fake-server.js` keeps one `localStorage` key a call), so the calls of a tab that has since closed or reloaded are compared too: a closing tab's are read from the tab before it goes, and whatever a page sends as it leaves is picked up after. In both modes every request to a server other than the build's own is recorded and the two lists compared at the end of the mode; Demo Mode makes none.
3. **What a teacher and a student see** (every 25 steps and at the end): the text of every cell of the gradebook's Scores grid with its row and column titles, the Assignments page, the grader opened on one named student's rubric piece, that student's page, Preview as Student and its My Learning for two more named students, and the Quick Report's sheets. The students are picked by name: Student3, Student8 and Student12 signed in; Sam Blackwood, Cece Adeyemi and Liam Chen in Demo Mode.

It also compares what each action answered and any page errors.

A difference in a list of entries that have ids (a student's score entries, the roster, the pieces) is reported entry by entry, by id, and not place by place: an entry whose key changed is named as one entry (`st1[e1 in A, e9 in B].tagId  A: "CM1"  B: "PA5"`), where a place-by-place readout would list every entry after it.

### The classes

- Signed in: the speed recorder's class (`e2e-perf/speed.spec.js`, 30 students by 60 pieces, every cell scored), with a rubric, two categories, and points, Complete/Incomplete, rubric, pair, group and two-competency pieces among the 60, one pair piece scored by points and one group piece scored Complete/Incomplete, and an Overall Comment on two students in three of the competency work (`scripts/differential/fixtures.mjs`). Every id is one the server could have made: the class, its students, pieces, rubric, criteria, categories, competencies and their sections. So every write is sent as it is live, a competency score (`upsert_tag_score`) and a hand-set level (`upsert_section_override`) included. The class's student page is on, it returns grades When I Return Them, and Send Work is on. The last ten pieces start blank. A second, small class is there to switch to.
- Demo Mode: the Demo class, from `login.html?demo=1&student=1`, as the front page's Try Demo Mode link starts it: the student page on, Return Grades When I Return Them, Send Work and My Learning, so drafts, Return and revisions are in play.

### The fake server

Signed in, the app talks to the fake Supabase of `e2e/helpers.js` (`mockAuth`), which the browser specs use: it answers the class bundle from what the page held when it loaded, and every write with nothing. `scripts/differential/fake-server.js` is laid over it in every page, without changing `e2e/helpers.js`:

- **Server ids.** `create_assessment`, `create_student_and_enroll` and `save_categories` are answered with the ids the server would give, made from the call's idempotency key, so they are the same in A and B and the same when a create is sent twice. The app then re-keys its local id, as it does live: a new piece or student graded before the answer comes has its marks, statuses and rows re-keyed, also after an offline create.
- **Draft and Returned.** The server keeps the class's Draft and Returned rows. Each time a write lands it takes the rows the device holds then as its own, and `list_course_grade_returns` answers with them; a write that fails or is refused leaves them as they were. The rule that makes a row is the device's (`shared/grade-state.js`); the fake does not work it out a second time. `return_grades` and `return_work` answer as live, and one can be told to refuse, which is how the run reaches the outbox's refusal handling and the un-return. `set_course_send_work`, `return_for_revision`, `cancel_revision`, `list_course_submissions` and `list_course_feedback` are kept the same way. The class bundle carries the student page's switch, Return Grades and Send Work on the course row, as live.

### Making A and B the same

- **The clock.** Playwright's fake clock, installed paused at 15:00 UTC on 15 October 2026. Date, timers, `requestAnimationFrame` and `performance.now` move only when the run moves them: six seconds after each step, in three moves, and longer when the device comes back online so every outbox retry is due. No move depends on how long anything took in real time. A page that is starting (the first load, a new tab, a reload) is given the clock in rounds of twenty moves of 100 ms, and build A and build B are always given the same number of rounds. A wait for something on a screen (the grader opening, a toast) always moves the clock the same amount and then looks once.
- **Real work first.** Before each move every tab finishes its real work: the page has loaded and is not leaving for another, nothing it started is on its way (the scripts and stylesheets it adds, its fetches, its IndexedDB work, a Web Lock it is owed), and what it saved, sent and drew has stopped changing.
- **Both builds are read alike.** A read is not free: calling into the app can change what it holds in memory (`getScores` marks its scores as checked against the rubrics, for one). So everything the run reads from one build it reads from the other, in the same order: the class the next action is picked from, the saved copy, the calls, the screens. The two reads of the class must agree, or that is a difference. And the run checks itself: every `page.evaluate` it makes is noted per build (`scripts/differential/given.mjs`), and at every comparison the two lists must be the same, or the run stops with exit code 2 and says the fault is its own. The first version read the class from build A alone, which made main differ from main (seed 2741, Demo Mode, step 162).
- **Random numbers.** `Math.random`, `crypto.getRandomValues` and `crypto.randomUUID` come from one seeded generator per page load (`scripts/differential/page-init.js`), so ids, idempotency keys and local ids come out the same in A and B.
- **Messages between tabs.** The app's BroadcastChannels are held by the run: each tab's messages are delivered when the run says, in a fixed order, after a barrier that every other tab has seen. Without this, two tabs' messages arrive in an order the browser picks.
- **Nothing is normalised.** Every value is compared as it is. If a value ever cannot be made the same, list it in `NORMALISE` in `scripts/differential/compare.mjs` and here.

## The actions

Weighted so marks dominate. Most go through the app's own functions, the ones the screens call, with the arguments the screens pass (`scripts/differential/actions.mjs` names the screen beside each). A few go through the real screen.

Through the real screen:

- The grader dialog from a gradebook cell: a level, + or −, Late, Done.
- Cmd+Z on the gradebook (Undo of the last score).
- Delete Assessment from the gradebook's column menu, the dialog, then the toast's Undo or the toast timing out.
- Mark Blank Cells Missing or Excused from the column menu, then sometimes its Undo, from the toast or from the menu's Undo Marking Blank Cells.
- Keys on a selected cell of the Competencies view: a level 1 to 4, + or − (which sends the cell's comment again with the level), 0 or Backspace to clear, C or I on Complete/Incomplete work.
- Switching class and back.
- A reload.

Through the screen's functions:

- A level with + or − (`Grader.setLevel`), + or − alone, a competency piece tag by tag, a rubric criterion by criterion.
- Points: enter, change, clear, 0, over the maximum. Complete and Incomplete and clearing them.
- Missing, Excused, Late and clearing them.
- An overall comment, a competency's comment and a criterion's comment, and clearing each; a criterion comment on a criterion with no score.
- Set Everyone To on a piece and its Undo; a column fill and Undo; a row fill or Clear and Undo; the gradebook's Clear Score and its Undo.
- Pair and group marks (levels, points and Complete/Incomplete), Grade Separately and Back to Group Grade.
- A hand-set competency level and clearing it; a term rating.
- Return for one student and Return to All (`return_work` with Send Work on, `return_grades` with it off); a new mark on a returned grade (a draft over a returned grade); a Return the server refuses, which the outbox puts back to a draft (signed in); Return for Revision, a revised mark, and Take Back; Send Work on and off.
- Creating a piece, graded at once six times in ten (before the server has answered with its id); editing a piece's title, points, category, date, rubric, weight, due date, description and Core Competencies; deleting a piece.
- Adding a student, given a mark at once six times in ten; editing, withdrawing and re-enrolling a student.
- The grading style; the calculation method; adding and reweighting a category.
- The phone's Grade tab: a level with + or − and its Undo (`Grader.setLevelOnPhone`, `setPlusMinusOnPhone`, `undoOnPhone`), in the phone app loaded in a phone-sized tab.

**Going back.** A random cell of 1,800 is almost never touched twice, so a clear after a change would almost never happen. The run keeps the cells the last steps touched, and the marks, statuses, comments, Clear Score and Return for Revision go back to one of them between two and five times in ten: a comment is cleared on the cell that has it, a status is set then cleared, a score is changed then cleared, a returned grade is changed.

### The writer ledger

A run only guards what it does. A fault in a writer the run never calls passes every comparison, however long the run. So the run counts the writers it calls.

`scripts/differential/writers.mjs` lists every function exported by `shared/data.js`, the `shared/data-*.js` files and `shared/grader.js` that saves, clears, returns, takes back or restores a score, status, comment, note, rubric tick, DIBELS score or group mark, each with its area and a reason. It also lists the exported names that look like a writer's but are not one. `tests/differential-writers.test.js` fails when an exported function whose name looks like a writer's (a verb such as set, save, clear or undo with a word such as Score, Status, Comment or Group, and every export of `window.Grader`) is on neither list, and when a listed name is gone. So a new writer cannot be added without the run counting it.

In every page the run opens, each listed writer is wrapped once the page's scripts have run: the wrapper tells the run its name through a Playwright binding, then calls the writer with the same `this`, arguments and answer. Nothing is stored in the page. App files are not changed. A writer called while the page's scripts are still loading, or through a reference a script took before then, is not counted.

At the end of each mode the run prints the writers called, with their counts (A and B apart where they differ), and the writers not called.

**A writer on the "not called" list is not guarded by the run.** The reviewer of a move that touches it must check it by reading or by a test, and say which. A move names the writers it moves with `--must-reach`, so a run that never reached one cannot pass as proof for it.

For the coming moves of mark writers out of `shared/data.js`, the run (seeds 1, 2 and 3, 600 steps, both modes, `--offline --two-tabs`) takes these lists, each the writers of that move that the run reaches:

- Assignment statuses: `--must-reach Grader.setStatus,Grader.markBlankCells,Grader.undoMarkBlankCells,setAssignmentStatus,applyAssignmentStatus,saveAssignmentStatuses`. Not reached, so checked by reading or a test: `Grader.deleteAssessmentStatuses`, `Grader.undoMissing`, `setCellStatus`.
- Score writes: `--must-reach upsertScore,setPointsScore,setCompletionMark,saveScores,persistScoreDiffToCanonical,restoreScoreCells,clearScoreEntries,clearScore,upsertCellScore,saveScoreComment,saveTagComment,saveRubricCriterionComment,Grader.setLevel,Grader.setPlusMinus,Grader.setPoints,Grader.setMark,Grader.typeLevel,Grader.typePlusMinus,Grader.clearScore,Grader.clearScoreOnServer,Grader.undoCell,Grader.undo,Grader.deleteAssessmentScores,Grader.setLevelOnPhone,Grader.setPlusMinusOnPhone,Grader.undoOnPhone,Grader.setOverallComment,Grader.setCompetencyComment,Grader.setCriterionComment`. Not reached: `saveRubricCriterionBeyond`, `saveScoreReportNote`, `setRubricCheck`, `saveRubricChecks`, `saveDibelsScore`, `moveRubricScores`, `clearRowScores`, `clearColumnScores`, `fillRubric`, `Grader.carryOverall`, `Grader.moveToRubric`, `Grader.setReportNote`, `Grader.setTick`, `Grader.setWentBeyond`, `Grader.setDibels`.
- Group grading: `--must-reach setGradedSeparately,Grader.gradeSeparately,Grader.backToGroupGrade`. Back to Group Grade is reached in Demo Mode only, so this list needs both modes. The group fill itself runs inside `upsertScore`, `setPointsScore` and `setCompletionMark` (`_groupWrite`, `_syncGroupFrom`, `_syncGroupStatuses` are private and not counted); it is guarded by the comparisons, not by the ledger.

### Not covered

- A student opening a returned piece (`seen_at`), and so a grade marked Updated because the student had seen it: the fake server never says a student opened anything.
- The class's Return Grades setting changed during a run (When I Return Them to As Soon As I Save, or the student page turned off, which returns every waiting draft): the class holds grades from start to end.
- A Return the outbox has no room for. A refused Return runs; a full outbox does not.
- Photos and Mark Up: no student sends work, so `return_work` carries no marks and Return for Revision has no first version. The Note for the Report, DIBELS scores, Advanced Rubric checkboxes and Copy to Another Class.
- Creating a rubric, a class or a learning-map entry: their creates are not answered with server ids, so their re-keying does not run. Pieces, students and categories are.
- Typing a points score into the gradebook grid (the keys above cover levels, + and −, clearing and Complete/Incomplete), Set Everyone To from its menu, and the phone Grade tab's buttons: driven through the same functions the screens call, not by clicks. The gradebook's Scores view keys (Edit Score) are not pressed.
- Undo of a fill after the toast has gone (the toast is the only Undo for a fill).
- Marks in a class whose student page is off, or that returns grades As Soon As I Save. Both classes that are marked hold grades When I Return Them from start to end, so a change that matters only when a class does not hold grades (a class with its build switch off, for one) is not seen.
- A piece's scoring changed (proficiency to points and back), its competencies changed, or its pairs or groups changed, after it has marks. A single-point rubric's Went Beyond note.
- More than one teacher device. After a refused Return the class is read again whole, and the fake answers with the class as the page held it when it last loaded (the run reloads the page first, so that is the class as it is).
- The student's own phone page (`s/`): Preview as Student draws the same page with the same code (`s/page-view.js`).

## Proof that it works

Two pull requests hold the tables: #1304, which added it, and #1319, which has the tables for the tool as it is now. Main against main on six seeds (1, 2, 3, 7, 11 and 2741), each run twice, with no difference and the same summary both times. And main against fifteen throwaway copies of main, each with one small change in how marks are saved, cleared, deleted, returned, re-keyed or synced, every one caught on one of seeds 1 to 3.

## Files

- `scripts/differential-run.mjs`: the run.
- `scripts/differential/args.mjs`: its command line.
- `scripts/differential/serve.mjs`: serves each build through `scripts/e2e-server.mjs`.
- `scripts/differential/session.mjs`: a build's browser context, the clock, starting tabs, delivering tab messages.
- `scripts/differential/page-init.js`: runs in every page first: seeded random numbers, held tab messages, the count of work on its way.
- `scripts/differential/fake-server.js`: runs in every signed-in page after `mockAuth`: the call log, server ids, Draft and Returned rows.
- `scripts/differential/fixtures.mjs`: the signed-in classes.
- `scripts/differential/actions.mjs`: the teacher actions.
- `scripts/differential/probe.mjs`: reads the saved copy, the calls and the screens, and waits for a page to finish.
- `scripts/differential/compare.mjs`: the comparisons and their readable output.
- `scripts/differential/given.mjs`: the run's check that it asked both builds the same things.
- `scripts/differential/prng.mjs`: the seeded sequence.
- `scripts/differential/writers.mjs`: the mark writers, the ledger's wrapper and its readout.
- `tests/differential-run-helpers.test.js`: tests for the comparisons, the sequence, the command line and the run's check on itself.
- `tests/differential-fake-server.test.js`: tests for the fake server.
- `tests/differential-writers.test.js`: the writers list against the code, and the ledger's readout.
