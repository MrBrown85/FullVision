# Quizzes build plan (2026-11-17)

**Status (Nov 17, late night).** A plan. Nothing is built. Colin said "add quizzes to the build plan too" and decided all ten of the board's questions the same night. The choices left after that were made by the orchestrating session under his delegation ("make whatever choices you think is best") and are marked so below. Three things stay his whatever is delegated: every migration is shown to him and applied only on his OK; the slice that turns a quiz into grades (Q4) stops at "ready for Colin's review"; nothing is released without his word.

**What it is.** A quiz is a way students do an assessment, not a new kind of grade. On the assessment form, "They Answer a Quiz" opens a Quiz card where the teacher writes questions, sets the right answers and tags each question to one of the piece's competencies. Students answer on their own page. The teacher sees the results by student, by question and by competency, with a suggested level for each competency. **A suggestion counts nowhere until the teacher confirms it.** Confirming writes ordinary scores, as if the teacher had clicked each one.

**Board.** "Quizzes Artboard" (https://claude.ai/artifact/55nAacfpnbwSgrEhEGktS3), version 3, final for planning after an independent review and a fix pass: Board 1 (Make a Quiz, Quiz Settings), Board 2 (Taking It on a Phone), Board 3 (Results and Confirm), Board 4 (When It Comes Back), Board 5 (The Questions Most Missed), Board 6 (Thin Evidence Asks for a Question). Every count on it comes from one sample set in its script (`window.QUIZ`). **Every builder's brief is written from the board as it stands that day, not from this plan's summary of it.**

Where this plan differs from the board's own build notes, on purpose, each with its reason below: the quiz is a record of its own and the Student Work setting keeps its three values; the answer key is a table of its own; the Reflect builder is not reused as it stands; quizzes have their own tables, not Reflect's.

## Rules every slice follows

1. **A suggested level is not a grade.** It is worked out on the teacher's screen from the answers and is never written to a score, a returned grade or anything a report, the gradebook or the student page reads. Only Confirm writes, and only through the grader.
2. **Every grade write goes through `shared/grader.js`.** `tests/grader-guard.test.js` fails any other file that calls a score writer; it stays as it is.
3. **No rule in `calc.js` changes.** One function is added (Q4). Levels and percents are shown only through `calc.js` and its helpers; the grade-format guard in `tests/grade.test.js` and `tests/level-readings-outside-calc.test.js` stay green and are not loosened.
4. **The answer key never reaches a student's device before the work is returned to that student**, and then only if the quiz shows answers. The server guarantees it by where the key is kept (see "The answer key").
5. **Every write is safe to repeat.** Teacher writes carry `p_idempotency_key`. A student's save is one row per question per try, replaced by the next save.
6. **Nothing existing is tightened**, and no setting the released app already reads is given a value it does not know.
7. **No new party.** Answers stay on the student page and in `gradebook-prod`. No import from an outside quiz service, no timer, no tab-switch or keystroke tracking.
8. **Dark until whole.** Every quiz screen draws only when the build flag `quizzes` is on (`shared/build-flags.js`). It is off in every released build, Demo Mode included, until Q6, and Q6 waits for Colin's review of Q4.
9. **Demo Mode works** for every slice, with a sample quiz in the sample class.
10. **Hidden means hidden.** The board's own Confirm dialog and Undo bar showed before any click, because a CSS `display` rule beat the `hidden` attribute. Every brief and every review checks, in a browser, that what should be out of sight at rest is.
11. No name an ad blocker hides: classes and ids start with `quiz-` (teacher) or `sp-quiz-` (student), checked against `tests/fixtures/adblock-hidden-names.txt`. Text reaches HTML only through `esc`. Real radio and checkbox controls, 44 px targets, usable at 200% zoom.
12. **Student screens are checked in Safari's engine and at every Text Size.** Most students are on iPhones. Every slice that draws on the student page (`s/`) is tried by its builder and again by its reviewer in Playwright's WebKit (`FV_WEBKIT=1`, the `webkit-student` project) as well as Chromium, from 320 to 430 px wide, light and dark, with the ad-block rules on. WebKit on a Mac is not iOS Safari (no collapsing address bar, no safe areas, no iOS text-size setting), and a review says "checked in WebKit", never "tested on iPhone". The student page's Text Size setting scales the page with CSS `zoom` (1.15 and 1.3), so a 390 px phone lays out at 300 px at Larger, and a 320 px phone at 246: every new student screen holds at those widths and is added to the Text Size sweep (every student screen, five widths, three sizes; it fails on clipped text, overflow and a word broken in the middle) in the slice that builds it. Viewport units are multiplied by the zoom, so a sheet uses the zoom-corrected height variable, never raw `vh`. A confirm never draws its primary button where the tap that opened it was.

## What exists already

Traced on `main` at `68cf3dd8` on Nov 17. File and line as they stand there.

### Grades

- **Points to Proficiency.** `pointsToProf(rawScore, maxPoints, scale)` (`shared/calc.js:721-733`): the percent, rounded on paper, against the class's table, highest start first. The default table is 86 / 73 / 50 (`DEFAULT_GRADING_SCALE.boundaries`, `shared/constants.js:645-654`). The board's worked example uses those numbers; they are right.
- **"The table decides"** is DECISIONS, "Points work's level" (2026-11-01): a points piece's level is the level its percent reaches on the class's table, everywhere a level is shown. `_normalizeAssessmentEntryValue` does it (`calc.js:773-783`).
- **How a level is written today.** `Grader.setLevel(cid, sid, aid, key, level, mod)` (`shared/grader.js:46`) → `upsertScore` (`shared/data.js:8280`) → the `upsert_tag_score` call (`:5474`). Points: `Grader.setPoints` (`grader.js:56`) → `setPointsScore` (`data.js:8284`) → `upsert_score` (`:5734`). Every grader action ends in `GradeState.afterSave` (`grader.js:31-34`), which makes the grade a Draft or Returned by the class's Return Grades setting. A student marked Missing or Excused takes no score: `upsertScore` refuses (`data.js:8281`).
- **A bulk action with a question and Undo exists**: Set Everyone To (DECISIONS, 2026-11-03; `tests/set-everyone-unscored.test.js`). It sets only cells with no score, asks first with the count, and its Undo puts back exactly the cells it set. Confirm follows it.
- **Golden grades.** `tests/golden-grades.test.js` and `tests/helpers/golden-grades.js` hold every grade of a frozen class to a fixture. Q4's proof is written on top of them.

### The assessment form

- `renderAssessForm` (`teacher/page-assignments.js:2729`) builds the form as one string, a section per card: What (`:2783`), Competencies (`:2912`), Scoring (`:3014`), Student Work (`:3153`), then the footer with Save as Draft and Assign.
- **The Student Work card is drawn only where the class's Send Work is on** (`_formWorkOffered`, `:3244-3251`). The board draws "They Answer a Quiz" as its fourth answer. A quiz needs the student page, not Send Work, so the card has to be offered wherever the student page is on, with the photo answers still behind Send Work.
- **The Student Work setting is a closed list, and the released app reads any other value as "takes photos".** `assessment.students_send` is `nothing`, `photos` or `photos_files`, held by a check (`docs/schema.generated.sql:64`) and by `set_assessment_student_work` (`migrations/2026111101_student_work_submissions.sql:1291-1293`). Seven server functions and the app test only "is it `nothing`?": `shared/grader.js:416` (To Grade and Not In), `shared/data-revisions.js:757`, `shared/data-student-work.js:238-239`, and the send, unsend and revision functions in the database. A fourth value, `quiz`, would make today's app count a quiz as photo work to grade and offer Send My Work on it. **So this plan does not add one.** A quiz is a row of its own, keyed by the assessment; `students_send` stays `nothing` for a quiz piece. The form still draws it as the card's fourth answer.
- **Scoring** is `scoreMode`: `proficiency` (Rubric, or Competencies when there is no rubric), `points`, `complete`, `dibels` (`:4087-4165`). Competency tags are `assessment.tagIds`.
- **Type.** `quiz` and `test` are already in `ASSESSMENT_TYPES` (`shared/constants.js:531-542`); only the teacher sees Type and no grade reads it.
- **Draft and Assign.** A draft is `assessment.is_draft`; Assign clears it (`teacher/assign-draft.js:75`). Students are sent nothing for a draft (`student_submit._listed`, `migrations/2026111702_student_listed_rule.sql:127-135`). The trigger that refuses Unassign once a student has a result or work (`draft_has_work`, `migrations/2026111701_assessment_drafts.sql:203-260`) does not know about quiz answers.
- **A copy does not carry Student Work today.** Copy Assessment and Copy to Another Class carry a fixed list of fields (`teacher/assessment-copy.js:260-300`); `duplicate_assessment` another (`migrations/2026111701_assessment_drafts.sql:1513-1553`); the class backup and its restore, others. None would carry a quiz.

### Reflect, which the board says to reuse

- **The builder cannot be hosted as it stands.** `teacher/cm-reflect-builder.js` (1,103 lines) is one object with one open draft (`_b`, `:36`), opened with a class and a saved questionnaire and nothing else (`open(cid, q)`, `:255`). It saves through `Questionnaires.saveCustom`, redraws through Class Settings, and its words are a reflection's ("Save and Turn On"). Its `fromSaved` and `toContract` (`:111-172`) keep only the option keys they know, so a right answer, points or a competency put on a question would be dropped the next time it was saved. It has seven kinds (`:19-27`): no Number, no True or False.
- **The student's drawing can be reused.** `s/question-kinds.js` draws Choice (one or several) and Text with real controls and has no state. It has no Number box, no right answer, no read-only view of a sent answer, and its shuffle is new on every page load (`:65-83`), where a quiz needs each student's own order kept (the board's "Cece's Question 9").
- **Reflect's storage cannot hold a quiz.** A questionnaire belongs to a class, not an assessment; a question has no points; `question.core_ids` allows only the seven Core Competency codes; and **the student's `form` route sends a question's `options` whole** (`supabase/functions/student-submit/forms-routes.ts:155`), so a right answer kept there would reach every phone. Answers are written whole, once (`student_submit.answer`, `migrations/2026111150_student_page_last_changes.sql:1053-1180`); nothing saves as the student goes.
- **Drafts are on the phone only**, in the tab's `sessionStorage` (`s/student.js:493-537`). Decision 10 needs them on the server.
- **See Answers** (`teacher/cm-reflect-answers.js`) counts answers by question and by student and knows nothing of right, wrong or levels. Its two layouts are the model for By Question and By Student; By Competency is new.

### The student page

- A card's button is "Send My Work", drawn only when the piece takes work (`s/page-view.js:426-437`); its press opens a screen `s/send.js` registered with `StudentPage.addScreens` (`s/send.js:2085-2128`). A quiz's "Start the Quiz" hooks in the same two places.
- A new route is named on three lists: the edge function's, `CLASS_ROUTES` (`s/app.js:2329-2356`), and the reply's allowed keys.
- Write limits are per card per hour, in `student_submit.write_log`, whose `kind` is a closed list (`migrations/2026111150_student_page_last_changes.sql:222`).
- Returned work is read from the student's returned copy only (DECISIONS, "Grades, photos and sign-in on the student page"); a draft grade is never sent.

**Live numbers** (the board's, gradebook-prod, read only, counts only): 7 classes, 4 Letter and 3 Proficiency; 139 pieces; in Letter classes 73 of 97 pieces are scored by level, so a quiz has to feed levels in every grading style.

## Grade math: what a quiz feeds, and proof that a suggestion feeds nothing

This is the part of the plan that needs the most care. It is Q4, and it goes to Colin.

**The path.** Answers sent → the teacher's app works out, for each competency, points earned ÷ points possible on that competency's questions → the class's Points to Proficiency table (`pointsToProf`) → a suggested whole level → the teacher confirms or changes it → an ordinary score.

**The one new function**, in `shared/calc.js`: `quizSuggestions(questions, key, tries, settings, scale)`. It writes nothing and reads no class data but what it is handed. For one student it returns, for each competency: earned, possible, and a level, "too few questions" or "waiting".

- **Fewer than three questions on a competency: no suggestion** (decision 4); the teacher sets it by hand.
- **A Text answer not yet assessed: waiting.** A competency with one waits whole.
- **A question tagged to no competency counts toward none** (decision 8). On Competencies scoring it earns nothing anywhere, and the screen says so.
- **Extending is possible** where the class's table gives it (decision 5). The council split: Guskey and O'Connor would cap a quiz at Proficient. Colin chose the table knowingly; every level is confirmed by hand.
- **More than one try** (decision 9): one whole try counts, never a mix of two. Best is the try with the higher total; on a tie, the later try. Latest is the last try sent. (Chosen by the orchestrating session under Colin's delegation, Nov 17.) Best cannot be known while a Text answer in any try is unassessed; until then the student waits.
- **What counts as right**, the plan's rule, set out for Colin's review with the slice: Choice with one right answer and True or False, that answer; Choice with several right, all of them and no others, or nothing (no part marks); Number, within the tolerance, the ends included, compared on paper as `pointsToProf` compares; Text, the points the teacher gives.
- A suggestion is a whole level. The teacher may step it up or down, with a + or −, before confirming; a changed one is marked Changed.

**On Points scoring** the quiz's total is the piece's points score, and the piece's points possible is the sum of the questions' points (the form keeps the two equal while the piece is a quiz). Then **every competency tagged on the piece reads the level the total reaches**, as for any points piece today (`calc.js:773-783`). The per-question tags sort the results screen and change no grade. This is today's rule for points work, not a new one; a teacher who wants a level per competency picks Competencies scoring.

**A quiz is offered with Competencies or Points scoring.** With Rubric or Complete/Incomplete the answer is not offered, and the card says why in a sentence. (This plan's choice: the board defines only those two.)

**Confirm.** One new grader action, `Grader.confirmQuiz`, which calls `setLevel` or `setPoints` for each student and nothing else.

- **It asks first, naming what moves**: "Confirm 54 levels for 20 students on Data Patterns Quick Check? They count toward each student's grade." Under As Soon As I Save it adds that students see them at once; under When I Return Them, that they stay drafts until returned. Cancel sends nothing.
- **It sets only cells with no score yet**, as Set Everyone To does. A level the teacher already entered by hand stays, and the question says how many stay.
- **A student marked Missing or Excused is left out**, and the question says how many.
- **Undo** puts back exactly the cells Confirm set; a cell scored again since keeps its new score.
- **Even under As Soon As I Save, nothing counts before Confirm** (decision 6).
- With unlimited tries and Best counting, a later, better try changes the suggestion and nothing else; what was confirmed stays until the teacher confirms again, by the same question and Undo.
- If the key is corrected after Confirm, the results say "Changed Since Confirmed" beside the students it touches; nothing moves until the teacher confirms again.

**What a confirmed level feeds**: the same places as any level the teacher clicks, by the same code. The gradebook cell and the student's competency proficiency; its folder's level; the category and the Overall Proficiency; in a Letter or Both class the course % through Counts As (DECISIONS, "Proficiency percents"); the reports that read those; and, once returned, the student page. No reader is changed.

**Why a suggestion reaches none of them.**

1. Suggestions are never stored as scores. Answers live in `quiz_answer`, which `calc.js`, the class bundle (`get_class_bundle`), the gradebook, reports and `student_submit.page` do not read.
2. The only code that writes a score from a quiz is `Grader.confirmQuiz`, behind the question.
3. The student page is sent returned grades only, so even a confirmed draft is not sent before Return.

**The tests that hold it** (Q4):

- With the frozen class of the golden grades and a quiz answered by every student: every grade in the fixture is unchanged before Confirm.
- After Confirm, every grade equals what typing the same levels by hand gives, cell for cell, in a Proficiency, a Letter and a Both class.
- `quizSuggestions` against a table of cases at the table's edges (85.9, 86, 72.9, 73, 49.9, 50), with two, three and no questions on a competency, an untagged question, a waiting Text answer, a tolerance's ends, two tries each way, and a tie.
- Undo after Confirm restores the fixture exactly.
- A source check that no file but `shared/grader.js` writes a score for a quiz (the grader guard, unchanged).

## The answer key

- **It is a table of its own, `quiz_key`**, apart from the questions. No student function reads it except one, `student_submit.quiz_result`, the returned view. A missed setting elsewhere cannot leak it, because the functions that answer a student who is taking a quiz never open that table. (DECISIONS, "Add Work for the Class" 14, reasoned the same way for an answer key.)
- **A choice carries no mark of being right.** Choices have random ids; "which is right" is only in the key.
- **`quiz_result` sends anything about right and wrong only when all of these hold**: the piece is returned to that student (not a draft); the student can no longer answer (no try left, or the quiz is closed); and the quiz's setting allows it. "Grade Only" sends the grade. "Grade and Which Were Right" sends, for each question, right or not, from what the teacher confirmed. "Grade, Which Were Right and the Answers" also sends the key's answers and the "why" line.
- **Reopen for One Student stops it again** until the piece is returned again. Reopening after the answers were shown gives that student a try with the answers seen; the Reopen question says so.
- **Between tries a student is told nothing** about right or wrong.
- **What a student sees as right or wrong is what the teacher confirmed.** Confirm stores each counted try's marking, question by question. So there is one place that decides right and wrong (`calc.js`), not a second copy in the database, and a returned quiz shows exactly what the teacher saw.
- **Tests that ask the server directly**: a key holding a marker value is saved; every student route is called at every stage (not started, part way, sent, tries left, confirmed but a draft); the marker appears in no reply until the piece is returned and closed to that student. A check of the database's own function list: no function in `student_submit` names `quiz_key` except `quiz_result`.

## How it is built

- **Tables of its own**, keyed by the assessment; `students_send` is not touched. The reasons are under "What exists already".

| Table           | Holds                                                                                                                                                                               | Goes with                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `quiz`          | one per assessment: Shuffle Questions, Shuffle Choices, Tries (one, two, unlimited), Counts (best, latest), When Returned Students See (three choices), Add a Total, when it closes | its assessment              |
| `quiz_question` | assessment, order, kind (choice, true or false, number, text), prompt, choices, points, the competency it counts toward, archived                                                   | its assessment              |
| `quiz_key`      | question, the right answer, a tolerance, the "why" line                                                                                                                             | its question                |
| `quiz_attempt`  | assessment, student (enrolment), which try, the student's own order, started, sent, reopened, and what the teacher confirmed for it                                                 | its assessment; its student |
| `quiz_answer`   | attempt, question, the raw answer, when saved, the points the teacher gave a Text answer, the teacher's note                                                                        | its attempt                 |

Row security on, no policy, no grant: only functions touch them. The settings for decisions 7 and 9 are columns of `quiz` in the first migration, so no second one is needed for them.

- **Raw answers are kept, not scores.** A key that is fixed rescores everyone the next time the results are opened.
- **A question with answers is archived, not deleted**, so no answer loses its question.
- **Each student's order is made once and kept** on their attempt, so "Question 9" is the same question on any device and on the returned view.
- **Answers save as the student goes** (decision 10): one small write per answer changed, to the student's own attempt. **Until it is sent, only that student's own session can read it**: not the teacher, not another student. The teacher's functions return sent tries only. Another phone signed in with the same card carries on at the first unanswered question. With no connection the answers wait on the phone and go when it returns, as Send Work's pages do.
- **Unassign is refused once a student has started**, by a trigger of the quiz's own that raises the same `draft_has_work` the app already understands. The existing trigger is not changed.
- **To Grade keeps exactly the meaning it has on `main`.** Quizzes answered and waiting for Confirm show on the assessment's own card ("12 Answered · Confirm Levels"), not in that number.
- **The builder.** A tidy first (Q2a): the drawing pieces of Reflect's builder that a quiz needs (a question's card in its read and edit forms, the list of choices, Copy, Move and Delete) move into a shared file, unchanged, with Reflect's own tests and browser spec passing untouched. The Quiz card (Q2b) is then its own module on those pieces, with its own state, its own save, and the fields a quiz adds. Reflect's builder gains nothing and loses nothing.
- **Quizzes are not offered on a pair or group piece** in this build.

## Migrations

Each is its own file, 40 KB at most, tested on embedded PostgreSQL 17 with a pre-check, a post-check and a tested undo, given a Fable review at high effort, shown to Colin, applied only on his OK, and never tried against `gradebook-prod`. Each track stops at "ready for Colin" and its builder moves to work that does not depend on it.

| Migration               | Adds                                                                                                                                                                                                                                                                                  | Changes that exists                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| MQ1 `…_quizzes`         | The five tables; the teacher's functions: `save_quiz`, `list_quiz` (questions and key, the teacher's own class only), `list_quiz_tries` (sent tries), `mark_quiz_answer`, `reopen_quiz`, `confirm_quiz` (stores what was confirmed; writes no score); the quiz's own Unassign trigger | Nothing                                                                                                               |
| MQ2 `…_quizzes_student` | `student_submit.quiz` (the questions in this student's order, their saved answers, tries left), `quiz_save`, `quiz_send`                                                                                                                                                              | `write_log`'s `kind` check gains `quiz`. Bulletins' M2 widens the same check; whichever is applied second names both. |
| MQ3 `…_quiz_returned`   | `student_submit.quiz_result`                                                                                                                                                                                                                                                          | Nothing                                                                                                               |

If MQ1 passes 40 KB, the results functions (`mark_quiz_answer`, `reopen_quiz`, `confirm_quiz`) become a file of their own.

## Slices

| Slice | What                                                                                   | Waits for                              | Builder | Review                 |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------- | ------- | ---------------------- |
| Q1    | The contract; MQ1                                                                      | The orchestrator's go                  | Opus    | Fable high             |
| Q2a   | The shared question pieces, moved out of Reflect's builder, unchanged                  | Nothing                                | Sonnet  | Opus                   |
| Q2b   | The Quiz card on the assessment form; Quiz Settings; Demo Mode's sample quiz           | Q2a; MQ1 applied, to merge             | Sonnet  | Opus                   |
| Q3a   | MQ2; the edge routes `quiz`, `quiz-save`, `quiz-send`                                  | The contract                           | Opus    | Fable high             |
| Q3b   | The student's quiz screen                                                              | The contract; Bulletins' B1d merged    | Sonnet  | Opus                   |
| Q4    | Results and Confirm: `quizSuggestions`, the results screen, `Grader.confirmQuiz`       | Q2b, Q3a                               | Opus    | Fable high, then Colin |
| Q5a   | MQ3; the `quiz-result` route                                                           | The contract                           | Opus    | Fable high             |
| Q5b   | When It Comes Back, on the student page; the privacy page                              | Q3b, Q5a                               | Sonnet  | Opus                   |
| Q6    | Turn it on                                                                             | Everything above; Colin's review of Q4 | Sonnet  | Fable                  |
| Q7    | A quiz goes with its copy                                                              | Q6                                     | Opus    | Fable                  |
| Q8    | Make a Review Quiz; past questions offered by competency                               | Q6                                     | Sonnet  | Opus                   |
| Later | A picture on a question, matching and ordering, questions shared across classes, pools |                                        |         |                        |

### Q1. The contract and the database

`migrations/local-test/quizzes-contract.md` first: every table, column, function, argument and answer, exact; Q2b, Q3a, Q3b, Q4 and Q5 build to it. Then MQ1.

**Tests** (`migrations/local-test/quizzes.py`, in the shape of `scan_labels.py`): save and reopen a quiz; a question with answers archived, not deleted; another teacher reads and changes nothing; `list_quiz_tries` never returns an unsent try; a student deleted for good takes their tries; an assessment deleted takes its quiz; Unassign refused once a student has started; the same key twice saves once; defaults; apply; undo. `tests/db/table-owners.mjs` gains the five tables.

### Q2a. The shared question pieces

A move, not a change. `teacher/question-cards.js` (new) takes the pieces named under "How it is built"; `teacher/cm-reflect-builder.js` calls them. **Done when** `tests/reflect-builder.test.js` and `e2e/reflect-builder.spec.js` pass without an edit, and a reflection built before the move opens, edits and saves the same after it.

### Q2b. The Quiz card

Board 1. On the Student Work card, "They Answer a Quiz", offered wherever the class's Student Page is on (the photo answers stay behind Send Work), with Competencies or Points scoring. The Quiz card under it: Add Question; Choice (one or several right), True or False, Number with a tolerance, Text; on each question the right answer, points and one of the piece's competencies, or "Counts Toward No Competency"; Copy, Move, Delete; Evidence by Competency, which counts each competency's questions and says how many more one needs for a suggestion. Quiz Settings: Shuffle Questions and Shuffle Choices (both on), Tries (One, Two, Unlimited; starts on One) with Counts (Best, Latest) when more than one, "You can reopen it for one student.", When Returned, Students See (Grade Only; Grade and Which Were Right; Grade, Which Were Right and the Answers, where it starts) and Add a Total. Preview as a Student. A new quiz starts on Competencies in a Proficiency or Both class and on Points in a Letter class. The quiz is written while the piece is a Draft and reaches students on Assign.

**Files.** `teacher/quiz-builder.js`, `teacher/quiz.css`, `shared/data-quizzes.js` (new); `teacher/page-assignments.js` (the card's fourth answer, one mount, one save call: a few lines, as `_saveFormWork` is called); `shared/seed-data.js`; `teacher/app.html`, `sw.js`.

**Tests.** Unit: the builder's model (each kind, the key, points, a tag, validation: a Choice with no right answer, a Number with no answer); the round trip through save and reopen keeps every field; the points total follows the questions on Points scoring. Browser (`e2e/quiz-builder.spec.js`, Demo Mode, flag on): build the board's quiz with the keyboard alone; flag off, the form is today's.

### Q3a. The student's side of the database, and the routes

MQ2 and `supabase/functions/student-submit/quiz-routes.ts`. `quiz` sends prompts, choices and points in the student's own order, their saved answers and the tries left; never the key, never a hint of it. Every function begins with `_session_class`, so a paused or withdrawn student, a class with its page off and an expired card are refused; a draft or not-yet-assigned piece is not found (`_listed`). `quiz_save` writes one answer to the student's own open try. `quiz_send` closes the try; a sent try cannot be changed. A closed quiz, a try beyond the number allowed, and an answer of the wrong shape for its question are refused.

**Tests.** The scenarios script: the access rule for unfinished answers (the teacher's functions do not return them; another student's session does not); a second device carries on; two saves of one answer at once; the tries rule each way; closed; Reopen for One Student; the hourly limit; the key's marker value in no reply. Handler tests under Node; the reply's allowed keys.

### Q3b. The student's quiz screen

Board 2. "Start the Quiz" on the piece's card in Assignments (a quiz is an assessment, so not Reflect). One scrolling page, numbered in the student's own order, with a count of what is left; each answer saved as it changes, and "Saved" said quietly; Send, with a check for unanswered questions; then Sent, and Try Again with the tries left when the quiz allows it. No timer. With no connection: "Saved on this phone. It'll send when you're back online." The Choice and Text controls are `s/question-kinds.js`'s; a Number box and True or False are added there.

**Files.** `s/quiz.js`, `s/quiz.css` (new); `s/question-kinds.js`; `s/page-view.js` (the button: a few lines); `s/app.js` (`CLASS_ROUTES`); `s/index.html`; `shared/student-view.js`; `teacher/preview-student.js` (Preview as Student shows the quiz and sends nothing). Built after Bulletins' B1d has merged: both write `s/page-view.js` and `s/app.js`.

**Tests.** Unit on the screen's model. Browser (`e2e/quiz-student.spec.js`, the demo card at 390 px): take the sample quiz, leave part way, come back to the same order and answers, send; at 200% zoom nothing is cut off.

### Q4. Results and Confirm

Board 3, and "Grade math" above. `quizSuggestions` in `shared/calc.js`; `Grader.confirmQuiz` in `shared/grader.js`; `teacher/quiz-results.js` and `.css`: By Competency (suggestions dashed until confirmed, the figures beside each, a level stepped by a click and marked Changed), By Question and By Student in See Answers' two layouts, Text answers assessed down one column, "Best of 2 Tries" with which try counts and both shown, Reopen for One Student, Confirm with its question and Undo.

**This slice stops at "ready for Colin's review".** Its PR says, in plain words: what the new function works out, the rule for what counts as right, what Confirm writes and where that shows, the question's exact words, what Undo puts back, and the test results. It does not merge until he has read it.

### Q5. When it comes back

Board 4. Q5a is MQ3 and the route, as "The answer key" sets out. Q5b is the student's returned view: the grade in the class's style through `calc.js`'s own words (levels as words, never a figure; a % and letter in a Letter class), each question right or wrong and the right answer with its "why" line when the quiz shows them, in the student's own numbering; "Grade Only" stops after the teacher's comment; Add a Total adds "7 of 10". `privacy.html` names quiz answers: what is kept, who sees it, how long.

### Q6. Turn it on

The `quizzes` flag on by default, after Colin's review of Q4. Download All My Data gains quiz answers; the class backup's note says quizzes are not in it. A help article with pictures. DECISIONS and CLAUDE.md's Current state. **The check before it merges**, by someone who built none of it: every board in a real browser, the form and results at 1280 × 800, the student's screens at 390 px, light and dark, ad-block rules on; then a signed-in pass in Colin's test class with two phones: build, assign, answer on one phone and finish on the other, confirm, return, and read the returned view. The privacy page promises teachers an email before a change to how student information is stored; Colin sends it before the release that carries this.

### Q7. A quiz goes with its copy

Copy Assessment, Copy to Another Class and Duplicate carry the quiz's questions, key and settings, with each question's competency matched by name in the other class as the assessment's own are (`teacher/assessment-copy.js`), and never any student's tries. A teacher with two blocks of one course will want this soon after Q6; it is its own slice because it changes what three existing copy paths carry.

### Q8. The two surprises

Board 5: By Question ranked from most missed, with Make a Review Quiz from those questions; the review quiz is a new piece of evidence and the first is never rewritten. Board 6: while a quiz is being written, a competency short of three questions offers the teacher's own past questions on it, newest first.

## Order across the three plans

The Dashboard (`dashboard-inbox-plan.md`), Bulletins (`bulletins-plan.md`) and Quizzes are built in this order, chosen by the orchestrating session and checked here against the code.

1. **The Dashboard first.** It has no database change, so nothing waits on Colin, and every slice is the teacher's side only. D1 starts on the go.
2. **Bulletins' first stage beside it**, starting with its database slices (B1a, B1b), because the longest wait in any of the three builds is Colin's OK on SQL. Its screens are built in Demo Mode meanwhile.
3. **Quizzes after Bulletins' first stage is on**, except three pieces that touch nothing the others touch and can start earlier when a builder is free: Q1 (its own tables), Q2a (Reflect's builder) and Q2b (the assessment form).
4. Bulletins' later stages (polls, Whiteboard, Learner Profile) and Quizzes' later slices then take turns; which leads is the orchestrator's call at that point.

**Where they contend, and the rule for each.**

| File or thing                                           | Who                                                  | Rule                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `s/page-view.js`, `s/app.js`                            | The gear-menu PR, Bulletins B1d, Quizzes Q3b and Q5b | One at a time, in that order. Quizzes' student slices never run beside Bulletins' student slices.                  |
| `supabase/functions/student-submit/handler.ts`          | Bulletins B1b, Quizzes Q3a and Q5a                   | One line each, in routes files of their own. One deploy at a time, each after its migration.                       |
| `student_submit.write_log`'s check                      | Bulletins M2, Quizzes MQ2                            | The second to be applied names both kinds.                                                                         |
| `docs/schema.generated.sql`, `migrations/baseline/`     | Every migration                                      | Refreshed from live after each apply, so **one migration is in front of Colin at a time**, applied, then the next. |
| `teacher/page-assignments.js`                           | Quizzes Q2b only                                     | The Dashboard and Bulletins do not write it.                                                                       |
| `teacher/dash-overview.js`, `teacher/page-dashboard.js` | The Dashboard's D1, D2, D4, D9; Bulletins B1e        | In that order.                                                                                                     |
| `shared/calc.js`, `shared/grader.js`                    | Quizzes Q4 only                                      | Nothing else in the three plans touches grade math.                                                                |
| `shared/photo-queue.js`                                 | Bulletins B1f only                                   |                                                                                                                    |
| `shared/build-flags.js`, `teacher/app.html`, `sw.js`    | Every track                                          | A line or two each; merged one at a time.                                                                          |

**How many at once.** Usage is checked before each wave of agents. Three builders at a time is the working limit: one on the Dashboard, one or two on Bulletins or Quizzes, each with its review. A track that reaches "ready for Colin" stops, and its builder moves to work that does not depend on it.

**One small PR apart from the three builds**: the app's primary blue button (white on #007aff) measures 4.02 to 1 against the 4.5 to 1 standard. The fill is darkened for buttons with words on them (the boards use #0066cc), every use of the colour is checked, and before and after pictures go to Colin. Low priority; when a Sonnet builder is free.

## Decisions

Colin's, Nov 17, all settled; not reopened.

1. A quiz is a Student Work answer on the assessment form, "They Answer a Quiz". Not a new Scoring kind and not a page of its own.
2. It feeds whatever scoring the teacher picks. It starts on Competencies in Proficiency and Both classes and on Points in Letter classes.
3. The first question types: Choice (one or several right), True or False, Number with a tolerance, Text assessed by hand.
4. A competency needs at least three questions before a level is suggested for it.
5. A quiz can suggest Extending: the class's Points to Proficiency table decides. The council split; he chose it knowingly.
6. Suggested levels always need the teacher's Confirm, in every class, even under As Soon As I Save.
7. **What students see when it comes back: "Teacher chooses".** A setting on each quiz. It starts on the grade in the class's style, which questions were right, and the answers; the teacher can switch a quiz to Grade Only, or to the grade and which were right, and can turn on Add a Total. (The starting point is the orchestrating session's reading, taken under his delegation.)
8. A question may count toward no competency, labelled "Counts Toward No Competency".
9. **Tries: "Teacher sets tries".** One, two or unlimited, with Best or Latest counting. It starts at one try; shuffle is on by default; Reopen for One Student stays.
10. Unfinished answers save to the class on the server as the student goes, so another device can carry on.

Chosen by the orchestrating session under Colin's delegation, Nov 17 ("make whatever choices you think is best"):

- With more than one try and Best counting, the whole try with the higher total counts, never a mix of two; on a tie, the later try.

This plan's own choices, from the code, listed for Colin afterwards and easy to change: a quiz is a record of its own and the Student Work setting keeps its three values; the key is a table of its own; a quiz is offered with Competencies or Points scoring only; a Choice with several right answers is all or nothing; Confirm sets only cells with no score yet; no quiz on a pair or group piece; quizzes waiting for Confirm show on the piece's card and To Grade keeps its meaning; a copy does not carry the quiz until Q7.

Still Colin's, whatever is delegated: his OK on each migration; his review of Q4; the release; and the district privacy officer's view, which the board's privacy note says should be asked before the first class uses it.

## Not in this plan

- A timer, a lockdown, tab-switch or keystroke tracking, and import from Google Forms or any outside quiz service.
- Rating, Likert, Date and Ranking as quiz questions: they stay Reflect's.
- Part marks on a Choice with several right answers.
- A quiz on a pair or group piece, a rubric-scored piece or a Complete/Incomplete piece.
- Quizzes in the class backup.
- Any change to what To Grade counts.
- Pictures, matching, ordering, shared question banks and pools (the board's "Later").

## Risks

- **A suggestion counted as a grade.** The whole design turns on it not happening. It is held by where answers are kept, by the grader being the only writer, and by tests that pin every grade before and after Confirm.
- **The answer key on a phone before return.** Held by the key's own table, one function that reads it, and tests that ask every route at every stage.
- **Two answers to "is this right?"** Only `calc.js` decides; the server stores what the teacher confirmed and never works it out again.
- **A quiz piece misread by today's app.** Avoided by not adding a value to the Student Work setting.
- **Reflect broken by the builder move.** Q2a changes no behaviour and Reflect's own tests and browser spec pass without an edit; students answer reflections every day.
- **Two tries and Best with hand-assessed answers.** Best waits until every try's Text answers are assessed; the results say who is waiting and why.
- **A key corrected after Confirm.** Nothing moves by itself; the results flag the students it touches and the teacher confirms again.
- **Answers saving on a poor connection.** They wait on the phone and go when it returns; a second device may then hold older answers for a moment. The later save wins, and Send is refused while saves are still waiting.
- **The assessment form is 17,000 lines and busy.** Q2b adds one answer, one mount and one save call there; the card lives in its own file.
- **Selected-response rarely shows Extending** (Guskey and O'Connor). Colin chose the table; the teacher confirms every level; the builder's Evidence by Competency card shows how thin a competency's questions are.

## Working rules

- **Models.** Routine screens, wiring and test fixes on Sonnet; migrations, the edge function, the key's release, anything about who can read what, and Q4 on Opus; the orchestrator on Fable. Every slice has a review on Opus or Fable by someone who did not build it, given the code and not the builder's conclusion; migrations, server rules and Q4 get Fable at high effort.
- Builders work in worktrees of their own cut from `origin/main`, commit and push in small steps, and never touch the main checkout (`/Users/brown_colin/FullVision` sits on an old branch).
- One PR per slice; `test-and-format` passes before merge; the slice's own tests and its one browser spec are run locally; main's e2e run is checked after merging and fixed next if red.
- Every screen is tried in a real browser by someone other than its builder, at 1280 × 800 and 390 px, light and dark, ad-block rules on, against the board.
- A fault of the same kind twice is fixed at its cause.
- No migration is tried against `gradebook-prod`. No release without Colin's word.
