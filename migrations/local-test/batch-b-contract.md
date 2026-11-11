# Batch B: the contract

What the database gives the edge routes (`S5-F4`) and the browser (`S5-W1`, `S6-W1`, `S7-W1`) to code against, once `migrations/2026111101_student_work_submissions.sql` and `migrations/2026111102_student_work_storage.sql` are applied. Written from the SQL as it is in this pull request; `migrations/local-test/submissions.py` checks every shape and refusal below.

If you must depart from anything here, add a dated line under "Changes" at the bottom saying what and why.

## The settled rules

- A page of student work is always a JPEG, 2 MB at most, with a thumbnail beside it. A PDF never reaches the server: the browser turns each page into a JPEG (DECISIONS, "Student page build answers" 2).
- One private bucket, `student-photos`, keeping no old version of a file.
- A submission holds 1 to 30 pages.
- A card can start 20 sends an hour (send-start and replace both count; a refusal and a repeat of the same request do not).
- Nothing is handed in until every page and every thumbnail is in storage. The database checks this itself, in storage's own table.
- **A started send holds its place for two hours from its first start.** It can be finished until then and not after. Asking again with the same request id does not give it longer. After two hours it answers `expired`, and its files are queued for deletion. The same holds for the teacher's Add Work.
- Whether a piece is open, and whether the work is late, is judged by the class's own date (its time zone) when the send **starts and again when it is handed in**. A send started on the last day and finished the day after is refused. One started before the due date and finished after it is Late.
- **A page keeps who added it.** A student's Unsend or Replace removes only the pages the student added. Pages the teacher added stay.
- Unsend and Replace: only the student's own send, only while the piece is open, only until grading starts. **Grading has started** when the piece holds a draft or a returned grade for that student (a level, points, a tick, or an Overall Comment). A Late, Missing or Excused mark alone is not grading.
- **One class may hold 10,000 pages and 5 GB**, pages handed in and not yet handed in together. A start that would pass either is refused.
- Send Work and Students Send govern what a **student** may do. The teacher's Add Work and Handed In on Paper work whatever the two say.
- No function here reads or writes a grade.

## Storage

|                        |                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bucket                 | `student-photos`, private, versioning `DISABLED`                                                                                                             |
| Size limit             | 2,097,152 bytes a file (the browser's own limit is 2,000,000)                                                                                                |
| Type                   | `image/jpeg` only. The Storage service checks the upload's `Content-Type`, not its bytes                                                                     |
| Page path              | `<course id>/<assessment id>/<enrollment id>/<submission id>/<file id>.jpg`                                                                                  |
| Thumbnail path         | the same with `-thumb.jpg`                                                                                                                                   |
| Who names a path       | the database, in `send_start`, `replace` and `start_work_upload`. Nobody else. Every id is a server UUID                                                     |
| A path never changes   | `<submission id>` is the submission the page was first made for; a page added later, or kept through a Replace, keeps its path                               |
| Upload link lifetime   | 7,200 seconds (two hours; Supabase's, not ours). Made only while the send holds its place, so the last link for a page is dead 4 hours after its first start |
| Download link lifetime | **300 seconds.** `createSignedUrl(path, 300)`, for the student's `file-links` route and for the teacher's browser alike                                      |
| Who can delete a file  | the service key, through the Storage API, for paths the removal queue hands out. Nobody else, and no SQL                                                     |

Policies on `storage.objects`, for this bucket:

- A signed-in teacher can **read** a page or its thumbnail that still has its row, in a class they own, and is either handed in or part of an upload that teacher started. Not a page of a send a student has not finished. Not a file whose row is gone (unsent, replaced, deleted, expired) and which waits for the removal worker.
- A signed-in teacher can **write** exactly the paths of an upload they started with `start_work_upload` and have not finished, for the two hours it holds its place.
- Nothing lets a teacher's browser change, move or delete a file. Nobody who is not a signed-in teacher gets past row security. The service key passes row security.

A file waiting for the removal worker can be read only with the service key. **A download link signed before the file was queued goes on working until its 300 seconds are up or the file is deleted, whichever is first.** So for up to five minutes after an Unsend whose removal failed, a link the phone already holds still opens the photo.

**Never list the bucket**, from the browser or from the function (`storage.from(bucket).list()`). In the review of this batch, listing one class's folder took 8.5 seconds with 300,000 files in the bucket. Everything a screen needs is in `list_course_submissions` and `file_links`, which read by index.

## What the edge function must do (`S5-F4`)

These are requirements. The database cannot do them, and it relies on them.

1. **Read every file before handing it in.** Before `send_finish`, for every file in `p_files` and for its thumbnail, the function itself downloads the object with the service key and checks:
   - the bytes are a JPEG (they start `FF D8 FF` and decode);
   - the size is 2,000,000 bytes or less;
   - the page is 1 to 20,000 pixels each way, and the thumbnail no larger than the size the phone is told to make;
   - there is no location data left in it (strip it if there is, storing the result before hashing).

   It takes the SHA-256 of the bytes it read and passes that, not a hash the phone sent. **It never calls `send_finish` naming a file it has not read in that request.** If a file fails, it does not call `send_finish`: it answers the phone `bad_file`, and the phone starts again with a new request id (which drops the failed send and queues its files).

2. **Nobody checks the bytes of a teacher's upload.** The teacher's browser uploads straight to storage, signed in. What limits it: only a signed-in teacher, only to the exact paths of an upload they started for their own class, 2 MB a file with a `Content-Type` of `image/jpeg`, 30 pages, the class's limit. The file is given back only to that teacher and to the student it is filed under, always as `image/jpeg`. The browser's own `PhotoShrink` makes the JPEG; a teacher who bypasses it can store bytes that are not a JPEG, and only they and that student would be handed them. Show these files only in an `<img>`, never in a frame or as a download that opens.

3. **Upload links.** Only `createSignedUploadUrl(path)`, never with upsert, only for the `path` and `thumb_path` values in the database's answer to this same request, and only from `send_start` or `replace` (a replay included). The database stops answering with paths once the two hours are up, so no link can be made after `finish_by`.

4. **Download links live 300 seconds**, and are made only for paths `file_links` returned in this same request.

5. **Run the removal worker after every route that can queue a file**: `send-start` and `replace` (each can drop an unfinished or expired send), `send-finish` (a Replace's old pages, a page left out, an expired send) and `unsend`. The teacher's RPCs queue files too and are called straight from the browser, so the function needs one more route, `sweep`, that does nothing but run the worker. It takes no input, answers nothing but `ok`, and is limited as the other routes are. The teacher's browser calls it after `delete_submission`, after `finish_work_upload` (a Replace Them queues the old photos; an answer of `already_sent` drops the upload) and after `start_work_upload` (it drops an upload started earlier for the same piece). In one run: `removal_batch(200)`, `storage.from(bucket).remove(paths)`, `removal_done(ids)`, again while `left` is above 0 and there is time.

   **If the worker does not run**, nothing is lost and nothing is shown: the queue keeps every path, the files stay in storage in Canada, no teacher and no student can read them, and the next run takes them. They are still there, though, and "deleted for good" is not yet true of them. Until Batch D's schedule, a file queued in a class nobody uses again waits for the next call from any class.

6. **Keep the Canada check.** Every new route goes through `makeHandler` in `supabase/functions/student-submit/handler.ts`, after its region check (line 201: any region but `ca-central-1` answers 421 `wrong_region` before the body is read). No route, and no second function, may handle a photo or a link outside that check. The phone keeps calling with `?forceFunctionRegion=ca-central-1`.

7. A path given to the Storage API always comes from the database's answer to this request. Never from the request body.
8. Send the phone links, not paths, where a link will do.
9. `22023` from the database is a bug in the function: answer a plain server error.
10. Pass each page's real `bytes` and `thumb_bytes` in `p_pages`. A page that says nothing counts as 2 MB plus 2 MB against the class's limit until it is handed in.

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
- `open`: work can be sent right now (Send Work on, the piece takes work, today is not past its last day). `closes_on`: the last day, or null. `late_now`: work handed in now would be marked late.
- `sent`: null, or what is handed in. `sent_by` is `student` or `teacher` (Add Work, Handed In on Paper, or work left with only the teacher's pages after an Unsend). `pages` counts every page, the teacher's among them. `grading`: grading has started. `can_change`: Unsend and Replace would be accepted now.
- `sending`: null, or a send of this student's that is not finished and still holds its place: `{ submission_id, intent: "new" | "replace", started_at, finish_by, pages }`. Null again once its two hours are up.
- A draft on a piece with nothing sent shows nowhere: `sent` is null and nothing else differs.

### `send_start(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_pages jsonb, p_note text, p_followed_plan text, p_request_id uuid, p_ip_hash text)`

### `replace(` the same arguments `)`

Make the rows and name the paths. `replace` is for a piece the student has already sent: what was sent stays, whole, until the new pages are finished.

- `p_pages`: a list of 1 to 30 objects, one per page in order, each `{ "width": 1500, "height": 2000, "bytes": 412003, "thumb_bytes": 18211 }`. `width` and `height` are whole numbers 1 to 20000; `bytes` and `thumb_bytes` are the sizes of the page and its thumbnail, 1 to 2097152. Any may be left out. A file that turns out larger than its page said is refused at the finish.
- `p_note`: null, or up to 1000 characters. `p_followed_plan`: null, `yes`, `partly` or `no`.
- `p_request_id`: required. The same id again returns the same submission and paths with `"replayed": true`, makes nothing and counts nothing. This is how a phone that lost its links (a reload) gets them back without starting over. **It does not give the send longer**: `finish_by` is the same as the first time.

```json
{
  "ok": true,
  "replayed": false,
  "submission_id": "<id>",
  "state": "sending",
  "bucket": "student-photos",
  "late": false,
  "finish_by": "2026-11-05T19:41:09.12+00:00",
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

- `finish_by`: two hours after the send's first start. `send_finish` after it answers `expired`.
- `late`: whether the work would be late if handed in now. What is recorded is what is true at the finish.
- On a replay after the work was handed in, `state` is `sent`, `files` is empty and `finish_by` is null.

| Error                            | When                                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send_off`                       | Send Work is off for the class                                                                                                                                                         |
| `not_found`                      | the assessment is not this class's, or its date has not come; or the student was withdrawn while the call waited                                                                       |
| `not_taking_work`                | Students Send is Nothing                                                                                                                                                               |
| `expired`                        | this request id is a send started more than two hours ago and never finished. It is gone. Start again with a new request id                                                            |
| `work_closed`, with `closed_on`  | today is past the last day                                                                                                                                                             |
| `already_sent`                   | `send_start` only: work is already handed in for the piece                                                                                                                             |
| `nothing_sent`                   | `replace` only                                                                                                                                                                         |
| `cannot_change`                  | `replace` only: what is in was added by the teacher                                                                                                                                    |
| `grading_started`                | `replace` only                                                                                                                                                                         |
| `too_many_pages`, with `room`    | `replace` only: the teacher added pages to this work, they stay, and with them the new pages would pass 30. `room` says how many new pages fit                                         |
| `too_many`, with `retry_after_s` | twenty sends in the last hour for this card                                                                                                                                            |
| `class_full`                     | the class holds all it may (10,000 pages or 5 GB). Nothing is made. The teacher is the one who can make room                                                                           |
| RAISES `22023`                   | no request id, no assessment, pages not a list of 1 to 30 objects, a bad width, height, bytes or thumb_bytes, a note over 1000 characters, a `followed_plan` that is none of the three |

A send of the student's own for the same piece that was started and never finished is dropped when a new one starts. So is every send and upload in the class that has lost its place.

### `send_finish(p_session_token text, p_enrollment_id uuid, p_submission_id uuid, p_files jsonb, p_ip_hash text)`

Hand the work in. `p_files`: the pages to hand in, **in their final order**, each `{ "file_id": "<id>", "sha256": "<64 lower-case hex>" }`. A page of the send that is left out is deleted (Remove the Page). The hash is of the page as it is stored, taken by the function from the bytes it read.

```json
{ "ok": true, "replayed": false, "submission_id": "<id>", "sent_at": "…", "late": false, "pages": 2 }
```

- `late`: as judged now, at the finish. It is what the teacher sees.
- For a replace, the student's old pages are deleted in the same step. Pages the teacher added to the old work move to the new one, after the new pages, and `pages` counts them.
- The same finish again answers the same with `"replayed": true`.

Everything a start asks is asked again here.

| Error                           | When                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expired`                       | the send was first started more than two hours ago. It is gone and its files are queued: start again with a new request id                                            |
| `not_found`                     | no such send of this student's (a newer send took its place, or it was dropped); or the student has been withdrawn                                                    |
| `send_off`, `not_taking_work`   | the switch was turned off, or the piece set to take nothing, since it started                                                                                         |
| `work_closed`, with `closed_on` | the piece closed since it started                                                                                                                                     |
| `missing_pages`, with `missing` | a page or its thumbnail is not in storage. `missing` lists the file ids. Nothing changes; call again when they are up                                                 |
| `bad_file`, with `files`        | storage holds a page or a thumbnail over the size limit, larger than its page said it would be, or not as `image/jpeg`                                                |
| `already_sent`                  | the teacher added this student's work while the pages were going up. This send is dropped                                                                             |
| `grading_started`               | a replace only: grading started while the new pages were going up. What was sent stays; the new pages are dropped                                                     |
| RAISES `22023`                  | no submission, `p_files` not a list of 1 to 30 `{ file_id, sha256 }`, a file named twice, a hash that is not 64 lower-case hex, a file that is not one of this send's |

### `unsend(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)`

```json
{ "ok": true, "unsent": true, "cancelled": false, "pages": 2, "kept": 0 }
```

- `unsent`: the student's pages of work that was handed in are now deleted, `pages` of them. **Those photos are deleted for good.**
- `kept`: pages the teacher added to that work. They are not the student's to remove. When `kept` is above 0 the work stays handed in with those pages, as the teacher's (`sent_by` becomes `teacher`), without the student's note; its `sent_at` and `is_late` stay as they were; the student can no longer change it. When it is 0 the work is gone.
- `cancelled`: a send that was not finished was dropped.
- Nothing sent and nothing unfinished answers `{ "ok": true, "unsent": false, "cancelled": false, "pages": 0, "kept": 0 }`. So does an Unsend sent twice: read it as done.

Errors: `not_found` (the assessment is not this class's), `cannot_change` (the teacher added it, or it is on paper), `send_off`, `not_taking_work`, `work_closed` with `closed_on` (unsent now, it could not be sent again), `grading_started`. RAISES `22023` with no assessment.

### `file_links(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text)`

The student's own pages for one piece, handed in: also pages the teacher added for them. Never a page of a send that is not finished. Read-only.

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

`removal_batch` hands out files to delete: the ones never tried first, newest first, then the ones tried longest ago; 1 to 1000 at a time. `removal_done` is believed only for a file storage's own table no longer has. A file removed while an upload link for it could still be alive (up to 4 hours 10 minutes after its send was first started) is offered once more after that, in case it was put back; only then is the queue finished with it. A removal that fails is tried again on the next run: the queue keeps it.

## The routes of `student-submit`

| Route                   | SQL                             | Then                                                                                                                                                 |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`                  | `page`, and `work`              | Two calls, or one statement that returns both. `work` is its own function so `page` is not changed                                                   |
| `send-start`, `replace` | `send_start`, `replace`         | For every `path` and `thumb_path` returned, and only those: a signed upload link. Give the phone the ids, the links and `finish_by`. Then the worker |
| `send-finish`           | `send_finish`                   | First read and check every file (requirement 1). Then `send_finish`. Then the worker                                                                 |
| `unsend`                | `unsend`                        | Then the worker                                                                                                                                      |
| `file-links`            | `file_links`                    | A 300-second download link for each path returned, and for no other                                                                                  |
| `sweep`                 | `removal_batch`, `removal_done` | The worker alone. Called by the teacher's browser after `delete_submission`, `finish_work_upload` and `start_work_upload`                            |

## The teacher's side: `public` RPCs

Signed-in teachers, through the API. Each checks the caller owns the class. Each write takes `p_idempotency_key`; the same request sent twice at once is answered once. They RAISE `PT401` (not signed in), `P0002` (not found, or not yours) and `22023` (a wrong shape); a state the screen could not have known is an answer, not an error.

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
          "sha256": "…",
          "added_by": "student"
        }
      ]
    }
  ],
  "uploads": []
}
```

- `submissions`: handed in only. A student's unfinished send is never in it.
- `added_by`: `student` or `teacher`, for each page.
- `uploads`: the teacher's own uploads that are not finished and still hold their place: the same shape plus `intent`, `target_id` and `finish_by`.
- The browser reads a page with its own signed-in Storage client (`download`, or `createSignedUrl(path, 300)`): the policy lets it, for the pages this lists and no other file.
- A submission changing does not move the class's sync cursor. Call this when the grader or the Assignments page opens, and again when you need it fresh.
- "Same photo as": two pages of one assessment with the same `sha256`.

### `start_work_upload(p_assessment_id uuid, p_enrollment_id uuid, p_pages jsonb, p_mode text, p_idempotency_key uuid)`

Add Work, first half. `p_mode`: `new`, `add` (Add as More Pages) or `replace` (Replace Them: every page of what is in goes, the student's among them). `p_pages` as for `send_start`. Works whatever Send Work and Students Send say.

| `result`         | Meaning                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ready`          | `{ result, submission_id, mode, bucket, finish_by, files: [{ file_id, page, path, thumb_path }] }`. Upload each, then finish |
| `already_sent`   | `new` only: work is already in. `submission` is what is there. Offer Add as More Pages, Replace Them, Skip                   |
| `nothing_sent`   | `add` or `replace`: nothing is in (the student unsent it). Use `new`                                                         |
| `on_paper`       | `add` only: what is in is a paper hand-in. Use `replace`                                                                     |
| `too_many_pages` | `add` only: it would pass 30 pages. `room` says how many fit                                                                 |
| `class_full`     | the class holds all it may. `{ result, pages, bytes, max_pages, max_bytes }`: what it holds now and the two limits           |

Only `ready` is remembered under the key. RAISES `P0002` for an assessment or a student that is not the teacher's, a student of another class, or a withdrawn student; `22023` for the mode or the pages.

The browser then uploads each `path` and `thumb_path` with its signed-in Storage client: `upload(path, blob, { contentType: 'image/jpeg', upsert: false })`. Storage answers 403 for any other path and for any path after `finish_by`, 409 if the file is already there (count that as landed), 413 over 2 MB, 415 for another type. Starting a second upload for the same student and piece drops the first.

### `finish_work_upload(p_submission_id uuid, p_files jsonb, p_idempotency_key uuid)`

`p_files` as for `send_finish`; the browser's own hash (`PhotoShrink`). It hands in only an upload this teacher started, never a student's unfinished send.

| `result`        | Meaning                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sent`          | `submission` is the work as it now stands. For `add` that is the submission added to, the new pages marked `added_by: "teacher"`; for `replace` the old photos are queued for deletion |
| `missing_pages` | `missing` lists file ids not in storage yet. Not remembered: the same call again looks again                                                                                           |
| `bad_file`      | `files` lists pages storage holds too large, larger than was said, or not as JPEG                                                                                                      |
| `already_sent`  | a `new` upload only: the student sent meanwhile. The upload is dropped                                                                                                                 |
| `gone`          | no such upload of this teacher's: dropped, replaced, another teacher's, a student's send, or started more than two hours ago                                                           |

Only `sent` is remembered under the key.

### `mark_handed_in_paper(p_assessment_id uuid, p_enrollment_ids uuid[], p_idempotency_key uuid)`

Handed In on Paper. Returns `{ "marked": 1, "submissions": [ … ] }`. A student who already has work in, is withdrawn, or is not in the class is passed over. Works on an assessment that takes nothing, in a class with Send Work off.

### `delete_submission(p_submission_id uuid, p_idempotency_key uuid)`

Work that is handed in, or the teacher's own unfinished upload: every page of it, whoever added the page. Returns `{ "deleted": true, "pages": 2 }`. **Its photos are deleted for good**: the screen must say so and ask first. Not found, already deleted, another teacher's and a send a student has not finished all answer `{ "deleted": false, "pages": 0 }`.

### `rotate_submission_page(p_file_id uuid, p_rotation integer, p_idempotency_key uuid)`

`0`, `90`, `180` or `270`. Returns `{ "file_id", "rotation" }`. The file is not touched. RAISES `P0002` for a page that is not the teacher's.

## What also deletes photos

For good; no second copy is kept anywhere.

- Deleting an assessment, permanently deleting a withdrawn student, and the 30-day purge of a deleted class take the work handed in for them, and queue its photos for deletion. No screen warns of this yet (`S8-F1`).
- A send or an upload that is started and not finished within two hours: its pages, when the next call starts, finishes or unsends work in that class.

## What later batches add

- **Batch C**: `markup`, `revision_request`, `feedback_reflection`; a revision as `version` 2 (then `student_submit._grading_started` becomes aware of versions, and `send_start` takes a revision); one submission serving a group (`group_work`); Students See Your Mark Up.
- **Batch D**: the removal worker on a schedule; the Keep Photos Until job and its reminder; the nightly check for a file with no row and a row with no file; clearing expired sends in a class nobody is using; trimming the removal queue's history. The tables need no change for any of it: deleting `submission_file` rows is all a purge has to do, and the queue does the rest.

## Changes

- 2026-11-10, after the first review, before anything was built on this: a started send holds its place two hours from its first start and a repeat no longer extends it (`finish_by`; `expired` from `send_start` too); open and late are asked again at the finish (`work_closed` from `send_finish`; `late` is as at the finish); a page keeps who added it (`added_by`, `kept`, `too_many_pages` on `replace`); a class's limit (`class_full`, `bytes` and `thumb_bytes` in `p_pages`); a teacher reads only handed-in work and their own uploads; the requirements on the edge function, the `sweep` route and the 300-second download link.
