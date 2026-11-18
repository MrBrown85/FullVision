# Per-student options on the Student Page tab

Colin, Nov 17 2026: "More options in 'manage cards' for teachers. As of now, they have none. … i should be able to show/hide grades for individual students, thiings like that." He chose Layout A (Student List and Side Panel) from the mockup https://claude.ai/artifact/QdCnUwwVGYb4ncaq4Y9UKL ("finish jobs", relayed by the orchestrating session as go-ahead for the recommendation).

Two PRs:

1. **Migration** (`migrations/2026111720_student_page_per_student.sql`, branch `claude/per-student-options-migration`). Tested locally on PostgreSQL 17, independently reviewed, shown to Colin, applied only on his OK, then pushed once with the live schema snapshot.
2. **App** (branch `claude/per-student-options`). Merges after the migration is applied, because the drift check fails on an RPC the database does not have yet.

## The contract

### Columns on `enrollment`

| Column               | Type          | Meaning                                                                                                                                     |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `show_overall_grade` | `boolean`     | null: follow the class's Show Overall Grade (`course.show_my_learning`). true: shown for this student. false: hidden for this student.      |
| `page_paused_at`     | `timestamptz` | null: the student's card opens their page. Set: paused since then; no card of theirs opens anything, and a page already open stops at once. |

No reason is stored for either (privacy: a reason would hold sensitive notes).

### What the server does with them

- `student_submit._card_refusal(card)`: a paused enrollment is refused as `'closed'`, the code a class with its page off already gets. Every card scan (`_card_lookup`) and every session route (`_session_class`, and `_send_session` through it) goes through this one function, so a pause takes effect on the next call, mid-session too. The student reads "The student page is turned off for this class. Ask your teacher." No edge function or student page change: `closed` is already in both whitelists.
- `student_submit._session_classes(session)`: leaves out a paused enrollment, as it leaves out a class whose page is off.
- `student_submit.page` and `student_submit.feedback`: everywhere they read `_course.show_my_learning`, they read the student's effective value instead, `coalesce(enrollment.show_overall_grade, course.show_my_learning)`. The key sent stays `show_my_learning`. Hide sends exactly what the class switch off sends: the overall grade is not sent (no My Learning block, no piece's `category_id`); each piece's result, `weight` and `category_percent` still go, as they do today with the class switch off.

### Teacher RPCs (new)

`set_student_page_options(p_course_id uuid, p_enrollment_ids uuid[], p_show_overall_grade text, p_paused boolean, p_idempotency_key uuid) returns jsonb`

- `p_show_overall_grade`: `'class'` (null), `'show'` (true), `'hide'` (false), or null for no change.
- `p_paused`: true pauses (sets `page_paused_at` to now() when not already set), false opens (clears it), null for no change.
- An id that is not an active enrollment of that class (withdrawn, gone, or another class's) is skipped: nothing changes for it, and it comes back in `skipped`, which says nothing more about it.
- Refuses with nothing changed: a class the caller does not own, no ids, a null id, more than 500 ids, both changes null, an unknown `p_show_overall_grade`, or no id left once the skipped ones are taken out.
- Idempotent through `fv_idem_check` (a repeat with the same key returns the first answer).
- Returns `{ ok: true, options: [{ enrollment_id, show_overall_grade, paused_at }], skipped: [enrollment_id] }`: `options` for the active students given (in class-list order), `skipped` for the rest (in the order given). `show_overall_grade` is the word, `'class'`, `'show'` or `'hide'`; `paused_at` is the time or null.

`list_student_page_options(p_course_id uuid) returns jsonb`

- `{ ok: true, options: [{ enrollment_id, show_overall_grade, paused_at }] }`: every active enrollment of the class with either set. Owner only.

Both granted to `authenticated` only (never `anon`), following the pattern of `set_course_feedback_options`.

### The app

- Data: `getStudentPageOptions(cid)`, `loadStudentPageOptions(cid)`, `setStudentPageOptions(cid, studentIds, change)` (`change`: `{ show_overall_grade: 'class'|'show'|'hide' }` and/or `{ paused: boolean }`), through the outbox with an idempotency key. Demo Mode keeps them on the device with the sample class. Signed in, if `list_student_page_options` does not exist yet, the options are not offered (nothing drawn, nothing sent).
- `effectiveShowOverallGrade(cid, sid)`: what Preview as Student and the student view use, so Preview shows exactly what one student sees.
- Class Settings › Student Page (Layout A):
  - Show Overall Grade's row adds a line naming the exceptions ("Hidden for Jordan and Priya", "Shown for Liam" when the class is off). It is a button: it narrows the list to Exceptions and brings the list into view.
  - The card list becomes **Students**: filters All, Feedback Not Opened, Questions, Exceptions, Not Printed, Locked, Never Opened (with counts, coloured only when they hold any); columns Student, Card, Status (today's status words), Feedback Opened ("12 of 14"), Work Sent ("5 · 1 late"), Overall Grade (Shown · Class, Hidden · Class, Hidden, Shown, Page Paused). Unlock stays on a locked row.
  - A row opens a side panel (about 200 ms slide, Escape closes, focus goes back to the row): the student's name and when they last opened their page; Preview as <first name>; **What <first name> Sees**: Overall Grade (Same as Class (Shown), Show, Hide) and Student Page (Open, Paused), each with a sentence saying what it does; **What <first name> Has Done**: Feedback Opened with the returned pieces not opened yet, Work Sent and late, Reflections answered, Questions waiting; **Card**: the card, its status and last day, Print New Card, Unlock.
  - Tick rows for a bar: Hide Overall Grade, Show Overall Grade, Same as Class, Pause Pages, Open Pages, Print New Cards (asks first), Clear.
  - Every option change shows a toast with Undo for about 5 seconds.
  - Manage Cards keeps its name and brings the Students list into view.
