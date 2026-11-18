## Per-student options: the database half (not applied)

Colin's ask, Nov 17: "i should be able to show/hide grades for individual students, thiings like that." This PR is the database part of `docs/plans/per-student-options-plan.md`. The app part (Class Settings › Student Page, Layout A) is a separate PR that merges after this is applied.

**Nothing changes for any student until a teacher sets an option.** No existing row is changed.

### What each file does

- `migrations/2026111720_student_page_per_student.sql` (22 KB, small enough to send whole through Supabase's `apply_migration`):
  - Adds two empty columns to each student's class enrolment: **Show Overall Grade** for this student (empty means "same as the class", or shown, or hidden) and **Page Paused** (empty means open, or the time it was paused). No reason is stored.
  - Adds two functions only the class's own teacher can use: one to change the options for up to 500 students at once, one to list the students who have an option set.
  - Changes four student-page functions, each checked word for word against what live has before it touches it:
    - A paused student's card is refused with the same message a class with its page off gets ("The student page is turned off for this class. Ask your teacher."). This covers every card scan and every page request, so a page already open stops on its next request.
    - A paused student's class is left out of the card sign-in's class list.
    - The student page and the feedback page use the student's own Show Overall Grade when it is set, and the class's otherwise. Hidden means the numbers behind the overall grade never leave the database for that student; each assignment's own result and feedback still show, exactly as when the class switch is off.
- `migrations/local-test/per-student-live-precheck.sql`: one read-only query that lists anything on live that differs from what the file was tested against. No rows means ready.
- `migrations/local-test/per-student-live-postcheck.sql`: one read-only query to run after the apply; every row should say ok.
- `migrations/local-test/per-student-undo.sql`: the way back, in two parts.
  - Part 1, the fast stop: puts the four student functions back exactly as they were. Every student sees what they saw before; the teachers' choices are kept and do nothing until the file is run again.
  - Part 2, full removal: drops the two functions and the two columns. It refuses while any student has an option set, because that would delete teachers' choices.
- `migrations/local-test/per_student.py`: the test script. `schema.sql` and `migrations/local-test/README.md` describe the change.

### What it does to existing rows

Nothing. Both columns start empty on every row, which is how every student page behaves today.

### Results

- Tested on a throwaway PostgreSQL 17.11 rebuilt from the repo and proven equal to live (all 366 functions match gradebook-prod's fingerprints): **138 of 138 checks pass**.
- With no option set, 54 student answers (25 page requests, the card scan and the sign-in, for two students) are byte for byte the same as before the file.
- A paused student's card scan, sign-in and all 25 page requests (on a page opened before the pause) answer "closed"; classmates are unaffected; opening again gives every answer back.
- Hidden: the page carries no overall-grade inputs and is byte for byte the page that student gets with the class switch off, while a classmate's still carries them. Show overrides a class that is off. Same as Class follows the class.
- Another teacher, a signed-out caller, a visitor (`anon`) and the edge functions' role cannot use the new functions. 18 kinds of bad request are refused with nothing changed. Sending the same request twice changes nothing the second time.
- No student answer contains the new columns. Two requests on the same students at once wait for each other, with no deadlock.
- The undo leaves the database as it was (apart from two empty dropped-column slots, which PostgreSQL keeps).
- The pre-check, run read-only on gradebook-prod on Nov 17, returned no rows.

### How to apply

1. Run `per-student-live-precheck.sql` read-only. It must return no rows.
2. Apply `migrations/2026111720_student_page_per_student.sql` whole through Supabase's `apply_migration`. It is one transaction: it applies completely or not at all, and if live is not what it was tested against it stops with nothing changed.
3. Run `per-student-live-postcheck.sql`. Every row should say ok.
4. Refresh `docs/schema.generated.sql` and the baseline from live, then merge the app PR.

### What you accept by applying this

- When a teacher pauses a student, that student's card stops working at once for that class, mid-session too, until the teacher opens it again. Printed questionnaire slips are not cards and still work, as they do for a class with its page off.
- A teacher's choice stays when a student is withdrawn and re-enrolled. A class restored from a backup comes back with every student on the class's setting.
- The teacher's own class data (the class bundle and the student profile) now carries the two values for each student. Students never get them.
- Each option change counts as a change to the class, so the teacher's other open devices reload the class, as they do after any roster change.
- Removing the columns later deletes the choices, so the undo refuses until they are cleared. Part 1 of the undo stops every effect on students without deleting anything.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
