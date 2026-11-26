# Comment Bank per Rubric: build plan

Status: built and on (Nov 25 2026 Pacific; the database change was applied Nov 26 02:24 UTC). Owner's calls are final; do not reopen them.

A teacher keeps reusable feedback comments with a rubric. Each criterion holds comments per level; the rubric
holds overall comments. They are written ahead of time in the rubric editor or kept while grading with
Add to Bank, and offered under the comment box while grading. Teacher-only: never printed, never sent to
the student page.

Boards (the approved look; read the files, match them): the canvas "Comment Bank Board". Local copies:
`/private/tmp/claude-504/-Users-brown-colin-FullVision/55c7c9ee-3229-467b-b43a-ce13f17b2c99/scratchpad/cbank/project/Main.dc.html`
(grading) and `.../cbank/project/Rubric-Mine-Grid.dc.html` (the rubric editor grid). `Rubric-Editor.dc.html`
there is an old rejected version: ignore it.

## Colin's calls (Nov 25 2026)

1. Same As stays exactly as it is (look, when it shows, what a click does).
2. Only Add to Bank keeps a comment. Nothing joins the bank by itself.
3. A banked comment belongs to ONE CRITERION of ONE RUBRIC, at the level it was given. Overall comments
   belong to the rubric. It never follows a competency to other rubrics.
4. Last Time stays and sits ABOVE the comment box as a line of text, not a chip.
5. The rubric writer stays the grid. No cards.
6. No sliders, no codes, no "where is it kept" choices. A small use count ("6x") is wanted.
7. Left out of this build: the BC library's "Curriculum" line; the phone grader; renaming anything.

## The shape (the contract every piece builds to)

In memory (and in Demo Mode's localStorage, and in a backup file):

- `criterion.comments`: array of `{ level: Number, text: String }`, in the order shown. `level` is the same
  level key the Advanced checkboxes use (`RubricChecks.checksAt(crit, level)`): 1..4, or 1..6 on a rubric
  with a `scale`. The database accepts a level 1 to 6 whatever the rubric's scale, and three table checks
  per column hold the same rule. No ids. Missing means `[]`.
- `rubric.overallComments`: array of `String`. Missing means `[]`.
- A text may hold the slot `[Name]`, filled with the student's first name when used.
- Limits: text 1..500 characters after trim; at most 40 comments on a criterion and 40 overall.

Database (one migration, `migrations/2026112601_rubric_comment_bank.sql`):

- `criterion.comments jsonb not null default '[]'`, `rubric.overall_comments jsonb not null default '[]'`,
  each with a CHECK that it is a JSON array.
- `upsert_rubric`: each criterion in `p_criteria` may carry `comments`; a MISSING key keeps what is stored
  (the app already in teachers' browsers does not send it), a present key replaces after validation. A new
  last parameter `p_overall_comments jsonb default null`: null keeps, an array replaces.
- `get_class_bundle`: `comments` on each criteria row, `overall_comments` on each rubrics row.
- `duplicate_course` and `import_json_restore` carry both.
- Two small new RPCs for Add to Bank, so grading never re-sends a whole rubric:
  `add_criterion_comment(p_criterion_id uuid, p_level smallint, p_text text, p_idempotency_key uuid default null) returns jsonb`
  and `add_rubric_overall_comment(p_rubric_id uuid, p_text text, p_idempotency_key uuid default null) returns jsonb`.
  Each appends unless the same level + text (overall: the same text) is already there, and returns the list.
  Owner-checked, idempotent (`fv_idem_check`), granted to `authenticated` and `service_role`.
- `student_submit.page` is NOT touched: it lists the criterion fields it sends, so the new columns never
  reach a student. The harness proves it.

Client data API (new file `shared/rubric-comments.js`, `window.RubricComments`, pure helpers plus the two writes):

- `at(criterion, level)` -> texts at that level, in order. `all(criterion)` -> `[{level,text}]`.
- `fill(text, firstName)` -> the text with `[Name]` filled. `slot(text, firstName)` -> the text with the
  first name (whole word) put back to `[Name]`.
- `newPart(text, bankTexts, firstName)` -> what is left of `text` after every banked text (filled) is taken
  out, trimmed. Add to Bank is offered when it is 3 characters or longer.
- `uses(cid, rubricId, criterion)` -> `{ '<level>|<text>': n }`: how many students in the class have a
  criterion comment, on any assessment using this rubric, that contains the text (filled with their first
  name). `overallUses(cid, rubricId)` -> the same for overall comments. Derived from scores: nothing is stored.
- `lastTime(cid, sid, aid, criterion)` -> `{ text, title }` or null: the student's most recent non-empty
  criterion comment on an EARLIER assessment (by date, before this one's) whose rubric criterion shares a
  competency (`tagIds`) with this criterion. Null when the criterion has no competencies.
- `addCriterionComment(cid, rubricId, criterionId, level, text)` and `addOverallComment(cid, rubricId, text)`:
  update the cached rubric AND its server baseline (so the next `saveRubrics` does not re-send the rubric),
  then send the RPC through the outbox; in Demo Mode the local write is the whole of it. No duplicate is added.
- The rubric editor saves comments through the draft and `saveRubrics` (payload, signature, loader and
  `upsertRubric` wrapper all carry `comments` / `overallComments`).

## The screens

Rubric editor (`teacher/page-assignments.js` `_blankRowHtml` and friends; styles in `teacher/assignments.css`):

- `+ Comments` in a criterion's `.af-ge-tools` (after `+ Competency` and `...`) when that criterion is not open.
- Open (one criterion at a time, kept on the editor state, not in the draft): each level cell shows its
  comments as lines typed in place, plus one empty line with the placeholder "Add a comment". Typing in the
  empty line makes a comment and another empty line follows. An emptied line is dropped on save.
- Shut: each comment is a light blue bubble under the level's description (three lines at most, the whole
  text in `title`), with its use count at the right when it has been used. A click opens the criterion.
- `+ Overall Comments` in the foot opens a last row, "Overall Comment", that works the same way with no levels.
- Comments carry over on Duplicate Criterion, Duplicate rubric and Copy to another class, and
  `RubricLibrary._critView` compares them so "Update the other classes too?" offers a change.
- NOT shown: the Rubric Bank's read-only grid, any printout, any student-facing or feedback page.

Grader (`teacher/crit-comment.js`; styles in `teacher/assignments.css`), under an open criterion comment:

- Last Time: a line above the box, "Last Time, <assessment title>:" in bold then the comment. Individual
  students only.
- Same As: unchanged.
- Bank: a row under Same As. The word "Bank" (the app's link blue, with a chevron) then chips: this
  criterion's comments at the level picked, most used first, three at most, each with its count. With no
  level picked, the most used at any level. While the teacher types, the Bank chips narrow to those that
  contain what is being typed.
- A pick from the Bank is ADDED after what is already written (a space between), or takes the place of the
  fragment being typed when that fragment narrowed the row. It saves at once, as a Same As pick does.
- Pointing at a chip (Bank or Same As), or arrowing down to it from the empty box, shows the whole comment
  in the empty box in grey (the placeholder). Enter on a highlighted chip picks it; with none highlighted
  Enter keeps today's meaning.
- "Bank" opens the whole bank in one soft panel: a row per level (the level picked first), each comment
  once, then "Edit Comments", which opens Edit Rubric for this rubric.
- Add to Bank: shown in the Bank row when `newPart` is 3 characters or longer and no chip matches. It keeps
  only the new part, under the level picked (no level picked: it asks nothing and keeps it under the
  rubric's top "meets" level, 3), with the student's first name put back to `[Name]`. It then reads "In the Bank".
- Overall comment field: the same Bank row and Add to Bank, with no levels, shown while that field has focus.
- The closed comment keeps the app's look (`.rsg-crit-note`). Group rows: Bank and Add to Bank work; no name
  slot and no Last Time.

## Order of work (one pull request each, auto-merge on)

1. Database: the migration, its harness scenario, pre/post checks, fingerprints, undo. Shown to Colin;
   applied to the live database only on his OK; merged after it is applied (the drift check needs that).
   Built: #1805.
2. Data layer: `shared/rubric-comments.js`, the loader/payload/signature/wrapper/backup changes, the Demo
   sample class's comments, unit tests, the build switch `commentBank` (off). Merges after 1 is applied. Built: #1804.
3. Rubric editor comments (behind the switch). Built: #1807.
4. Grader: Bank row, Add to Bank, preview, Last Time (behind the switch). Built: #1806.
5. Switch on, this plan and a DECISIONS entry in the repo, CLAUDE.md's Current State line. Built: this one, "Comment bank: on".

With the switch off nothing a teacher sees changes, and no existing snapshot fixture changes.

## Rules for every builder

- Read the repo's `CLAUDE.md`. Text enters HTML only through `esc`; a new innerHTML site needs its
  `// html-safe:` proof (`npm run audit:html`). Title Case for labels and buttons.
- `teacher/page-assignments.js` is at its exact line limit (`tests/file-size-baseline.json`): it may not grow.
  New code goes in a small new file; offset any hook lines.
- A new JS file starts with `// @ts-check` and is registered in `tsconfig.json`, `scripts/typecheck-ratchet.json`,
  the page's script tags, `sw.js` and (shared scripts) `docs/ARCHITECTURE.md`'s list.
- Before the pull request opens: `npm test` (whole suite, once), `npm run typecheck`, `npm run typecheck:ratchet`,
  `npm run audit:html`, `npm run format:check`, and the one browser spec for the change, in the page font and
  the wide stand-in font (`e2e/wide-font.js`). Demo Mode must work.
- Commit in small steps and push. Do not release. Do not touch `gradebook-prod`.
