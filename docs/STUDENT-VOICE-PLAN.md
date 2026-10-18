# FullVision student voice: plan

Written 2026-10-17. Design only; nothing built. Fits the existing UI rather than adding new surfaces. Citations are to the repo as of 2026-10-17.

## What this adds

Four instruments, all optional per class, all feeding one learner profile and the report:

1. **About Me** (September): the student introduces themselves. Includes a teacher-only private box.
2. **Core competency reflection** (each reporting period): a different form for each grade and each reporting period, seeded from your own grade-by-period matrix (see "The question bank" below). Three short written prompts on that period's theme, plus a quick self-rating on the nine dimensions. This is the Ministry's required student self-reflection, and it produces the MyEd comment that goes with it.
   2b. **Curricular self-assessment** (optional, per period): the student rates the course's curricular competencies using the learning map's own "I can…" statements, with one sentence of evidence each. Separate from the core reflection so neither form gets long.
3. **Goal check-in** (mid-term): how the goal is going, what's next. Reflections become a dated history.
4. **Interview** (reporting week, teacher-led): two to four minutes per student, three generated questions, answers typed or tapped on the spot.

Everything a student or an interview produces is a dated _conversation_ record tied to the student and a competency, next to the teacher's observations and scores. The report can then quote it, show the Ministry self-assessment section, use it when drafting comments, and show September-to-June growth in the student's words.

Nothing here requires student accounts, photos, or a parent portal.

## What already exists

- The teacher's term questionnaire: nine dimensions in two groups (`shared/constants.js:560-570`), narrative, work habits, participation, traits, strengths and growth tags (`schema.sql:377-408`, `data.js:2786-2791`). It is the model for the student version.
- Printed blank self-reflection blocks that students fill on paper: `renderBlockStudentReflectionLearning` and `…Habits` (`teacher/report-blocks.js:412-470`). Paper mode is already half built; this plan makes those blocks fillable and prefilled.
- "I can…" statements per tag (`schema.sql:119`, `data.js:1862-1863`, `4667-4669`), already rendered on reports (`report-blocks.js:321-355`). They become the self-assessment items.
- `goal` and `reflection` per student per competency, one row each (`schema.sql:335-354`); this plan turns reflection into a history.
- Report config with togglable blocks per class (`schema.sql:433-438`, `report-blocks.js:1004-1027`).
- The Reports page: Term Questionnaire · Progress Reports · Class Summary tabs, a student picker, and a Report 1–6 period select (`teacher/page-reports.js:612`).
- Observations: quick-add bar, tags, timeline (`teacher/page-observations.js`).
- Security: anon can't run any function (`migrations/20261013_revoke_anon_function_execute.sql`). Student submissions need a deliberate, narrow exception.

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

## UI integration, screen by screen

The rule: no new top-level tab. Student voice appears where the teacher already looks for that student or that report.

### Reports page

- **Term Questionnaire tab** becomes two columns when a student has submitted: the teacher's rating on the left (unchanged), the student's self-rating on the right, same nine dimensions, same chips. Gaps of two or more levels get a thin amber underline. Hover shows the student's one-sentence evidence. The teacher's workflow doesn't change; they just see more.
- A **"Student voice"** strip under the questionnaire: the student's latest goal check-in, their proudest-work pick, and interview notes if any, each with a date. One "Use in comment" toggle per item.
- A **Questionnaires** button in the toolbar (next to the Report period select) opens a side panel: which instruments are open for this class and period, response counts, Print code sheet, Close, Import Forms CSV, Paper entry.
- **Progress Reports tab:** three new report blocks in the existing block registry, toggled per class like the others:
  - _Core competency reflection_ (the Ministry section): the period's theme, the student's answers, and the template's MyEd comment line; prints blank with the prompts if there is no response, exactly as today's blank blocks do.
  - _In the student's words_: one or two chosen quotes with dates.
  - _Then and now_: September answer beside the current answer for the three repeated questions.
- **Class Summary tab:** one card, "How the class sees itself": self-rating distribution per dimension, common goals, what students said they're nervous about, anonymous and aggregate.

### Student page

- Each competency chip's panel (where the override lives, `teacher/student-overrides.js`) gains a "Student says" line: self-rating and sentence for that competency this period, with a link to the full response.
- A **Learner profile** card at the top: About Me answers (name pronunciation, languages, how I learn, interests), the teacher-only private box marked as such, and a flag if the box has content the teacher hasn't read.
- **Reflection history** replaces the single reflection field: a dated list, newest first, add-entry at the top.

### Observations page

- The quick-add bar gets a third chip beside Tags: **Interview**. Picking it switches the bar into interview mode for the selected student: three generated questions appear as prompts above the text box, the teacher answers each in a line, Save writes one observation per answer with `context_type = 'interview'` and the competency tag. The timeline shows interview entries with a distinct icon. The class rail shows a small dot on students interviewed this period, so the teacher can work down the list during a work block.
- Generated questions come from: the biggest teacher–student gap, the competency with the least evidence this period, and the goal status. Teachers can replace any with their own; the last three used are remembered.

### Class Management

- A **Student questionnaires** section under Students: enable About Me / Core reflection / Curricular self-assessment / Goal check-in for this class. The core reflection is pre-picked from the class's grade level and the reporting period (Grade 10 + November → "Resilience and adapting to change"); a class whose grade level is a range gets a picker. The teacher can preview and edit the prompts, sets open and close dates, and chooses which Report N on the Reports page the form belongs to. Print or regenerate code sheets here. Lives beside the roster because it's roster-shaped work.

### The student page (new, public, no login)

- One static page at `/s/` (site root, not under `teacher/`), built the way the teacher mobile app is built: it loads `teacher/styles.css` (the tokens) and `teacher-mobile/styles.css`, and reuses the mobile components (`teacher-mobile/components.js`: cards, chips, segmented scale buttons, the sheet pattern) rather than new ones. Same type scale, same proficiency colours, same card radius and shadows, same dark mode. A student who has seen the teacher's phone screen in class recognizes it.
- Layout follows the mobile shell: a slim header with the class name and a progress dots row, one question per card, the four-point scale as the same segmented buttons the teacher taps, text answers in the same textarea style, Next/Back in the mobile footer bar. No tab bar, no student rail, no settings.
- Reuse is one-way: the student page imports from the mobile app; the mobile app never imports from `/s/`. Anything the student page needs that the mobile app lacks (sentence starters, read-aloud, the language switch) is added to `components.js` so both can use it.
- The student enters the class code from the QR or link and their personal code from the code sheet. They see only their own form. Submit shows a confirmation and nothing else. No navigation, no other students, no grades.
- Playwright runs it at the mobile preset, like `e2e/mobile.spec.js`.

### Mobile teacher app

- Interview mode only, in `tab-observe.js`: the same three prompts and a text box. The rest is desktop.

## Data model

Additive. Existing tables keep working; the teacher's term questionnaire migrates into the same shape later.

```
questionnaire_template
                     id, kind, grade (8–12 or null), period (1 Nov | 2 Mar | 3 Jun | null),
                     year, theme, myed_comment, questions jsonb   -- seeded from the Brainstorm file
questionnaire        id, course_id, template_id (nullable), kind
                     (about_me | core_reflection | curricular_self_assessment | goal_checkin | interview),
                     title, theme, report_period (1–6, null for about_me), opens_at, closes_at,
                     is_open, created_at
question             id, questionnaire_id, display_order, prompt, prompt_translations jsonb,
                     kind (scale4 | emoji | text | choice | pick_assessment),
                     dimension (one of the nine, nullable), tag_id (nullable),
                     repeated_key (for same-question-three-times), teacher_only boolean
response             id, questionnaire_id, enrollment_id, via (link | forms_csv | paper | interview),
                     submitted_at, created_by (teacher or null)
answer               id, response_id, question_id, value_num, value_text, chosen_assessment_id
student_access_code  enrollment_id, questionnaire_id, code (6 chars), expires_at, used_at
reflection           add a `recorded_at` and drop the unique (enrollment, section); keep the
                     latest-per-section view for current readers
```

Interview answers are stored as `observation` rows with `context_type = 'interview'` and an `observation_tag`, plus a `response` with `via = 'interview'` that groups them. That keeps interviews visible on the Observations timeline without a second feed.

`term_rating` is unchanged. The two-column view joins it with the student's `response` for the same period.

## RPCs and security

Teacher side (authenticated, SECURITY INVOKER as now):

- `upsert_questionnaire`, `set_questionnaire_open`, `issue_access_codes(questionnaire_id)` → code sheet rows, `list_responses(course_id, period)`, `enter_paper_response`, `import_forms_responses(questionnaire_id, rows jsonb)`, `save_interview(enrollment_id, period, answers jsonb)`.
- `get_class_bundle` gains `questionnaires` and `responses` sections; bundle schema version bumps.

Student side: the anon revoke stays total. Nothing in the database is callable by the anon key.

- The student page talks to one **Supabase Edge Function**, `student-submit`, invoked in `ca-central-1` (regional invocation, so answers never leave Canada in transit), holding the service-role key server-side. Two routes: `open` (class code + personal code → the questions, the student's first name for confirmation, nothing else) and `submit` (answers). The page never sees a database key.
- The function calls two SECURITY DEFINER functions in a new schema `student_submit`, granted to `service_role` only: `open_form` and `submit_form`. Keeping the logic in SQL keeps it testable in `begin … rollback` and keeps the function thin.
- **Codes are hashed at rest.** `student_access_code` stores a SHA-256 of the code with a per-row salt; the plain code exists only on the printed sheet. A database leak doesn't leak the codes.
- **Open returns a short-lived token** (signed, 30 minutes, bound to the code row) and `submit` requires it. A guessed code can't post answers without first opening the form, and the open is the rate-limited step.
- **Rate limiting** in a `submit_attempt` table: per code, per class, per IP, with a lockout after a handful of failures. Optional Cloudflare Turnstile on the code screen if abuse ever shows up; not at launch.
- **Single use and windowed.** A code is valid between `opens_at` and `closes_at` and is burned on submit. Reissue from the Questionnaires panel invalidates the old one.
- **Append-only responses.** `response` and `answer` are inserted, never updated or deleted by the student path. A resubmission is a new response; the teacher sees the latest and can open the earlier one.
- **Idempotent submit.** The token doubles as the idempotency key, so a double tap or a flaky connection can't create two responses.
- **No personal data in logs.** The function logs code-row id, class id, outcome and timing; never answers or names.
- **Least privilege all the way down.** anon has no grants; the edge function's service role is used only through the two functions; RLS on every new table through `fv_owns_course` and `fv_owns_enrollment` for the teacher side, exactly as today.
- **Demo Mode** never calls the function; the student page detects the demo class code and runs locally.

Why not an anon-callable RPC: it would reopen the hole closed on 2026-10-13, put a key in the student page, and leave rate limiting and token handling to SQL. The edge function costs one more deployable and buys a clean security story for the PIA.

Demo Mode: questionnaires and responses live in the local cache like everything else; the student page shows a "Demo class" sample form that writes to nothing.

## Report and AI pipeline

Per class, in the Report config: `student_self_assessment`, `student_quotes`, `then_and_now` blocks, plus a `use_student_voice_in_draft` switch.

When drafting a comment, the de-identified payload for a student adds:

```
self: Collaboration 4 ("I organized our group roles"), Questioning 2 ("I don't ask much")
teacher: Collaboration 2, Questioning 3
interview (Nov 12): "I usually let others talk first"
goal (set Sept 20, checked Nov 1): finish work on time — partly met
proudest: the ecosystem essay — "rewrote the ending three times"
then/now: Sept "I'm shy in groups" → Nov "I volunteer to present"
```

No names, no student numbers, no free text that identifies anyone (the private About Me box never enters the payload). The draft is asked to mention at most one student quote and to stay inside MyEd's character limit.

## Privacy

- Responses are the student's personal information held by the teacher; same retention as the class (30-day purge after delete).
- The private box is teacher-only, never printed, never sent to a model, flagged until read. A reminder line under it: if a student discloses harm, follow your school's process.
- Students can't see other students, grades, or the teacher's ratings.
- The student page sets no cookies and stores nothing locally.
- The privacy page gains a section describing the student form in plain words.

## Build order and size

1. **Core reflection + code sheet + two-column questionnaire.** Convert the Brainstorm file into `shared/questionnaire-templates.json` (15 templates, plus the MyEd comment per template), new tables and RPCs, the student page, the Reports two-column view, the readable Ministry block. Large: four or five sessions. Ship before the next written Learning Update.
   1b. **Curricular self-assessment** from the I-can statements, reusing everything from 1. Small.
2. **Report blocks and draft switch.** Quotes, then-and-now, the de-identified payload. Medium.
3. **About Me + learner profile card + private box.** Medium.
4. **Interview mode** on Observations and mobile, with generated questions. Medium.
5. **Goal check-in and reflection history.** Small.
6. **Forms CSV import and paper entry.** Small each, when a pilot teacher asks.
7. **Class Summary card and student-led-conference sheet.** Small.
8. **Course question bank, later.** A longer-term goal, not part of the first release: `scripts/build_question_bank.py` and `shared/curriculum-questions.json`, generated subject by subject with a teacher-reading check. Until it exists, the curricular self-assessment uses the I-can ratings only, which already cover every course. Start with your four courses when you want it; the rest can follow over time.

Do nothing until the checkout is synced with main. Each phase is its own branch and PR, migrations tried on a Supabase branch first, screenshots from the deploy preview in Demo Mode.

## Decisions (approved 2026-10-17)

1. **Two forms, not one.** The core reflection is the grade-by-period template from your Brainstorm file: three written prompts on the theme plus the nine-dimension rating. The curricular self-assessment is a separate optional form built from the course's I-can statements for competencies assessed that period. Neither form should take a student more than ten minutes.
2. **Codes: one per student per questionnaire.** Single use, expires with the close date. Reissue from the Questionnaires panel.
3. **Previous answers:** shown for the three repeated questions only, read-only, above the new answer box. Everything else starts blank.
4. **The three repeated questions:** "What am I good at as a learner?" · "What is hard for me right now?" · "What do I want to get better at, and how?" Asked in About Me (September), the January self-assessment and the June self-assessment.
5. **Language: English first.** The question table carries `prompt_translations` from day one so adding Punjabi, Mandarin and Arabic is data, not code. Add them after a pilot teacher asks.
6. **Interview answers are observations** with `context_type = 'interview'`, grouped by a `response` row. One timeline.
7. **The teacher's term questionnaire stays as is** through phases 1–4. Migrate it into the shared tables in phase 5, when the two shapes have settled.
