# FullVision: what it needs to be worth paying for

Written 2026-10-17. Follows the Schoology/Teams comparison (2026-10-17) and the pricing discussion (Teacher $120/yr, School $69/teacher, District $5–6/student).

FullVision won't win by matching Schoology or Teams feature for feature. Both are free to a teacher and already approved by the district. It wins by being the tool that writes BC reports better than anything else, while teachers keep the district LMS for assignments. Everything below either removes a reason not to pay, or makes that one job much better.

## 1. Remove the reasons not to pay

Without these, no feature set will hold a $120 price.

1. **Roster import from MyEducation BC.** Schoology and Teams get rosters automatically. A teacher typing 150 students by hand will quit on day one. Accept MyEd BC's class-list export as is: map its columns, match on student number, and add students who are already in another class without making duplicate records.
2. **Reporting periods.** Done 2026-10-17 (`docs/DECISIONS.md`, "Reporting periods"): up to six dated terms per class in Class Management, a term picker on the gradebook, dashboard and student pages, and reports that follow Report N. Still to do: the mobile grade filter's "term" means the last 90 days, not a real term.
3. **Safe student handling.** Districts and parents will ask "what happens to my child's record?" Done 2026-10-19 (`docs/DECISIONS.md`): removing a student withdraws them, with a Withdrawn list, Re-enrol and a permanent delete as a second step. Still to do: Restore for deleted classes.
4. **Rolling over to next year.** Duplicate Class copies the class settings, categories and weights, learning map and sentence starters, but not reporting terms, rubrics or assessments (2026-10-18). Assessments (2026-10-18), rubrics (Rubric Bank, 2026-10-18) and the grading setup ("Copy grading setup…", Teams' Import settings, 2026-10-18) can each be copied to another class.
5. **Trust basics:** closed signup or SSO, a real privacy page, and full data export. A teacher paying personally needs to know they can leave with their data.
6. **The first ten minutes:** bigger type, a legend for every code (CRT, QAP, NS…), phones sent to the mobile app, and three first-run tips. If the app feels hard on day one, $120 feels like too much.

## 2. Make the core job far better than anyone else

1. **Write comments from the evidence.** FullVision already has everything a comment needs: proficiency by competency, observations, the questionnaire answers, goals and reflections. Done 2026-10-28, not as a generated draft (`DECISIONS.md` 14; `questionnaire-plan.md`): the Term Questionnaire shows that evidence beside a Comment Bank in BC's four parts, each sentence filled in for the student and offered only when its data exists; the teacher writes and approves the comment, and the BC Written Learning Update card says which of BC's six requirements the report meets. TeacherDashboard and Almanack start from nothing; FullVision starts from what happened in class. Still to do: the Focus Area pick is kept per device (no server column yet).
2. **Reports that fit the sheet.** One form per class, fixed and flowing blocks, Letter or Legal, a return strip, an issued copy to reprint or send. Decided 2026-10-20 (`DECISIONS.md`, "Report forms"); plan in `report-forms-plan.md`. Phase 0 (two pages per student, letterhead, dots not colour, Legal) ships first.
3. **Output shaped for MyEd BC.** Teachers end up pasting into MyEd anyway. Give them a per-class export of each student's proficiency level and comment, laid out the way they'll enter it, so they don't retype anything.
4. **Student self-assessment and goal-setting without student accounts.** BC reporting expects student self-assessment of the core competencies and goal-setting. The `goal` and `reflection` tables already exist. Add a per-class link or QR code where students answer a short form, and have the answers land in the report. Neither Schoology nor Teams does this the BC way.
5. **An evidence trail for every level.** "Why is this a 3?" One click should show the scores, observations and work samples behind it, and let the teacher attach a photo of student work. This is what a teacher shows a parent at conferences, and what an admin wants if a grade is challenged.
6. **Fast in-class capture on the phone:** tap a student, pick a competency, speak or type one line, done. Observations are already the app's best screen. Making them two seconds to record on a phone is what makes the evidence trail real.
7. **Reporting for students on IEPs.** Designations are already on the roster. Let a teacher report a student against their IEP goals instead of the course competencies, with the right wording on the report. No mainstream tool handles this well, and resource and inclusion teachers would buy for it alone.

## 3. Work alongside the district tools, don't replace them

1. **Import scores from Teams, Google Classroom and Schoology.** There's already an unused `import_teams_class` RPC. The pitch becomes "keep assigning in Teams, report in FullVision." That turns your strongest competitor into a source of data.
2. **Don't build an LMS.** No assignment submission, no content pages, no discussions. Every hour spent there is spent losing to free tools.

## 4. What the school tier needs

- **Co-teachers and shared classes:** resource teachers, EAs and TOCs, with view-only and edit roles.
- **A principal view:** which classes have finished their Learning Updates, and how far along each teacher is. Admins pay for visibility.
- **School-wide templates:** shared comment banks, a common questionnaire, the same category setup across a department.

## 5. Cut or hide

Six calculation methods, the per-assessment weight, the decay slider, and several settings that are only explanation text are confusing for most teachers. Default them sensibly (Most Recent for grades K–9, Mean for 10–12) and put the rest behind "Advanced." Showing less makes the app look more powerful.

## Order of work

1. **This term:** MyEd roster import, withdraw instead of delete, legibility pass, closed signup.
2. **Before the next reporting round:** reporting periods, plus drafted comments from evidence with the MyEd-shaped export.
3. **Over the next few months:** student self-assessment link, the evidence trail, phone capture, IEP reporting.
4. **When a school asks:** co-teachers, the principal view and templates.

## How to know it's worth the money

Time it. Have three colleagues write one round of Learning Updates in FullVision and in their current tool. If FullVision saves each of them several hours, $120 a year is an easy sell, and that time saving is the line to lead your pricing page with.
