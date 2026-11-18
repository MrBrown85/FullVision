# Bulletins: the contract (stage 1, 2026-11-17)

What `migrations/2026111801_bulletins.sql` (M1, slice B1a) gives the teacher's browser, and what M2 (slice B1b) must give the student page. The plan is `docs/plans/bulletins-plan.md`. The teacher-app builder (B1c, B1f) and the student-page builder (B1d) need nothing else; B1b builds M2 and the edge routes to the second half.

Not in M1: any `student_submit` function, any change to `student_submit.write_log`, the edge function, the removal worker. Those are B1b's.

## Where this differs from the plan or the brief

0. **The functions' helpers** are in `fv_private`, run by no role: `bulletin_file_path`, `bulletin_file_path_parts`, `bulletin_audience`, `bulletin_pinned_now`, `bulletin_json`, `bulletin_patched` (post's and edit's one set of rules), `bulletin_drop_expired`, and the two trigger functions. B1b may call `bulletin_file_path` and `bulletin_pinned_now` from its own `security definer` functions.

1. **No `start_bulletin_file`.** `post_bulletin` makes the bulletin and its file rows in one call and answers the paths to upload to, so a bulletin and its files can never be half-made. The plan listed `start_bulletin_file` separately; the brief folded it into `post_bulletin`.
2. **`finish_bulletin_file` takes `p_bulletin_file_id`**, not `p_file_id`: the security rule tests (`tests/db/function-args.mjs`) read `p_file_id` as a student's submitted file in every function.
3. **A photo is one page.** `kind = 'photo'` has `page_count = 1`; several photos are several files. A PDF has 1 to 20.
4. **`pinned_until` is for a pinned reminder only.** An announcement is pinned or not; a reminder may carry a last day.
5. **Seen by N of M ignores the class's Student Page switch.** M counts students who could open the page if it is on. `list_bulletins` answers `page_on` so the app can say the page is off.
6. **Every refusal is an error, not an empty answer**, as handouts' functions are (`P0002` not found or not yours), except `finish_bulletin_file`, which answers `status: 'gone'` (an error would undo the drop of an upload that ran out of time).

## Tables

All four are in `public`, row security on, **no policy**, and `revoke all` from `public`, `anon`, `authenticated`, `service_role`. No role reads or writes them directly; only the `security definer` functions below (and M2's) do. Every table has a primary key.

### `bulletin`

| Column            | Type          | Null | Default             | Rule                                                                                                                                                                                   |
| ----------------- | ------------- | ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `uuid`        | no   | `gen_random_uuid()` | primary key                                                                                                                                                                            |
| `course_id`       | `uuid`        | no   |                     | references `course(id)` on delete cascade                                                                                                                                              |
| `kind`            | `text`        | no   |                     | `bulletin_kind_check`: `kind in ('announcement', 'reminder')`                                                                                                                          |
| `body`            | `text`        | no   | `''`                | `bulletin_body_check`: `char_length(body) <= 2000`                                                                                                                                     |
| `link_url`        | `text`        | yes  |                     | `bulletin_link_check`: null, or 2000 characters at most matching `^https?://[^[:space:][:cntrl:]/?#@\\]+([/?#][^[:space:][:cntrl:]]*)?$` (any case: the host runs to `/`, `?`, `#` or the end, with no `@` or backslash in it) |
| `link_title`      | `text`        | yes  |                     | `bulletin_link_title_check`: null, or 1 to 200 characters and `link_url` not null                                                                                                      |
| `pinned`          | `boolean`     | no   | `false`             |                                                                                                                                                                                        |
| `pinned_until`    | `date`        | yes  |                     | `bulletin_pinned_until_check`: null, or `pinned`, `kind = 'reminder'` and `isfinite(pinned_until)`. The last day it is pinned, in the class's time zone.                               |
| `assessment_id`   | `uuid`        | yes  |                     | references `assessment(id)` on delete set null; `post_bulletin` and `edit_bulletin` refuse an assessment of another class (`22023`)                                                    |
| `reactions_on`    | `boolean`     | no   | `false`             |                                                                                                                                                                                        |
| `shown_again_at`  | `timestamptz` | yes  |                     | the last Show It Again                                                                                                                                                                 |
| `posted_at`       | `timestamptz` | yes  |                     | when students could first see it. Null: not yet visible (a file still uploading).                                                                                                      |
| `edited_at`       | `timestamptz` | yes  |                     | the last change to `body`, `link_url` or `link_title`                                                                                                                                  |
| `created_at`      | `timestamptz` | no   | `now()`             |                                                                                                                                                                                        |
| `updated_at`      | `timestamptz` | no   | `now()`             | the last change of any kind                                                                                                                                                            |
| `idempotency_key` | `uuid`        | yes  |                     | the `p_idempotency_key` it was posted with                                                                                                                                             |

Constraints and indexes: `bulletin_pkey (id)`; `bulletin_id_course_key unique (id, course_id)` (for `bulletin_file`'s key); `bulletin_course_key_key unique (course_id, idempotency_key)` (nulls distinct); `bulletin_course_idx (course_id, posted_at)`; `bulletin_assessment_idx (assessment_id) where assessment_id is not null`.

**For M3 and M4, which replace `post_bulletin` and `edit_bulletin`:** the rule that a linked assessment is in the bulletin's class lives only in those two functions (in `fv_private.bulletin_patched`); no trigger holds it, so a replacement must keep calling `bulletin_patched` or repeat the rule. M1's guard, post-check and undo look only at their own function names in `public` and `fv_private` and their own four tables, so M2's `student_submit` functions change nothing for them; M1's full undo refuses while another file's function names the tables.

**Adding `poll` and `whiteboard` later (M3, M4)** needs no row rewritten and no table rewrite: in one transaction, `alter table bulletin drop constraint bulletin_kind_check, add constraint bulletin_kind_check check (kind in ('announcement', 'reminder', 'poll')) not valid;` then `alter table bulletin validate constraint bulletin_kind_check;` (the validate reads the rows under a lock that lets reads and writes go on). A check constraint never rewrites rows.

### `bulletin_file`

| Column        | Type          | Null | Default             | Rule                                                                                       |
| ------------- | ------------- | ---- | ------------------- | ------------------------------------------------------------------------------------------ |
| `id`          | `uuid`        | no   | `gen_random_uuid()` | primary key                                                                                |
| `course_id`   | `uuid`        | no   |                     | references `course(id)` on delete cascade                                                  |
| `bulletin_id` | `uuid`        | no   |                     | `(bulletin_id, course_id)` references `bulletin(id, course_id)` on delete cascade          |
| `kind`        | `text`        | no   |                     | `photo` or `pdf`                                                                           |
| `title`       | `text`        | no   |                     | 1 to 200 characters                                                                        |
| `page_count`  | `integer`     | no   |                     | 1 to 20; a photo is 1                                                                      |
| `bytes`       | `bigint`      | yes  |                     | null while `uploading`; when `ready`, the stored pages' total, 1 to `page_count × 2097152` |
| `status`      | `text`        | no   | `'uploading'`       | `uploading` or `ready`                                                                     |
| `position`    | `integer`     | no   |                     | 1, 2, … in the order `p_files` gave                                                        |
| `created_at`  | `timestamptz` | no   | `now()`             |                                                                                            |

Indexes: `bulletin_file_pkey (id)`; `bulletin_file_bulletin_idx (bulletin_id, position)`; `bulletin_file_course_idx (course_id)`.

Trigger `bulletin_file_removed`, after delete, for each row, whoever deletes it and however (`delete_bulletin`, the cascade from its bulletin or its class, an upload dropped after two hours): every page path `1 … page_count` goes into `public.submission_file_removal` (`bucket 'bulletin-files'`, `reason 'bulletin_removed'` or `'bulletin_expired'`, `link_dies_at now() + 10 minutes`, `on conflict (bucket, path) do nothing`), in the same transaction. Pages never uploaded are queued too; the worker finds nothing and marks them done.

### `bulletin_seen`

| Column          | Type          | Null | Default | Rule                                          |
| --------------- | ------------- | ---- | ------- | --------------------------------------------- |
| `bulletin_id`   | `uuid`        | no   |         | references `bulletin(id)` on delete cascade   |
| `enrollment_id` | `uuid`        | no   |         | references `enrollment(id)` on delete cascade |
| `seen_at`       | `timestamptz` | no   | `now()` | the first time; never overwritten             |

Primary key `(bulletin_id, enrollment_id)`; index `bulletin_seen_enrollment_idx (enrollment_id)`. Trigger `bulletin_seen_same_class` (before insert or update): the student is in the bulletin's class (`23514` otherwise).

### `bulletin_reaction`

| Column          | Type          | Null | Default | Rule                                          |
| --------------- | ------------- | ---- | ------- | --------------------------------------------- |
| `bulletin_id`   | `uuid`        | no   |         | references `bulletin(id)` on delete cascade   |
| `enrollment_id` | `uuid`        | no   |         | references `enrollment(id)` on delete cascade |
| `word`          | `text`        | no   |         | `got_it`, `done` or `question`                |
| `updated_at`    | `timestamptz` | no   | `now()` |                                               |

Primary key `(bulletin_id, enrollment_id)`: one reaction per student per bulletin, replaced when they change it, deleted when they take it back. Index `bulletin_reaction_enrollment_idx (enrollment_id)`. Trigger `bulletin_reaction_same_class` as for seen.

### What goes with what

| Deleted                                               | Takes                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| a bulletin (`delete_bulletin`)                        | its files (their pages queued), every seen and reaction row                         |
| a class (the 30-day purge, `fv_retention_cleanup`)    | every bulletin and file of it (every page queued), every seen and reaction row      |
| a student deleted for good (`delete from enrollment`) | their seen and reaction rows                                                        |
| an assessment                                         | nothing: a bulletin linked to it keeps its words, `assessment_id` becomes null      |
| a withdrawn student                                   | nothing: their rows stay with their record and are left out of every count and list |

A class in the trash keeps everything until the purge, and no function answers for it.

## Who "can see" (Seen by N of M)

For a class, every enrolment that is **not withdrawn** is in exactly one group:

- `paused`: `enrollment.page_paused_at is not null` (whether or not they have a card).
- `can_see`: not paused, and has a **working card**: a `student_card` row for the enrolment with `stopped_at is null` and `works_until >= ` today in the class's time zone (`(now() at time zone public._fv_timezone(course.timezone))::date`). These are `student_submit._card_refusal`'s own tests for `card_stopped` and `card_expired` (2026110904, patched by 2026111720). A locked card (`locked_at`, too many wrong tries) still counts: `_card_refusal` does not refuse it and an open session keeps working.
- `no_card`: not paused, no working card.

Withdrawn students are in no group, no count and no list. **M** (`can_see`) is the size of the first group. **N** (`seen`) is the `bulletin_seen` rows of those students only; reaction counts likewise. The class's Student Page switch is not part of it (see `page_on`).

## The bulletin, as the teacher's functions answer it

```json
{
  "id": "uuid",
  "kind": "announcement | reminder",
  "body": "text, 0 to 2000",
  "link_url": "https://… or null",
  "link_title": "text or null",
  "pinned": true,
  "pinned_until": "2026-11-20 or null",
  "assessment_id": "uuid or null",
  "reactions_on": false,
  "visible": true,
  "posted_at": "timestamptz or null",
  "shown_again_at": "timestamptz or null",
  "edited_at": "timestamptz or null",
  "created_at": "timestamptz",
  "updated_at": "timestamptz",
  "idempotency_key": "uuid or null",
  "files": [
    {
      "id": "uuid",
      "kind": "photo | pdf",
      "title": "text",
      "page_count": 3,
      "bytes": 812345,
      "status": "uploading | ready",
      "position": 1,
      "created_at": "timestamptz",
      "paths": ["<class>/<file>/1.jpg", "<class>/<file>/2.jpg", "<class>/<file>/3.jpg"],
      "finish_by": "timestamptz"
    }
  ],
  "seen": 18,
  "can_see": 26,
  "reactions": { "got_it": 9, "done": 3, "question": 1 }
}
```

- `pinned` is as students see it now: the stored switch, and false once `pinned_until` is before today in the class's time zone (computed on read; no job changes the row). `pinned_until` is answered as stored.
- `visible` is `posted_at is not null`. A bulletin with a file still `uploading` is `visible: false`: students are not sent it.
- `files` is in `position` order, `[]` when there are none. `bytes` is null while uploading. `finish_by` (created_at + 2 hours) is there only while `uploading`.
- `seen`, `can_see` and `reactions` follow "Who can see". `reactions` counts every word whether or not `reactions_on` is now on.

## Teacher functions

All in `public`, `security definer`, `search_path` `public, pg_temp`, executable by `authenticated` only (not `anon`, not `service_role`, not `public`). Each first raises `PT401` (`not authenticated`) when `auth.uid()` is null, then checks the class through `fv_owns_course` (the class found from the bulletin or file when that is the argument): another teacher's class, a class in the trash or an id that does not exist is `P0002`. Every write takes `p_idempotency_key uuid default null` and calls `fv_idem_check(key, '<function name>')` first (the same key from two windows at once waits on the key's lock, and the second is answered the first's reply) and `fv_idem_store` with its answer; a refused call stores nothing. Writes for one class wait on each other (`pg_advisory_xact_lock(hashtext('fv.bulletin'), hashtext(course_id::text))`). No function changes `course_sync_cursor`.

Refusal codes: `PT401` signed out; `P0002` not found or not yours; `22023` a value refused (the message says which, in a plain sentence). No other error is raised on purpose.

### `list_bulletins(p_course_id uuid) → jsonb`

```json
{ "bulletins": [ … ], "more": false, "can_see": 26, "no_card": 4, "paused": 1, "page_on": true }
```

The class's bulletins, **pinned first, then newest first** (`coalesce(posted_at, created_at)` descending, then `id`), at most 100; `more` is true when there are others past the hundredth. A bulletin never made visible within two hours of its post is left out. `page_on` is `course.student_page_enabled`. At its start, unless the transaction is read-only, it drops the class's expired uploads (below); otherwise it changes nothing.

### `post_bulletin(p_course_id uuid, p_bulletin jsonb, p_files jsonb default null, p_idempotency_key uuid default null) → jsonb`

`p_bulletin`: an object with only these keys, each optional except `kind`:

| Key             | Type                         | Default | Refused (`22023`) when                                                                                                                                                                                                                                                                |
| --------------- | ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`          | `announcement` or `reminder` |         | missing or another word                                                                                                                                                                                                                                                               |
| `body`          | string                       | `''`    | over 2000 characters after trimming (all whitespace, newlines and tabs too)                                                                                                                                                                                                           |
| `link_url`      | string or null               | null    | not `http://` or `https://` with a host and no spaces, or over 2000 (trimmed first); a name or password before the host (`https://user:pass@host/`), a backslash before the host's end, or a hidden character (U+200B to U+200F, U+202A to U+202E, U+2060 to U+2069, U+FEFF) anywhere |
| `link_title`    | string or null               | null    | over 200 (trimmed; blank is null), or given with no `link_url`                                                                                                                                                                                                                        |
| `pinned`        | boolean                      | false   |                                                                                                                                                                                                                                                                                       |
| `pinned_until`  | date string or null          | null    | not exactly `YYYY-MM-DD` and a real date (`infinity`, `tomorrow`, `12/31/2099`, `20990101` and timestamps are refused); given on an announcement or with `pinned` false; before today                                                                                                 |
| `assessment_id` | uuid or null                 | null    | not an assessment of this class                                                                                                                                                                                                                                                       |
| `reactions_on`  | boolean                      | false   |                                                                                                                                                                                                                                                                                       |

Any other key, a value of the wrong JSON type, or a `p_bulletin` that is not an object is `22023`.

`p_files`: null or `[]` for none, or an array of `{ "kind": "photo | pdf", "title": "text", "pages": n }` (only those keys). `title` is trimmed; blank is `Photo` or `PDF`; over 200 is `22023`. `pages` is a JSON number that reads as a whole number (`1.0` is refused; `2e0` reads as `2`, as JSON keeps it), 1 for a photo, 1 to 20 for a PDF. Every refusal here is `22023`. Refused (`22023`): more than 20 pages on the bulletin in all; more than 2000 pages in the class's bulletins counting these; a bulletin with no words, no link and no file.

Answers `{ "bulletin": <the bulletin>, "bucket": "bulletin-files" }`. With no files it is `visible: true` and `posted_at` is now. With files it is `visible: false`, each file `uploading` with its `paths`: upload each page there, then call `finish_bulletin_file` for each file. The bulletin carries `idempotency_key`: a device that posted with a key and missed the answer finds the row in `list_bulletins` by it. The same key again answers the first reply; a key whose stored reply has been cleared away answers the bulletin as it is now.

**After `status: 'gone'` (an upload dropped after two hours) the key is spent:** the bulletin is gone, and the same key answers the stored first reply (the dead id, `visible: false`) for as long as the reply is kept (24 hours). **The device must post again with a new key.**

### `finish_bulletin_file(p_bulletin_file_id uuid, p_idempotency_key uuid default null) → jsonb`

Checks that every page `1 … page_count` is in the bucket `bulletin-files` at its path, a JPEG (`metadata->>'mimetype' = 'image/jpeg'`) of 1 to 2097152 bytes (`metadata->>'size'`), not archived and not a delete marker.

- All there: the file becomes `ready` with `bytes` the pages' total; when it was the bulletin's last `uploading` file, the bulletin's `posted_at` becomes now (visible to students from that moment). Answers `{ "file_id": "uuid", "bulletin": <the bulletin> }`, remembered under the key. Finishing a file already `ready` answers the same and changes nothing.
- Some missing or wrong: answers `{ "file_id": "uuid", "bulletin": <the bulletin>, "missing": [page numbers], "bad": [page numbers] }` (`bad`: there but not a JPEG of that size; such a page cannot be replaced, so delete the bulletin). Nothing is changed or remembered, so call again after uploading.
- Not there (never was, not yours, deleted, its class in the trash, or dropped after two hours): `{ "file_id": "uuid", "status": "gone" }`, not remembered. Its bulletin is gone with it and the post's key is spent: post again with a new key.

### `edit_bulletin(p_bulletin_id uuid, p_patch jsonb, p_idempotency_key uuid default null) → jsonb`

`p_patch`: an object with any of `body`, `link_url`, `link_title`, `pinned`, `pinned_until`, `assessment_id`, `reactions_on`; the same rules as `post_bulletin`. A key that is there is set (null clears `link_url`, `link_title`, `pinned_until`, `assessment_id`; null `body` is `''`); a key that is not there is left. Clearing `link_url` clears `link_title`. Setting `pinned` false clears `pinned_until`. A pinned reminder whose `pinned_until` (given or kept) is before today is `22023` only when the patch names `pinned` or `pinned_until`. The result must still have words, a link or a file. `kind` cannot change (`22023`). `updated_at` is set when anything changed; `edited_at` only when `body`, `link_url` or `link_title` changed. Answers `{ "bulletin": <the bulletin> }`.

### `delete_bulletin(p_bulletin_id uuid, p_idempotency_key uuid default null) → jsonb`

**Deletes data.** The bulletin, its files, and every student's seen and reaction rows for it; the files' pages are queued for deletion by the trigger. Answers `{ "deleted": true, "id": "uuid" }`. Not there or not yours: `P0002` (the outbox counts a `delete_` call answered `P0002` as done).

### `list_bulletin_seen(p_bulletin_id uuid) → jsonb`

```json
{
  "bulletin_id": "uuid",
  "not_seen": ["enrollment uuid", "…"],
  "seen": ["…"],
  "reactions": { "got_it": ["…"], "done": ["…"], "question": ["…"] },
  "paused": ["…"],
  "no_card": ["…"]
}
```

Enrolment ids only, each list in class-list order (`roster_position`, then `id`). `not_seen`, `seen` and `reactions` are of the `can_see` students only; `paused` and `no_card` are the students not counted. Withdrawn students are in none. The app has the names.

### `show_bulletin_again(p_bulletin_id uuid, p_idempotency_key uuid default null) → jsonb`

Sets `shown_again_at` (and `updated_at`) to now. Answers `{ "bulletin": <the bulletin> }`. A bulletin not yet visible is `22023`; one deleted a moment before (even while this call waited for the class's lock) is `P0002`. Every function that finds the row and then takes the class's lock reads it again under the lock, so a delete that came first gives `P0002` (`finish_bulletin_file`: `status: 'gone'`). On the student's page it moves to the new end for every student who has not seen it (see `student_submit.bulletins`).

### Uploads never finished: `fv_private.bulletin_drop_expired(p_course_id uuid) → integer`

Deletes every bulletin of the class with `posted_at is null` and `created_at` more than two hours ago (its files go with it, and the trigger queues their pages with reason `bulletin_expired`), under the class's lock; answers how many. It does one class only: given null it does nothing. (An every-class form without the class's lock could deadlock with a finish, and nothing calls one; a scheduled job, if one is ever added, must take each class's lock in turn.) No role may run it. It is called at the start of `post_bulletin`, `finish_bulletin_file` and `list_bulletins` (the last only when the transaction may write). **The nightly `photo_lifecycle_nightly` does not call it** and is not changed: a class whose teacher never opens Bulletins again keeps an expired upload's rows (at most 20 pages, never shown to anyone) until that teacher's next visit or the class's purge.

## Storage

- Bucket **`bulletin-files`**: private, `file_size_limit` 2097152 (2 MB a page), `allowed_mime_types` `{image/jpeg}`. Same project and region as everything else.
- A page's name: **`<course id>/<bulletin_file id>/<n>.jpg`**, lower-case ids, `n` from 1 to 20 with no leading zero (`^(ID)/(ID)/([1-9]|1[0-9]|20)\.jpg$`). Made in one place, `fv_private.bulletin_file_path(p_course_id, p_file_id, p_page)`.
- Upload each page signed in (`Content-Type: image/jpeg`, no upsert) to exactly a path `post_bulletin` gave, within two hours of the post. Read a page of your own class's bulletin with a signed link made signed in (`createSignedUrl`), uploading or ready.

Four policies on `storage.objects`, the shape of `handout-files`':

| Policy                            | For                             | Rule                                                                                                                      |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `fv_bulletin_files_read`          | select, authenticated           | `bucket_id = 'bulletin-files' and fv_private.bulletin_file_read_allowed(name)`                                            |
| `fv_bulletin_files_upload`        | insert, authenticated           | `bucket_id = 'bulletin-files' and fv_private.bulletin_file_upload_allowed(name)`                                          |
| `fv_bulletin_files_teachers_only` | all, public, restrictive        | `bucket_id is distinct from 'bulletin-files' or current_user = 'authenticated'` (using and with check)                    |
| `fv_bulletin_files_fence`         | all, authenticated, restrictive | using `… or fv_private.bulletin_file_read_allowed(name)`, with check `… or fv_private.bulletin_file_upload_allowed(name)` |

- `bulletin_file_upload_allowed(name)`: signed in, the name parses, a `bulletin_file` row with that id and course is `uploading`, the page is within its `page_count`, it was made within two hours, and `fv_owns_course(course)`.
- `bulletin_file_read_allowed(name)`: signed in, the name parses, a `bulletin_file` row with that id and course exists, the page is within its `page_count`, and `fv_owns_course(course)`.

No policy allows an update or a delete: nothing is overwritten, moved or deleted from a browser. Students have no storage role; the edge function signs links for them. A visitor and `service_role`'s policies are untouched (`service_role` bypasses row security, as the edge function's worker needs). The two helpers are `security definer`, executable by `authenticated` only (the policies call them as the signed-in user).

## Limits (the author's, easy to change, listed for Colin)

Words 2000 characters; a link 2000; a link's name and a file's name 200; 20 pages on one bulletin; 2000 bulletin pages in a class; 2 MB a page; two hours to finish an upload; 100 bulletins in one `list_bulletins` answer.

## For B1b: the student's side (M2), to build exactly

M2 adds these to `student_submit`, each `security definer`, `search_path` `public, student_submit, pg_temp`, executable by `service_role` only, each taking `p_ip_hash text` last, and **each beginning** `_in := student_submit._session_class(p_session_token, p_enrollment_id)` and answering `{ "ok": false, "error": _in->>'error' }` when it has one (that refuses a signed-out session, a paused or withdrawn student, a class with its page off or in the trash, and a stopped or expired card, in the middle of a session too). Only the session's own class (`_in->>'course_id'`) is ever read.

M2 also widens `student_submit.write_log`'s `write_log_kind_check` to add `bulletin` (drop and add in one transaction), and the two write routes call `student_submit._write_limit(card_id, 'bulletin', 120)` (shared by both: 120 an hour per card), answering its `{ ok: false, error: 'too_many', retry_after_s }` as it comes.

**The one shared rule**: `student_submit._bulletin_visible(p_bulletin_id uuid, p_enrollment_id uuid) → boolean`, true only when the bulletin exists, `posted_at is not null`, and it is in the enrolment's class. Every student function that names a bulletin or file asks it; none copies its test. (`_session_class` has already refused the student who may see nothing.)

**What a student is sent**: the bulletin's kind, words, link, pinned (as computed for the teacher, by `fv_private.bulletin_pinned_now(pinned, pinned_until, course.timezone)`), `pinned_until`, files, `posted_at`, `edited_at`, whether reactions are on, the linked assessment's id only when `student_submit._listed(assessment, today)` would list it (else null), and their own `seen_at` and reaction. **Never a count about other students, never a name, never another student's anything.** `bulletin_file.bytes`, `idempotency_key`, `created_at`, `updated_at` and `shown_again_at` are not sent.

### `student_submit.bulletins(p_session_token text, p_enrollment_id uuid, p_ip_hash text) → jsonb` (route `bulletins`)

```json
{
  "ok": true,
  "bulletins": [
    {
      "id": "uuid",
      "kind": "announcement",
      "body": "…",
      "link_url": null,
      "link_title": null,
      "pinned": false,
      "pinned_until": null,
      "assessment_id": null,
      "reactions_on": true,
      "posted_at": "…",
      "edited_at": null,
      "files": [{ "id": "uuid", "kind": "photo", "title": "Photo", "page_count": 1, "position": 1 }],
      "seen_at": "… or null",
      "reaction": "got_it | done | question | null"
    }
  ],
  "new": [{ "enrollment_id": "uuid", "count": 2 }]
}
```

`bulletins`: the session's class's visible bulletins, **oldest first** by `coalesce(case when shown_again_at is not null and seen_at is null then shown_again_at end, posted_at)`, then `id` (so one shown again and not seen by this student sits at the new end), the newest 100 of that order. Files are `ready` ones in `position` order (all of a visible bulletin's are). `new`: for every class `student_submit._session_classes(session)` lists for this device, that enrolment's visible bulletins with no `bulletin_seen` row of theirs: the student's own count, for the red number and "2 new". Read-only (`stable`).

### `student_submit.bulletin_seen(p_session_token text, p_enrollment_id uuid, p_bulletin_ids uuid[], p_ip_hash text) → jsonb` (route `bulletin-seen`)

Up to 100 ids (more is `{ ok: false, error: 'bad_request' }`). After the write limit, inserts `(bulletin, enrolment, clock_timestamp())` for each id `_bulletin_visible` allows, `on conflict do nothing` (the first time is kept). Answers `{ "ok": true, "seen": <rows added> }`; ids that are not allowed are skipped silently.

### `student_submit.bulletin_react(p_session_token text, p_enrollment_id uuid, p_bulletin_id uuid, p_word text, p_ip_hash text) → jsonb` (route `bulletin-react`)

`p_word` is `got_it`, `done`, `question`, or null to take the reaction back; another word is `{ ok: false, error: 'bad_request' }`. Not visible: `not_found`. `reactions_on` false: `{ ok: false, error: 'reactions_off' }`. After the write limit, upserts the row (`updated_at` now) or deletes it. Answers `{ "ok": true, "reaction": <word or null> }`.

### `student_submit.bulletin_file_links(p_session_token text, p_enrollment_id uuid, p_bulletin_file_id uuid, p_ip_hash text) → jsonb` (route `bulletin-files`)

A `ready` file of a bulletin `_bulletin_visible` allows: `{ "ok": true, "bucket": "bulletin-files", "file_id": "uuid", "bulletin_id": "uuid", "kind": "photo", "title": "…", "page_count": 1, "pages": [{ "page": 1, "path": "<class>/<file>/1.jpg" }] }`; otherwise `{ ok: false, error: 'not_found' }`. The edge function checks each path against the pattern above and signs 60-second links, as for handouts. Read-only.

### The edge function and worker (B1b)

The four routes are registered beside the others; each reply is rebuilt from an allowed list of keys (`tests/student-submit-allow-list.test.js`). The removal worker learns the bucket `bulletin-files` and the page pattern above, and deletes nothing it cannot match. Until it does, a queued page waits in `submission_file_removal` and the nightly job reports it stuck after six hours; nothing queues one until the app posts a bulletin with a file.
