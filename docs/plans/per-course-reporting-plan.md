# Reporting each course of a combined class (2026-11-25)

**Status.** A plan. Nothing is built. Six decisions are Colin's (listed below); the first stage needs none of them.

**Why.** The district wrote to teaching staff on Nov 25: where distinct Ministry courses are taught together (English 8 and Social Studies 8 as Humanities 8), learning must be reported separately for each course, according to its learning standards. English 10's paired 2-credit courses are the only exception, and Humanities is named as not one. In MyEducation BC each course is its own section (`MEN--08`, `MSS--08`), so a Humanities 8 teacher enters a level and a comment twice for each student (`docs/plans/myed-integration.md`, 1.1).

FullVision gives a combined class one overall proficiency and one Teacher Comment for each student. The teacher has to split both by hand.

## What is true today

In the code:

- A class's Ministry courses are its **subjects** (`subject`; each competency, `section`, belongs to one). The New Class wizard's Humanities 8 preset makes two: English Language Arts 8 and Social Studies 8.
- The overall is one figure for the class (`getOverallProficiency` → `rollUpSectionLevels`, `shared/calc.js`). With Each Course Counts Equally on, each course is rolled up on its own and the two are averaged. Those two figures are worked out and never shown.
- The report's Proficiency part lists rows by folder, not by course. Its Overall row, and the Overall Proficiency part, print the one figure.
- The Teacher Comment is one for each student and term (`term_rating.narrative_html`), written and approved in the Term Questionnaire, where Generate drafts it from the whole class's evidence.
- Class Settings › Competencies already lets a teacher add a course and say which course a competency belongs to.

In the live database (read-only counts, Nov 25):

| Humanities 8 class | Students | Courses kept apart | Assessments | Comments written |
| ------------------ | -------- | ------------------ | ----------- | ---------------- |
| A                  | 28       | yes                | 0           | 0                |
| B                  | 26       | yes                | 0           | 0                |
| C                  | 25       | yes                | 15          | 0                |
| D                  | 22       | yes                | 3           | 22               |
| E                  | 22       | **no**             | 29          | 22               |

- Five classes, 123 students. No other class has more than one course, and none pairs two English 10 courses.
- **Class E keeps both courses under one heading**, "Humanities 8", with 23 competencies. Three of its folders are English Language Arts and one is Social Studies, and one Social Studies competency (Inquiry Skills) sits in an English folder. The app cannot tell its courses apart until the teacher says which is which.
- In class C, 8 of 15 assessments are tagged to competencies of both courses, 3 to English only and 3 to Social Studies only. One piece of work counting toward both courses is normal, and the level for a course comes from that course's competencies, so this works as it is.
- No folder holds competencies of two courses in classes A to D.
- 44 comments are already written (classes D and E), each as one comment for the whole class.

## What a teacher gets

For a class with two or more courses, for each student and each course:

1. **A proficiency for the course**, worked out from that course's competencies by the class's own rules.
2. **A comment for the course**, written and approved on its own.
3. **Both on the printed report**, under the course's name.

A class with one course sees no change anywhere.

## Stages

Each stage is one PR unless it says otherwise. P1 can start before any decision.

| Stage | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Changes grades?                  | Database   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------- |
| P1    | **The level for a course**, in `shared/calc.js`: `courseLevels(cid, sid)` gives each course's name and level, by the roll-up Each Course Counts Equally already does inside `rollUpSectionLevels` (the same code, shared, so the two can never disagree). As of a report's term through `readAsOfTerm`. Printed through `formatLevel`. Golden tests show no existing figure moves.                                                                                                             | No. It adds figures; moves none. | None       |
| P2    | **Which course is this?** For a class whose courses are under one heading (class E): Class Settings › Competencies asks which courses the class teaches, sorts each folder into one, and lets a single competency go to the other. It uses the subjects the class already has. Class Settings calls them Subjects and the Grading tab calls them Courses: this stage says Course in both. Nothing moves while Each Course Counts Equally is off; turning that on asks first, as it does today. | No                               | None       |
| P3    | **The report.** In a combined class the Proficiency part prints each course as a heading with its level, its folders and competencies under it; the Overall Proficiency part prints a line for each course. A part cut between pages keeps a course's heading with its first row (the rule folders already follow). Whether the combined overall still prints is decision 1.                                                                                                                   | No                               | None       |
| P4    | **A comment for each course.** The Term Questionnaire's comment has a switch between the courses; each course's comment is written, drafted by Generate from that course's competencies and evidence only, and approved on its own. The report prints each under its course. How it is stored is decision 2; what happens to the 44 comments already written is decision 3.                                                                                                                    | No                               | Decision 2 |
| P5    | **The gradebook and the student's own page.** The gradebook's overall column, the Dashboard's student cards, the phone's student card, the student page's My Learning, Print Grades' final grade, and the exports each show one figure today. Which of them show a level for each course is decision 4.                                                                                                                                                                                        | No                               | None       |
| P6    | **Ready for MyEd.** For each course, the class in MyEd's order with the level in MyEd's four codes and the comment with its character count, to copy across. This is item 3 of `docs/plans/myed-integration.md`, made per course. It waits on that plan's own open questions (the comment's character limit; what happens to + and −).                                                                                                                                                         | No                               | None       |

P1 touches the grade math file, so it needs Colin's review (Rules, 2), though it moves no grade. P1, P2 and P3 touch different files and can be built at once. P4 is the largest stage: the questionnaire, Generate, the Comment Bank's facts, the report's comment part and its on-page editor all read one comment today.

Demo Mode's sample class has one course, so Demo Mode shows none of this. The tests build a two-course class of their own. Whether Demo Mode should gain one is not part of this plan.

## Not in this plan

- **English 10's paired courses, and any combined class on letters and percents.** A percent comes from assignments, not competencies, so a percent for each course needs each assignment to belong to a course. No live class needs it. The district allows one comment with a pointer in the companion course ("See EFP Writing 10 for learning updates"), and requires a mark in both; if a pair of English 10 courses is ever set up as one class, that is its own plan.
- **Insufficient Evidence, or goals-based reporting, for one course only.** A student's reporting basis is set once for the class (`term_rating.reporting_basis`). Decision 5.
- **Attendance, work habits, the reflections and the response.** They describe the student in the class, not a course. They stay once on the report.

## Decisions that are Colin's

Each will be put to him on its own, with what the council would say and a recommendation. The options below were checked against the code and the counts above.

1. **Does a combined class still show one combined overall?** Recommended: not on the printed report (a level for "Humanities 8" belongs to no Ministry course and has nowhere to go in MyEd); in the app it stays where a single figure sorts or colours a list, until decision 4.
2. **How a comment for each course is stored.** (a) Its own row for each course (a new table beside `term_rating`, one migration, its own approved mark and draft record); or (b) one comment with a heading for each course inside it (no migration; one approval covers both; Generate and the character count have to find the headings in the text). Recommended: (a). MyEd takes one comment for each course with its own limit, and a teacher finishes one course's comments before the other's.
3. **The 44 comments already written.** Recommended: none is changed or deleted. Each stays as it is and shows beside the two course boxes with Copy Into English Language Arts 8 and Copy Into Social Studies 8, until the teacher has used or dismissed it.
4. **Where a level for each course shows first.** Recommended: the report and the Term Questionnaire first (what the district's email is about), then the gradebook; the student's page and the phone after that.
5. **Insufficient Evidence for one course.** Recommended: not in the first build. A course with no evidence prints "No evidence yet" for that course, as a competency does today.
6. **Each Course Counts Equally.** It decides only the combined overall. If decision 1 takes the combined overall off the report, should the switch stay as it is, or go from the Grading tab once nothing prints it? Recommended: leave it; it still decides the figure the app sorts and colours by.

## What was checked, and what was not

- Checked: the code paths named above; the live counts (read-only `select`s on `gradebook-prod`, Nov 25); that Class Settings can already move a competency between courses.
- Not checked: MyEd's comment character limit and the Post Columns a combined class's two sections show (open since Oct 17, `docs/plans/myed-integration.md` section 10, question 1); whether other districts read the Ministry's policy as Surrey does. The Ministry's K-12 Student Reporting Policy (July 1, 2023) requires the Provincial Proficiency Scale and descriptive feedback for each area of learning in Grades K to 9; the district's email is the reading this plan follows.
