# Grade by Headings

Plan for Colin's approval, 2026-11-05. Mockups: the private canvas "FullVision: Grade by Headings" (https://claude.ai/artifact/MBpJNTdfftJFZveXrbptVZ). Nothing is built yet.

## The request

A CSL-expert teacher, Nov 5: "is there a way to make the select just 'Reasoning and Modelling' instead of the specific ones listed below (in stats 12 I was looking at). It keeps my gradebook less busy to only have 4 or 5 competencies per class."

Statistics 12 has 18 competencies under four Ministry headings (Reasoning and Modelling 5, Understanding and Solving 5, Communicating and Representing 4, Connecting and Reflecting 4). Folders Count as One already makes the overall count each heading once, but she still tags, scores, reads and prints 18. She wants to assess four things, so the class should have four things.

## Recommendation

**A per-course choice in the New Class wizard, Grade By: Competencies | Headings. Under Headings, each Ministry heading becomes one ordinary competency.** It carries its own bank id, a code from the heading's stem (RM, UND, CM, CN), its competencies' Ministry wording as its wording, and two or three I Can statements written for it that name the skills its competencies assess. No display mode, no hidden rows, no grade math change, no database migration for the first three phases.

### Why this and not a display mode

|                                     | Heading is a competency (recommended)                          | Per-class display mode (children hidden)           | Hand-made competencies (today) |
| ----------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- | ------------------------------ |
| What she tags and scores            | 4                                                              | Still 18 (or one score fanned out to 5 rows)       | 4                              |
| Grade math                          | Unchanged: a competency is a competency                        | Folders Count as One, plus a new fan-out rule      | Unchanged                      |
| Ministry wording, I Can, bank place | Kept                                                           | Kept                                               | Lost                           |
| Surfaces to change                  | Few; most work as they are                                     | Every view must hide children and show folder rows | None                           |
| Reversible                          | Freely before scores; with scores, a one-way combine (Phase 4) | Freely                                             | Re-link only                   |

A display mode keeps the busy part, 18 tags on every assessment, and scores one judgement five times, inflating evidence counts. Hand-made competencies lose everything the bank gives. A heading-as-competency fits the existing model exactly: `section` → one `tag`, scored by `tag_score`, rolled up by `calc.js` like any other.

### The data

- **Heading ids live in the bank.** `scripts/bc_curriculum_derive.py` gives every folder category with two or more competencies a `heading: { id, code }`: id `bc.<course>.hd.<stem>` (`bc.stat12.hd.rm`), code the stem its competency codes already use (RM1–RM5 → RM). Frozen once published, like codes; a lock file and test stop them changing. 1,035 headings in 204 courses. Social Studies (20 courses) and Career Education 8–9 (2) have no headings; one-competency headings are already one column.
- **The heading's wording** (`tag.text`, `source_text`) is its competencies' Ministry wording, one per line, in order. Its I Can statements are written for it (below). It keeps `tag.bank_id`, so the competency card says "BC Curriculum · Statistics 12 · Reasoning and Modelling", Duplicate Class, backups and Restore carry it as they do now (`duplicate_course`, `import_json_restore` already copy `bank_id`), and Re-link matches on it.
- **Per course, per heading.** A course is the unit of choice (Humanities 8 can take ELA 8 by Headings, 2 columns, beside SS 8's 8 competencies). Each heading can also be split back to its competencies in the wizard ("Use Its 5 Competencies"). The class needs no new setting: a tag whose bank id has `.hd.` is a heading.
- **ADST and nested courses.** The heading is the bank's folder (Defining, Ideating…), not the top organizer (Applied Design), so ADST 8 gives 9 columns, not 3. **Colin decides:** keep folders (consistent with codes and the card's path), or offer the top level for the 63 nested courses.
- **Grade 7** has no bank courses, so the choice never shows; a custom class already takes four hand-made competencies.

### The heading's I Can statements (Colin, 2026-11-05)

Two or three per heading, written from that course's own competencies, never generic heading words: Statistics 12's Reasoning and Modelling talks about statistical models and estimation, Mathematics 8's about mathematical ones. The rules:

1. **Together they name every skill the heading's competencies assess.** Each statement records the competency ids it covers (`covers: [...]`), and CI fails a heading with an uncovered competency.
2. **In the course's context.** Written from the Ministry wording and the competencies' own I Can statements, keeping their subject words (variables, data, First Peoples communities), so a student reads what they actually do in that course.
3. **The competency I Can rules apply:** "I can" and a lower-case word, no end punctuation, the banned words, the word cap (14 at grade 8, 17 at 9–10, 22 at 11–12), and a hash of the competencies' Ministry text so a revision flags the heading.
4. **Written as the bank's were:** one exemplar per heading name and subject (56) for Colin to approve, every other course adapted from it, changing only what its competencies change, then an independent review. 1,035 headings, about 2,600 statements, in `data/bc-curriculum-heading-ican.json`.

The rubric draft takes at most three I Can statements, so a heading's criterion draws from all of them. The heading's comment phrase, descriptors and course sets are then written from these statements, as the competencies' were from theirs.

Sample for approval, Statistics 12:

- **Reasoning and Modelling:** I can use reasoning, estimation and technology to analyze and apply statistical ideas · I can build a statistical model of a real situation and explain how it fits · I can explore a problem or puzzle with curiosity and try creative thinking strategies to solve it
- **Understanding and Solving:** I can explain how and why a statistical idea works and choose an approach that fits the question · I can use graphs and other visuals to explore variation within and between variables · I can keep investigating a research question, including questions that matter to local First Peoples communities and my own community
- **Communicating and Representing:** I can explain and justify my statistical decisions in more than one way · I can represent a statistical idea with materials, pictures and symbols · I can use statistical vocabulary to share my ideas in class discussion, even when I am unsure
- **Connecting and Reflecting:** I can reflect on my statistical thinking and use my mistakes to improve my next attempt · I can connect statistical ideas to each other, to other subjects and to my own interests · I can connect statistics to First Peoples worldviews, perspectives, knowledge and practices

**The hard case:** 142 headings hold seven or more competencies (ELA's Comprehend and Connect has 13; Arts' Explore and Create up to 9). At grade 8, three statements of 14 words must cover 13 skills, which pushes toward vague wording. Colin decides: keep three and group related skills, or allow a fourth statement for headings of seven or more.

### What Folders Count as One means afterwards

A course by headings has no folders, so its overall is the plain mean of its headings: the same shape as Folders Count as One on, without the folder layer. A heading split back to its competencies is a folder again and follows its own Counts as One. The wizard's review and the Grading tab say "Graded by headings, so there are no folders" instead of showing a switch that does nothing. Each Course Counts Equally is unchanged. Rule 2: no formula in `calc.js` changes; the tests prove it.

## Every surface

| Surface                           | Change                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Choose Courses                    | Each row reads "18 Competencies · 4 Headings".                                                                                                                                                                                                                                                                         |
| Choose Competencies               | A Grade By control on each course card. Under Headings, one row per heading with its code, name and "Includes 5 Competencies" (open to read the Ministry wording); Clear unticks a heading. A live column preview above the cards (surprise 1).                                                                        |
| Review                            | "Statistics 12 · By Headings · 4 Columns"; the Folders row reads as above.                                                                                                                                                                                                                                             |
| Class Settings › Competencies     | The heading card shows Includes and the I Can statements; the course header offers Grade by Competencies / Grade by Headings while none of that course's competencies has evidence (scores, rubric links, observations, term-rating picks). With evidence: "Reasoning and Modelling has scores, so it stays as it is." |
| Re-link                           | Builds candidates by headings or competencies to match the class, and pairs a hand-made "Reasoning and Modelling" with the bank heading (surprise 3).                                                                                                                                                                  |
| Gradebook (Scores, Competencies)  | Nothing: four sections, four columns. Header hover lists what the heading includes.                                                                                                                                                                                                                                    |
| Assessment tagging, observations  | Nothing beyond the hover. Four chips instead of 18.                                                                                                                                                                                                                                                                    |
| Competency Rubric, rubric draft   | "+ From Competency" on a heading offers One Criterion, or One per Competency in It (surprise 2). Level wording: the scale's general wording until Phase 3 writes heading descriptors.                                                                                                                                  |
| Generate and Browse               | Phase 1: a heading has no course set yet, so Generate words it as it words a hand-made competency of that name (the `SKILLS` table); Browse offers its competencies' set sentences under it for the teacher to pick. Phase 3: written heading sets.                                                                    |
| Printed and phone reports         | Nothing: As Graded prints one row per heading. Each Competency prints the same rows, with the hint "Graded by headings".                                                                                                                                                                                               |
| Student page (`s/`)               | The card shows the heading, its I Can statements and Includes.                                                                                                                                                                                                                                                         |
| Phone                             | Level sheet and tag lists work as they are; descriptors as the rubric.                                                                                                                                                                                                                                                 |
| Dashboard                         | Nothing: `DashInsights.columns` gives section columns when there are no folders, and `columnCode` reads `tag.code` (RM, UND, CM, CN). Four chips per student card.                                                                                                                                                     |
| Backups, Restore, Duplicate Class | Nothing; tests prove the heading round-trips.                                                                                                                                                                                                                                                                          |

### Which course-set sentence a heading uses

None of its competencies' sets alone: any one of them would claim a specific skill ("can justify statistical decisions with reasons") from a judgement about the whole heading. Phase 3 writes **heading sets** from the heading's I Can statements: 79 groups (subject × heading × grade band: PHE 19, ADST 18, Science 12, Career 10, Arts 8, Math 8, ELA 4), split into sets where courses' wording asks for different things (likely 150–250 sets; the competencies' 697 groups became 1,706), each with the full course-set shape (phrase, next steps at four levels, strengths, next-step sentences, at-home line), plus four proficiency descriptors and a comment-file phrase. Written and reviewed by `docs/course-sets/WRITE-BRIEF.md` and `REVIEW-BRIEF.md`, checked by `scripts/check-course-sets.mjs`, built by `scripts/build-course-sets.mjs`. Colin approves one sample first, as on Nov 4.

## Switching an existing class

1. **No evidence: switch freely**, either way, per course (Competencies tab). The swapped sections have nothing attached.
2. **Competencies → headings with scores: Phase 4, Combine into Headings, if Colin wants it now.** One server RPC per heading, in one transaction, idempotent: the heading takes every link its competencies had (`assessment_tag`, `criterion_tag`, `observation_tag`, `term_rating_strength` / `growth_area`, deduplicated). A rubric criterion keeps its own score, so rubric work loses nothing. A direct score is one per student and piece: where a piece scored several of the competencies, **the heading takes their mean, to the nearest third (3, 4 and 4 → 4−)**, and their comments, each after its code. Overrides on the competencies are dropped and listed first. It asks first with the grade-change count and offers Download Class Backup before it runs; approved comments and issued reports keep what they say. **Colin decides the merge rule** (mean to thirds, or the gradebook's lowest-when-mixed); it is grade math and deletes the children, so rule 2 applies.
3. **Headings → competencies with scores: not offered.** A heading's score can't be split honestly. The hint says so and points to next term's class.

## The database

Phases 1–3 need no migration: `tag.bank_id` is free text (`migrations/20261102_tag_bank_id.sql`), and nothing on the server reads its shape. Phase 4 adds `fold_competencies_into_heading(p_course_id, p_heading jsonb, p_child_tag_ids uuid[], p_idempotency_key uuid)` under `fv_owns_course` and `fv_idem_check`, tested on a Supabase branch, SQL shown to Colin and applied only on his OK (rule 1).

## Wording

Labels are in Title Case in the table above. Hints, plain: "Headings: one column for each Ministry heading. Each one includes its competencies' wording and I Can statements." "You'll score 4 things instead of 18." "Graded by headings, so there are no folders." "Reasoning and Modelling has scores, so it stays as it is."

Help: a section in `help/articles/create-a-class.md`, "Grade by Headings", with the column-preview picture (`scripts/help-shots.mjs`); a Glossary line for Heading; a What's New entry. DECISIONS.md gets "Grade by Headings (2026-11-xx)".

## Pleasant surprises

1. **The wizard shows the gradebook before you build it.** Above the course cards, a strip of real gradebook column headers (codes and short names at their real size) that slides from 18 columns to 4 when Grade By flips: "Your gradebook: 4 columns."
2. **Detail on the handout, four columns in the gradebook.** "+ From Competency" on a heading can make one criterion per competency it includes, all feeding the heading. Students get five rows of feedback; the gradebook shows one level per heading (the lowest when mixed, as now).
3. **Re-link finds her hand-made headings.** A class with a competency she typed as "Reasoning and Modelling" is offered the bank heading in Re-link: every score stays, and the Ministry wording, I Can statements and card path arrive.

## Build plan

**Phase 1: headings in the bank and the wizard.** The heading I Can statements are written and approved first (data only, no app change), then land with this phase. Derive script and lock file, `build-curriculum-bank.mjs` emits `heading`, `buildLearningMapFromTags(tags, { headings })`, the Grade By control, Includes rows, column preview, Review and Folders row wording, `_cmBankPlace` for heading ids. Tests: every multi-competency folder has a unique heading id and code; the lock file holds; every heading has two or three I Can statements that pass the I Can checks and cover each of its competencies; Stats 12 builds 4 sections, no groups, wording and I Cans as specified; Humanities 8 mixes 2 headings with SS 8; ADST 8 nested; a headings class's overall equals the plain mean of its headings with Folders Count as One on and off; Generate's output for a heading class equals the same class with `bank_id` null; e2e: wizard Stats 12 by Headings → 4 gradebook columns, 4 dashboard chips; Demo Mode: the wizard builds Science 8 by Headings (6 columns), and the seed class is unchanged.

**Phase 2: Class Settings, Re-link, rubric, Browse.** The Competencies tab's switch and its evidence check, Includes on the card, heading-aware Re-link and name matching, One per Competency in It, Browse's sentences under a heading, the Proficiency block's hint, the help section. Tests: switching both ways with no evidence; blocked with each kind of evidence; Re-link pairs a hand-made heading and keeps its scores; backup → Restore and Duplicate Class keep heading ids; rubric criteria all feed the heading and score on their own; e2e on the Competencies tab.

**Phase 3: heading wording.** Heading sets, descriptors and comment phrases as above, after Colin approves a sample. Tests: the checker is clean on the batch; every heading id has a set, four descriptors and a phrase; Generate drafts from the heading set; the golden comment tests still pass.

**Phase 4 (optional): Combine into Headings.** The RPC on a branch, its SQL for Colin, the client preview with the grade-change count and backup. Tests: the merge rule per piece, rubric criteria untouched, links deduplicated, idempotent replay, Demo Mode does the same on the device, offline queue replays it once. Needs Colin's review (rules 1 and 2).

## For Colin to decide

1. Approve heading-as-competency over a display mode.
2. The Statistics 12 I Can sample above, and three or four statements for headings of seven or more competencies.
3. Nested courses (ADST and 62 others): folders (9 columns in ADST 8) or the top organizer (3).
4. Build Phase 4 now, or wait until a teacher with scores asks; and its merge rule.
5. Phases 1 and 2 as one merge or two.
