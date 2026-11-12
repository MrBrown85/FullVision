# A stale tab catches up before it saves

## The fault

Two tabs (or the phone page and a tab) share one saved copy of each class in
the browser's storage. Each tab also holds its own copy in memory. When tab A
saves, tab B hears about it, but B re-reads the class only from the server, and
only once B has been quiet for two seconds (`_REFRESH_QUIET_MS`) and the outbox
is empty. Offline, that never happens. Until then B saves from its old copy:

- F1. A fills a column. B types one mark. The guard sees B's copy would wipe
  A's fill, blocks it, and B's mark is lost.
- F2. A adds work and marks it. B saves its old work list (a title edit), which
  drops A's work from the saved copy. B's next mark then drops A's marks too.
- F3. Any list B saves (work, roster, categories, statuses, settings,
  withdrawn students) overwrites A's newer one in the saved copy.

The server is mostly safe already: saves send only what differs from the
tab's own server baseline. The saved copy is not, and in Demo Mode the saved
copy is all there is.

## How a tab knows it is behind

There is no per-class counter today. The smallest signal needs no new key:
the saved copy's own text. Each tab remembers, for each object it holds in
memory, the exact text of the saved copy it was read from or last written as
(`_baseOf`, a WeakMap from object to text). It records this on every write of
the field to storage and on every load. The tab is behind on a field when
storage now holds different text. A stamp key was rejected: every writer in
every tab (and an older build in another tab) would have to bump it, and a
missed bump would hide a change.

## The rule

Before a tab saves a class field, or before a writer reads memory to make one
change, the tab compares its text with storage. For each field another tab
changed, it takes the saved copy as it is now and puts back on it only what
this tab changed since it read it. Then the save goes on exactly as on main,
guard included.

"What this tab changed" is the difference between two copies from this tab
only: the text it read (`base`) and what it now hands over (`mine`). It can
never contain another tab's data. Cells and rows this tab did not touch take
the saved copy's value. This is not the merge removed from PR #1250: that one
used the server baseline as the reference, so a stale tab's whole copy counted
as its change.

## The one change at each call site

- One-cell writers (levels, points, Complete marks, comments, ticks, all
  through `_groupWrite`): catch up first, then read memory and make the change.
  No difference is computed.
- Undo of a fill (`restoreScoreCells`): catch up first, so it puts back only
  cells that still hold what the fill wrote. A's retyped cells stay.
- Whole-object savers (`saveScores`, `saveAssessments`, `saveStudents`,
  `saveCategories`, `saveAssignmentStatuses`, `saveCourseConfig`, withdrawn):
  the callers mutate the cache in place (Clear Score, Delete Assessment,
  `undoCell`, the phone's Undo, title edits, roster edits). The text the
  object was read from is kept apart from the object, so the change is still
  separable: `diff(base, mine)` by score cell (student, work, key), by row id,
  or by settings key. Within a row only the fields this tab changed are put
  back; a level and its + or − go together.
- Withdraw and re-enrol, Edit a Copy (`moveRubricScores`): catch up first.

Same cell changed in both tabs: this tab's change wins (it is the teacher's
newest action, and the server already takes the last write). A row another
tab deleted (work, a withdrawn student) stays deleted, and a mark typed onto
it in the stale tab is not kept. The server baseline is moved forward the same
way, so only this tab's change is sent. If this tab's own change would drop
most of its marks (the guard's rule applied to `base` against `mine`), it does
not catch up, and the guard blocks as on main.

## Other modes

- Offline: storage is shared, so both tabs catch up from it; the outbox sends
  each tab's own change once. The quiet window is left alone: it protects the
  server reload, which this does not use.
- Storage full: a field whose last write failed in this tab is not caught up
  (its memory is newer than storage). Main's behaviour and guard apply.
- Demo Mode: the same, with no server.
- Phone: the same functions in `shared/data.js`.
- No text recorded (an object never read from or written to storage): main's
  behaviour.

## Two options

A. Re-read storage the moment another tab says it saved. Small, but anything
holding an object from before (a fill loop, an open menu, a dialog) still
saves an old copy, and the screen redraws under a teacher's typing.

B. Catch up at save time, as above. Covers held objects. Risk: a wrong `base`
would count another tab's change as this tab's; that is why `base` is only
ever set from storage text at a write or a load, and an unknown `base` falls
back to main.

Chosen: B. The guard is unchanged and still runs last.

## Out of scope

Observations, notes, goals, flags, rubrics and the other student-record
fields; Draft and Returned rows; a stale screen (it still redraws at the
existing refresh); objects copied before a catch-up and saved after it.
