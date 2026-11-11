# Batch B: the contract

What the database gives the edge routes (`S5-F4`) and the browser (`S5-W1`, `S6-W1`, `S7-W1`) to code against, once `migrations/2026111101_student_work_submissions.sql` and `migrations/2026111102_student_work_storage.sql` are applied. Written from the SQL as it is in this pull request; `migrations/local-test/submissions.py` checks every shape and refusal below.

If you must depart from anything here, add a dated line under "Changes" at the bottom saying what and why.

## The settled rules

- A page of student work is always a JPEG, 2 MB at most, with a thumbnail beside it. A PDF never reaches the server: the browser turns each page into a JPEG (DECISIONS, "Student page build answers" 2).
- One private bucket, `student-photos`.
- A submission holds 1 to 30 pages.
- A card can start 20 sends an hour (send-start and replace both count; a refusal and a repeat of the same request do not).
- Nothing is handed in until every page and every thumbnail is in storage. The database checks this itself, in storage's own table.
- Unsend and Replace: only the student's own send, only while the piece is open, only until grading starts. **Grading has started** when the piece holds a draft or a returned grade for that student (a level, points, a tick, or an Overall Comment). A Late, Missing or Excused mark alone is not grading.
- Whether a piece is open, and whether a send is late, is judged by the class's own date (its time zone) when the send **starts**.
- No function here reads or writes a grade.

## Storage

|                       |                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Bucket                | `student-photos`, private                                                                                |
| Size limit            | 2,097,152 bytes a file (the browser's own limit is 2,000,000)                                            |
| Type                  | `image/jpeg` only. The Storage service checks the upload's `Content-Type`, not its bytes                 |
| Page path             | `<course id>/<assessment id>/<enrollment id>/<submission id>/<file id>.jpg`                              |
| Thumbnail path        | the same with `-thumb.jpg`                                                                               |
| Who names a path      | the database, in `send_start`, `replace` and `start_work_upload`. Nobody else. Every id is a server UUID |
| A path never changes  | `<submission id>` is the submission the page was first made for; a page added later keeps its path       |
| Upload link lifetime  | two hours (Supabase's, not ours). A send not finished within two hours of its start answers `expired`    |
| Who can delete a file | the service key, through the Storage API, for paths the removal queue hands out. Nobody else, and no SQL |

Policies on `storage.objects`, for this bucket: a signed-in teacher can **read** any file under a class they own, and **write** exactly the paths of an upload they started with `start_work_upload` and have not finished. Nothing lets a teacher's browser change, move or delete a file. Nobody who is not a signed-in teacher gets past row security. The service key passes row security.

## The student's side: `student_submit` functions

Service role only. The schema is not served by the API. Each returns `jsonb`. Each takes the caller's hashed address last, as `page` does (unused here). A wrong **shape** is the caller's bug and RAISES `22023` with nothing changed; everything a student can cause is answered `{ "ok": false, "error": "<code>" }`.

Session errors, from any of them: `signed_out` (no such session, past midnight, after Done), `not_found` (that enrollment is not in this session, the student is withdrawn, the class is deleted), `card_stopped`, `card_expired`, `closed` (the class's Student Page is off). The four that send or change work also answer `card_locked`.

### `work(p_session_token text, p_enrollment_id uuid, p_ip_hash text)`

What the page shows about sending. Read-only.

```json
{
  "ok": true,
  "v": 1,
  "send_work": true,
  "assessments": [
    {
      "id": "<assessment id>",
      "students_send": "photos",
      "open": true,
      "closes_on": "2026-11-13",
      "late_now": false,
      "sent": {
        "submission_id": "<id>",
        "sent_at": "2026-11-05T17:41:09.12+00:00",
        "sent_by": "student",
        "on_paper": false,
        "is_late": false,
        "note": "I was away Thursday.",
        "pages": 2,
        "grading": false,
        "can_change": true
      },
      "sending": null
    }
  ]
}
```

- Lists each assessment that is on the student's page (its date has come, or it has none) and either takes work or has work in. Same order as `page`.
- `students_send`: `nothing`, `photos` or `photos_files`. The last means the page may also offer a PDF.
- `open`: work can be sent right now (Send Work on, the piece takes work, today is not past its last day). `closes_on`: the last day, or null. `late_now`: a send started now would be marked late.
- `sent`: null, or what is handed in. `sent_by` is `student` or `teacher` (Add Work, Handed In on Paper). `grading`: grading has started. `can_change`: Unsend and Replace would be accepted now.
- `sending`: null, or a send of this student's that is not finished: `{ submission_id, intent: "new" | "replace", started_at, pages }`.
- A draft on a piece with nothing sent shows nowhere: `sent` is null and nothing else differs.

### `send_start(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb, p_note text, p_followed_plan text, p_request_id uuid, p_ip_hash text)`

### `replace(` the same arguments `)`

Make the rows and name the paths. `replace` is for a piece the student has already sent: what was sent stays, whole, until the new pages are finished.

- `p_pages`: a list of 1 to 30 objects, one per page in order, each `{ "width": 1500, "height": 2000 }` (whole numbers 1 to 20000, either may be left out).
- `p_note`: null, or up to 1000 characters. `p_followed_plan`: null, `yes`, `partly` or `no`.
- `p_request_id`: required. The same id again returns the same submission and paths with `"replayed": true`, makes nothing and counts nothing.

```json
{
  "ok": true,
  "replayed": false,
  "submission_id": "<id>",
  "state": "sending",
  "bucket": "student-photos",
  "late": false,
  "files": [
    {
      "file_id": "<id>",
      "page": 1,
      "path": "<course>/<assessment>/<enrollment>/<submission>/<file>.jpg",
      "thumb_path": "…-thumb.jpg"
    }
  ]
}
```

On a replay after the work was handed in, `state` is `sent` and `files` is empty.

| Error                            | When                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `send_off`                       | Send Work is off for the class                                                                   |
| `not_found`                      | the assessment is not this class's, or its date has not come                                     |
| `not_taking_work`                | Students Send is Nothing                                                                         |
| `work_closed`, with `closed_on`  | today is past the last day                                                                       |
| `already_sent`                   | `send_start` only: work is already handed in for the piece                                       |
| `nothing_sent`                   | `replace` only                                                                                   |
| `cannot_change`                  | `replace` only: what is in was added by the teacher                                              |
| `grading_started`                | `replace` only                                                                                   |
| `too_many`, with `retry_after_s` | twenty sends in the last hour for this card                                                      |
| RAISES `22023`                   | no request id, no assessment, pages not a list of 1 to 30 objects, a bad width or height, a note |
|                                  | over 1000 characters, a `followed_plan` that is none of the three                                |

A send of the student's own for the same piece that was started and never finished is dropped when a new one starts.

### `send_finish(p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_files jsonb, p_ip_hash text)`

Hand the work in. `p_files`: the pages to hand in, **in their final order**, each `{ "file_id": "<id>", "sha256": "<64 lower-case hex>" }`. A page of the send that is left out is deleted (Remove the Page). The hash is of the page as it is stored.

```json
{ "ok": true, "replayed": false, "submission_id": "<id>", "sent_at": "…", "late": false, "pages": 2 }
```

The same finish again answers the same with `"replayed": true`.

| Error                           | When                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_found`                     | no such send of this student's. A newer send took its place, or it was dropped                                                                                        |
| `send_off`, `not_taking_work`   | the switch was turned off, or the piece set to take nothing, since it started                                                                                         |
| `expired`                       | it started more than two hours ago: start again                                                                                                                       |
| `missing_pages`, with `missing` | a page or its thumbnail is not in storage. `missing` lists the file ids. Nothing changes; call again when they are up                                                 |
| `bad_file`, with `files`        | storage holds one of them over the size limit or not as `image/jpeg`                                                                                                  |
| `already_sent`                  | the teacher added this student's work while the pages were going up. This send is dropped                                                                             |
| `grading_started`               | a replace only: grading started while the new pages were going up. What was sent stays; the new pages are dropped                                                     |
| RAISES `22023`                  | no submission, `p_files` not a list of 1 to 30 `{ file_id, sha256 }`, a file named twice, a hash that is not 64 lower-case hex, a file that is not one of this send's |

### `unsend(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)`

```json
{ "ok": true, "unsent": true, "cancelled": false, "pages": 2 }
```

- `unsent`: work that was handed in is now deleted. **Its photos are deleted for good.**
- `cancelled`: a send that was not finished was dropped.
- Nothing sent and nothing unfinished answers `{ "ok": true, "unsent": false, "cancelled": false, "pages": 0 }`. So does an Unsend sent twice: read it as done.

Errors: `not_found` (the assessment is not this class's), `cannot_change` (the teacher added it, or it is on paper), `send_off`, `not_taking_work`, `work_closed` with `closed_on` (unsent now, it could not be sent again), `grading_started`. RAISES `22023` with no assessment.

### `file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)`

The student's own pages for one piece, handed in (also work the teacher added for them). Read-only.

```json
{
  "ok": true,
  "bucket": "student-photos",
  "files": [
    {
      "file_id": "<id>",
      "submission_id": "<id>",
      "version": 1,
      "page": 1,
      "path": "…",
      "thumb_path": "…",
      "width": 1500,
      "height": 2000,
      "rotation": 0
    }
  ]
}
```

Nothing handed in answers an empty list.

### The removal worker: `removal_batch(p_limit integer)`, `removal_done(p_ids bigint[])`

```json
{ "ok": true, "items": [{ "id": 41, "bucket": "student-photos", "path": "…" }], "left": 0 }
```

```json
{ "ok": true, "gone": 4, "still_there": [] }
```

`removal_batch` hands out files to delete: the ones never tried first, newest first, then the ones tried longest ago; 1 to 1000 at a time. `removal_done` is believed only for a file storage's own table no longer has. A file removed while its upload link was still alive is offered once more after the link has died, in case it was put back.

## What `student-submit` does on each route (`S5-F4`)

| Route                   | SQL                             | Then                                                                                                                                                                                                 |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`                  | `page`, and `work`              | Two calls, or one statement that returns both. `work` is its own function so `page` is not changed                                                                                                   |
| `send-start`, `replace` | `send_start`, `replace`         | For every `path` and `thumb_path` returned, and only those: a signed upload link (`createSignedUploadUrl(path)`, **never** with upsert). Give the phone the ids and the links                        |
| `send-finish`           | `send_finish`                   | First, for each page the phone says is up: read it with the service key, check it is a JPEG, check for location data and strip it, take its SHA-256. Then `send_finish`. Then run the removal worker |
| `unsend`                | `unsend`                        | Then run the removal worker                                                                                                                                                                          |
| `file-links`            | `file_links`                    | A short-lived download link for each path returned, and for no other                                                                                                                                 |
| (worker)                | `removal_batch`, `removal_done` | `storage.from(bucket).remove(paths)` with the service key between the two calls                                                                                                                      |

Rules for the function:

- A path given to the Storage API always comes from the database's answer to this request. Never from the request body.
- Send the phone links, not paths, where a link will do.
- `22023` from the database is a bug in the function: answer a plain server error.
- If the function rewrites a page (to strip location data) it does so before `send_finish`, with the service key, and hashes what it stored.
- A removal that fails is tried again on the next call: the queue keeps it.

## The teacher's side: `public` RPCs

Signed-in teachers, through the API. Each checks the caller owns the class. Each write takes `p_idempotency_key`. They RAISE `PT401` (not signed in), `P0002` (not found, or not yours) and `22023` (a wrong shape); a state the screen could not have known is an answer, not an error.

### `set_course_send_work(p_course_id uuid, p_patch jsonb, p_idempotency_key uuid)`

`p_patch`: any of `{ "send_work": true, "keep_photos_until": "end_of_year" | "end_of_term" }`. Only what it names is written. Returns `{ "send_work", "keep_photos_until" }`. Both are also columns of `course`, so `get_class_bundle` already sends them.

### `set_assessment_student_work(p_assessment_id uuid, p_patch jsonb, p_idempotency_key uuid)`

`p_patch`: any of `students_send` (`nothing`, `photos`, `photos_files`), `after_due` (`keep`, `until`, `stop`), `accept_until` (`YYYY-MM-DD` or null), `group_work` (`each`, `group`), `students_see_markup` (true, false). `until` needs `accept_until`, on or after the due date; any other `after_due` drops the date. Returns `{ "id", "students_send", "after_due", "accept_until", "group_work", "students_see_markup" }`.

`get_class_bundle` does **not** send these five (it lists an assessment's fields by name). Read them from `list_course_submissions`. A new assessment has the defaults: nothing, keep, each, true. Copy Assessment, Duplicate Class and a restore do not copy them.

`group_work` and `students_see_markup` are stored and do nothing yet (Batch C).

### `list_course_submissions(p_course_id uuid)`

```json
{
  "bucket": "student-photos",
  "course": { "send_work": true, "keep_photos_until": "end_of_year" },
  "assessments": [
    {
      "id": "…",
      "students_send": "photos",
      "after_due": "keep",
      "accept_until": null,
      "group_work": "each",
      "students_see_markup": true
    }
  ],
  "submissions": [
    {
      "id": "…",
      "assessment_id": "…",
      "enrollment_id": "…",
      "version": 1,
      "state": "sent",
      "sent_by": "student",
      "on_paper": false,
      "is_late": false,
      "note": "I was away Thursday.",
      "followed_plan": null,
      "created_at": "…",
      "sent_at": "…",
      "files": [
        {
          "id": "…",
          "page": 1,
          "path": "…",
          "thumb_path": "…",
          "bytes": 412003,
          "thumb_bytes": 18211,
          "width": 1500,
          "height": 2000,
          "rotation": 0,
          "sha256": "…"
        }
      ]
    }
  ],
  "uploads": []
}
```

- `submissions`: handed in only. A student's unfinished send is never in it.
- `uploads`: the teacher's own uploads that are not finished, the same shape plus `intent` and `target_id`.
- The browser reads a page with its own signed-in Storage client (`download` or `createSignedUrl` on `path`): the policy lets it.
- A submission changing does not move the class's sync cursor. Call this when the grader or the Assignments page opens, and again when you need it fresh.
- "Same photo as": two pages of one assessment with the same `sha256`.

### `start_work_upload(p_assessment_id uuid, p_enrollment_id uuid, p_pages jsonb, p_mode text, p_idempotency_key uuid)`

Add Work, first half. `p_mode`: `new`, `add` (Add as More Pages) or `replace` (Replace Them). `p_pages` as for `send_start`.

| `result`         | Meaning                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ready`          | `{ result, submission_id, mode, bucket, files: [{ file_id, page, path, thumb_path }] }`. Upload each, then finish |
| `already_sent`   | `new` only: work is already in. `submission` is what is there. Offer Add as More Pages, Replace Them, Skip        |
| `nothing_sent`   | `add` or `replace`: nothing is in (the student unsent it). Use `new`                                              |
| `on_paper`       | `add` only: what is in is a paper hand-in. Use `replace`                                                          |
| `too_many_pages` | `add` only: it would pass 30 pages. `room` says how many fit                                                      |

Only `ready` is remembered under the key. RAISES `P0002` for an assessment or a student that is not the teacher's, a student of another class, or a withdrawn student; `22023` for the mode or the pages.

The browser then uploads each `path` and `thumb_path` with its signed-in Storage client: `upload(path, blob, { contentType: 'image/jpeg', upsert: false })`. Storage answers 403 for any other path, 409 if the file is already there (count that as landed), 413 over 2 MB, 415 for another type. Starting a second upload for the same student and piece drops the first.

### `finish_work_upload(p_submission_id uuid, p_files jsonb, p_idempotency_key uuid)`

`p_files` as for `send_finish`; the browser's own hash (`PhotoShrink`).

| `result`        | Meaning                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `sent`          | `submission` is the work as it now stands. For `add` that is the submission added to; for `replace` the old photos are queued for deletion |
| `missing_pages` | `missing` lists file ids not in storage yet. Not remembered: the same call again looks again                                               |
| `bad_file`      | `files` lists pages storage holds too large or not as JPEG                                                                                 |
| `already_sent`  | a `new` upload only: the student sent meanwhile. The upload is dropped                                                                     |
| `gone`          | no such upload of this teacher's: dropped, replaced, or another teacher's                                                                  |

Only `sent` is remembered under the key.

### `mark_handed_in_paper(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid)`

Handed In on Paper. Returns `{ "marked": 1, "submissions": [ … ] }`. A student who already has work in, is withdrawn, or is not in the class is passed over. Works on an assessment that takes nothing.

### `delete_submission(p_submission_id uuid, p_idempotency_key uuid)`

Returns `{ "deleted": true, "pages": 2 }`. **Its photos are deleted for good**: the screen must say so and ask first. Not found, already deleted and another teacher's all answer `{ "deleted": false, "pages": 0 }`.

### `rotate_submission_page(p_file_id uuid, p_rotation integer, p_idempotency_key uuid)`

`0`, `90`, `180` or `270`. Returns `{ "file_id", "rotation" }`. The file is not touched. RAISES `P0002` for a page that is not the teacher's.

## What also deletes photos

Deleting an assessment, permanently deleting a withdrawn student, and the 30-day purge of a deleted class take the work handed in for them, and queue its photos for deletion. No screen warns of this yet (`S8-F1`).

## What later batches add

- **Batch C**: `markup`, `revision_request`, `feedback_reflection`; a revision as `version` 2 (then `student_submit._grading_started` becomes aware of versions, and `send_start` takes a revision); one submission serving a group (`group_work`); Students See Your Mark Up.
- **Batch D**: the removal worker on a schedule; the Keep Photos Until job and its reminder; the nightly check for a file with no row and a row with no file; clearing sends that were started and never finished; trimming the removal queue's history. The tables need no change for any of it: deleting `submission_file` rows is all a purge has to do, and the queue does the rest.

## Changes

None yet.
