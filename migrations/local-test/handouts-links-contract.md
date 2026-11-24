# Handouts and Links: the contract (final, 2026-11-11)

What `migrations/2026111170_handouts_links.sql` gives the browser and the edge function. The draft's function and field names are kept. Where this differs from the draft it says so and why.

## What changed from the draft

1. **`assessment_resource` has no foreign key to `assessment`.** The draft had one, on delete cascade. Every write is made under the class's lock, taken first; a foreign-key check takes the assessment's row lock in the other order, so adding a handout while its assessment is deleted would deadlock. Triggers do the cascade instead, as they do for submissions. The table also has `course_id`. Nothing the browser calls changes.
2. **`finish_handout_upload` on a handout that is not there answers `{ id, status: 'gone' }`.** Not an error: an upload that ran out of its two hours is dropped by that same call, and an error would undo the drop.
3. **`student_submit.handout_links` takes `p_ip_hash` last,** as every function of that schema does.
4. **A row also carries** `assessment_id`, `created_at`, `updated_at`, and for a handout `paths` and (while uploading) `finish_by`. `start_handout_upload` adds `bucket`.
5. **An assessment holds 50 handouts and links at most.** A stop for a runaway script, not a product rule.

## The row

Every teacher function that answers a row answers this:

```json
{
  "id": "uuid",
  "assessment_id": "uuid",
  "kind": "pdf | link",
  "title": "text, 1 to 200",
  "url": "text or null",
  "page_count": "1 to 20, or null for a link",
  "status": "uploading | ready",
  "position": 3,
  "created_at": "timestamptz",
  "updated_at": "timestamptz",
  "paths": ["<class>/handouts/<id>/1.jpg", "..."],
  "finish_by": "timestamptz"
}
```

`paths` is on a handout only. `finish_by` is on a handout only while it is `uploading`: two hours after its start. `position` orders an assessment's rows; removing one leaves a gap.

## Teacher functions (`public`, signed-in teachers only)

Each write takes `p_idempotency_key`; the same key answers the same result again. Errors: `PT401` not signed in, `P0002` not found or not yours (a class in the trash included), `22023` a value refused.

| Function                                                                          | Answers                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_assessment_link(p_assessment_id, p_url, p_title, p_idempotency_key)`         | The row, `ready`. `p_url` is trimmed; it must start with `http://` or `https://` (any case), have a host, no spaces, 2000 characters at most, or `22023`. With no `p_title` the title is the address's host (`www.britannica.com`).                                                                                                   |
| `start_handout_upload(p_assessment_id, p_title, p_page_count, p_idempotency_key)` | The row, `uploading`, plus `bucket`. `p_page_count` 1 to 20 or `22023`. With no `p_title` the title is `Handout`.                                                                                                                                                                                                                     |
| `finish_handout_upload(p_resource_id, p_idempotency_key)`                         | The row. `ready` when every page is in storage. Otherwise still `uploading` with `missing: [page numbers]` (and `bad: [page numbers]` for a file that is there but is not a JPEG within 2 MB); nothing is remembered, so call again after uploading. `{ id, status: 'gone' }` when the handout is not there or its two hours ran out. |
| `remove_assessment_resource(p_resource_id, p_idempotency_key)`                    | `{ removed: true }`, or `{ removed: false }` when it was already gone or is not yours.                                                                                                                                                                                                                                                |
| `list_course_resources(p_course_id)`                                              | An array of rows for the class, each assessment's in the order added. Uploads past their two hours are left out.                                                                                                                                                                                                                      |

A title over 200 characters is `22023`. A 51st item on one assessment is `22023`.

## Uploading and reading a handout's pages (the teacher's browser)

- Bucket `student-photos`: private, JPEG only (`Content-Type: image/jpeg`), 2 MB a page. No thumbnail.
- Upload each page, signed in, to exactly the path `start_handout_upload` gave, within two hours of the start. Storage refuses any other name, a page past `page_count`, a second upload to the same name, and any upload once the handout is `ready`.
- Read a page of your own class's handout with a signed link made signed in (`createSignedUrl`). Uploading or ready, both can be read.
- Nothing can be changed, moved or deleted from the browser. `remove_assessment_resource` queues the files; the removal worker deletes them.

## The student page (`student_submit`, service role only, through the edge function)

- `page(p_session_token, p_enrollment_id, p_ip_hash)`: each `assessments[]` item gains `resources: [{ id, kind, title, url, page_count }]`, the ready ones in the order added, `[]` when there are none. No path is in it.
- `handout_links(p_session_token, p_enrollment_id, p_resource_id, p_ip_hash)`:

  ```json
  {
    "ok": true,
    "bucket": "student-photos",
    "resource_id": "uuid",
    "assessment_id": "uuid",
    "title": "Cell Lab.pdf",
    "page_count": 3,
    "pages": [{ "page": 1, "path": "<class>/handouts/<id>/1.jpg" }]
  }
  ```

  or `{ "ok": false, "error": "..." }`: the session errors `page` gives (`signed_out`, `not_found`, a card's refusal), and `not_found` for a link, a handout still uploading, one in another class, or one on an assessment dated into the future.

## What the edge function must change before any screen ships

`supabase/functions/_shared/storage-rest.ts` checks every path against one shape, the students' (`PATH`). A handout page is `<class>/handouts/<resource>/<n>.jpg`, so today:

- the removal worker skips a queued handout page and leaves it in storage (after six hours the nightly job reports the queue as stuck);
- `signDownloads` refuses a handout path.

So the function needs: the handout shape accepted in `remove` and `signDownloads` (not in `signUpload`: students never upload one), and a route that calls `handout_links` and signs a short-lived link for each path it returns.

## What is not done

- Copy Assessment, Duplicate Class, Copy to Another Class and Restore do not copy handouts or links.
- Backups and Download All My Data leave them out.
- A handout's pages do not count against the class's limit for students' photos.
- Keep Photos Until never deletes a handout. It goes when it is removed, when its assessment is deleted, or when its class is purged.

## Handout files (2026-11-17, `migrations/2026111706_handout_files.sql`)

Colin's call of Nov 17: "+ Add a PDF" becomes "+ Add a File". A PDF works as above. A web page, a text file or an EPUB is kept as the teacher chose it (DECISIONS, Handouts and Links 6 to 11).

### The row

`kind` may also be `html`, `txt` or `epub`. Such a row has `url` and `page_count` null and two more keys:

```json
{ "kind": "html", "bytes": 52000, "path": "<class>/<id>.html", "finish_by": "timestamptz while uploading" }
```

`bytes` is the size declared at the start, and the stored size once `ready`. A PDF's and a link's row answer exactly as before (no `bytes`, no `path`).

### Teacher functions

| Function                                                                           | Answers                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_handout_file(p_assessment_id, p_title, p_kind, p_bytes, p_idempotency_key)` | The row, `uploading`, plus `bucket` (`handout-files`). `p_kind` `html`, `txt` or `epub`, and `p_bytes` 1 to 20971520, or `22023`. With no `p_title` the title is `Handout`. Counts toward the 50.                                                                                                                                                         |
| `finish_handout_file(p_resource_id, p_idempotency_key)`                            | The row, `ready` (with the stored `bytes`) when the file is in storage typed as its kind and within 20 MB. Otherwise still `uploading` with `missing: true` (send it again) or `bad: true` (the stored file is another type or size: it cannot be replaced, so remove the handout); nothing is remembered. `{ id, status: 'gone' }` when it is not there. |

`remove_assessment_resource` and `list_course_resources` take files as they take PDFs.

### Uploading and reading a file (the teacher's browser)

- Bucket `handout-files`: private, 20 MB a file, and only `text/html`, `text/plain` and `application/epub+zip`. Upload with the kind's type as the file's own type (storage reads a Blob's type), never `upsert`.
- Upload, signed in, to exactly the `path` `start_handout_file` gave, within two hours of the start. Storage refuses any other name, a second upload to the same name, and any upload once the file is `ready`. Nothing can be changed or deleted from the browser.
- Read a file of your own class with a signed link made signed in (`createSignedUrl` on `handout-files`).
- A web page's pictures are put inside it before upload (`shared/handout-files.js`); text is stored as UTF-8.

### The student page

- `page`: `resources[].kind` is `html`, `txt` or `epub` for a file; `url` and `page_count` are null. The edge function copies such an item with no address.
- `handout_file(p_session_token, p_enrollment_id, p_resource_id, p_ip_hash)`:

  ```json
  {
    "ok": true,
    "bucket": "handout-files",
    "resource_id": "uuid",
    "assessment_id": "uuid",
    "title": "Lesson 1.1 Practice",
    "kind": "html",
    "bytes": 52000,
    "path": "<class>/<id>.html"
  }
  ```

  or `{ ok: false, error }` under the same checks as `handout_links` (a PDF, a link, a file still uploading, another class, a Draft or a piece dated into the future: `not_found`).

- The edge function's route `handout-file` (`supabase/functions/student-submit/handout-routes.ts`) checks the bucket, that the path is this resource's of the kind named, and the size, then answers `{ ok, kind, bytes, title, url }` with one link signed for 60 seconds in `handout-files`. The page fetches it and shows it with `shared/handout-viewer.js`: text through `textContent`; a web page or an EPUB only in the sealed frame `shared/handout-frame.html` (sandbox without `allow-same-origin`, and its own policy from `netlify/edge-functions/inject-env.js`, which loads nothing from any other address: no `https:` picture, font, style or script, `connect-src 'none'`, `frame-src 'none'`). A page's `localStorage` and `sessionStorage` there are an in-memory stand-in. The frame may open no window (no `allow-popups`); a student's own click on a web link is passed to the viewer, which opens it only after the student presses Open Website. An EPUB that would unzip past 100 MB, by its zip directory, is not opened (Save to Phone still works).
- The removal worker deletes a queued file from `handout-files` (`storageRest(...).remove(paths, 'handout-files')`), and `removal_done` asks that bucket whether it is gone.

### What is not done

- Copies of an assessment do not carry files. Backups and Download All My Data leave them out.
- A web page's own stylesheets and scripts that sit beside it on disk are not put inside it (pictures only).
- The EPUB reader has no table of contents; links between chapters work.
- `handout-files` has no nightly stray sweep (`_photo_strays` looks only in `student-photos`), and none is added: a stray there would be a file with no row, and none can arise from the app. A teacher can write a name only while its row is `uploading` (the policy is checked again when Storage records the file), removing the row queues the name, and the worker looks again after ten minutes (`link_dies_at`), so a file recorded in that moment is deleted too. An upload never finished is dropped by the nightly job and its name queued. Only a file put there by hand (the dashboard, the service key) would stay; catching that would need a SQL sweep like `_photo_strays` for this bucket.

## A PDF's original (2026-11-24, `migrations/2026112408_handout_pdf_original.sql`)

Colin's call of Nov 24: a PDF handout keeps its pages (students still see the pictures) and also the PDF itself, so students can save and print it.

### The row

A PDF row may also carry, once an original was started:

```json
{
  "original": "uploading | ready | dropped",
  "original_path": "<class>/<id>.pdf",
  "original_bytes": 340000,
  "original_finish_by": "timestamptz while uploading"
}
```

A PDF with no original (every row made before this, and one never started) has none of the four keys and answers exactly as before. `original_bytes` is the size declared at the start, and the stored size once `ready`. `dropped` means it was not stored within two hours of its start: it is final (never restarted, its name is queued for deletion) and the handout works from its pages.

### Teacher functions (each idempotent through `p_idempotency_key`)

- `start_handout_original(p_resource_id, p_bytes, p_idempotency_key)`: the PDF's row with `original: 'uploading'`, plus `bucket`. Only after the pages are ready (`22023` before). `p_bytes` 1 to 20971520 (`22023`). Another teacher's, a link's or a missing handout: `P0002`. Started again it answers as it stands (`ready`, `dropped`) and changes nothing.
- `finish_handout_original(p_resource_id, p_idempotency_key)`: the row with `original: 'ready'` once the file is stored typed `application/pdf` within 20 MB. Otherwise still `uploading` with `missing: true` (send it again) or `bad: true` (another type or size: it cannot be replaced, and is dropped after two hours). `{ id, status: 'gone' }` when the handout is not there.

`remove_assessment_resource` and `list_course_resources` take originals as they take pages. Removing a handout, deleting its assessment, the 30-day purge of its class and an upload never finished all queue the original's name in `submission_file_removal` (bucket `handout-files`), as they queue the pages.

### Uploading (the teacher's browser)

Bucket `handout-files` (private, 20 MB) also takes `application/pdf`. Upload signed in, to exactly `original_path`, typed `application/pdf`, never `upsert`, within two hours of the start. Storage refuses any other name, a second upload to the same name, and any upload once it is `ready` or `dropped`. A teacher reads the original of a class they own.

### The student page

`student_submit.handout_original(p_session_token, p_enrollment_id, p_resource_id, p_ip_hash)` (service role only; `fv_student_submit` too, if it exists), under `handout_file`'s checks (the session's class, a ready PDF, listed for this student). A PDF with no ready original is not refused:

```json
{ "ok": true, "has_original": false, "resource_id": "uuid" }
```

and with one:

```json
{
  "ok": true,
  "has_original": true,
  "bucket": "handout-files",
  "resource_id": "uuid",
  "assessment_id": "uuid",
  "title": "Worksheet",
  "bytes": 340000,
  "path": "<class>/<id>.pdf"
}
```

or `{ ok: false, error }` (`not_found` for a link, a file, another class, a Draft or a piece dated into the future).

The edge function's route `handout-original` (`supabase/functions/student-submit/handout-routes.ts`) rebuilds the reply key by key: `{ ok: true, original: false }` when there is none (the page leaves Open as PDF out without asking again), else `{ ok: true, original: true, bytes, title, url }` with one link signed for 60 seconds in `handout-files`, after the bucket, that the name is this resource's `.pdf` and the size are checked. `student_submit.page` does not change.

### What is not done

Copies of an assessment do not carry originals. Handouts attached before this have none and are not backfilled. `handout-files` still has no nightly stray sweep.
