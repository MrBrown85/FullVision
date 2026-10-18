# Decisions

Settled product decisions. Add a dated entry when one is made; don't reopen one without a new entry that supersedes it.

## Grade calculation (2026-10-16)

Context: `grading-compliance-plan.md`. All implemented; see its status table.

- **D1 Category weights must total exactly 100** to save. Not relative weights.
- **D2 Per-assessment weight** (0.5×–3×) applies to proficiency work only; hidden on points and Complete/Incomplete work, labelled "Proficiency weight".
- **D3 A proficiency level counts as level ÷ 4** toward a percentage (3 = 75%). Not the middle of a letter band.
- **D4 Extra credit:** points work can score up to 2× its maximum; the course % can exceed 100.
- **D5 No drop-lowest.** Skipped; low demand.
- **D6 Rounding:** a class setting, whole number or one decimal; default whole for grades 10–12. The letter always comes from the % as shown.
- **D7 Missing counts as 0.** No switch to turn it off.

## Product shape (2026-10-17)

- **Teacher-only.** No student or parent logins. Printed reports are the family surface. A no-login student form for self-reflection is planned (see `STUDENT-VOICE-PLAN.md`), not a portal.
- **Flat learning map:** one section per competency, grouped by subject and competency group. Not a duplication to be cleaned up.
- **Demo Mode is the only sample data.** No Welcome Class.
- **Manual archive; delete only after archive; soft delete with a 30-day purge.**
- **Letter cutoffs are the BC scale,** fixed, not editable schemes.
- **Overrides are per competency with a required reason.** No course-level final-grade override.
- **No LMS features:** no assignment submission, content pages, discussions or quizzes. FullVision sits beside the district LMS.
- **Students are removed by withdrawal, not deletion** (planned; hard delete stays behind a second step).
- **Sync failures show only on the sync dot.** No banners or toasts.
- **Plain language in the UI:** sentence case, no jargon without a legend.

## Student voice (2026-10-17)

Context: `STUDENT-VOICE-PLAN.md`.

1. **Two forms:** a core competency reflection from the grade-by-period templates (three prompts plus the nine-dimension rating) and an optional curricular self-assessment from the course's I-can statements. Neither over ten minutes.
2. **Codes:** one single-use code per student per questionnaire, expiring at the close date, stored hashed.
3. **Previous answers** are shown only for the three repeated questions.
4. **Repeated questions:** "What am I good at as a learner?" · "What is hard for me right now?" · "What do I want to get better at, and how?" (September, January, June).
5. **English first;** translations stored as data on each question.
6. **Interview answers are observations** (`context_type = 'interview'`), on the one timeline.
7. **The teacher's term questionnaire stays as is** until phase 5.
8. **Backend:** no anon-callable database functions. One Supabase Edge Function in `ca-central-1` fronts the student form, calling `student_submit` schema functions granted to the service role only; short-lived tokens, rate limiting, append-only responses.
9. **UI:** the student page reuses the teacher mobile app's stylesheets and components; reuse is one-way.
