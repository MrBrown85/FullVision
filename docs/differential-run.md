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

node scripts/differential-run.mjs --a /tmp/main-build --b . --seed 1 --steps 600 --mode both --offline --two-tabs
```

Options:

- `--seed <n>`: the seed of the action sequence. The same seed gives the same steps, so a run can be repeated. Use three seeds for a move (1, 2 and 3).
- `--steps <n>`: steps in each mode.
- `--mode signed-in|demo|both`: signed in against the fake server, Demo Mode, or both (the default).
- `--offline`: ten steps offline in every 200, then back online with the outbox drained.
- `--two-tabs`: a second desktop tab open for a block of steps in every 200, taking about four in ten of the actions while it is open.
- `--screens-every <n>`: how often the screens are compared (default 25; always after the last step).

It serves each built folder through `scripts/e2e-server.mjs` (the edge function and its CSP, as the browser specs get it) on a free port and stops each server by its process id when done.

What it prints: a progress line every 25 steps; at the end one line per mode with the steps run, the actions by kind, the keys, calls and screens compared and "0 differences". At the first difference it stops and prints the step, the action and what differed. Exit code 0 is no difference, 1 a difference, 2 a run that could not be done (a step over its 30-second limit is one: it names the step and action).

Speed on an M5 Pro: 600 steps in both modes with `--offline --two-tabs` take about the time in the PR that added it (see below). Three seeds can run at once.

## What it does

Build A and build B each get a browser context. The same seeded sequence picks an action, does it in A and in B, lets both finish, and compares them. After every step it compares:

1. **The device's saved copy.** Every `localStorage` key, as the exact text stored, so a change in key order counts. That covers the `gb-` keys (`_DATA_KEYS` in `shared/data.js` and the rest), `fv-sync-queue-v1` and `fv-sync-dead-letter-v1` (the outbox and its dead letters, `shared/offline-queue.js`) and every other key the app writes. Also every IndexedDB database and store the page has (`fv-photo-queue`, `fv-report-issues`), record by record.
2. **The calls sent to the server.** Signed in, the app talks to the fake Supabase of `e2e/helpers.js` (`mockAuth`), which logs every RPC in `window.__e2eRpcLog`. The run reads that log from every tab after each step and compares name, parameters and order. Demo Mode sends nothing; that it sends nothing is compared too.
3. **What a teacher and a student see** (every 25 steps and at the end): the text of every cell of the gradebook's Scores grid with its row and column titles, the Assignments page, the grader opened on one named student's rubric piece, that student's page, Preview as Student for two more named students, and the Quick Report's sheets. The students are picked by name: Student3, Student8 and Student12 signed in; Sam Blackwood, Cece Adeyemi and Liam Chen in Demo Mode.

It also compares what each action answered and any page errors.

### The classes

- Signed in: the speed recorder's class (`e2e-perf/speed.spec.js`, 30 students by 60 pieces, every cell scored), with server-shaped ids, a rubric, two categories, and points, Complete/Incomplete, rubric, pair, group and two-competency pieces among the 60 (`scripts/differential/fixtures.mjs`). The last ten pieces start blank. A second, small class is there to switch to.
- Demo Mode: the Demo class, from `login.html?demo=1&student=1`, as the front page's Try Demo Mode link starts it: the student page on, Return Grades When I Return Them, Send Work and My Learning, so drafts, Return and revisions are in play.

### Making A and B the same

- **The clock.** Playwright's fake clock, installed paused at 15:00 UTC on 15 October 2026. Date, timers, `requestAnimationFrame` and `performance.now` move only when the run moves them: six seconds after each step, in three moves, and longer when the device comes back online so every outbox retry is due. Each tab finishes its real work (scripts loading, fetches, Web Locks) before each move.
- **Random numbers.** `Math.random`, `crypto.getRandomValues` and `crypto.randomUUID` come from one seeded generator per page load (`scripts/differential/page-init.js`), so ids, idempotency keys and local ids come out the same in A and B.
- **Messages between tabs.** The app's BroadcastChannels are held by the run: each tab's messages are delivered when the run says, in a fixed order, after a barrier that every other tab has seen. Without this, two tabs' messages arrive in an order the browser picks.
- **Nothing is normalised.** Every value is compared as it is. If a value ever cannot be made the same, list it in `NORMALISE` in `scripts/differential/compare.mjs` and here.

## The actions

Weighted so marks dominate. Most go through the app's own functions, the ones the screens call, with the arguments the screens pass (`scripts/differential/actions.mjs` names the screen beside each). A few go through the real screen:

| Through the real screen                                                                                       | Through the screen's functions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The grader dialog from a gradebook cell: a level, + or −, Late, Done                                          | A level with + or − (`Grader.setLevel`), + or − alone, a competency piece tag by tag, a rubric criterion by criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Cmd+Z on the gradebook (Undo of the last score)                                                               | Points: enter, change, clear, 0, over the maximum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Delete Assessment from the gradebook's column menu, the dialog, then the toast's Undo or the toast timing out | Complete and Incomplete and clearing them; Missing, Excused, Late and clearing them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Switching class and back                                                                                      | A score comment and a criterion comment; Set Everyone To on a piece and its Undo; a column fill and Undo; a row fill or Clear and Undo; the gradebook's Clear Score and its Undo; pair and group marks, Grade Separately and Back to Group Grade; a hand-set competency level and clearing it; a term rating; Return grades for one student and for all (Demo Mode); Return for Revision and a revised mark (Demo Mode); creating, editing (title, points, category, date, rubric) and deleting a piece; adding, editing, withdrawing and re-enrolling a student; the grading style; the calculation method; adding and reweighting a category |
| A reload                                                                                                      | The phone's Grade tab: a level with + or − and its Undo (`Grader.setLevelOnPhone`, `setPlusMinusOnPhone`, `undoOnPhone`), in the phone app loaded in a phone-sized tab                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Not covered

- Return grades, Return for Revision and a draft over a returned grade **signed in**: the fake server keeps no Draft and Returned rows, so a signed-in class's student page cannot be turned on there. They run in Demo Mode only.
- Typing a points score into the gradebook grid, Set Everyone To from its menu, and the phone Grade tab's buttons: driven through the same functions the screens call, not by clicks.
- DIBELS scores, Advanced Rubric checkboxes, the Note for the Report, Mark Up, photos sent by students, and Copy to Another Class.
- Undo of a fill after the toast has gone (the toast is the only Undo for a fill).
- More than one teacher device: the fake server keeps no state between devices, so two devices' syncs are not modelled.
- The student's own phone page (`s/`): Preview as Student draws the same page with the same code (`s/page-view.js`).

## Proof that it works

The PR that added it ran main against main (no difference, the same summary on a repeat) and main against nine throwaway copies of main, each with one small change in how marks are saved, cleared, deleted, returned or synced. Each was caught. The table is in that PR.

## Files

- `scripts/differential-run.mjs`: the run.
- `scripts/differential/serve.mjs`: serves each build through `scripts/e2e-server.mjs`.
- `scripts/differential/session.mjs`: a build's browser context, the clock, opening tabs, delivering tab messages.
- `scripts/differential/page-init.js`: runs in every page first: seeded random numbers, held tab messages, loads in flight.
- `scripts/differential/fixtures.mjs`: the signed-in classes.
- `scripts/differential/actions.mjs`: the teacher actions.
- `scripts/differential/probe.mjs`: reads the saved copy, the calls and the screens.
- `scripts/differential/compare.mjs`: the comparisons and their readable output.
- `scripts/differential/prng.mjs`: the seeded sequence.
- `tests/differential-run-helpers.test.js`: tests for the comparisons and the sequence.
