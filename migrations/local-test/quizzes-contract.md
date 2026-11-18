# Quizzes: the contract (Q1, 2026-11-17)

What `migrations/2026111804_quizzes.sql` (MQ1, slice Q1) gives the teacher's browser, and what MQ2 (slice Q3a) and MQ3 (slice Q5a) must give the student page. The plan is `docs/plans/quizzes-plan.md`. The teacher-app builder (Q2b, Q4), the student-page builder (Q3b, Q5b) and the grade-math builder (Q4's `quizSuggestions` in `shared/calc.js`) need nothing else.

Not in MQ1: any `student_submit` function, any change to `student_submit.write_log`, the edge function, any app code. MQ1 changes no existing row, table, policy, constraint or function. It adds five tables, six functions a teacher may run, one private helper, three trigger functions and three triggers (one on `assessment`, one on `assessment_tag`, one on its own `quiz_attempt`), and the foreign keys' own internal triggers on `assessment` and `enrollment`.

MQ1 is two files, applied in this order, each under 40 KB: `migrations/2026111804_quizzes.sql` (the tables, the triggers, `list_quiz`, `save_quiz`) and `migrations/2026111805_quiz_results.sql` (`list_quiz_tries`, `mark_quiz_answer`, `reopen_quiz`, `confirm_quiz`), each with its own guard, pre-check, post-check and undo.

## Changed since first written (Nov 18, after the review; the Quiz card's builder must follow these)

1. **`save_quiz` takes `updated_at`.** `p_quiz` has one more required key, `updated_at`: the quiz's `updated_at` exactly as `list_quiz` or `save_quiz` last answered it (a string, sent back unchanged), or null for a quiz that does not exist yet. When it differs from the stored one (the quiz was saved in another tab, or this payload is old), the save is refused with `22023` `stale`, detail "This quiz was changed somewhere else. Open it again before saving.", and nothing is written. The app then reads the quiz again (`list_quiz`) and shows it; it never resends the same payload with a new `updated_at` without the teacher seeing the newer quiz. Every successful save answers a new `updated_at`: use it for the next save.
2. **The same idempotency key again answers the quiz as it is now**, not a stored copy of the first reply: `fv_idempotency` holds only `{"saved": true}` for `save_quiz`, so the answer key is never copied there. A replay is not checked for `stale`.
3. **`list_quiz_tries` is in the second file** (`2026111805_quiz_results.sql`). Its arguments and answer are unchanged.
4. **Trimming** is of ASCII white space (space, tab, newline, carriage return, form feed, vertical tab) at both ends of a prompt, a choice's text, a "why" line and a teacher's note, the same under every collation. A no-break space or any other character is kept. A prompt of only white space is `bad_quiz`.
5. **`confirm_quiz` refuses two tries of one student both given a `marked` in one call**: `22023` `bad_marks`, detail "Each student is confirmed on one try."
6. All refusals, with their exact words, are in one table under "Teacher functions".

**Three notes for app builders (from the review):**

- Send `updated_at` back as the exact string received. Parsed and cut to milliseconds (as a JavaScript `Date` does) it no longer matches, and every save is `stale`.
- Never reuse an idempotency key across pieces: a key already used makes a `save_quiz` of another piece save nothing; it answers that piece as it is, unchanged.
- Trimming is ASCII white space only, so the form trims Unicode white space (a no-break space and the like) itself before sending.

## Where this differs from the brief or the plan

1. **`quiz_answer` carries `assessment_id`** as well, so two composite keys make an answer to another quiz's question impossible in the table itself, whatever a later function does.
2. **A question's competency has no foreign key.** `update_assessment` and `save_assessment_tags` delete every `assessment_tag` row of the piece and insert them again on every save of the form; a key with `on delete set null` would empty every question's competency each time. Instead a deferred trigger on `assessment_tag` runs at commit and empties `tag_id` only where the pair is still gone then (see "What goes with what").
3. **`save_quiz` with `p_quiz` null removes the quiz** (the teacher turns "They Answer a Quiz" off), and is refused once any student has a try. The brief had no way to remove one, and the presence of a `quiz` row is what makes a piece a quiz.
4. **The closing columns are named as Student Work's are**: `after_due` (`keep`, `stop`, `until`) and `accept_until`, read exactly as `student_submit._work_window` reads them.
5. **Reopen gives one try beyond the quiz's number, answerable after the quiz closes** (the rule is under "Tries"). It is the rule for "Reopen for One Student" the plan names but does not define.
6. **MQ2's `quiz` takes `p_new_try boolean default false`.** The first open starts the first try; a later try ("Try Again") starts only when asked, or opening the screen to see "Sent" would spend a try.
7. **A key is required for Choice, True or False and Number questions.** The builder checks before it saves; `save_quiz` refuses a question without one.
8. **Two files.** Written whole, the first file was 53 KB; the results functions are the second file, as the brief said to do past 40 KB.
9. **`updated_at` on a question also moves** when the competency trigger empties its `tag_id`.
10. **`save_quiz` refuses only DIBELS and pair or group pieces**, as briefed. A rubric-scored or Complete/Incomplete piece is not refused here; the form does not offer the quiz on them (plan, "Grade math").

## Tables

All five are in `public`, row security on, **no policy**, and `revoke all` from `public`, `anon`, `authenticated`, `service_role`. Only the `security definer` functions below (and MQ2's and MQ3's) read or write them. Every table has a primary key. No table has a sync-cursor trigger: a quiz change does not make other devices reload the class.

### `quiz`: one per assessment

| Column              | Type          | Null | Default     | Rule                                                                                  |
| ------------------- | ------------- | ---- | ----------- | ------------------------------------------------------------------------------------- |
| `assessment_id`     | `uuid`        | no   |             | primary key; references `assessment(id)` on delete cascade                            |
| `shuffle_questions` | `boolean`     | no   | `true`      |                                                                                       |
| `shuffle_choices`   | `boolean`     | no   | `true`      |                                                                                       |
| `tries`             | `smallint`    | no   | `1`         | `quiz_tries_check`: `tries in (0, 1, 2)`; 0 is unlimited                              |
| `counts`            | `text`        | no   | `'best'`    | `quiz_counts_check`: `best` or `latest`. Read only when `tries` is not 1              |
| `shows`             | `text`        | no   | `'answers'` | `quiz_shows_check`: `grade`, `right` or `answers` (what a returned student sees)      |
| `add_total`         | `boolean`     | no   | `false`     | Add a Total: "7 of 10" on the returned view                                           |
| `after_due`         | `text`        | no   | `'keep'`    | `quiz_after_due_check`: `keep` (open), `stop` (the due date is the last day), `until` |
| `accept_until`      | `date`        | yes  |             | `quiz_accept_until_check`: `(after_due = 'until') = (accept_until is not null)`       |
| `created_at`        | `timestamptz` | no   | `now()`     |                                                                                       |
| `updated_at`        | `timestamptz` | no   | `now()`     | set by every `save_quiz`                                                              |

Shows, in the teacher's words: `grade` Grade Only; `right` Grade and Which Were Right; `answers` Grade, Which Were Right and the Answers.

**Open or closed** (MQ2 and MQ3 compute it; nothing stores it), with `today = (now() at time zone public._fv_timezone(course.timezone))::date`:
`keep` → open; `stop` → open while `assessment.due_date is null or today <= assessment.due_date`; `until` → open while `today <= accept_until`.

### `quiz_question`

| Column          | Type          | Null | Default             | Rule                                                                                                  |
| --------------- | ------------- | ---- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`            | `uuid`        | no   | `gen_random_uuid()` | primary key                                                                                           |
| `assessment_id` | `uuid`        | no   |                     | references `quiz(assessment_id)` on delete cascade                                                    |
| `position`      | `integer`     | yes  |                     | 1 … 100 while active, null when archived (`quiz_question_archived_check`)                             |
| `kind`          | `text`        | no   |                     | `quiz_question_kind_check`: `choice`, `true_false`, `number`, `text`                                  |
| `prompt`        | `text`        | no   |                     | `quiz_question_prompt_check`: 1 to 1000 characters                                                    |
| `choices`       | `jsonb`       | yes  |                     | `quiz_question_choices_check`: an array of 2 to 20 when `kind = 'choice'`, null otherwise             |
| `multiple`      | `boolean`     | no   | `false`             | `quiz_question_multiple_check`: true only on a choice question (several right)                        |
| `points`        | `numeric`     | no   | `1`                 | `quiz_question_points_check`: 0 to 100                                                                |
| `tag_id`        | `uuid`        | yes  |                     | one of the piece's own competencies (`assessment_tag`), or null: Counts Toward No Competency. No key. |
| `archived_at`   | `timestamptz` | yes  |                     | set when a question with answers is taken out of the quiz                                             |
| `created_at`    | `timestamptz` | no   | `now()`             |                                                                                                       |
| `updated_at`    | `timestamptz` | no   | `now()`             |                                                                                                       |

Constraints and indexes: `quiz_question_pkey (id)`; `quiz_question_id_assessment_key unique (id, assessment_id)` (for `quiz_answer`'s key); `quiz_question_position_key unique (assessment_id, position) deferrable initially deferred` (checked at commit, so a reorder can swap two); `quiz_question_tag_idx (assessment_id, tag_id) where tag_id is not null`.

`choices` is the teacher's order: `[{ "id": "<uuid v4>", "text": "1 to 300 characters" }, …]`. A choice's id is a random version-4 UUID (lower case), made by the app (`crypto.randomUUID()`), unique within its question, and **says nothing about being right**: which are right is only in `quiz_key`.

### `quiz_key`: the answer key, and nowhere else

| Column        | Type      | Null | Default | Rule                                                           |
| ------------- | --------- | ---- | ------- | -------------------------------------------------------------- |
| `question_id` | `uuid`    | no   |         | primary key; references `quiz_question(id)` on delete cascade  |
| `answer`      | `jsonb`   | yes  |         | `quiz_key_answer_check`: null, an array, a boolean or a number |
| `tolerance`   | `numeric` | yes  |         | `quiz_key_tolerance_check`: null or ≥ 0                        |
| `why`         | `text`    | yes  |         | `quiz_key_why_check`: null or 1 to 500 characters              |

`save_quiz` writes exactly one key row for every question. **The key's JSON, by kind:**

| Kind         | `answer`                                                                                                                               | `tolerance`       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `choice`     | `["<choice id>"]`, or with `multiple` several: `["<id>", "<id>"]`, sorted byte by byte (collation `C`), each one of the question's own | null              |
| `true_false` | `true` or `false`                                                                                                                      | null              |
| `number`     | a JSON number, −10¹² to 10¹²: `3.5`                                                                                                    | null or 0 to 10¹² |
| `text`       | null (assessed by hand)                                                                                                                | null              |

**No function of the student page reads this table except MQ3's `student_submit.quiz_result`.** MQ1 has none; `quizzes.py` checks that no `student_submit` function names it. No copy of it is kept anywhere else: `save_quiz`'s idempotency record holds only `{"saved": true}`.

### `quiz_attempt`: one student's try

| Column           | Type          | Null | Default             | Rule                                                                                                               |
| ---------------- | ------------- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`             | `uuid`        | no   | `gen_random_uuid()` | primary key                                                                                                        |
| `assessment_id`  | `uuid`        | no   |                     | references `quiz(assessment_id)` on delete cascade                                                                 |
| `enrollment_id`  | `uuid`        | no   |                     | references `enrollment(id)` on delete cascade                                                                      |
| `try`            | `integer`     | no   |                     | `quiz_attempt_try_check`: ≥ 1; 1, 2, … per student                                                                 |
| `question_order` | `jsonb`       | yes  |                     | this student's order (below); null only on a reopened try not yet opened                                           |
| `started_at`     | `timestamptz` | yes  |                     | `quiz_attempt_started_check`: `(started_at is null) = (question_order is null)`                                    |
| `sent_at`        | `timestamptz` | yes  |                     | null while unfinished; `quiz_attempt_sent_check`: sent only once started                                           |
| `reopened_at`    | `timestamptz` | yes  |                     | set by `reopen_quiz`: this try is the extra one Reopen gave                                                        |
| `marked`         | `jsonb`       | yes  |                     | what the teacher confirmed for this try (below); `quiz_attempt_marked_check`: only on a sent try, with `marked_at` |
| `marked_at`      | `timestamptz` | yes  |                     |                                                                                                                    |
| `created_at`     | `timestamptz` | no   | `now()`             |                                                                                                                    |

Constraints and indexes: `quiz_attempt_pkey (id)`; `quiz_attempt_try_key unique (assessment_id, enrollment_id, try)`; `quiz_attempt_id_assessment_key unique (id, assessment_id)`; `quiz_attempt_one_open_idx unique (assessment_id, enrollment_id) where sent_at is null` (**at most one unfinished try per student**); `quiz_attempt_one_marked_idx unique (assessment_id, enrollment_id) where marked is not null` (**at most one confirmed try per student**); `quiz_attempt_enrollment_idx (enrollment_id)`. Trigger `quiz_attempt_same_class` (before insert or update of `assessment_id, enrollment_id`): the student is in the assessment's class, else `23514`.

**`question_order`**, made once when the try starts and never changed by MQ1:

```json
{
  "questions": ["<question id>", "…"],
  "choices": { "<choice question id>": ["<choice id>", "…"] }
}
```

`questions` holds every active question at the start, shuffled when `shuffle_questions`, else in `position` order. `choices` has one entry per choice question, shuffled when `shuffle_choices`, else in the teacher's order. **Reading an order** (MQ2, MQ3, the results screen): the questions in the stored order that are still active, then any active question not in it (added later) in `position` order; within a question, the stored choice order, then any choice not in it in the teacher's order. Archived and deleted questions are left out. Number them 1, 2, … in that order: that is "Question 9" for this student everywhere.

**`marked`** (written only by `confirm_quiz`, read by MQ3):

```json
{
  "earned": 7,
  "possible": 10,
  "questions": {
    "<question id>": { "earned": 1, "result": "right" },
    "<question id>": { "earned": 0.5, "result": "partly" },
    "<question id>": { "earned": 0, "result": "wrong" },
    "<question id>": { "earned": 0, "result": "waiting" }
  }
}
```

### `quiz_answer`: one answer to one question in one try

| Column          | Type          | Null | Default | Rule                                                                                              |
| --------------- | ------------- | ---- | ------- | ------------------------------------------------------------------------------------------------- |
| `attempt_id`    | `uuid`        | no   |         | `(attempt_id, assessment_id)` references `quiz_attempt(id, assessment_id)` on delete cascade      |
| `question_id`   | `uuid`        | no   |         | `(question_id, assessment_id)` references `quiz_question(id, assessment_id)` on delete cascade    |
| `assessment_id` | `uuid`        | no   |         | the quiz both belong to                                                                           |
| `answer`        | `jsonb`       | no   |         | `quiz_answer_answer_check`: an array, a boolean, a number, or a string of 5000 characters at most |
| `saved_at`      | `timestamptz` | no   | `now()` | the last save                                                                                     |
| `given_points`  | `numeric`     | yes  |         | `quiz_answer_given_points_check`: null or 0 to 100. The teacher's points for a Text answer        |
| `note`          | `text`        | yes  |         | `quiz_answer_note_check`: null or 1 to 1000 characters. The teacher's                             |

Primary key `(attempt_id, question_id)`: one row per question per try, replaced by the next save. Index `quiz_answer_question_idx (question_id)`. A cleared answer is no row.

**A raw answer's JSON, by kind** (what MQ2's `quiz_save` takes and stores, and what `list_quiz_tries` answers):

| Kind         | `answer`                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `choice`     | `["<choice id>"]`: exactly one when not `multiple`; one or more, distinct, when `multiple`; each one of the question's own |
| `true_false` | `true` or `false`                                                                                                          |
| `number`     | a JSON number, −10¹² to 10¹²: `3.5`                                                                                        |
| `text`       | a JSON string, 1 to 5000 characters after trimming: `"Plants need light because…"`                                         |

### What goes with what

| Deleted or changed                                                     | Takes                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| an assessment (`delete_assessment`, or with its class)                 | its quiz, questions, key, every try and every answer (foreign keys, on delete cascade)                  |
| a class purged from the trash (`fv_retention_cleanup`)                 | the same, for every piece and student of it                                                             |
| a student deleted for good (`delete_withdrawn_student`)                | their tries and answers                                                                                 |
| a withdrawn student                                                    | nothing: their rows stay, and every teacher function leaves them out                                    |
| a question removed by `save_quiz`, no answer names it                  | the question and its key                                                                                |
| a question removed by `save_quiz`, an answer names it                  | nothing: it is archived (`archived_at`, `position` null), its key and answers kept                      |
| a competency taken off the piece (`assessment_tag` row gone at commit) | `tag_id` becomes null on that piece's questions with it; the questions stay                             |
| a competency deleted (`tag`)                                           | the same, through the `assessment_tag` cascade                                                          |
| `relink_student` merging a duplicate student into another              | the duplicate's enrolment is deleted, and with it that enrolment's tries and answers (as its scores go) |
| `clear_data` (the teacher deletes all their data)                      | every class, so every quiz, question, key, try and answer of that teacher                               |

**Why foreign keys here, when `submission` and `grade_return` have none.** Those two are written only under the class's lock (the class's `course_sync_cursor` row), and a cascade would take row locks before the deleter reached that lock. No quiz table has a sync-cursor trigger and no quiz function takes the class's lock, so a cascade cannot meet it in the other order. What a quiz writer must do instead is take its locks in one order (below), which every deleter also follows: the assessment's row first, then the quiz's.

**The competency trigger.** `quiz_tag_gone` is a constraint trigger, `after delete or update of assessment_id, tag_id on assessment_tag`, `deferrable initially deferred`, for each row: at commit it runs `update quiz_question set tag_id = null, updated_at = now() where assessment_id = old.assessment_id and tag_id = old.tag_id and not exists (that pair in assessment_tag)`. A form save that deletes and re-inserts the same competencies changes nothing.

### Locks, in order (every quiz writer, MQ2's included)

1. `fv_idem_check`'s key lock (teacher writes with a key).
2. The assessment's row: `for key share` (teacher writes); `for share` (MQ2's start of a try and `reopen_quiz`, which make a try: an Unassign waits for them, or they wait for the Unassign and then see the Draft).
3. The quiz's row: `for update` (`save_quiz`, which may delete questions); `for key share` (everything else).
4. `save_quiz` only: the piece's `assessment_tag` rows, `for key share`.
5. One student's tries: `pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(assessment_id::text || ':' || enrollment_id::text))` (`reopen_quiz`, `confirm_quiz` per student in input order sorted by enrollment id, MQ2's `quiz`, `quiz_save`, `quiz_send`).
6. Attempt rows, then answer rows.

So a student's save waits while the teacher saves the quiz and the other way round, and a question is never deleted while an answer to it is being written.

## Teacher functions

All in `public`, `security definer`, `search_path` `public, pg_temp`, executable by `authenticated` only (not `anon`, not `service_role`, not `public`). Each first raises `PT401` (`not authenticated`) when `auth.uid()` is null, then checks the class through `fv_owns_assessment` (the assessment found from the attempt for `mark_quiz_answer`). Every write takes `p_idempotency_key uuid default null`, calls `fv_idem_check(key, '<function name>')` before anything else is read, and `fv_idem_store` with its answer (`save_quiz` stores only `{"saved": true}`); the same key again answers the first reply (`save_quiz`: the quiz as it is now) and writes nothing, and the same key from two windows at once waits on the key's lock and then gets the first's reply. A refused call stores nothing.

**Refusals.** Every refusal is an error; the app reads `code` (SQLSTATE) and `message` (a word), and may show `detail` (a plain sentence).

| SQLSTATE | `message`            | Function                                                                | When                                                                                                                                  | `detail`, exactly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PT401`  | `not authenticated`  | all six                                                                 | signed out                                                                                                                            | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `P0002`  | `not found`          | all six                                                                 | the assessment, attempt, question or student is not there, not this teacher's, or its class is in the trash; the student is withdrawn | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `P0002`  | `not found`          | `mark_quiz_answer`, `reopen_quiz`, `confirm_quiz`                       | the quiz is missing (`list_quiz` answers `quiz: null`, `list_quiz_tries` answers `{ "students": [] }`, `save_quiz` makes one)         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `22023`  | `stale`              | `save_quiz`                                                             | `p_quiz.updated_at` is not the stored one (null for a quiz that exists, a value for one that does not)                                | This quiz was changed somewhere else. Open it again before saving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `22023`  | `bad_quiz`           | `save_quiz`                                                             | a setting is wrong                                                                                                                    | one of: The quiz must have exactly its settings, updated_at and questions. / updated_at must be the quiz's updated_at as last read, or null for a new quiz. / Shuffle and Add a Total must be true or false. / Tries must be 0, 1 or 2. / Counts must be best or latest. / Shows must be grade, right or answers. / After the due date must be keep, stop or until. / The last day must be a date (YYYY-MM-DD) with until, and null otherwise. / Questions must be a list.                                                                                                                                                                                                                                                                                                                       |
| `22023`  | `bad_quiz`           | `save_quiz`                                                             | a question is wrong                                                                                                                   | `Question N: <what>.` where what is one of: its fields / its id / its id is not a question of this quiz, or is there twice / its kind / its question (1 to 1000 characters) / Several Right (only on a choice question) / its points (0 to 100) / its competency is not one of this piece's / its competency / its choices (2 to 20) / its choices (each an id, a random version-4 UUID used once, and 1 to 300 characters) / its choices (only on a choice question) / its answer key / its why line (500 characters at most) / its tolerance (0 to 10^12, on a number question only) / its right answer (one of its choices, or with Several Right one or more) / its right answer (true or false) / its right answer (a number, -10^12 to 10^12) / its right answer (none on a text question) |
| `22023`  | `not_offered`        | `save_quiz`                                                             | the piece is scored DIBELS, or is a pair or group piece (`collab_mode` not `none`)                                                    | A quiz is not offered on a DIBELS, pair or group piece.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `22023`  | `too_many_questions` | `save_quiz`                                                             | more than 100 questions                                                                                                               | A quiz has 100 questions at most.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `22023`  | `kind_locked`        | `save_quiz`                                                             | a question with answers would change `kind` or `multiple`                                                                             | Question N has answers, so its kind and Several Right cannot change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `22023`  | `choices_locked`     | `save_quiz`                                                             | a choice question with answers would gain, lose or change a choice id                                                                 | Question N has answers, so a choice cannot be added or removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `22023`  | `has_tries`          | `save_quiz`                                                             | `p_quiz` null (remove the quiz) once any try exists                                                                                   | A student has started this quiz, so it cannot be removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `22023`  | `not_sent`           | `mark_quiz_answer`                                                      | the try is not sent                                                                                                                   | This try has not been sent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `22023`  | `not_sent`           | `confirm_quiz`                                                          | a named try is not sent                                                                                                               | Only a sent try can be confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `22023`  | `not_text`           | `mark_quiz_answer`                                                      | the question is not Text                                                                                                              | Only a text answer is given points by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `22023`  | `bad_points`         | `mark_quiz_answer`                                                      | points below 0 or above the question's points                                                                                         | Points are 0 to P on this question.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `22023`  | `bad_note`           | `mark_quiz_answer`                                                      | a note over 1000 characters                                                                                                           | A note is 1000 characters at most.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `22023`  | `bad_marks`          | `confirm_quiz`                                                          | `p_marks` breaks a rule                                                                                                               | one of: Marks must be a list of 1 to 200 tries. / Each item is an attempt_id and marked. / Marked is earned, possible and questions. / Earned is 0 to possible, and possible 10000 at most. / Each question is one of this quiz's, with earned (0 to 100) and result (right, partly, wrong or waiting). / Each try is named once. / Each student is confirmed on one try.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `22023`  | `draft`              | `reopen_quiz`                                                           | the piece is a Draft                                                                                                                  | This piece is a Draft: students cannot see it yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `P0001`  | `draft_has_work`     | the trigger on `assessment` (any Unassign, such as `update_assessment`) | Unassign once a try exists                                                                                                            | A student has started the quiz on this assessment, so it cannot go back to a Draft.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

No other error is raised on purpose.

### The quiz, as the teacher's functions answer it

```json
{
  "quiz": {
    "assessment_id": "uuid",
    "shuffle_questions": true,
    "shuffle_choices": true,
    "tries": 1,
    "counts": "best",
    "shows": "answers",
    "add_total": false,
    "after_due": "keep",
    "accept_until": null,
    "created_at": "timestamptz",
    "updated_at": "timestamptz"
  },
  "questions": [
    {
      "id": "uuid",
      "position": 1,
      "kind": "choice",
      "prompt": "Which is a producer?",
      "choices": [
        { "id": "uuid v4", "text": "Grass" },
        { "id": "uuid v4", "text": "Hawk" }
      ],
      "multiple": false,
      "points": 1,
      "tag_id": "uuid or null",
      "answered": true,
      "archived_at": null,
      "key": { "answer": ["uuid v4"], "tolerance": null, "why": "Grass makes its own food." },
      "created_at": "timestamptz",
      "updated_at": "timestamptz"
    }
  ],
  "archived": [{ "…": "the same fields, position null, archived_at set" }]
}
```

`questions` is the active questions by `position`; `archived` the archived ones, oldest archived first (their answers are kept; they count toward nothing). `choices` is null for any kind but `choice`. `answered` is true when any answer row names the question, sent or not (what `kind_locked` and `choices_locked` follow). With no quiz: `{ "quiz": null, "questions": [], "archived": [] }`.

### `list_quiz(p_assessment_id uuid) → jsonb`

The quiz above, key included, for the class's teacher only. Read-only (`stable`). Not this teacher's: `P0002`.

### `save_quiz(p_assessment_id uuid, p_quiz jsonb, p_idempotency_key uuid default null) → jsonb`

The whole quiz at once. Answers the quiz above, as saved.

`p_quiz` is an object with exactly these keys (each required; any other key, or a value of the wrong JSON type, is `bad_quiz`):

| Key                 | Type                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| `updated_at`        | the quiz's `updated_at` as last answered (a string, unchanged), or null for a new quiz |
| `shuffle_questions` | boolean                                                                                |
| `shuffle_choices`   | boolean                                                                                |
| `tries`             | 0, 1 or 2                                                                              |
| `counts`            | `best` or `latest`                                                                     |
| `shows`             | `grade`, `right` or `answers`                                                          |
| `add_total`         | boolean                                                                                |
| `after_due`         | `keep`, `stop` or `until`                                                              |
| `accept_until`      | a date string `YYYY-MM-DD` when `after_due` is `until`, else null                      |
| `questions`         | an array of 0 to 100 questions, in the order they are numbered                         |

Each question is an object with these keys only:

| Key        | Required                 | Rule                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | no (absent or null: new) | a question of this quiz, active or archived (an archived one comes back); not twice in the list                                                                                                                                                                                                                                                               |
| `kind`     | yes                      | `choice`, `true_false`, `number` or `text`                                                                                                                                                                                                                                                                                                                    |
| `prompt`   | yes                      | a string, 1 to 1000 characters after trimming ASCII white space (stored trimmed)                                                                                                                                                                                                                                                                              |
| `choices`  | for `choice` only        | 2 to 20 `{ "id", "text" }` (only those keys): id a lower-case version-4 UUID, distinct; text 1 to 300 after trimming ASCII white space (stored trimmed). Absent or null for other kinds                                                                                                                                                                       |
| `multiple` | no (default false)       | boolean; true only for `choice`                                                                                                                                                                                                                                                                                                                               |
| `points`   | yes                      | a number, 0 to 100                                                                                                                                                                                                                                                                                                                                            |
| `tag_id`   | yes (may be null)        | null, or a competency on this piece (`assessment_tag`)                                                                                                                                                                                                                                                                                                        |
| `key`      | yes                      | `{ "answer", "tolerance", "why" }` (only those keys; `tolerance` and `why` may be absent): `answer` as the key's JSON above for the kind (`choice`: at least one, exactly one unless `multiple`; for `text` absent or null); `tolerance` null or absent except on `number` (0 to 10¹²); `why` null, or a string of 500 at most after trimming (blank is null) |

What it does, in one transaction:

1. Refuses (`not_offered`) a DIBELS or pair or group piece; refuses (`too_many_questions`) more than 100.
2. Locks the quiz's row (or makes it) and refuses (`stale`) when `updated_at` is not the stored one; then sets the settings and a new `updated_at`.
3. For each question in order: a new one is inserted at `position` = its place; one with an id is updated (archived ones come back). `kind` and `multiple` cannot change once `answered` (`kind_locked`); a choice question's set of choice ids cannot change once `answered` (`choices_locked`); its text, order, prompt, points, competency and key can. Its key row is replaced.
4. Every active question of the quiz not in the list: deleted with its key if no answer names it, else archived.

**What may change once students have answered**: prompt, choice text and order, points, competency, key, settings, adding questions, removing questions (archived). Raw answers are kept and scored again on read, so a fixed key changes every student's suggested result the next time the results are opened (Q4 shows "Changed Since Confirmed"). **What may not**: a question's kind, Several Right, and a choice question's set of choice ids.

**Allowed while the piece is a Draft and after.** A Draft's quiz reaches students on Assign.

**`p_quiz` null removes the quiz**: the quiz row, every question and key. Refused (`has_tries`) once any try exists. Answers `{ "quiz": null, "questions": [], "archived": [] }`. Removing a quiz that is not there answers the same and changes nothing.

A competency taken off the piece at the same instant as a `save_quiz` naming it may make that save refuse with `bad_quiz`: the app saves the assessment form first, then the quiz.

### `list_quiz_tries(p_assessment_id uuid) → jsonb`

```json
{
  "students": [
    {
      "enrollment_id": "uuid",
      "sent": 2,
      "in_progress": false,
      "reopened": false,
      "tries": [
        {
          "attempt_id": "uuid",
          "try": 1,
          "started_at": "timestamptz",
          "sent_at": "timestamptz",
          "reopened_at": null,
          "question_order": { "questions": ["…"], "choices": { "…": ["…"] } },
          "marked": null,
          "marked_at": null,
          "answers": [
            {
              "question_id": "uuid",
              "answer": ["uuid v4"],
              "saved_at": "timestamptz",
              "given_points": null,
              "note": null
            }
          ]
        }
      ]
    }
  ]
}
```

Every student of the class who is **not withdrawn**, in class-list order (`roster_position`, then `id`), each with only their **sent** tries (by `try`) and those tries' answers (by question id). `sent` counts them. `in_progress` is true when the student has an unsent try that has started; `reopened` when they have an unsent try made or marked by Reopen. **An unsent try's answers, order, times and id are never answered**: only those two booleans. A student with no tries is listed with `sent: 0` and `tries: []`. With no quiz: `{ "students": [] }`. Read-only.

### `mark_quiz_answer(p_attempt_id uuid, p_question_id uuid, p_points numeric, p_note text, p_idempotency_key uuid default null) → jsonb`

The teacher's points for one Text answer, and a note. The try must be sent (`not_sent`), the question Text (`not_text`), the answer must exist (`P0002`; a blank answer has no row and counts 0, see "For the grade-math builder"). `p_points` null takes the points away (the answer is waiting again); otherwise 0 to the question's points (`bad_points`). `p_note` is trimmed; null or blank removes it; over 1000 is `bad_note`. Answers:

```json
{ "answer": { "attempt_id": "uuid", "question_id": "uuid", "given_points": 1.5, "note": "text or null" } }
```

It changes nothing else: not `marked`, not a score.

### `reopen_quiz(p_assessment_id uuid, p_enrollment_id uuid, p_idempotency_key uuid default null) → jsonb`

Gives one student one more try. The student must be an active student of the piece's class (`P0002`), the quiz must exist (`P0002`), and the piece must not be a Draft (`draft`).

- The student has an unsent try already made or marked by Reopen: nothing changes; `made: false`.
- The student has an unsent ordinary try (in progress): its `reopened_at` is set to now; `made: false`.
- Otherwise a new try is made: `try` = the student's highest + 1 (1 if none), `reopened_at` now, `question_order` and `started_at` null (MQ2 fills them when the student opens it); `made: true`.

Answers `{ "attempt": { "attempt_id": "uuid", "try": 3, "reopened_at": "timestamptz", "started": false }, "made": true }`.

### Tries: the rule MQ2 and MQ3 use

- **Ordinary tries** are a student's attempts with `reopened_at` null. **Reopened tries** have it set.
- **Tries left** (to start a new ordinary try): unlimited when `quiz.tries = 0`; else `quiz.tries − ordinary tries`, never below 0. Reopen does not change `quiz.tries` or any other student's tries.
- A student **can answer** when they have an unsent try that is reopened (closed or not), or an unsent ordinary try and the quiz is open, or no unsent try, tries left, and the quiz is open (MQ2 then starts one).
- So Reopen gives exactly one try beyond the quiz's number, answerable even after the quiz closes, and it stays open until the student sends it.

### `confirm_quiz(p_assessment_id uuid, p_marks jsonb, p_idempotency_key uuid default null) → jsonb`

Stores what the teacher's app confirmed for each named try. **Writes no score, tag score, rubric score or returned grade**: Q4's `Grader.confirmQuiz` writes those through the grader, in calls of their own.

`p_marks`: an array of 1 to 200 `{ "attempt_id": "uuid", "marked": <marked> | null }` (only those keys), each attempt once. Every attempt must be a sent try (`not_sent`) of this quiz of an active student (`P0002` otherwise). `<marked>` is the object under `quiz_attempt` with exactly the keys `earned`, `possible`, `questions`: `earned` and `possible` numbers, 0 ≤ `earned` ≤ `possible` ≤ 10000; `questions` an object of at most 200 entries, each key a question id of this quiz (active or archived), each value exactly `{ "earned": 0 to 100, "result": "right" | "partly" | "wrong" | "waiting" }`. Anything else is `bad_marks`. All or nothing.

For each item, in order: with a `marked`, every other try of that student loses its `marked` and `marked_at` (one confirmed try per student), then this try gets `marked` and `marked_at = now()`; with `null`, this try loses its `marked` (Undo of a first confirm). Undo of a later confirm sends the earlier marks back the same way. Answers:

```json
{ "confirmed": [{ "attempt_id": "uuid", "enrollment_id": "uuid", "try": 2, "marked_at": "timestamptz or null" }] }
```

### Unassign: the quiz's own trigger

`assessment_quiz_draft_guard`, `before update of is_draft on assessment`, for each row, `when (new.is_draft and not old.is_draft)`, runs `public._quiz_draft_guard()`: when any `quiz_attempt` of the piece exists (sent or not, reopened or not), it raises `draft_has_work` (`P0001`) with `detail` "A student has started the quiz on this assessment, so it cannot go back to a Draft.", the message and code the existing guard raises. A restore (`fv.restoring = 'on'`) is let through, as the existing guard lets it. The existing `assessment_draft_guard` and its function are not changed; both run (the existing one first, by name).

## For the results slice (Q4): two things the database does not do

- **Lowering a question's points below a mark already given leaves the mark as it was.** `mark_quiz_answer` checks points against the question's points when it is called; a later `save_quiz` that lowers the question to 1 point leaves `given_points` 3. `confirm_quiz` checks shape only. The results screen must cap a given mark at the question's points, or ask the teacher to mark it again, before it confirms.
- **Every student function (MQ2) must take the quiz's row `for key share`** before it writes an answer, or a cascade can take an answer with a question `save_quiz` is deleting (step 3 of "Locks, in order").

## For the grade-math builder (Q4, `quizSuggestions`)

Everything it needs comes from `list_quiz` (questions, keys, competencies, settings) and `list_quiz_tries` (sent tries, raw answers, given points). Rules the data fixes:

- Score only active questions (`questions`); archived ones count toward nothing.
- A question with no answer row in a sent try earns 0 and is not waiting, whatever its kind.
- A Text answer with `given_points` null is waiting; with a number, it earns that.
- Choice: compare `answer` and the key's `answer` as sets of ids. True or False: equal booleans. Number: `|answer − key| ≤ tolerance` (tolerance null is 0), compared as the plan says.
- A try counts only if sent. Which try counts (Best, Latest) is the app's; `confirm_quiz` stores the one it chose.

## The student's side (MQ2)

Slice Q3a: `migrations/2026111806_quizzes_student.sql` and the edge function's `supabase/functions/student-submit/quiz-routes.ts`. **This section is exact; the student's quiz screen (Q3b) builds to it.** It replaces the first sketch of MQ2 that stood here. Where it differs from that sketch:

1. **A closed quiz is refused `quiz_closed`, not `closed`.** `closed` already means "this class's page is off or paused for you" (from `_session_class`, on every route); the screen must tell the two apart, as Send Work's `work_closed` does.
2. **`quiz` answers `can_answer`**, so the screen need not work out the tries rule itself.
3. **A reopened try not yet opened** (Reopen after a sent try) is opened by the next `quiz` call, whatever `new_try` says; until then `quiz-save` and `quiz-send` answer `sent`.
4. **A Choice answer is stored sorted** (byte order, collation `C`), as the key is. The order the student ticked is not kept.
5. The write-limit check is widened in one statement, as Bulletins' M2 did (no `not valid` step).

### What it adds, and what it changes

Five functions in `student_submit`, each `security definer`, `search_path` `public, student_submit, pg_temp`:

| Function                                                                                                                                  | Who may run it      | What                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------- |
| `_quiz_window(p_assessment_id uuid, p_course_id uuid) → jsonb`                                                                            | no role             | the piece as a quiz this class's students may open       |
| `_quiz_new_order(p_assessment_id uuid) → jsonb`                                                                                           | no role             | a new `question_order` (shuffled as the quiz says)       |
| `_quiz_questions(p_assessment_id uuid, p_order jsonb) → jsonb`                                                                            | no role             | the active questions in an order, numbered, without keys |
| `quiz(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text, p_new_try boolean default false) → jsonb`         | `service_role` only | route `quiz`                                             |
| `quiz_save(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_question_id uuid, p_answer jsonb, p_ip_hash text) → jsonb` | `service_role` only | route `quiz-save`                                        |
| `quiz_send(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text) → jsonb`                                     | `service_role` only | route `quiz-send`                                        |

(Six rows, five names: the three helpers and the three the edge function calls. "No role" means not `public`, `anon`, `authenticated` or `service_role`; the database's owner runs them through the three.)

It changes one existing thing: `student_submit.write_log`'s `write_log_kind_check` gains `quiz`, so it reads `kind in ('reflect', 'seen', 'finish', 'answer', 'bulletin', 'quiz')` (Bulletins' M2 is applied, so this file names both). No row changes; no table, policy or other function changes. **None of the five reads `quiz_key`**, and none sends `tag_id`, `position`, a key's answer, a tolerance, a "why" line, an archived question, a `marked` value, `given_points`, a note, or anything of another student.

### Who may answer: the rules every one of the three follows

1. `_s := _session_class(p_session_token, p_enrollment_id)`; with `_s ? 'error'` the answer is `{ "ok": false, "error": _s->>'error' }`: `signed_out`, `not_found`, `card_stopped`, `card_expired`, `closed` (page off or paused). Withdrawn is `not_found`.
2. **The piece**: `assessment.id = p_assessment_id`, in the session's class (`course_id = _s->>'course_id'`), `student_submit._listed(a, today)` true (not a Draft, assigned on or before today in the class's time zone), `score_mode <> 'dibels'`, and a `quiz` row. Otherwise `{ "ok": false, "error": "not_found" }`. A piece of another class, a Draft and a piece assigned next week answer the same.
3. **Open or closed**, read as `student_submit._work_window` reads Student Work's, but from the quiz's own columns: `today = (now() at time zone public._fv_timezone(course.timezone))::date`; `after_due = 'keep'` open; `'stop'` open while `due_date is null or today <= due_date`; `'until'` open while `today <= accept_until`. `closes_on` is `accept_until` for `until`, `due_date` for `stop`, null for `keep`.
4. **Tries** (the rule under "Tries" above): ordinary tries have `reopened_at` null. `tries_left` is null when `quiz.tries = 0` (unlimited), else `greatest(quiz.tries - ordinary tries, 0)`. The **open try** is the student's one unsent attempt. The student **can answer** it when it is reopened (`reopened_at` set), whether the quiz is open or not, or when it is ordinary and the quiz is open. The student **can start** a try when they have no open try, the quiz is open, and `tries_left` is null or above 0.
5. **Locks**, in the contract's order: `quiz` takes the assessment's row `for share`; all three take the quiz's row `for key share`; then the student's advisory lock `pg_advisory_xact_lock(hashtext('fv.quiz'), hashtext(assessment_id::text || ':' || enrollment_id::text))`; then attempt rows, then answer rows. So two calls for one student (two phones, two taps) run one after the other, and a Reopen waits for them.
6. **The write limit**: `student_submit._write_limit(card_id, 'quiz', 600)`, 600 an hour per card, shared by the three. It is spent only by a call that writes: each `quiz_save`, each `quiz_send`, and each `quiz` that starts or opens a try; and only after every other check has passed (a refused call spends nothing). The 601st is `{ "ok": false, "error": "too_many", "retry_after_s": 1 to 3600 }` and writes nothing.

### `student_submit.quiz(...)`: open the quiz

What it does, after the rules above:

1. With an open try that has no `question_order` (a reopened try not yet opened): spend one write; set `question_order` (made now, see `quiz_attempt`) and `started_at = now()`.
2. With no open try, when the student has no attempt at all or `p_new_try` is true: if they can start one, spend one write and insert an ordinary try (`try` = the student's highest + 1, `started_at = now()`, the order made now). If `p_new_try` is true and they cannot: `{ "ok": false, "error": "quiz_closed" }` when the quiz is closed, else `{ "ok": false, "error": "no_tries_left" }`. When they have no attempt, `p_new_try` is false and the quiz is closed, nothing is made and the answer below has `try: null`.
3. `p_new_try` true with an open try already: the open try is answered; nothing is made.

Answer (every key always present):

```json
{
  "ok": true,
  "quiz": { "tries": 1, "tries_left": 0, "closed": false, "closes_on": "2026-11-28" },
  "try": {
    "number": 1,
    "sent": false,
    "started_at": "2026-11-18T17:04:11.482913+00:00",
    "sent_at": null,
    "reopened": false
  },
  "sent_tries": 0,
  "can_answer": true,
  "can_try_again": false,
  "questions": [
    {
      "id": "uuid",
      "number": 1,
      "kind": "choice",
      "prompt": "Which is a producer?",
      "points": 1,
      "multiple": false,
      "choices": [
        { "id": "uuid v4", "text": "Grass" },
        { "id": "uuid v4", "text": "Hawk" }
      ]
    },
    {
      "id": "uuid",
      "number": 2,
      "kind": "number",
      "prompt": "Half of 7?",
      "points": 2,
      "multiple": false,
      "choices": null
    }
  ],
  "answers": { "<question id>": ["uuid v4"], "<question id>": 3.5 }
}
```

| Key               | Value                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quiz.tries`      | 0 (unlimited), 1 or 2: the quiz's setting                                                                                                                                                                                         |
| `quiz.tries_left` | null when unlimited, else ordinary tries left (a reopened try is not counted in either)                                                                                                                                           |
| `quiz.closed`     | true when the quiz is closed today (rule 3)                                                                                                                                                                                       |
| `quiz.closes_on`  | `YYYY-MM-DD` or null (rule 3)                                                                                                                                                                                                     |
| `try`             | the open try; with none, the latest sent try (`sent: true`); with no attempt, null                                                                                                                                                |
| `try.number`      | its `try` (1, 2, ...; a reopened try continues the count)                                                                                                                                                                         |
| `try.reopened`    | true when the teacher's Reopen made or marked it                                                                                                                                                                                  |
| `sent_tries`      | how many of this student's tries are sent                                                                                                                                                                                         |
| `can_answer`      | true when `try` is the open try and the student can answer it (rule 4). False on a sent try, with no try, and on an ordinary open try once the quiz has closed                                                                    |
| `can_try_again`   | true when there is no open try and the student can start one (rule 4): then `quiz` with `new_try: true` starts it                                                                                                                 |
| `questions`       | `try`'s questions in this student's order (reading the order, under `quiz_attempt`): active questions only, numbered 1, 2, ...; `choices` in their order with `id` and `text` only, null for other kinds. `[]` when `try` is null |
| `answers`         | `try`'s own saved answers to those questions, by question id, each the raw answer JSON (below). `{}` with none                                                                                                                    |

Refusals: the session's five; `not_found`; `quiz_closed`; `no_tries_left`; `too_many`.

### `student_submit.quiz_save(...)`: save one answer

`p_answer` null (SQL or JSON null) clears the answer (deletes its row). Otherwise it must be, for the question's kind:

| Kind         | `p_answer`                                                                                                           | Stored as                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `choice`     | an array of distinct strings, each one of the question's own choice ids; exactly one unless `multiple`, else 1 to 20 | the ids sorted (collation `C`) |
| `true_false` | `true` or `false`                                                                                                    | as sent                        |
| `number`     | a JSON number, -10^12 to 10^12                                                                                       | as sent                        |
| `text`       | a string, 1 to 5000 characters after ASCII white space is trimmed at both ends                                       | trimmed                        |

In order, after rules 1, 2 and 5:

1. No open try, or an open try not yet opened: `{ "ok": false, "error": "sent" }` when the student has a sent try, else `not_found`.
2. The student cannot answer the open try: `quiz_closed`.
3. `p_question_id` is not an active question of this quiz (archived, another quiz's, made up): `not_found`.
4. `p_answer` is not the shape above: `{ "ok": false, "error": "bad_answer", "question_id": "<p_question_id>" }`.
5. Spend one write (`too_many`).
6. Insert or replace the row `(attempt, question)`: `answer`, `saved_at = clock_timestamp()`, `given_points` and `note` null. The later of two saves replaces the earlier.

Answer: `{ "ok": true, "question_id": "uuid", "saved_at": "timestamptz" }`. For a clear, `saved_at` is when it was cleared.

### `student_submit.quiz_send(...)`: send the try

In order, after rules 1, 2 and 5: no open try or one not yet opened: `sent` (with a sent try) or `not_found`; the student cannot answer it: `quiz_closed`; spend one write (`too_many`); set `sent_at = clock_timestamp()`. Nothing checks that every question is answered (the screen asks). A sent try is never changed by a student again: a second `quiz_send` is `sent`, a `quiz_save` after it is `sent`.

Answer: `{ "ok": true, "try": 1, "sent_at": "timestamptz", "tries_left": 0, "can_try_again": false }` (`tries_left` and `can_try_again` as `quiz` would now answer them).

### The access rule for unfinished answers

Only the student's own session (a session holding that enrolment, through `_session_class`) reads or writes an unsent try. The teacher's `list_quiz_tries` answers only sent tries (two booleans of an unsent one); another student's session is `not_found` (their enrolment is not on it); a classmate's session naming this student's enrolment is `not_found`.

### The routes (`quiz-routes.ts`)

The phone posts JSON to the `student-submit` edge function, as every route does. A request of the wrong shape is HTTP 400 `{ "ok": false, "error": "bad_request" }` and the database is not asked. Every other answer is HTTP 200 with the reply below, rebuilt key by key from the lists in `SENT` (`tests/student-submit-allow-list.test.js` holds them to the SQL); a refusal is passed on by its code (any code the route does not name becomes `not_found`); a database error is HTTP 500 `{ "ok": false, "error": "server" }`.

| Route       | Request                                                                                          | Calls                      |
| ----------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| `quiz`      | `{ "route": "quiz", "session", "enrollment_id", "assessment_id", "new_try"? }`                   | `student_submit.quiz`      |
| `quiz-save` | `{ "route": "quiz-save", "session", "enrollment_id", "assessment_id", "question_id", "answer" }` | `student_submit.quiz_save` |
| `quiz-send` | `{ "route": "quiz-send", "session", "enrollment_id", "assessment_id" }`                          | `student_submit.quiz_send` |

Shapes: `session` a string of 1 to 128 characters; each id a UUID; `new_try` absent (false) or a boolean; `answer` required (the key present): null, a boolean, a finite number, a string of at most 5000 characters after trimming (and 20,000 before) with no NUL and no lone surrogate, or an array of 0 to 20 UUID strings. Anything else is `bad_request`. The database checks the rest (`bad_answer`).

Replies: `quiz` as above, `quiz-save` and `quiz-send` as above, refusals `{ "ok": false, "error" }`, plus `question_id` on `bad_answer` and `retry_after_s` on `too_many`.

| Route       | Refusals passed on                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `quiz`      | `signed_out`, `not_found`, `card_stopped`, `card_expired`, `closed`, `quiz_closed`, `no_tries_left`, `too_many` |
| `quiz-save` | the session's five, `quiz_closed`, `sent`, `bad_answer`, `too_many`                                             |
| `quiz-send` | the session's five, `quiz_closed`, `sent`, `too_many`                                                           |

The edge function is the second look: a key the database might add later is dropped until it is named in `SENT`; a question carries only `id`, `number`, `kind`, `prompt`, `points`, `multiple`, `choices`; a choice only `id` and `text`; an answer only a raw answer's shape, under a question id that is in `questions`.

### For the student's screen (Q3b)

- Open the screen with `quiz` (`new_try` false). Show `questions` in the order given and number them by `number`. Show `answers`. When `can_answer` is false, show the answers read-only.
- Save each answer as it changes with `quiz-save`; a cleared answer sends `answer: null` (a blank text box too: an empty string is `bad_answer`). Send with `quiz-send`. "Try Again" is `quiz` with `new_try: true`, offered only when `can_try_again`.
- `sent` on a save means the try was sent elsewhere (another phone) or a Reopen is waiting: call `quiz` again and show what it answers. `quiz_closed` on a save: the quiz closed while it was open; call `quiz`.
- Every open and save spends one of 600 writes an hour per card; never save on a timer, only when an answer changes.
- Two phones on one card: the later save wins. A phone that was offline sends its saves when it returns and may then replace newer ones from the other phone.

## MQ3, the returned view (slice Q5a): build exactly this

File `migrations/<date>_quiz_returned.sql`. One function, `student_submit.quiz_result(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text) → jsonb`, as MQ2's are (service_role only, `_session_class` first, the same `not_found`). **It is the only function in `student_submit` that may name `quiz_key`.**

It sends anything about right and wrong **only when all hold**:

1. **Returned to this student**: `student_submit._returned_grade(p_enrollment_id, p_assessment_id)` has `returned_at` not null and `grade` not null (a Draft grade is never sent; Missing or Excused sends nothing).
2. **The student can no longer answer**: no unsent try, and the quiz is closed or no tries are left.
3. **One try is confirmed**: the attempt with `marked` not null, and its `marked_at <= returned_at` (a marking confirmed after the last return is a draft until returned again). Q5a checks how `returned_at` moves under As Soon As I Save before relying on this.
4. **`shows`** allows it.

Otherwise: `{ "ok": true, "returned": false }` and nothing else. When all hold:

```json
{
  "ok": true,
  "returned": true,
  "shows": "answers",
  "total": { "earned": 7, "possible": 10 },
  "questions": [
    {
      "id": "uuid",
      "number": 1,
      "kind": "choice",
      "prompt": "…",
      "points": 1,
      "multiple": false,
      "choices": [{ "id": "uuid v4", "text": "…" }],
      "your_answer": ["uuid v4"],
      "result": "right",
      "answer": ["uuid v4"],
      "why": "…"
    }
  ]
}
```

`total` only when `add_total` (from `marked.earned`, `marked.possible`). `shows: "grade"`: no `questions` key. `right`: each question in this student's order with `result` from `marked.questions` (null when absent), `your_answer` the try's own answer (null when none). `answers`: also `answer` (the key's) and `why`. Archived questions are left out.

## Limits (the author's, easy to change, listed for Colin)

100 questions; a prompt 1000 characters; 2 to 20 choices of 300; a "why" 500; points 0 to 100 a question; a number ±10¹²; a Text answer 5000; a teacher's note 1000; 200 tries in one `confirm_quiz`; tries one, two or unlimited; 600 student quiz writes an hour per card (MQ2).
