# Reflect: one sign-in, a teacher's switch, and reflections a teacher builds

Colin, Nov 16, 2026: "No more QR code slips specifically for the questionnaires. Students can access them through their regular sign-in. Extra codes complicates things. Allow teachers to turn them on. … i should also be able to create custom questionnaires that go into their reflect section." Then: "Reflect 'Questionnaires' into Reflect altogether so it's not confusing for teachers or students", and of the builder: "provide more and better options- like MS Forms, almost. teachers are used to that style of system." He approved the mockup (five boards) with "Build as shown".

Mockup: https://claude.ai/artifact/Fbfhx4hfgkxHsaBedA3DXz (boards: 1 the Reflect tab in Class Settings, 2 New Reflection, 3 See Answers, 4 the student's Reflect tab, 5 a student answering).

## What was wrong

On Nov 16 his Philosophy 12 and History 12 classes signed in with their cards and Reflect was empty. `student_submit._card_listed` listed a questionnaire on a card only for a student who had a printed slip for it (not taken back) or had already answered it. History 12 had no slips at all; Philosophy 12 had one for the November Reflection. Turning a questionnaire On did not put it on the student page. No real student had ever answered through a slip (0 responses in live classes).

## What changes

1. **One name.** The student's tab and the Class Settings tab are both **Reflect**. Each item is a **reflection**. The word "questionnaire" stays in code, table and file names; it leaves the screens (the Term Questionnaire in Reports is a different thing and keeps its name).
2. **The switch is the gate.** On puts a reflection in every student's Reflect tab until it is turned off. A closing date is optional and nothing sets one by itself. A reflection that is on but past its closing date shows as Off ("Closed Nov 1"); turning it On clears the past date.
3. **No slips.** Print QR Slips, Print Slips for N Not Answered and Print One Slip leave the screen. The slip tables, functions and edge routes stay; a slip already printed works until it expires. Nothing is deleted.
4. **New Reflection.** A teacher builds their own: a title, a description, and questions (below). Copy to Another Class and Delete on its card; Preview as a Student in the builder. Delete is offered only while nobody has answered: the database refuses to delete a reflection with answers (`delete_questionnaire`, since Oct 25: "turn it Off instead"), and that rule stays.
5. **See Answers.** Summary (per question) and By Student, on every reflection.
6. **A count on the student's Reflect tab** of reflections open and not yet answered.

Not built, on purpose: file upload (Send Work does it), Net Promoter Score, branching.

## The data contract

Every builder follows this exactly; the database checks it.

A teacher-built reflection is a `questionnaire` row with `kind = 'custom'`, no `template_id`, no `report_period`, no `parent_id`. Its **description** is the `theme` column (the card's `forms` route already sends `theme` as `description`). It is saved through `upsert_questionnaire` (whole questionnaire, questions in order), turned on and off with `set_questionnaire_on`, and removed with `delete_questionnaire`. Copy to Another Class is an `upsert_questionnaire` of the same title, description and questions (no question ids) into the other class, saved Off.

A question is `{ id?, prompt, kind, options, core_ids: [], repeated_key: null, teacher_only: false }`. `prompt` is 1 to 1000 characters. Two options apply to every kind:

- `options.required` (true or absent): the student page will not send until it is answered. Checked on the student page only.
- `options.subtitle` (text, up to 300 characters): a line under the question.

| Builder name    | `kind`    | `options`                                                                                                                                                              | The student's answer (what the page sends)                                                        | Stored as                                                 |
| --------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Text            | `text`    | `long: false` for one line; absent or true for a box                                                                                                                   | a string, up to 2000                                                                              | `value_text`                                              |
| Choice          | `choice`  | `choices: [text…]` (2 to 20, each up to 120); `multiple: false` for one answer (absent means many); `other: true`; `dropdown: true` (one answer only); `shuffle: true` | an array of chosen texts; a typed Other is a text not in `choices`, up to 60                      | `value_json` array, `value_text` joined with ", "         |
| Rating          | `rating`  | `levels`: whole number 2 to 10 (5 when absent); `low`, `high`: words for the two ends, up to 60 each                                                                   | a whole number 1 to `levels`                                                                      | `value_num`                                               |
| Date            | `date`    | none                                                                                                                                                                   | `"YYYY-MM-DD"`                                                                                    | `value_text`                                              |
| Ranking         | `ranking` | `choices: [text…]` (2 to 10)                                                                                                                                           | an array holding every choice once, in the student's order. Not sent until the student moves one. | `value_json` array, `value_text` "1. A · 2. B"            |
| Likert          | `likert`  | `statements: [text…]` (1 to 10, each up to 200); `choices: [text…]` the columns (2 to 7, each up to 40)                                                                | an object `{ "<statement text>": "<choice text>" }`; statements not answered are left out         | `value_json` object, `value_text` "statement: choice · …" |
| Section Heading | `section` | `subtitle`                                                                                                                                                             | none: it takes no answer and is not counted                                                       | nothing                                                   |

`scale4`, `short_set`, `goal_status` and `core_pick` stay as they are for the ready-made reflections; the builder does not offer them. Core Competency reflections keep their 1 to 4 scale.

An answer row read back (`list_course_responses`, `StudentVoice`) has `value_num`, `value_text`, `value_json` as above.

## Who owns which files

- **Database** (`migrations/2026111620_reflect_from_the_card.sql`, `migrations/local-test/`): the session's own work.
- **Student page**: everything under `s/`, its tests and browser specs.
- **Teacher's Reflect tab and builder**: `teacher/cm-questionnaires.js`, new `teacher/cm-reflect-builder.js`, `shared/questionnaires.js`, `teacher/dashboard.css` (the `sq-` and new `rb-` rules), `teacher/app.html`, `sw.js`, the tab label in `teacher/dash-class-manager.js`, `help/`.
- **See Answers**: new `teacher/cm-reflect-answers.js` and `teacher/cm-reflect-answers.css`, `shared/student-voice.js`, `teacher/learner-profile.js`, `shared/seed-data.js` (Demo Mode's sample reflection and its answers).

The Reflect tab calls See Answers through `window.CmReflectAnswers`: `render(cid, qid)` returns the HTML of the answers view for one reflection (all text through `esc`); `handleAction(action, el)` and `handleChange(el)` return true when they took the event. Its actions all start `sqAns` (the tab passes every `sqAns…` action to it). The builder is `window.CmReflectBuilder` with actions starting `sqB`.

## Preview as a Student

The builder writes the draft to `localStorage['fv-reflect-preview']` as `{ title, description, course: { name }, questions: [question…] }` (questions as in the contract, each with any `id`) and opens `/s/#preview-reflection`, with a query that changes each time, in a small window. The student page draws that reflection on its own answering screens with a line saying it is a preview; Send sends nothing and says so. The key is read once and removed.

## Shared wiring already in place

`teacher/app.html` and `sw.js` already load `teacher/cm-reflect-builder.js`, `teacher/cm-reflect-answers.js` and `teacher/cm-reflect-answers.css`.
