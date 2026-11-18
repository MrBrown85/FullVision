# Independent review: `2026111720_student_page_per_student.sql`

Reviewed at commit 69554c4f on 2026-11-17, by a reviewer who did not write it. Nothing was written to gradebook-prod; the live reads were catalog facts and counts only.

**Verdict: safe to apply as is.** No must-fix. Three should-fix items, none of which makes applying unsafe: one is wording Colin is asked to accept, one is a contract choice better settled before the app PR merges, one is in the undo.

## How it was checked

- My own throwaway PostgreSQL 17.11 (embedded-postgres), rebuilt with `scripts/db-rebuild.mjs --check`. One fingerprint over all 366 functions in `public`, `student_submit` and `fv_private` is the same there and on gradebook-prod (17.6), so the bodies read locally are live's.
- `per-student-live-precheck.sql` run read-only on gradebook-prod: no rows. All ten "before" md5s in the file's guard equal live now; the two new function names and the two columns are absent.
- `per_student.py` on my cluster: 138 of 138.
- The file applied from psql statement by statement, and whole as one message (as `apply_migration` sends it): both apply, the post-check says ok on all 17 lines, a second run changes nothing, and a guard stop leaves no column, no function and `page` at its live md5.
- The four patched functions, live body against patched body: the only differences are the lines the file names (one `when` and its comment in `_card_refusal`; one `and` in `_session_classes`; the same assignment and its comment after `select * into _course` in `page` and `feedback`). Owner, grants, `SECURITY DEFINER`, volatility and `search_path` are unchanged.
- Extra cases of my own on a copy (below, where they bear on a finding).

## Should fix

### S1. "The overall grade's inputs never leave the database" is not true for Letter and Both classes

Where: the file's header lines 61 to 64, `per-student-pr-body.md` ("Hidden means the numbers behind the overall grade never leave the database for that student"), the plan's "What the server does with them", `schema.sql`'s comment.

`student_submit.page` sends, on every listed piece and whatever Show Overall Grade says: `category_name`, `category_percent` (the category's weight, when the class is Letter or Both and its weights total 100), the piece's `weight` and `max_points`, and the returned result. The patch does not touch those lines, and should not: it is exactly what a class with the switch off sends today.

Failing case, run on a copy: a Both class with categories 60 and 40, one student set to `hide`. That student's page has no `learning` block and no `category_id`, and each piece still carries `("Tests", 60, weight 2)`. With each piece's result, its weight and its category's percent, the course percent can be worked out by hand.

What hidden does remove: the `learning` block (calculation method and settings, the full category list, folders, the learning map, the student's hand-set levels) and each piece's `category_id`, so the page cannot compute or show an overall grade.

Fix: say that in the header, the PR body and the plan ("the student gets the page a class with the switch off gets"). Whether a hidden student should also lose `category_percent` and `weight` is Colin's decision and a separate change to `page`.

### S2. One stale id refuses the whole call, so a bulk Hide or Pause can be dropped entirely

Where: `set_student_page_options`, the `if exists (… not exists (select 1 from enrollment e where e.id = x and e.course_id = p_course_id and e.withdrawn_at is null))` check. It follows the contract ("Refuses with nothing changed: … an id not an active enrollment of that class").

Failing case, run on a copy: three ids, one of them withdrawn after the list was drawn. The call raises P0002 and the other two students are not changed. In the app (`_setStudentPageOptionsLive`) a P0002 is a dead letter and only the sync dot says so. A teacher who ticks 28 students and picks Hide Overall Grade while another tab or a queued offline write has just withdrawn one of them ends with nobody hidden.

Fix, one of: the function changes the ids that are active students of the class and returns the others as `skipped`; or the app, on P0002, reloads the roster and sends the rest. The first is cheaper now than a second guarded patch later. If the refusal is kept, say so under "What you accept".

### S3. The full undo can kill another transaction with "deadlock detected"

Where: `per-student-undo.sql`, PART 2, `lock table public.enrollment in share row exclusive mode;` followed by `alter table … drop column`.

The undo takes SHARE ROW EXCLUSIVE and later asks for ACCESS EXCLUSIVE. A transaction that has read `enrollment` and then writes it in between is stuck behind the first lock while the undo is stuck behind its read.

Failing case, run on a copy: session X does `begin; select count(*) from enrollment;`, waits, then `update enrollment …`. The undo starts in between. X fails with `deadlock detected` after one second; the undo then finishes. The same X against the migration file itself is not harmed (a plain `alter table` lets X through).

Fix: `lock table public.enrollment in access exclusive mode;` in that place. The count is still taken under the lock, and nothing is upgraded.

## Notes

- **Slips and a paused student.** The header lists "open, check, submit, done" as the questionnaire slip routes. The slip routes are `open`, `verify`, `submit` (questionnaires) and `open`, `check` (a phone report's code); `done` is the card session's sign-out. None of the four asks about the student page, so a paused student can still answer a printed questionnaire slip and can still open a phone report with its code. The same holds for a class with its page off, and a phone report is also outside Show Overall Grade (through a card session `forms` and `report` do refuse a paused student). Live now: 1 live questionnaire slip, 0 live report codes, 0 open phone reports. I think this is acceptable; the PR body names the questionnaire slips and should name the report code too.
- **Every card and session route refuses.** Checked against the catalog: the 25 functions that take a session token and an enrollment all go through `_session_class`, directly or through `_send_session` (`send_start` and `replace` through `_send_begin`). `card` and `verify_card` go through `_card_lookup`, which refuses before a session is made or replaced. `done` only signs out. `_session_class` and `_card_refusal` are STABLE and read at each call, so a pause holds on the next request.
- **`form` and `answer` word it differently.** Through a card session they answer `closed` for a paused student, which the student page reads there as "These questions are closed now." Already so for a class with its page off.
- **No other student function sends roll-up inputs.** Of all 62 `student_submit` functions only `page` reads category weights, calculation settings, folders or hand-set levels, and only `page` and `feedback` read `show_my_learning`. The edge function calls only `student_submit` functions and keeps no cache; the student page keeps only its session token on the device.
- **Four teacher functions carry the whole enrollment row, not three.** `get_term_rating` also returns `to_jsonb(_enr)`. It runs as the teacher under row security, like `get_student_profile`.
- **The table itself.** `authenticated` holds update on `public.enrollment` under the `fv_owns_course` policy, so a teacher can set the two columns on their own class's rows without the function (and so without its "not withdrawn" rule). On a copy: the owner changes 1 row, another teacher 0, `anon` is denied. No more than they can already do to `withdrawn_at`.
- **Where an option is lost or comes back unseen.** `relink_student`, when both records are in the same class, keeps the surviving row's options and drops the other's. A class restored after its rows are gone comes back with no options (and with the class switch off). A withdrawn student keeps theirs, cannot be listed or changed, and has them again on re-enrolling.
- **Idempotency** follows `set_course_feedback_options` line for line: sign-in, ownership, `fv_idem_check`, checks, write, `fv_idem_store`. As everywhere, a repeated key answers the first reply whatever the new arguments are.
- **Grants.** After the file: `postgres` and `authenticated` only. The house functions also grant `service_role`; this is stricter, on purpose.
- **Dynamic SQL.** Only `execute _def`, where `_def` is the catalog's own text and must hash to a fixed md5 before it runs. No argument reaches dynamic SQL.
- **The plan is not on this branch.** `docs/plans/per-student-options-plan.md` is committed on `claude/per-student-options` (21c2177f) and untracked here; the header and PR body cite it. It will be missing from `main` between the two merges.
- **Outside this file.** Live has a publication `zero_data` for all tables. Nothing reads it (the only two replication slots are Supabase Realtime's own), and `enrollment` is not in `supabase_realtime`. The new columns join `zero_data` like every other column.

## The seven guarantees

1. Privacy: holds as "the same page as a class with the switch off" (S1). `show` overrides a class that is off; `class` follows the class; `feedback` sends the student's value.
2. Paused: holds for every card scan and all 25 session routes, mid-session, and `_session_classes` leaves the class out. Slips do not ask (first note).
3. Teacher functions: owner only, no other class's or withdrawn enrollment, `anon`, `public` and `service_role` cannot run them, idempotent, refusals are raised errors that change nothing, at most 500 ids, `search_path` pinned. S2 is about what a refusal costs.
4. Patch: guards first, counted replace, md5 before and after, one transaction, 5 s lock timeout, re-runnable, nothing else in the four functions changes. The pre-check's fingerprints match live now.
5. Existing paths: every insert into `enrollment` names its columns; no view reads it; no student function copies a row; an option change moves the class's sync cursor through the existing trigger.
6. Undo: PART 1 puts the four functions back byte for byte and keeps the choices; PART 2 refuses while a choice is set and otherwise leaves the catalog as before. S3 is its lock.
7. Size: 22,493 bytes; applied whole as one message.
