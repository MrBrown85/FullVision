## Per-student options: the database half (applied)

**APPLIED to gradebook-prod on 2026-11-17 on Colin's OK; post-check all ok.** Applied through Supabase's `apply_migration` as `student_page_per_student`. This PR records it: the migration, its tests, and the schema snapshot, baseline and types refreshed from live.

Colin's ask, Nov 17: "i should be able to show/hide grades for individual students, thiings like that." This PR is the database part of `docs/plans/per-student-options-plan.md`. The app part (Class Settings › Student Page, Layout A) is a separate PR that can merge now that this is applied.

**Nothing changes for any student until a teacher sets an option.** No existing row is changed.

### What each file does

- `migrations/2026111720_student_page_per_student.sql` (23 KB, small enough to send whole through Supabase's `apply_migration`):
  - Adds two empty columns to each student's class enrolment: **Show Overall Grade** for this student (empty means "same as the class", or shown, or hidden) and **Page Paused** (empty means open, or the time it was paused). No reason is stored.
  - Adds two functions only the class's own teacher can use: one to change the options for up to 500 students at once, one to list the students who have an option set. In a change for many students, an id that is no longer a student of the class (withdrawn since the list was drawn, say) is skipped and named back; the rest still change.
  - Changes four student-page functions, each checked word for word against what live has before it touches it:
    - A paused student's card is refused with the same message a class with its page off gets ("The student page is turned off for this class. Ask your teacher."). This covers every card scan and every page request, so a page already open stops on its next request.
    - A paused student's class is left out of the card sign-in's class list.
    - The student page and the feedback page use the student's own Show Overall Grade when it is set, and the class's otherwise. Hide sends exactly what the class switch off sends: the overall grade is not sent; each assignment's result, weight and category percent still go, as they do today with the class switch off.
- `migrations/local-test/per-student-live-precheck.sql`: one read-only query that lists anything on live that differs from what the file was tested against. No rows means ready.
- `migrations/local-test/per-student-live-postcheck.sql`: one read-only query to run after the apply; every row should say ok.
- `migrations/local-test/per-student-undo.sql`: the way back, in two parts.
  - Part 1, the fast stop: puts the four student functions back exactly as they were. Every student sees what they saw before; the teachers' choices are kept and do nothing until the file is run again.
  - Part 2, full removal: drops the two functions and the two columns. It refuses while any student has an option set, because that would delete teachers' choices. It takes the table's strongest lock first, so it cannot deadlock a teacher's save that is running at the same moment.
- `migrations/local-test/per_student.py`: the test script. `schema.sql` and `migrations/local-test/README.md` describe the change.

### What it does to existing rows

Nothing. Both columns start empty on every row, which is how every student page behaves today.

### Results

- Tested on a throwaway PostgreSQL 17.11 rebuilt from the repo and proven equal to live (all 366 functions match gradebook-prod's fingerprints): **149 of 149 checks pass**.
- With no option set, 54 student answers (25 page requests, the card scan and the sign-in, for two students) are byte for byte the same as before the file.
- A paused student's card scan, sign-in and all 25 page requests (on a page opened before the pause) answer "closed"; classmates are unaffected; opening again gives every answer back.
- Hidden: the page has no overall grade and is byte for byte the page that student gets with the class switch off, while a classmate's still has it. Show overrides a class that is off. Same as Class follows the class.
- Another teacher, a signed-out caller, a visitor (`anon`) and the edge functions' role cannot use the new functions. 19 kinds of bad request are refused with nothing changed. An id that is not a student of the class (another teacher's, another class's, withdrawn, in the trash, or made up) is skipped, changes nothing, and gets the same reply whichever it is. Sending the same request twice changes nothing the second time.
- No student answer contains the new columns. Two requests on the same students at once wait for each other, with no deadlock.
- The undo leaves the database as it was (apart from two empty dropped-column slots, which PostgreSQL keeps). The review found its first lock could deadlock a save running at the same moment; the test reproduces that with the old lock and shows the new one does not.
- The pre-check, run read-only on gradebook-prod on Nov 17, returned no rows.

### How it was applied

1. `per-student-live-precheck.sql`, run read-only: no rows.
2. The file applied whole through Supabase's `apply_migration` (one transaction).
3. `per-student-live-postcheck.sql`: all 17 rows ok.
4. `docs/schema.generated.sql`, `migrations/baseline/` and `types/database.d.ts` refreshed from live in this PR. The app PR can merge after this one.

### What you accepted by applying this

- When a teacher pauses a student, that student's card stops working at once for that class, mid-session too, until the teacher opens it again. What a paused student can still reach is what a class whose page is off already allows: a questionnaire slip already printed, and a phone report's single-use code (on Nov 17 live had 1 live slip and 0 live report codes).
- Hide takes away the overall grade, not the pieces behind it: in a Letter or Both class each assignment still shows its result, weight and category percent, as with the class switch off today, so a student could still work the percent out by hand. Hiding those too would be a separate change.
- A teacher's choice stays when a student is withdrawn and re-enrolled. A class restored from a backup comes back with every student on the class's setting.
- The teacher's own class data (the class bundle, the student profile and the term rating) now carries the two values for each student. Students never get them.
- Each option change counts as a change to the class, so the teacher's other open devices reload the class, as they do after any roster change.
- Removing the columns later deletes the choices, so the undo refuses until they are cleared. Part 1 of the undo stops every effect on students without deleting anything.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
