# Batch C: the contract

What the database gives the edge routes (`reflect`, `reply`, the Mark Up, revision and group reads) and the browser (`S9-W1` to `S13`) to code against, once `migrations/2026111120_markup_reflect_revise.sql` (C1) is applied, and what changes when `migrations/2026111121_markup_revise_grade_changes.sql` (C2) is. Written from the SQL in this pull request; `migrations/local-test/batch_c.py` checks every shape and refusal below.

Batch C applies only after Batch B (`2026111101`, `2026111102`), and builds on its contract (`batch-b-contract.md` on the `batch-b-submissions` branch). If you must depart from anything here, add a dated line under "Changes" at the bottom.

## The settled rules

- Mark Up is drawing data over a page, never burned in. The teacher's copy (`working`) is never sent to a student. The student's copy (`given`) is set only when the work is returned.
- A class that holds grades (Student Page on and When I Return Them) gives marks when the work is returned. Any other class gives them as soon as they are saved, as it does grades.
- A student sees no marks on a piece set not to show them (Students See Your Mark Up off), or while Missing or Excused is on it.
- A revision is the next version of the piece's submission: version 2, then 3. Version 1 and its pages stay. The revision is graded in the same score rows; while the new grade is a draft the student keeps the old one; when it is returned it replaces the old one. The first version's grade is kept on the request as history (Before and After).
- Students write their own words in a reflection; the teacher cannot change them. A teacher's answer reaches the student once it is sent.
- Group work (One per Group) is the groups the teacher made on the assessment (Pairs or Groups). Each member who sends makes their own submission; the group's work is all of them together. No function sends a student another student's name, or another student's enrollment id as a field (a group-mate's page path, turned into a link, carries that student's enrollment id: an opaque id, never a name).
- Every function takes the class's lock before it writes, and asks for a remembered answer under it.

## Class settings

`set_course_feedback_options(p_course_id uuid, p_patch jsonb, p_idempotency_key uuid)`

`p_patch`: any of `{ "reflect_on_feedback": true, "show_my_learning": true }`. Only what it names is written. Returns `{ "reflect_on_feedback", "show_my_learning" }`. Both are columns of `course`, so `get_class_bundle` sends them. Both start off.

Students See Your Mark Up is Batch B's `assessment.students_see_markup` (`set_assessment_student_work`). Group Work is Batch B's `assessment.group_work`.

## The teacher's side: `public` RPCs

Signed-in teachers. Each checks the caller owns the class. RAISE `PT401` (not signed in), `P0002` (not found, or not yours), `22023` (a wrong shape). A state the screen could not have known is an answer, not an error; only the answers named "remembered" are kept under the key.

### `save_markup(p_file_id uuid, p_marks jsonb, p_base_rev integer, p_idempotency_key uuid)`

`p_marks`: `{ "v": 1, "marks": [ … ] }`, at most 500 marks and 256 KB. A mark is an object whose `type` is `pen`, `highlight`, `note`, `tick` or `cross`; a `note` has a `text` of 1 to 500 characters. Everything else on a mark (position, colour, points) is kept as sent. The Eraser removes marks from the list; it is not a mark. Send the whole page's marks each time.

`p_base_rev`: the `rev` the screen last read (0 for a page with no marks), or null to skip the check.

| `result`  | Meaning                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `saved`   | `{ result, file_id, rev, given }`. Remembered. `given` is true when the student already has these marks (a class that does not hold grades). |
| `changed` | Another device saved since `p_base_rev`. `{ result, file_id, rev, marks }`: what is there now. Nothing written; not remembered.              |

`P0002` for a page that is not handed in (a send not finished, an upload not finished), not the teacher's, or gone.

### `list_assessment_markup(p_assessment_id uuid)`

`[ { file_id, enrollment_id, rev, marks, saved_at, given, given_rev, given_at, waiting } ]`. `waiting`: the student has not been given the latest marks.

### `return_work(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid)`

Use in place of `return_grades` wherever Mark Up can be on screen (Return, Return and Next, Return N Graded). It runs `return_grades` unchanged, then gives each listed student of the class the marks on their pages of the piece. Returns `return_grades`' answer plus `marks_given` (pages) and `marks_enrollment_ids`. Remembered. A student whose grade is not a draft but whose marks changed is given the marks (the To Return count should count marks waiting, from `list_course_feedback`).

Until C2 is applied, a Return through `return_grades` alone (an older screen), a class leaving When I Return Them, or a restore returns grades but not marks.

### `return_for_revision(p_assessment_id uuid, p_enrollment_id uuid, p_request jsonb, p_idempotency_key uuid)`

`p_request`: `{ "what_to_fix": "…" (1–2000, required), "revise_by": "YYYY-MM-DD" | null, "criterion_ids": [ … ] (criteria of the piece's rubric), "keep_grade": true | false }`.

The work is returned first, exactly as `return_work` returns it; then the request is made.

| `result`             | Meaning                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `made`               | `{ result, request, returned, hidden }`. Remembered. `returned` is `return_work`'s answer. `hidden`: the grade was hidden (C2, keep_grade false). |
| `already_open`       | An open request exists for the student and piece. `request` is it.                                                                                |
| `hide_not_available` | `keep_grade` false and C2 is not applied. Nothing changed.                                                                                        |
| `hide_needs_holding` | `keep_grade` false in a class that does not hold grades (a hidden grade is a draft, and such a class shows none). Nothing changed.                |
| `not_for_dibels`     | A DIBELS benchmark.                                                                                                                               |

`P0002` for another teacher's piece, a student of another class, a withdrawn student.

A request (`request`, and each item of `list_course_feedback.revisions`):

```json
{
  "id": "…",
  "assessment_id": "…",
  "enrollment_id": "…",
  "what_to_fix": "Add a third reason from Bourassa.",
  "revise_by": "2026-11-10",
  "criterion_ids": [],
  "keep_grade": true,
  "grade_hidden": false,
  "first_submission_id": "…",
  "first_version": 1,
  "first_grade": { "v": 1, "value": 2, "modifier": 1, "comment": "…", "tags": {}, "criteria": {}, "checks": [] },
  "first_returned_at": "…",
  "created_at": "…",
  "updated_at": "…",
  "closed_at": null,
  "state": "open",
  "revision_submission_id": null,
  "revision_version": null,
  "revision_sent_at": null,
  "revision_note": null,
  "revision_late": null,
  "revision_sent_by": null
}
```

`state`: `open` (no revision in), `sent` (in, grading not started), `grading` (the grade changed since it came in), `returned` (a grade was returned after it came in), `cancelled`. Read live from the submissions and `grade_return`, so a grade saved by any path is read right. `first_grade` is the raw copy: "Was Developing + on the Oct 30 version".

### `set_revision_request(p_request_id uuid, p_patch jsonb, p_idempotency_key uuid)`

`p_patch`: any of `what_to_fix`, `revise_by`, `criterion_ids`. Keep or Hide is not changed here. Answers `saved` (remembered) or `not_open`.

### `cancel_revision(p_request_id uuid, p_idempotency_key uuid)`

Take Back. A revision already sent stays as a later version. With C2, a hidden grade is given back exactly as the student had it (a change the teacher made since waits as a draft on it). Answers `cancelled` with `unhidden` (remembered) or `not_open`.

### `answer_reflection(p_reflection_id uuid, p_answer text, p_idempotency_key uuid)`

Send Answer, 1 to 2000 characters. Answers what is waiting: the question (or, with none, the reflection), then the follow-up. Answers `answered` with the reflection (remembered) or `already_answered`.

### `list_course_feedback(p_course_id uuid)`

```json
{
  "course": { "reflect_on_feedback": true, "show_my_learning": false },
  "markup": [ { "file_id", "assessment_id", "enrollment_id", "rev", "given_rev", "given_at", "waiting" } ],
  "revisions": [ request, … ],
  "reflections": [ { "id", "assessment_id", "enrollment_id", "makes_sense", "question", "plan", "went_well", "sent_at",
                     "answer", "answered_at", "sense_now", "sense_now_at", "follow_up", "follow_up_answer",
                     "follow_up_answered_at", "waiting" } ]
}
```

`waiting` on a reflection: a question or follow-up has no answer. It is what the dashboard's Questions From Students, the gradebook's mark and the profile's mark count; one answer clears all three. Nothing here moves the class's sync cursor: read it when the screens open.

## The student's side: `student_submit` functions

Service role only. Each takes the caller's hashed address last (unused). A wrong shape RAISES `22023`; everything a student can cause is `{ "ok": false, "error": "<code>" }`. Session errors as Batch B's: `signed_out`, `not_found`, `card_stopped`, `card_expired`, `closed`; the writes (`reflect`, `reply`, `revision_*`) also `card_locked`.

### `feedback(p_session_token text, p_enrollment_id uuid, p_ip_hash text)`

Read-only. For the student's page, beside `page` and Batch B's `work`:

```json
{
  "ok": true, "v": 1,
  "reflect_on_feedback": true, "show_my_learning": false,
  "assessments": [
    { "id": "…",
      "marks": { "pages": 1, "notes": 3 },
      "revision": { "state": "open", "what_to_fix": "…", "revise_by": "…", "criterion_ids": [], "keep_grade": true,
                    "grade_hidden": false, "first_version": 1, "first_sent_at": "…", "first_grade": { … },
                    "revision_version": null, "revision_sent_at": null, "revision_note": null, "revision_late": null,
                    "asked_at": "…" },
      "reflection": { "makes_sense": "not_sure", "question": "…", "plan": null, "went_well": null, "sent_at": "…",
                      "answer": "…", "answered_at": "…", "sense_now": null, "follow_up": null,
                      "follow_up_answer": null, "follow_up_answered_at": null } }
  ],
  "last_plan": { "assessment_id": "…", "plan": "…", "sent_at": "…" }
}
```

- Lists only pieces on the page that have marks given, a revision asked, or a reflection.
- `marks`: pages carrying given marks and how many are notes ("3 notes on your work"), the student's and their group's. Null before the work is returned with marks.
- `revision.first_grade`: the first version's grade as the student had it, cut to what the work's scoring uses now (as `page` cuts grades). Null while the grade is hidden, or Missing or Excused is on the piece. The new grade is `page`'s.
- `last_plan`: Your Plan From Last Time for the next send's "Did You Do It?" (Batch B's `followed_plan`).
- `show_my_learning`: the My Learning tab shows grades only when true. Its numbers come from `page`'s returned grades through `calc.js`.

### `markup(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)`

`{ "ok": true, "files": [ { "file_id", "marks", "given_at" } ] }`: the given marks on the student's pages and their group's. The page images come from Batch B's `file_links` (or `group_file_links`). Empty when the piece hides marks or Missing or Excused is on it. `not_found` for another class's piece.

### `reflect(…, p_assessment_id uuid, p_reflection jsonb, …)`

`p_reflection`: `{ "makes_sense": "yes" | "not_sure", "question": "…", "plan": "…", "went_well": "…" }`. `not_sure` needs a question; `yes` needs a plan; each 1000 characters at most. Sent again before the teacher answers, it takes the place of the first; the same reflection twice is the same. Errors: `reflect_off`, `not_found` (not the class's, or not yet on the page), `not_returned` (no grade has been returned for the piece), `already_answered`. Returns `{ ok, reflection }`.

### `reply(…, p_assessment_id uuid, p_reply jsonb, …)`

`p_reply`: `{ "sense_now": "yes" | "not_sure", "follow_up": "…" }` (follow_up only with not_sure, once, 1000 at most). Errors: `not_found`, `not_answered`, `already_asked`.

### `revision_start(p_session_token, p_enrollment_id, p_assessment_id, p_pages jsonb, p_note text, p_request_id uuid, p_ip_hash)`

### `revision_finish(p_session_token, p_enrollment_id, p_submission_id uuid, p_files jsonb, p_ip_hash)`

### `revision_unsend(p_session_token, p_enrollment_id, p_assessment_id, p_ip_hash)`

Send My Revision, as Batch B's `send_start`, `send_finish` and `unsend`, with the same shapes, paths, upload links, two-hour hold, twenty-an-hour limit (shared with Batch B's sends) and replay by request id. `revision_start` also answers `version`.

- `revision_start` errors: Batch B's (`send_off`, `not_found`, `not_taking_work`, `expired`, `too_many`, `class_full`), plus `no_revision` (no open request) and `grading_started` (the revision in is being graded or was returned). Revise By does not close it; a revision sent after it is `late`.
- `revision_finish` errors: Batch B's (`not_found`, `send_off`, `not_taking_work`, `expired`, `missing_pages`, `bad_file`), plus `no_revision` and `grading_started` (the pages are dropped), and `cannot_change` (the revision in was added by the teacher).
- Sent again before grading starts, a revision takes the place of the one in (the student's pages go, for good; pages the teacher added move to the new one).
- `revision_unsend`: `{ ok, unsent, cancelled, pages }`. THE PHOTOS ARE DELETED. Errors `grading_started`, `cannot_change`.

**The edge function must route a revision to these.** Batch B's `send_start` answers `already_sent` for a piece with work in; Batch B's `send_finish` on a revision's send answers `already_sent` and drops it; Batch B's `unsend` and `replace` on a piece with a revision in answer `grading_started` (the first version's grade was returned). Nothing is lost by a wrong route; it is refused. Batch B's `work` lists a revision's unfinished send as that piece's `sending`, and a revision handed in as its `sent` (the latest version): tell them apart with `feedback`'s `revision`. A wrong request id is the caller's bug: one Batch B's `send_start` used before is answered by `revision_start` as a replay of that send.

### `group_work(p_session_token, p_enrollment_id, p_ip_hash)`

`{ "ok": true, "assessments": [ { "id", "members": 3, "sent": true, "pages": 4, "you_sent": false, "first_sent_at": "…" } ] }` for each piece on the page set to One per Group that the student's group is on. No names. ("Sent by Leo for the group" needs a name: see the PR's decisions.)

### `group_file_links(p_session_token, p_enrollment_id, p_assessment_id, p_ip_hash)`

Batch B's `file_links` for the group: every member's handed-in pages, each with `mine`. For a piece that is not group work, the student's own only. Make links for these paths and no others.

Add a Page on a group piece is the member's own Batch B `send_start` (their own submission; their own Unsend takes only theirs).

## What `student-submit` does on each route

| Route           | SQL                                                                               |
| --------------- | --------------------------------------------------------------------------------- |
| `page`          | `page`, Batch B's `work`, and `feedback` (and `group_work`)                       |
| `reflect`       | `reflect`                                                                         |
| `reply`         | `reply`                                                                           |
| `markup`        | `markup`                                                                          |
| `revise-start`  | `revision_start`, then upload links as `send-start`                               |
| `revise-finish` | the file checks as `send-finish`, then `revision_finish`, then the removal worker |
| `revise-unsend` | `revision_unsend`, then the removal worker                                        |
| `group-links`   | `group_file_links`, then download links as `file-links`                           |

Copy each reply field by field, as the card routes do.

## What C2 changes (when applied)

- `return_for_revision` with `keep_grade: false` hides the grade: the student's `grade_return` row becomes a draft never returned (the student page and every report count nothing for it); the teacher sees a draft. `cancel_revision` gives it back. Returning the new version's grade ends the hide. A class leaving When I Return Them returns it, as any draft.
- Every Return, by any path, gives the marks on that piece (a trigger on `grade_return`). `return_work` stays the call to use.

## Changes

None yet.
