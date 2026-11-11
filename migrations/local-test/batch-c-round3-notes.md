# Batch C, review round 3: what changed (a draft for the PR body)

The third independent review (`batch-c-review-3.md`, of `b26cf1c7`) found C1 and C2 ready with notes and two faults, neither reachable today (no screen writes marks or revision requests yet), neither touching a grade. Both are fixed on the branch `batch-c-round3`. Each fix is its own commit, with checks committed first that failed on `b26cf1c7` and pass now, and wrong versions added to `batch_c_mutate.py`. Nothing is applied.

## F1: a revision the teacher deleted (C1)

**What went wrong.** A student sent a revision; the teacher deleted it. The request read open. The next Return of a changed grade on that piece (or, in a class that returns grades as soon as you save, the next save) closed the request: the student was told "returned" and could not send a revision again.

**Why.** The request remembers when the revision came in and what the grade's returned date was then. Only the student's Unsend cleared those. After the teacher's delete they were still there, so any later Return looked like a Return of the revision.

**The fix.**
- A request counts as returned by a later Return only while its revision is still in. With no revision in it reads open, whatever was returned since. The student can send again.
- Before a sent revision is deleted, by any path, its request is settled first, the way Unsend settles it: a revision whose grade was already returned is stored as done while it can still be read, so it stays returned after its photos go. This is one new trigger on `submission` (`revision_gone`, before delete, only for a sent version 2 or later; it deletes nothing and never stops the delete). It is a third table C1 adds a trigger to, beside `assessment` and `enrollment`.
- The two remembered dates are not cleared on a delete. The teacher's Replace Them on a revision deletes the student's photos a moment before the teacher's take their place; clearing there would lose when the revision came in, and a Return would then never close that request. They are read only while a revision is in, and the next send writes them again.

**Every other way a revision goes, checked:** the student's Unsend and Replace (settled first, as before); the teacher's Delete and Replace Them (the new trigger); a student withdrawn (deletes nothing; the revision stays in); a student deleted, Delete Assessment and the 30-day purge (the requests go with them, as before).

**Checks:** `revision_deleted`, 46 checks, 18 failed on `b26cf1c7`. Wrong versions: 6 new (the reviewed rule, no settle before the delete, the settle after the delete, the delete settling as a Return, only later versions settled, the dates cleared on a delete).

## F2: marks left waiting when a class stops holding grades (C2)

**What went wrong.** Work returned with a 6; the teacher then drew marks on it (waiting for the next Return). The class was switched to As Soon As I Save, or its Student Page was turned off. The marks were not given, and the teacher's screen kept saying they wait, until that page or that grade was touched again.

**Why.** Leaving When I Return Them returns only drafts. A student whose grade was already returned had no draft, so no Return happened for them, and C2's trigger never ran.

**The fix (C2 only; it still writes no grade or score row).** One more function and one trigger on `course` (`markup_given_on_release`), with the same condition as Batch A's `grade_return_release` and running after it. When a class stops holding grades, every page of that class with marks not yet given, on a piece whose grade is returned, is given, exactly as a Return gives it: while Students See Your Mark Up is off, or the piece is Missing or Excused, the student sees none, as after any Return. Another class is not touched. Entering or staying in When I Return Them gives nothing.

**Left as built, for Colin:** marks on a piece with no grade yet are not given by the switch. They go with the grade (its first save, now a Return), or at the next save of marks on that page. Giving them too would mean marks reach a student before any grade on that piece, which a class that holds grades never did. (With C1 alone, marks waiting on returned work stay waiting after the switch until `return_work` or a save of marks: C1 alone gives marks only those two ways, as before.)

**Checks:** `leave_holds`, 32 checks, with C1 alone and with C2; 8 failed on `b26cf1c7`. Wrong versions: 6 new (no trigger, every waiting mark given graded or not, every class's, on every change of the two settings, a piece not showing marks passed over, Missing passed over). `apply2` also checks the new trigger and function, and that the post-check notices the course trigger off or recreated to fire on every update.
