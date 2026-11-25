# The Inbox, redrawn (2026-11-24)

**Status.** I1 to I5 are built and on for everyone since I5 (2026-11-24); the old views and their tests are deleted. On `main`, not released.

**Why.** The Inbox showed all student work, so the few pieces waiting on the teacher were lost among returned ones. Colin, Nov 24: show only what is waiting; no row of assignments along the top; no grey explainer lines; no grading inside the tile; keep Roll Call.

**Board.** "Inbox Redesign Board" (https://claude.ai/artifact/CNpZMPoLwkpM522dLJxNbo), the Revision row, R1 to R6. Each builder's brief is written from the board's own files.

**Switch.** `inboxStacks` in `shared/build-flags.js` was off until the last slice (I5), which turned it on and deleted the old views; the name stays only so a device that kept the key changes nothing.

## What the tile is (switch on)

- **Header:** "Inbox", a two-way switch (To Grade, Roll Call) kept per class, "Assignments →", and in To Grade one button: Start Grading while work waits, Return All N when nothing waits and more than one assessment has graded work. No view menu, no assignment row, no line of words under the body in any state.
- **To Grade (R1, R2, R4):** one stack per assessment with work to grade, newest work first. A stack shows its top page, a count, a dot when a student sent work since the last look, and "Late" when any waiting work is late. A click spreads it into its pages (to grade, in the order they came in) followed by Not In names. A click on a page opens the grader on that student. A graded pile lies face down with Return N, for every assessment that has grades not yet returned, in a class that holds grades.
- **Roll Call (R3):** the whole class for one assessment in class-list order, four columns read downward. Three marks: to grade, returned, not in. The three counts are buttons that pick out their students. The assessment's name is a menu of every assessment whose work shows, with arrows either side. A not-in name's menu: Handed In on Paper (`markStudentWorkOnPaper`) and Add a Scan or Photo (the grader on that student, as today's Add Work). It changes no grade: no Mark Missing.
- **Nothing waiting (R5):** the tile is one 64 px line (All Caught Up, up to two pieces still taking work with their Not In count, Add Work) and Bulletins takes the room.
- **A scan held over it (R6):** the tile opens to one target per assessment that Add Work for the Class offers, and Another Assessment. A drop opens Add Work for the Class with the files, as D5 does.

## Contracts between slices

- `DashInboxQueue` (`teacher/dash-inbox-queue.js`, no DOM). Every count is GraderWork's.
  - `build(cid, { seen, classCounts })` → `{ on, holds, toGrade, toReturn, caughtUp, stacks, returns, taking }`. `stacks`: `{ aid, title, tograde, notin, late, isNew, at, top: { sid, name, file, paper } }`. `returns`: `{ aid, title, toreturn }`, empty when the class does not hold grades. `taking`: pieces taking work with someone not in, `{ aid, title, notin }`.
  - `open(cid, aid)` → `{ aid, title, items, notIn }`: `items` are the to-grade students (a pair or group is one item), oldest send first; `notIn` is `{ sid, name }` in class-list order.
  - `order(cid)` → `[{ aid, studentIds }]`: the stacks in the order shown, each with `DashInboxModel.gradeOrder`.
- The grader: `PageAssignments.openGrader(cid, aid, sid, { studentIds, show: 'tograde', onClose, queue })`, where `queue` is `order(cid)`. With a queue, Next on a piece's last student reads "Next: <title> →" and carries on into the next piece in the same dialog; after the last piece it reads "Finish" and shows All Caught Up with each piece's graded count, Return N Graded and Not Yet. Return asks first, as `_askReturn` does. Without a queue the grader is unchanged.
- `PageAssignments.askReturn(cid, aids, button, then)`: one question naming everyone with a grade waiting in those pieces, then returns them and calls `then`. Nothing in a class that does not hold grades.
- `DashInboxRollCall.show(cid, aid)`: Roll Call on that piece (the Not In heading of an open stack and the R5 chips call it).

## Slices

| Slice | What                                                                                                 | Files                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| I1    | The queue, the tile's header and switch, To Grade (R1, R2, R4)                                       | `dash-inbox-queue.js`, `dash-inbox-stacks.js`, `.css` (new); `dash-inbox.js`; `app.html`, `sw.js`    |
| I2    | Roll Call (R3)                                                                                       | `dash-inbox-rollcall.js`, `.css` (new); `app.html`, `sw.js`                                          |
| I3    | The grader's queue, All Caught Up, `askReturn`                                                       | `page-assignments.js`, `assignments.css`                                                             |
| I4    | Nothing waiting (R5) and the scan drop (R6); needs I1                                                | `dash-inbox.js`, `dash-inbox-drop.js`, `dash-overview.js`, `dashboard.css`                           |
| I5    | Each screen beside the board, the switch on, the old views and their tests deleted, the help article | `build-flags.js`, `dash-inbox-side/-flip/-roll/-pick.*`, the old half of `dash-inbox-model.js`, docs |

I1, I2 and I3 touch different files and are built at once. No slice changes a grade or the database.

**Tests, each slice.** Unit tests for what it adds; one Playwright spec in Demo Mode with the switch on (`localStorage['fv-build-inboxStacks'] = '1'`), with its layout checks in the wide font too (`e2e/wide-font.js`). Before the PR opens: `npm test`, `npm run typecheck`, `npm run typecheck:ratchet`, `npm run lint:ratchet`, `npm run audit:html`, `npm run format:check`. New class names and ids start `dash-inbox-`.

**Rules that hold.** Colours and sizes come from `teacher/styles.css` tokens, never a hex from the board. Motion is 150 to 250 ms and things glide from where they were; nothing fades in. Title Case on labels and buttons. Demo Mode shows all of it. Grades are worded only by `calc.js`.
