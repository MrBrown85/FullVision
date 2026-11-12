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
