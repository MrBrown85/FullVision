# Course-Set Comment Wording

Every curricular competency's comment wording comes from its **course set**: the courses whose Ministry wording asks for the same thing. The 697 skill groups are split into 1,553 sets. Each set has, per grade band (`all`, or `8-9` and `10-12`), a phrase, next steps at four levels, two strength sentences, three next-step sentences and an at-home line: 10,240 sentences in all. Generate drafts from the student's own competency's set first; Browse offers the set sentences under the student's competencies.

## Where It Lives

| Path                                | What it is                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data/course-sets/<batch>.json`     | The source of truth, one file per subject batch. Edit these.                                                 |
| `scripts/check-course-sets.mjs`     | Checks one batch: structure, slots, `[s-form\|plain]` verbs, the comment lint, Canadian spelling, repeats.   |
| `scripts/build-course-sets.mjs`     | Builds `data/bc-curriculum-sets.json` and `shared/bank-sets.js` from the batches (never edit those by hand). |
| `WRITE-BRIEF.md`, `REVIEW-BRIEF.md` | The instructions the wording was written and independently reviewed to (Nov 4 2026).                         |
| `approved-sample.md`                | The sample Colin approved as the quality bar.                                                                |
| `review/<batch>.md`                 | Each batch's review log: every change and why.                                                               |

## Editing

1. Edit the set in `data/course-sets/<batch>.json`.
2. `node scripts/check-course-sets.mjs data/course-sets/<batch>.json` until it prints `clean` (read its warnings).
3. `node scripts/build-course-sets.mjs` to rebuild the app's files, then run the tests.

## Rules Colin Set

- Each set of courses gets its own wording; never make wording plainer so it fits more courses.
- Next steps name a skill to practise or a work habit, never a topic or task.
- Every line passes a read-aloud test: a parent reading it cold understands why it is said about their child.
- Canadian spelling. "Indigenous" except in official names.
- A set marked `"sensitive": true` (abuse and exploitation, puberty and change, identity, bullying, substance use, supporting others, well-being) has no at-home line and is never drafted on its own; Browse may still offer its other sentences.
