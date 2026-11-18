# Quizzes: the contract (Q1, 2026-11-17)

What `migrations/2026111802_quizzes.sql` (MQ1, slice Q1) gives the teacher's browser, and what MQ2 (slice Q3a) and MQ3 (slice Q5a) must give the student page. The plan is `docs/plans/quizzes-plan.md`. The teacher-app builder (Q2b, Q4), the student-page builder (Q3b, Q5b) and the grade-math builder (Q4's `quizSuggestions` in `shared/calc.js`) need nothing else.

Not in MQ1: any `student_submit` function, any change to `student_submit.write_log`, the edge function, any app code. MQ1 changes no existing row, table, policy, constraint or function. It adds five tables, six functions a teacher may run, one private helper, three trigger functions and three triggers (one on `assessment`, one on `assessment_tag`, one on its own `quiz_attempt`), and the foreign keys' own internal triggers on `assessment` and `enrollment`.

MQ1 is two files, applied in this order, each under 40 KB: `migrations/2026111802_quizzes.sql` (the tables, the triggers, `list_quiz`, `save_quiz`, `list_quiz_tries`) and `migrations/2026111803_quiz_results.sql` (`mark_quiz_answer`, `reopen_quiz`, `confirm_quiz`), each with its own guard, pre-check, post-check and undo.

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

| Kind         | `answer`                                                                                                  | `tolerance`       |
| ------------ | --------------------------------------------------------------------------------------------------------- | ----------------- |
| `choice`     | `["<choice id>"]`, or with `multiple` several: `["<id>", "<id>"]`, sorted, each one of the question's own | null              |
| `true_false` | `true` or `false`                                                                                         | null              |
| `number`     | a JSON number, −10¹² to 10¹²: `3.5`                                                                       | null or 0 to 10¹² |
| `text`       | null (assessed by hand)                                                                                   | null              |

**No function of the student page reads this table except MQ3's `student_submit.quiz_result`.** MQ1 has none; `quizzes.py` checks that no `student_submit` function names it.

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

| Deleted or changed                                                     | Takes                                                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| an assessment (`delete_assessment`, or with its class)                 | its quiz, questions, key, every try and every answer (foreign keys, on delete cascade) |
| a class purged from the trash (`fv_retention_cleanup`)                 | the same, for every piece and student of it                                            |
| a student deleted for good (`delete_withdrawn_student`)                | their tries and answers                                                                |
| a withdrawn student                                                    | nothing: their rows stay, and every teacher function leaves them out                   |
| a question removed by `save_quiz`, no answer names it                  | the question and its key                                                               |
| a question removed by `save_quiz`, an answer names it                  | nothing: it is archived (`archived_at`, `position` null), its key and answers kept     |
| a competency taken off the piece (`assessment_tag` row gone at commit) | `tag_id` becomes null on that piece's questions with it; the questions stay            |
| a competency deleted (`tag`)                                           | the same, through the `assessment_tag` cascade                                         |

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

All in `public`, `security definer`, `search_path` `public, pg_temp`, executable by `authenticated` only (not `anon`, not `service_role`, not `public`). Each first raises `PT401` (`not authenticated`) when `auth.uid()` is null, then checks the class through `fv_owns_assessment` (the assessment found from the attempt for `mark_quiz_answer`). Every write takes `p_idempotency_key uuid default null`, calls `fv_idem_check(key, '<function name>')` before anything else is read, and `fv_idem_store` with its answer; the same key again answers the first reply and writes nothing, and the same key from two windows at once waits on the key's lock and then gets the first's reply. A refused call stores nothing.

**Refusals.** Every refusal is an error; the app reads `code` (SQLSTATE) and `message` (a word), and may show `detail` (a plain sentence).

| SQLSTATE | `message`            | When                                                                                                                                                                                             |
| -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PT401`  | `not authenticated`  | signed out                                                                                                                                                                                       |
| `P0002`  | `not found`          | the assessment, attempt, question or student is not there, not this teacher's, or its class is in the trash; the quiz is missing (all but `save_quiz` and `list_quiz`); the student is withdrawn |
| `22023`  | `bad_quiz`           | `p_quiz` breaks a rule below; `detail` names the question (by its place, 1 …) and the field                                                                                                      |
| `22023`  | `not_offered`        | the piece is scored DIBELS, or is a pair or group piece (`collab_mode` not `none`)                                                                                                               |
| `22023`  | `too_many_questions` | more than 100 questions                                                                                                                                                                          |
| `22023`  | `kind_locked`        | a question with answers would change `kind` or `multiple`                                                                                                                                        |
| `22023`  | `choices_locked`     | a choice question with answers would gain, lose or change a choice id                                                                                                                            |
| `22023`  | `has_tries`          | `p_quiz` null (remove the quiz) once any try exists                                                                                                                                              |
| `22023`  | `not_sent`           | marking or confirming a try that is not sent                                                                                                                                                     |
| `22023`  | `not_text`           | `mark_quiz_answer` on a question that is not Text                                                                                                                                                |
| `22023`  | `bad_points`         | `mark_quiz_answer` points below 0 or above the question's points                                                                                                                                 |
| `22023`  | `bad_note`           | a note over 1000 characters                                                                                                                                                                      |
| `22023`  | `bad_marks`          | `p_marks` breaks a rule below; `detail` says which                                                                                                                                               |
| `22023`  | `draft`              | `reopen_quiz` on a Draft                                                                                                                                                                         |
| `P0001`  | `draft_has_work`     | Unassign once a try exists (the trigger, below)                                                                                                                                                  |

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

| Key                 | Type                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `shuffle_questions` | boolean                                                           |
| `shuffle_choices`   | boolean                                                           |
| `tries`             | 0, 1 or 2                                                         |
| `counts`            | `best` or `latest`                                                |
| `shows`             | `grade`, `right` or `answers`                                     |
| `add_total`         | boolean                                                           |
| `after_due`         | `keep`, `stop` or `until`                                         |
| `accept_until`      | a date string `YYYY-MM-DD` when `after_due` is `until`, else null |
| `questions`         | an array of 0 to 100 questions, in the order they are numbered    |

Each question is an object with these keys only:

| Key        | Required                 | Rule                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | no (absent or null: new) | a question of this quiz, active or archived (an archived one comes back); not twice in the list                                                                                                                                                                                                                                                               |
| `kind`     | yes                      | `choice`, `true_false`, `number` or `text`                                                                                                                                                                                                                                                                                                                    |
| `prompt`   | yes                      | a string, 1 to 1000 characters after trimming (stored trimmed)                                                                                                                                                                                                                                                                                                |
| `choices`  | for `choice` only        | 2 to 20 `{ "id", "text" }` (only those keys): id a lower-case version-4 UUID, distinct; text 1 to 300 after trimming (stored trimmed). Absent or null for other kinds                                                                                                                                                                                         |
| `multiple` | no (default false)       | boolean; true only for `choice`                                                                                                                                                                                                                                                                                                                               |
| `points`   | yes                      | a number, 0 to 100                                                                                                                                                                                                                                                                                                                                            |
| `tag_id`   | yes (may be null)        | null, or a competency on this piece (`assessment_tag`)                                                                                                                                                                                                                                                                                                        |
| `key`      | yes                      | `{ "answer", "tolerance", "why" }` (only those keys; `tolerance` and `why` may be absent): `answer` as the key's JSON above for the kind (`choice`: at least one, exactly one unless `multiple`; for `text` absent or null); `tolerance` null or absent except on `number` (0 to 10¹²); `why` null, or a string of 500 at most after trimming (blank is null) |

What it does, in one transaction:

1. Refuses (`not_offered`) a DIBELS or pair or group piece; refuses (`too_many_questions`) more than 100.
2. Makes the `quiz` row if there is none, or sets its settings and `updated_at`.
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

## For the grade-math builder (Q4, `quizSuggestions`)

Everything it needs comes from `list_quiz` (questions, keys, competencies, settings) and `list_quiz_tries` (sent tries, raw answers, given points). Rules the data fixes:

- Score only active questions (`questions`); archived ones count toward nothing.
- A question with no answer row in a sent try earns 0 and is not waiting, whatever its kind.
- A Text answer with `given_points` null is waiting; with a number, it earns that.
- Choice: compare `answer` and the key's `answer` as sets of ids. True or False: equal booleans. Number: `|answer − key| ≤ tolerance` (tolerance null is 0), compared as the plan says.
- A try counts only if sent. Which try counts (Best, Latest) is the app's; `confirm_quiz` stores the one it chose.

## MQ2, the student's side (slice Q3a): build exactly this

File `migrations/<date>_quizzes_student.sql`. Three functions in `student_submit`, `security definer`, `search_path` `public, student_submit, pg_temp`, executable by `service_role` only. Each begins with `_s := student_submit._session_class(p_session_token, p_enrollment_id)` and answers `{ "ok": false, "error": _s->>'error' }` when it has one (`signed_out`, `not_found`, `closed`, `card_stopped`, `card_expired`, …, as every route does). Then the piece: `assessment` with `id = p_assessment_id and course_id = _s->>'course_id'`, `student_submit._listed(a, today)` true, `score_mode <> 'dibels'`, and a `quiz` row; otherwise `{ ok: false, error: 'not_found' }`. **None of them reads `quiz_key`, and none sends `tag_id`, a key's answer, `why`, archived questions, another student's anything, or anything from which right could be told.**

Refusal answers, exactly: `{ "ok": false, "error": "closed" }` (the quiz is closed and the student has no reopened try), `{ "ok": false, "error": "no_tries_left" }`, `{ "ok": false, "error": "not_found" }`, `{ "ok": false, "error": "sent" }` (the try was sent: no try is open), `{ "ok": false, "error": "bad_answer", "question_id": "uuid" }`, `{ "ok": false, "error": "too_many", "retry_after_s": 120 }`.

**Write limit.** `student_submit._write_limit(card_id, 'quiz', 600)` (600 an hour per card) before each `quiz_save`, each `quiz_send`, and each `quiz` call that starts a try. MQ2 widens `write_log_kind_check` to add `quiz`: `alter table student_submit.write_log drop constraint write_log_kind_check, add constraint write_log_kind_check check (kind in ('reflect', 'seen', 'finish', 'answer', 'quiz')) not valid;` then `validate constraint`. Bulletins' M2 widens the same check: **whichever is applied second names both kinds.**

### `student_submit.quiz(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text, p_new_try boolean default false) → jsonb`

Locks: the assessment's row `for share`, then the quiz's row `for key share`, then the student's advisory lock. Then:

1. The open try is the student's unsent attempt. If it has no `question_order` (a reopened try not yet opened), fill `question_order` and `started_at` now.
2. If there is none, and either the student has no attempt at all or `p_new_try` is true, and they can start one (open, tries left): insert an ordinary try (`try` = highest + 1, `started_at` now, the order made as under `quiz_attempt`). If `p_new_try` is true and they cannot: `closed` or `no_tries_left`.
3. Answer:

```json
{
  "ok": true,
  "quiz": { "tries": 1, "tries_left": 0, "closed": false, "closes_on": "2026-11-28 or null" },
  "try": { "number": 1, "sent": false, "started_at": "timestamptz", "sent_at": null, "reopened": false },
  "sent_tries": 0,
  "can_try_again": false,
  "questions": [
    {
      "id": "uuid",
      "number": 1,
      "kind": "choice",
      "prompt": "…",
      "points": 1,
      "multiple": false,
      "choices": [{ "id": "uuid v4", "text": "…" }]
    }
  ],
  "answers": { "<question id>": ["uuid v4"] }
}
```

`tries_left` is null when unlimited. `closes_on` is `accept_until` or the due date as `_work_window` gives it. `try` is the open try, or with none the latest sent try (`sent: true`), or null with no try. `questions` are in this student's order (reading the order, under `quiz_attempt`) for that try, choices in their order with `id` and `text` only, `choices` null for other kinds; `[]` when `try` is null. `answers` are that try's own answers by question id (`{}` with none). `can_try_again`: no open try, tries left and open.

### `student_submit.quiz_save(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_question_id uuid, p_answer jsonb, p_ip_hash text) → jsonb`

Locks: the quiz's row `for key share`, the student's advisory lock. The open try must exist and be started (`sent` if the latest try is sent, `not_found` if there is none); the student must be able to answer it (`closed`); the question must be an active question of the quiz (`not_found`). `p_answer` null deletes the answer. Otherwise it must be the raw answer's JSON for the question's kind (table above; choice ids among the question's own; text trimmed, 1 to 5000), else `bad_answer`. Insert or replace the row (`answer`, `saved_at = now()`, `given_points` and `note` null). A later save replaces an earlier. Answers `{ "ok": true, "question_id": "uuid", "saved_at": "timestamptz" }`.

### `student_submit.quiz_send(p_session_token text, p_enrollment_id uuid, p_assessment_id uuid, p_ip_hash text) → jsonb`

Locks as `quiz_save`. Sets `sent_at = now()` on the open try (`sent` if none is open and the latest is sent, `not_found` if there is no try; `closed` if the student cannot answer it). A sent try is never changed by a student again. Answers `{ "ok": true, "try": 1, "sent_at": "timestamptz", "tries_left": 0, "can_try_again": false }`.

**The access rule for unfinished answers**: only the student's own session (a session holding that enrolment, through `_session_class`) reads or writes them. The teacher's functions never return them; another student's session is `not_found`.

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
