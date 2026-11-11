# S4-M1: the contract

What `student_submit.page` and `student_submit._session_classes` send once `migrations/2026111103_student_page_fields.sql` is applied. Written for three readers: whoever extends the edge function's lists (`supabase/functions/student-submit/card-routes.ts`), whoever makes `shared/student-view.js` build the same reply from a teacher's cache (`StudentView.reply`, for Preview as Student), and whoever draws the page (`s/`).

If you must depart from anything here, add a dated line under "Changes" at the bottom saying what and why.

## The settled rules

- Every key the reply had before has the same value as before. `v` is still 1. Nothing about a grade, a draft, a returned copy, a status or what counts as returned is different.
- With the migration applied, **every new key is on every object it belongs to**. A value that does not exist is `null` or `[]`, never a missing key.
- Until the edge function's lists are extended, **a phone receives none of the new keys** (the function copies a reply field by field and leaves the rest behind). And if the migration is ever undone, the keys are gone again. So the page's drawing code must read a missing key as it reads `null` or `[]`: show nothing.
- Text is sent as it is stored: nothing is trimmed, and a list keeps its order and its blanks. The only tidy-up is that an empty string becomes `null` for `teacher_name` and `description`.
- Every new key is about the session's own student and class. Nothing is another student's, nothing is about the class as a whole, and nothing is a teacher's alone.

## The new keys

| Where                           | Key                 | Type                    | What it is                                                                                                                        | Empty                                                                |
| ------------------------------- | ------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `course`                        | `teacher_name`      | text or `null`          | The class's teacher's display name (`teacher.display_name`): the name they signed up with.                                        | `null` when the teacher has none, or it is empty                     |
| `tags.<tag id>`                 | `i_can`             | list of text            | The competency's I Can statements as the class has them (`tag.i_can_statements`), in the class's order.                           | `[]`                                                                 |
| `rubrics[].criteria[]`          | `tag_ids`           | list of tag ids         | The competencies this row counts toward (`criterion_tag`), only those still on the class. Ordered by id. Each is a key of `tags`. | `[]`                                                                 |
| `assessments[]`                 | `description`       | text or `null`          | What the teacher typed in the assignment's Description box.                                                                       | `null` when there is none, or it is empty                            |
| `assessments[]`                 | `module_name`       | text or `null`          | The name of the module the piece is filed under (`assessment.module_id`). The boards call it the unit.                            | `null` when it is filed under none                                   |
| `assessments[]`                 | `category_name`     | text or `null`          | The name of the piece's category (`category.name`).                                                                               | `null` when it has no category                                       |
| `assessments[]`                 | `category_percent`  | number or `null`        | What that category counts toward the course grade, as the class's Grading setup has it. See below.                                | `null` where no percent would be true, and when there is no category |
| `assessments[]`                 | `core_competencies` | list of `{ id, name }`  | The piece's Core Competencies, each once, in the Ministry's order.                                                                | `[]`                                                                 |
| `classes[]` (and `verify_card`) | `to_do`             | whole number, 0 or more | How many pieces wait for the student in that class. See below.                                                                    | `0`                                                                  |

`classes` is the session's list of classes, which `page` and `verify_card` (routes `verify` and `add-card`) both send. Both gain `to_do`.

### `category_percent`

A class's category weights are on `public.category` (`weight`, 0 to 100). A class's weights total 100, or it has no categories. `shared/calc.js` works the course % out as each category's % times its weight, over the weights of the categories the student has a % in (`getCourseLetterData`), and only for a class whose grading style shows a % (`assessmentCourseWorth` answers `null` in a Proficiency class). The first row that fits decides:

| The piece                                                                          | `category_percent`    |
| ---------------------------------------------------------------------------------- | --------------------- |
| is a DIBELS benchmark (`score_mode` is `dibels`)                                   | `null`                |
| has no category                                                                    | `null`                |
| its category weighs 0, in any grading style                                        | `0`                   |
| the class is Letter or Both and its weights total 100                              | the category's weight |
| the class is Proficiency and the category weighs more than 0                       | `null`                |
| the class's weights do not total 100 (a class saved before 2026-10-16 could be so) | `null`                |

Drawing it:

- A number above 0: "Tests · 40% of your grade" is true as the class is set up. It is the category's share, not this one piece's.
- `0`: work in this category counts toward nothing (`countsTowardGrades` in `calc.js`), in every grading style. "Doesn't count toward your grade" is true.
- `null`: say nothing about a percent. The category's name alone is still true.
- The figure is the class's setup, not the student's own arithmetic. While a category holds no graded work for a student, `calc.js` shares the grade among the others, so early in a term a category can carry more than its figure. Do not word it as a promise about this student's grade today.
- Do not add figures together or work one out for a single piece: the page is sent only the pieces whose date has come, which is not the whole class.

The same rule in the browser, for `StudentView.reply`:

```js
// categories: getCategories(cid). category: getCategoryById(cid, a.categoryId), or null.
var total = categories.reduce(function (sum, c) {
  return sum + Number(c.weight || 0);
}, 0);
var percent =
  !category || isDibelsScored(a)
    ? null
    : Number(category.weight) === 0
      ? 0
      : courseGradeMode(cid) !== 'proficiency' && total === 100
        ? Number(category.weight)
        : null;
```

### `to_do`

The pieces of that class that are on the student's page, take a grade, and have none returned. It is the number `StudentView.build` gives for the same class as `counts.toDo + counts.missing` (the owner's ruling: To Do counts Missing work too).

A piece is counted when all of these hold:

1. it is listed: its date has come where the class is, or it has no date;
2. it is not a DIBELS benchmark;
3. it is marked Missing (`status` is `NS`), **or** it is not Excused (`status` is not `EXC`) and it has never been returned (`returned_at` is `null`).

`status` and `returned_at` are the ones `page` sends for that piece: both come from `student_submit._returned_grade`. So, for the class the reply is for:

```js
var toDo = reply.assessments.filter(function (a) {
  if (a.score_mode === 'dibels') return false;
  return a.status === 'NS' || (a.status !== 'EXC' && !a.returned_at);
}).length; // equals the to_do of that class in reply.classes
```

What follows from that:

- A draft never moves it. A piece with a draft and no earlier return counts exactly as a piece never graded; a draft saved over a returned grade leaves the piece returned.
- A returned piece marked Missing waits again, at once. Excused never waits. Late changes nothing.
- A piece that came back with nothing left to show (every competency it was graded on was since taken off the class) still came back: it does not wait, though its `grade` is `null`.
- A returned grade that the teacher cleared and returned again is a piece with no grade: `returned_at` is `null` and it waits.
- Opening a piece (`seen`) changes nothing.

`StudentView.reply` does not send `classes` (the cache has no session), so Preview has no `to_do` to match; Preview's own counts come from `build`.

## What is not sent

- **Competencies a rubric scores as a whole** (`rubric_tag`). A rubric can link a competency to the whole rubric instead of to a row; `criteria[].tag_ids` holds only a row's own links, so such a rubric shows no competency on any row. If the board needs them it is one more key (`rubrics[].tag_ids`) and its own change.
- A competency's wording (`tag.i_can_text`, which despite its name is the competency's wording) and its curriculum text.
- Ids of the category and the module: only their names. Two categories a teacher gave the same name read as one on the page.
- The category's Calculation (Total Points or Average of Percentages), any other category, and every piece's own share of the grade.
- Anything of the teacher but the display name: no email, no id.

## For the edge function (`card-routes.ts`)

The reply is copied field by field, so each new key must be named:

- `course()`: add `teacher_name` to the plain fields.
- `classes()`: add `to_do` beside `enrollment_id`.
- `page()`'s `tags`: `i_can` is a list of text; copy the strings and leave anything else behind.
- `rubric()`'s criteria: `tag_ids` is a list of ids, checked as `assessment()` checks its own `tag_ids`.
- `assessment()`: `description`, `module_name`, `category_name` and `category_percent` are plain fields; `core_competencies` is a list of `{ id, name }`, both text.

`verified()` gets `to_do` through `classes()`. No route, statement or error changes.

## For `StudentView.reply` (the cache)

The server's values, and where the cache holds the same thing as I read `shared/data.js` (pointers, not tested in a browser):

| Key                  | From the cache                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teacher_name`       | `getConfig().displayName` (the teacher's own row as `bootstrap_teacher` returns it), `null` when empty. Not `user_metadata.display_name`, which can differ. |
| `i_can`              | the tag's `i_can_statements` as loaded: not trimmed, blanks kept (`_iCanStatementsOf` tidies; the server does not)                                          |
| `criteria[].tag_ids` | the criterion's `tagIds`, only ids that are keys of the reply's `tags`, sorted                                                                              |
| `description`        | `a.description`, `null` when empty                                                                                                                          |
| `module_name`        | `getModuleById(cid, a.moduleId)`'s `name`, or `null`                                                                                                        |
| `category_name`      | `getCategoryById(cid, a.categoryId)`'s `name`, or `null`                                                                                                    |
| `category_percent`   | the rule above                                                                                                                                              |
| `core_competencies`  | `_coreCompetencyIdsOf(a.coreCompetencyIds)` mapped to `{ id, name: getCoreCompetency(id).label }`                                                           |

The Core Competency names in the SQL are the labels of `CORE_COMPETENCIES` in `shared/constants.js`. `tests/student-page-fields.test.js` fails if the two lists differ, so a label changed in one place cannot drift from the other unnoticed.

## A worked example

One student, CeCe, signed in with two cards in one session. Science 8 is a Letter-and-Proficiency class (`both`) on When I Return Them, with categories Tests 40, Projects 60 and Practice 0. Lab Report was graded and returned. Cells Quiz is marked Missing. Exit Ticket holds a draft, which the reply does not show in any way: it reads as a piece never graded. Ids are UUIDs, shortened here. Times are printed as `jsonb` prints a `timestamptz`.

Science 8's `to_do` is 2: Cells Quiz (Missing) and Exit Ticket (never returned). Lab Report came back.

```json
{
  "ok": true,
  "v": 1,
  "expires_at": "2026-11-11T07:00:00+00:00",
  "student": { "enrollment_id": "<enrollment-1>", "first_name": "CeCe" },
  "course": {
    "name": "Science 8",
    "block": "C",
    "grading_system": "both",
    "grading_scale": null,
    "level_order": "desc",
    "round_percent": null,
    "teacher_name": "Ms. Okafor"
  },
  "classes": [
    {
      "enrollment_id": "<enrollment-1>",
      "student": { "first_name": "CeCe" },
      "course": { "name": "Science 8", "block": "C" },
      "to_do": 2
    },
    {
      "enrollment_id": "<enrollment-2>",
      "student": { "first_name": "CeCe" },
      "course": { "name": "Socials 8", "block": "B" },
      "to_do": 2
    }
  ],
  "tags": {
    "<tag-1>": {
      "label": "Ask questions",
      "code": "Q1",
      "i_can": ["I can ask a question that can be tested.", "I can say what I expect to happen."]
    },
    "<tag-2>": { "label": "Plan a fair test", "code": "Q2", "i_can": [] }
  },
  "rubrics": [
    {
      "id": "<rubric-1>",
      "name": "Lab Report",
      "style": "advanced",
      "criteria": [
        {
          "id": "<criterion-1>",
          "name": "Method",
          "weight": 1.0,
          "level_1_value": 1,
          "level_2_value": 2,
          "level_3_value": 3,
          "level_4_value": 4,
          "level_1_descriptor": null,
          "level_2_descriptor": null,
          "level_3_descriptor": "Every step is listed, in order.",
          "level_4_descriptor": null,
          "tag_ids": ["<tag-1>", "<tag-2>"],
          "checks": [{ "id": "<check-1>", "level": 3, "label": "Lists every step" }]
        },
        {
          "id": "<criterion-2>",
          "name": "Conclusion",
          "weight": 1.0,
          "level_1_value": 1,
          "level_2_value": 2,
          "level_3_value": 3,
          "level_4_value": 4,
          "level_1_descriptor": null,
          "level_2_descriptor": null,
          "level_3_descriptor": null,
          "level_4_descriptor": null,
          "tag_ids": ["<tag-2>"],
          "checks": [{ "id": "<check-2>", "level": 3, "label": "Answers the question" }]
        }
      ]
    }
  ],
  "assessments": [
    {
      "id": "<assessment-1>",
      "title": "Lab Report",
      "date": "2026-11-04",
      "due_date": "2026-11-08",
      "created_at": "2026-11-11T06:05:52.513413+00:00",
      "score_mode": "proficiency",
      "max_points": null,
      "weight": 1.0,
      "rubric_id": "<rubric-1>",
      "tag_ids": [],
      "description": "Write up the density lab. Use the checklist on the back.",
      "module_name": "Unit 1: Cells",
      "category_name": "Projects",
      "category_percent": 60,
      "core_competencies": [
        { "id": "COM", "name": "Communicating" },
        { "id": "CRT", "name": "Critical & Reflective Thinking" }
      ],
      "status": null,
      "returned_at": "2026-11-11T06:05:52.562805+00:00",
      "updated_at": null,
      "seen_at": null,
      "grade": {
        "v": 1,
        "value": null,
        "modifier": 0,
        "comment": "A clear report.",
        "tags": {},
        "criteria": {
          "<criterion-1>": { "value": 3, "modifier": 0, "comment": "Number your steps next time.", "beyond": null },
          "<criterion-2>": { "value": 4, "modifier": 0, "comment": null, "beyond": null }
        },
        "checks": ["<check-1>"]
      },
      "previous": null
    },
    {
      "id": "<assessment-2>",
      "title": "Cells Quiz",
      "date": "2026-11-07",
      "due_date": null,
      "created_at": "2026-11-11T06:05:52.517563+00:00",
      "score_mode": "points",
      "max_points": 10,
      "weight": 1.0,
      "rubric_id": null,
      "tag_ids": [],
      "description": null,
      "module_name": "Unit 1: Cells",
      "category_name": "Tests",
      "category_percent": 40,
      "core_competencies": [],
      "status": "NS",
      "returned_at": null,
      "updated_at": null,
      "seen_at": null,
      "grade": null,
      "previous": null
    },
    {
      "id": "<assessment-3>",
      "title": "Exit Ticket",
      "date": "2026-11-09",
      "due_date": null,
      "created_at": "2026-11-11T06:05:52.519885+00:00",
      "score_mode": "proficiency",
      "max_points": null,
      "weight": 1.0,
      "rubric_id": null,
      "tag_ids": ["<tag-1>", "<tag-2>"],
      "description": null,
      "module_name": null,
      "category_name": "Practice",
      "category_percent": 0,
      "core_competencies": [],
      "status": null,
      "returned_at": null,
      "updated_at": null,
      "seen_at": null,
      "grade": null,
      "previous": null
    }
  ]
}
```

The values are what the two functions returned for that class on the local harness (PostgreSQL 17.11); the keys are grouped here for reading (`jsonb` keeps no order), the ids are shortened and the times are shown in UTC.

## Fingerprints

`md5(pg_get_functiondef(...))` on PostgreSQL 17, from the harness built as `gradebook-prod` is:

| Function                                | As live has it                     | As S4-M1 leaves it                 |
| --------------------------------------- | ---------------------------------- | ---------------------------------- |
| `student_submit.page(text,uuid,text)`   | `e744f2a27bcfd6fef662bbddeb9659c7` | `034e6674a25f8a5e1abc067f50784ce6` |
| `student_submit._session_classes(uuid)` | `6ef848f90721affa406d2b7fef89d285` | `722d403571069e3e97516f432ed9de5c` |

## Changes

None yet.
