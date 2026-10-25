# FullVision student voice: plan

Written 2026-10-17. Revised 2026-10-24 to match the approved mockups on the design canvas (https://claude.ai/artifact/B7CKPGG7LXFBHwQRxzbCjT). The canvas is the visual spec: every PR below is checked against it screen by screen before merge. Nothing here is built yet.

## What this adds

Students answer short questionnaires on their own phones by scanning a QR slip, with no accounts. Their answers, goals and reflections live on the Learner Profile next to the teacher's evidence, and feed the report comment. Two related features use the same plumbing: the November report sent to students' phones (with a reply), and missing-work reminders for families.

Instruments, all optional per class:

1. **About Me** (start of course): how to say my name, languages at home, how I learn best, what I do outside school, and three repeated questions (good at, hard right now, what I want to get better at and how). A private note only the teacher sees.
2. **Core Competency Reflection** (each reporting period): the grade-by-period theme from the Brainstorm file, its activity as prompts, and a self-assessment on that period's Core Competencies on the scale already live in `core_self_assessment`: Beginning, Growing, Confident, Leading, each with a one-sentence why.
3. **Goal Check-In** (same slip as the reflection): how the Science 8 goal is going (Not Started, Working On It, Mostly There, Done), what's next, and one Core Competency goal with one thing to do this week.
4. **Curricular Self-Assessment** (optional, off by default): the class's I-can statements on the same four-step scale.
5. **Reply to Report** (after a report is sent to phones): proud of, surprised by, keep or change the goal plus one thing before the next report, anything for the teacher.

Interview mode (teacher-led, on Observations and mobile) stays in the plan but is not in this build.

## What already exists (main, 2026-10-24)

- `core_self_assessment` (enrollment, core_id, term_key, level, body, goal) with `upsert_core_self_assessment` and `list_course_core_self_assessments` (#386, applied). Student self-assessments write here; nothing new is needed for the scale.
- `goal` (enrollment, section, body) with goal dates (#385, applied), and `reflection` (enrollment, section, body, confidence), one row per competency.
- `guardian` (student, name, relationship, email, phone, language, consent_at, consent_source) with `upsert_guardian`, `delete_guardian`, `list_course_guardians` (`migrations/20261020_guardian.sql`, applied). Parent emails on the roster are these rows; no new field is needed. Its header records that nothing should email families until the district's position on teacher-to-family email is known.
- `report_issue` and `report_issue_student` (`migrations/20261020_report_issue.sql`, applied): a fixed copy of each student's report at the moment it was issued. Phone reports link to this copy, not to live scores.
- Netlify Edge Functions are set up (`netlify/edge-functions/inject-env.js`) but run at the nearest Netlify location, not necessarily in Canada. Student submissions use a Supabase Edge Function in ca-central-1 instead (see Security).
- The roster import (`cmHandleCSV`) reads seven columns by position and splits on bare commas; see PR 3.

## Decisions (approved 2026-10-24, replacing the 2026-10-17 list)

1. **One QR per student per questionnaire.** The slip carries the student's own code; scanning signs them in and shows "Hi Cece, is this you?". The code sits after `#` in the URL so it never reaches a server log. A typed fallback code is printed under the QR. Eight slips per letter page, black and white, styled like the rubric handouts.
2. **Students rate Core Competencies, not the nine dispositions.** The teacher keeps rating dispositions on the Term Questionnaire; the two scales are not shown side by side.
3. **One scrolling page per form,** with a progress bar, not one question per card. Answer boxes grow as the student types. Sentence starters under the repeated questions.
4. **Goal Check-In rides on the reflection's slip** and is edited inside the November card on the Questionnaires tab, with its own On/Off.
5. **Class Management gets a Questionnaires tab** (one card per questionnaire: status, dates, answered count, who hasn't answered, Print QR Slips, inline question editor, MyEd comment). The Students tab holds the full roster only.
6. **The Goals and Reflections tab is removed.** Its content moves onto the Learner Profile tab, which becomes one page: ID card, About Me, Goals, Reflections.
7. **Student words are shown exactly as written,** never summarized, filtered or autocorrected. Blank answers show the question with "No answer". Answers in another language get a Translate link that never replaces the original.
8. **Phone reports use the issued copy** and a birthday check, expire at a set date, and can be closed or reissued per student.
9. **Missing-work reminders start as Outlook drafts,** one personalised draft per student opened from FullVision. Sending from FullVision comes later.
10. **The Term Questionnaire is redesigned separately.** It stays as it is through this build; its redesign starts from a data inventory and a written spec, and pulls in student voice once the data exists. The 2026-10-17 decision to migrate it into the shared tables in phase 5 is dropped.
11. **Prompts stay English first,** with `prompt_translations` on the question table from day one.

## Screens (the canvas)

### Student phone (no login): canvas screens 1–5

- `/s/` at the site root, built from `teacher-mobile` components and tokens: slim header with class and progress, cards, segmented scale buttons, footer buttons. No navigation, no other students, no grades.
- Scan screen: avatar, "Hi Cece!", what they're about to answer and how long it takes, Yes / No That's Not Me, and the typed-code fallback.
- About Me, November Reflection (theme card, Personal Shield, how it helps, self-assessment with why), My Goals (September goal read-only, status, next step, Core Competency goal picker with one thing this week), Sent.
- Demo Mode: the demo class code runs the form locally and writes nothing.

### Class Management › Students: canvas screen 6

- Full roster, every field editable in place: Last, First, Preferred, Pronouns, Student Number, Date of Birth, Student Email, Parent Email, Parent Email 2 (the first two `guardian` rows), Designations (chips with ×, + opens the BC code picker), ELL (checkbox). About Me status is read-only.
- Enter or ↓ moves down a column, ↑ up, Tab across, Esc leaves. Saves through the existing write path with no banners or toasts (sync dot only).
- Sticky header and sticky Last/First columns; the table scrolls sideways. Alternating row shading; the hovered or focused row turns light blue. The tab's 900px and 1200px width caps are lifted for this tab only.
- Toolbar: search, a one-line summary (students, designations, ELL, About Me answered, missing parent emails), Import Roster, Add Student. Bulk Edit is removed. A ⋯ menu per row: Open Student Page, Withdraw.

### Class Management › Questionnaires: canvas screen 6b

- One card per questionnaire with On/Off, description, status dot, dates, answered count and progress bar, and who hasn't answered.
- Actions on the card: View Answers, Reopen for N Students, Print QR Slips, Hide/Show Questions, Change Dates.
- The questions open inside their card: numbered, type shown ("4 short answers", "Self-assessment · Beginning to Leading, plus why"), growing text boxes, Remove, competencies as removable chips, + Add Question, and the MyEd comment for families. Off questionnaires show as a grey header-only card.
- The tab label shows a count of open questionnaires.

### QR slips: canvas screen 7

Letter, 2 × 4 slips, dashed grey cut lines, black and white: name, class, questionnaire and dates, QR, typed fallback code, "works once and only for you". The private note never prints.

### Student page › Learner Profile: canvas screen 9d

- Five tabs on the student page (Goals and Reflections removed). The Learner Profile tab stat shows goal count or a new reply.
- Sticky ID card: band with class and grade, avatar, how to say the name with the stressed syllable in bold, pronouns, languages, learns best, jump links (About Me, Goals, Reflections with dates or counts). Private note card under it: "Only you see this."
- About Me: As a Learner (good at, hard right now) and Outside School, each answer in a speech bubble under its question. Repeated questions carry a ↻ Jan · Jun tag.
- Goals: the course goal (full text once, status as a dot plus text, latest next step with its source), the Core Competency goal, then competency goals (cards for those with a goal; a "No Goal Yet" list with + Goal / + Reflection).
- Reflections, newest first: replies to reports, the reporting-period reflection (Personal Shield as bubbles, how it helps), self-assessments with the four-step control.
- Hierarchy rules from the audit: section 18px bold, group 14px bold, question 13px grey, answer 16px for every answer; bubbles only for student words; "From Cece" or "Set by you" wherever student and teacher entries sit together; headings in the teacher's voice; answers capped near 68 characters a line with line breaks kept; no filler text.

### Report to phones: canvas screens R1–R4, T1, T2

- Student: birthday check → the issued report (sticky name, class, report and issue date; overall on the four-level scale with one plain sentence; each competency with a student-friendly line; the teacher's comment; their goal and self-assessment; attendance) → Reply to Your Report → Sent. A line says the official report is in MyEd.
- Teacher, Reports › Progress Reports › Sent to Phones: issue date and expiry, Print QR Slips, Update Issued Copy, Close All Links; counts for opened, replied, changed goal, not opened; a filterable list with reply previews and New Slip for students who haven't opened.
- A reply lands at the top of Reflections on the Learner Profile, highlighted while new; a kept or changed goal and the new next step update the Goals card, with the earlier step kept underneath.

### Missing-work reminders: canvas screens M1–M2

- Opened from the gradebook. Students with missing work, all ticked, with their missing assignments and who the email goes to (student, parents, both; "no parent email" flagged).
- A per-student preview: shared editable intro, due date and closing; the missing list with due dates filled from the gradebook; signed with the teacher's name.
- Open [Name]'s Draft opens a `mailto:` draft in the teacher's mail app, then steps to the next student and marks the row "Draft opened". Copy Email is the fallback when a draft is too long. No repeat sending in this version.

## Data model

Additive. Existing tables keep working.

```
questionnaire_template  id, kind, grade (8–12 or null), period (1 Nov | 2 Mar | 3 Jun | null),
                        year, theme, myed_comment, questions jsonb     -- seeded from the Brainstorm file
questionnaire           id, course_id, template_id (nullable), kind
                        (about_me | core_reflection | goal_checkin | curricular_self_assessment | report_reply),
                        title, theme, report_period (1–6, null for about_me), parent_id (goal_checkin → its
                        core_reflection, same slip), opens_at, closes_at, is_on, created_at
question                id, questionnaire_id, display_order, prompt, prompt_translations jsonb,
                        kind (text | short_set | scale4 | choice | goal_status | core_pick),
                        core_ids text[] (for scale4 on Core Competencies), repeated_key, teacher_only boolean
response                id, questionnaire_id, enrollment_id, via (link | paper | forms_csv),
                        submitted_at, created_by (teacher or null)
answer                  id, response_id, question_id, value_num, value_text, value_json
student_access_code     id, enrollment_id, questionnaire_id (or report_issue_id), code_hash, salt,
                        expires_at, used_at, revoked_at, opened_at
submit_attempt          id, code_id (nullable), course_id, ip_hash, outcome, at
reflection              add recorded_at and a response_id; keep the latest-per-section view for current readers
```

- Self-assessment answers also upsert `core_self_assessment` for that term, so the existing readers keep working.
- Goal Check-In answers update `goal` (status, next step) and keep the earlier next step as history.
- Report replies are a `response` on a `report_reply` questionnaire tied to the `report_issue`.
- Parent emails are `guardian` rows. The roster's Parent Email and Parent Email 2 columns are the first two by created_at.
- `get_class_bundle` gains `questionnaires`, `responses` and `guardians`; the bundle schema version bumps.

## Security

Nothing in the database becomes callable without signing in; the 2026-10-13 anon revoke stays total.

- **One Supabase Edge Function, `student-submit`, in ca-central-1.** Routes: `open` (code → that student's form and first name) and `submit` (answers); `check` (birthday) arrives with report codes in PR 9. The phone calls it with `?forceFunctionRegion=ca-central-1`, and the function refuses to run in any other region (421). It is deployed with `verify_jwt` off: the phone holds no key at all, and the slip's code is the credential.
- It calls SECURITY DEFINER functions in a `student_submit` schema over a direct database connection (`SUPABASE_DB_URL`). The schema is not exposed through the API, and only `service_role` has execute, so the logic stays in SQL and testable locally.
- Codes are hashed with a per-row salt; the plain code exists only on the printed slip. Questionnaire codes are single-use and live only while the questionnaire is open. Report codes are reusable until expiry and need the birthday check. Reissue revokes the old code.
- `open` returns a random 30-minute token, stored only as a hash in `student_submit.session`, that `submit` requires. A second submit with the same token returns the first result, so a double tap saves once. (A stored token rather than a signed one, so it can be checked and expired in SQL with no signing secret.)
- Rate limits: ten failed opens per IP hash in 15 minutes locks that hash out; 500 failed opens across everyone in 10 minutes pauses opening; 20 opens per code; 120 submits a minute per class. The IP hash is an HMAC made in the edge function; the address is never stored. Turnstile only if abuse appears.
- Responses are append-only from the student path. Logs record code id, class id, outcome and timing, never answers or names.
- The private note is teacher-only: never printed, never in a report, never sent to a model.
- Demo Mode never calls the function.

## Privacy

- Answers, guardian emails and reports stay in gradebook-prod (ca-central-1); the edge function runs in the same region.
- Phone reports show nothing that shouldn't be on a fridge: no designations, no private note, no observations. The name and issue date stay pinned at the top, so a screenshot is clearly that student's.
- Emailing families waits on the district's position (as the guardian migration says). The Outlook-draft reminders send from the teacher's own school account, so FullVision itself sends nothing.
- The privacy page gains a plain-language section on student forms, phone reports and guardian emails, shipped with PR 6.

## Build order: one branch and PR each

Each PR is checked element by element against its canvas screen before merge. Migrations go to a Supabase branch first. Screenshots come from the deploy preview in Demo Mode.

| PR  | What                                                                                                                                                                                                                                            | Depends on                     | Size         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------ |
| 1   | This plan                                                                                                                                                                                                                                       | —                              | Small        |
| 2   | **Students tab:** full roster, every field editable in place, keyboard moves, guardians as Parent Email columns through the existing guardian RPCs, designations picker, ELL, search, ⋯ menu, Bulk Edit removed, width caps lifted on this tab  | —                              | Medium       |
| 3   | **Roster import v2:** read columns by header with a match-your-columns step, proper quoted CSV, new columns (Parent Email ×2, Designations, ELL), MyEd class-list export, updated `roster-template.csv`                                         | 2                              | Small–medium |
| 4   | **Questionnaire data:** migration for the tables above, templates seeded from the Brainstorm file, teacher RPCs (`upsert_questionnaire`, `set_questionnaire_on`, `issue_access_codes`, `list_responses`), bundle section. No student access yet | —                              | Medium       |
| 5   | **Questionnaires tab and QR slips:** cards, inline question editor, Print QR Slips (letter, 2 × 4), the tab count                                                                                                                               | 4                              | Medium       |
| 6   | **Security:** `student-submit` edge function, `student_submit` schema, hashed codes, tokens, rate limits, SQL and function tests, privacy page section. Reviewed on its own, no UI in the same PR                                               | 4                              | Medium–large |
| 7   | **Student phone page `/s/`:** scan screen, About Me, November Reflection with Goal Check-In, Sent, Demo Mode, Playwright at the mobile preset                                                                                                   | 6                              | Medium       |
| 8   | **Learner Profile:** ID card, About Me, Goals, Reflections in one page; Goals and Reflections tab removed; hierarchy rules; Translate link                                                                                                      | 4 (shows answers once 7 lands) | Medium       |
| 9   | **Report to phones:** report codes on `report_issue`, birthday check route, phone report page, Reply to Report, Sent to Phones on Progress Reports, replies on the Learner Profile                                                              | 6, 7, 8                        | Medium–large |
| 10  | **Missing-work reminders:** gradebook entry point, per-student preview, `mailto:` drafts, Copy Email, Draft opened tracking                                                                                                                     | 2                              | Small–medium |

PRs 2, 3 and 10 touch no new backend and can start right away. PR 6 is the critical path for everything students touch.

## Later

- Term Questionnaire redesign: data inventory, written spec, then mockups; pulls in student voice from PRs 7–9.
- Sending reminders and reports from FullVision (email service, sending domain, district approval).
- Interview mode on Observations and mobile.
- Curricular self-assessment content, and the course question bank below.
- Paper entry and Forms CSV import for classes without phones.

## The question bank: your file

Source: `OneDrive - School District No. 36 (Surrey)/Core Competency Reflecting Brainstorm.docx` (Nov 2024). It already defines the structure this feature needs: three reflections a year, a theme per grade per period, three 15–20-minute activities each, and the MyEd comment families receive. It also says these are student reflections shared with caretakers, not teacher reporting, which is exactly how the plan treats them.

Themes by grade and period:

| Grade | November                            | March                                     | June                                                        |
| ----- | ----------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| 8     | Self-awareness and goal setting     | Growth in communication skills            | Reflecting on teamwork and collaboration                    |
| 9     | Personal strengths and identity     | Creative thinking and problem-solving     | Responsibility in learning and community involvement        |
| 10    | Resilience and adapting to change   | Critical thinking in academics            | Contributions to the school community and future goals      |
| 11    | Personal values and self-regulation | Balancing perspectives in decision-making | Social responsibility and leadership roles                  |
| 12    | Exploring purpose and direction     | Ethical judgment and cultural awareness   | Preparedness for post-secondary life and career exploration |

Period headings in the file: November = Self-Awareness, Identify Values; March = Communication, Thinking, Decision-Making; June = Collaboration, Responsibility, Future Planning.

Each grade has three activities in the file (for example Grade 8: Personal Shield, Communication Challenge, Teamwork Reflection; Grade 12: Purpose Pathway, Ethical Dilemma Reflection, Future Goals Plan). The file's text becomes the seed: `shared/questionnaire-templates.json`, one template per grade per period, each with its theme, its three prompts as text questions, and the nine-dimension rating block appended. Prompts that say "draw" get a "write or describe" variant on the phone form.

The file's MyEd comment ("Your student has reflected on the Core Competency of Self-Awareness and have given thought to identifying their own values. You are encouraged to speak with your student about their self-reflection.") becomes a per-template comment with the theme filled in, ready for the MyEd export and the report.

Two other files inform the rest:

- `History 12/Unit 0 - Introduction/Notes/02 - History 12 Questionnaire - REFERENCE.xlsx`: your beginning-of-year Forms survey (topics of interest, what helps me learn, group vs individual, comfort presenting, useful resources and assessments, helpful feedback, what keeps me engaged). The About Me template generalizes these questions across subjects.
- `Core Comptency DH/Core Competency Committee Vision Statement.docx`: your committee's goals include "design a user-friendly self-reflection tool for students" and "a digital portfolio system for students to track their Core Competencies growth." This feature is both; the then-and-now view is the portfolio.

Templates are the teacher's starting point, not a cage: a teacher can edit prompts, drop one, or add one, and the edited copy belongs to that class. Templates carry a `year` so next year's revisions don't change forms already answered.

## The course question bank: every curriculum in the system

`curriculum_by_course.json` holds 223 BC courses (9 at grade 8, 8 at grade 9, 46 at 10, 68 at 11, 92 at 12), 845 competency categories, 2,069 curricular competencies and 7,881 I-can statements. Every one of those competencies gets student-facing questions, so a teacher of any course in the system opens the curricular self-assessment and finds it already written.

Per competency, three questions, in plain grade-level language:

1. **Rating:** the competency's I-can statements, each on the four-point scale (these exist already; nothing to write).
2. **Evidence:** "Tell about one time this term you [did the competency]. What did you do?" written for the subject, not generic. Computer Studies 10 "Computational Problem Solving": _Tell about a problem you broke into smaller parts this term. What were the parts?_
3. **Next step:** "What would you try next time to get better at this?" with a sentence starter.

One bank file, `shared/curriculum-questions.json`, keyed by course short tag → competency id → questions, with a `curriculum_year`. About 6,000 written questions. Generated in batches by Claude from the `raw` competency text and the I-can statements, one subject at a time, then checked by a teacher-reading pass that enforces the house rules: no jargon, no all-caps, sentence case, a Grade 8 reading level for grades 8–9 and Grade 10 for 10–12, no question a student could answer with "yes." A script, `scripts/build_question_bank.py`, does the batching so a curriculum update regenerates only the changed competencies.

The bank is read-only reference data like `curriculum_data.js`: loaded lazily, never stored per class. When a class is created from a BC course, its curricular self-assessment is assembled from the bank for the competencies assessed that period. A custom class (no curriculum) gets the rating question only, from whatever I-can text the teacher typed. Teachers can edit a question for their class; the edit lives on the class's `question` row, the bank stays untouched.

Size: generating and checking 223 courses is roughly ten sessions of batch work, not design work. Start with the courses you teach (Humanities 8, Socials 10, History 12, Philosophy 12) so the pilot has them, then fill the rest by subject.
