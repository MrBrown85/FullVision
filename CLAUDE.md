# FullVision

A gradebook and report writer for BC classroom teachers. Proficiency scale (Emerging, Developing, Proficient, Extending, with + and −) and letter/percent for grades 10–12, a learning map built from the BC curriculum, an observation log, student goals and reflections, a term questionnaire, and printed reports. Teacher-only: no student or parent logins.

Live at fullvision.ca. Owner: Colin Brown, a Surrey (SD36) teacher. Read `docs/ROADMAP.md` for where the product is going and `docs/DECISIONS.md` before changing grading or student-facing behaviour.

## Stack

- **Database:** Supabase project `gradebook-prod` (`novsfeqjhbleyyaztmlh`, `ca-central-1`). Every write goes through a `public` RPC; RLS is on every table through `fv_owns_course` / `fv_owns_enrollment` / `fv_owns_assessment` / `fv_owns_term_rating`. The anon role can run no functions (`migrations/20261013_revoke_anon_function_execute.sql`). Student data must stay in Canada.
- **Front end:** plain JavaScript, no bundler. Browser-global IIFE modules loaded by `<script>` tags. Deployed as a static site on Netlify; `netlify/edge-functions/inject-env.js` injects the Supabase URL and key and sets a per-request CSP nonce.
- **Errors:** Sentry (`shared/sentry-init.js`).

## Where things live

| Path                               | What it is                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/calc.js`                   | All grade math. Course %, letters, proficiency roll-ups, `formatLevel`, `studentGradeSummary`, `courseGradeMode`. Nothing else computes a grade.    |
| `shared/data.js`                   | The data layer: in-memory cache, localStorage, RPC dispatch, offline outbox, local-id → UUID rekeying, class bundle loading.                        |
| `shared/constants.js`              | Scales, dimensions, labels, BC designations.                                                                                                        |
| `shared/reporting-term-presets.js` | Surrey secondary schools' reporting periods per school year; Grandview Heights is the default. Refresh each August.                                 |
| `shared/offline-queue.js`          | `window.v2Queue`: queued writes, retry, dead letters.                                                                                               |
| `shared/seed-data.js`              | Demo Mode's sample class (Science 8). The only sample data.                                                                                         |
| `shared/supabase.js`               | Auth, session, sign-out wipe.                                                                                                                       |
| `teacher/`                         | Desktop SPA: `app.html`, `router.js`, `page-*.js`, `ui.js`, `dash-class-manager.js`, reports.                                                       |
| `teacher-mobile/`                  | Phone PWA: `index.html`, `shell.js`, `tab-*.js`, `components.js`. Loads `teacher/styles.css` for tokens.                                            |
| `migrations/`                      | Applied SQL, one file per change, each with a comment saying what broke and why.                                                                    |
| `schema.sql`                       | Readable snapshot of the database, not a replayable log.                                                                                            |
| `curriculum_by_course.json`        | BC curriculum index: 223 courses, competencies, I-can statements. Reference data.                                                                   |
| `tests/`                           | Vitest. `e2e/` Playwright against the static build. `e2e-real/` Playwright against a live account.                                                  |
| `docs/`                            | `ARCHITECTURE.md` (shape), `ROADMAP.md`, `STUDENT-VOICE-PLAN.md`, `DECISIONS.md`, `grading-compliance-plan.md`, `backend-design/` (design history). |

## Running things

```bash
npm test                 # vitest
npm run test:e2e         # playwright, static build
npm run dev              # serve on :8347; Demo Mode from login.html
npm run dev:local        # same, with Supabase env injected like Netlify
npm run format:check     # prettier; CI enforces it
```

Demo Mode (`login.html` → Try Demo Mode, or `/login.html?demo=1`) runs local-only with no Supabase. Every feature must work there.

## Rules

1. **Never test a migration against `gradebook-prod`.** Use a Supabase branch or `begin … rollback`. Show the user the SQL before anything is applied to prod, and apply only on their OK.
2. **Grade math changes and anything that deletes data need the user's review.** Say so in the PR.
3. **Grades always follow the class's grading-style setting** (Proficiency / Letter / Both) through `calc.js` (`formatLevel`, `studentGradeSummary`). Never `toFixed` a level or format a grade outside `calc.js`.
4. **Demo Mode is the only sample data.** No Welcome Class, no seeded rows for signed-in teachers.
5. **Sync failures show only on the sync dot.** No banners, toasts or failed-item lists for sync problems.
6. **Client ids:** `createCourse` and friends return a local id (`c` + base36 timestamp) and re-key to the server UUID when the RPC resolves. A local-shaped id reaching the database is a bug.
7. **Every write RPC is idempotent** through `p_idempotency_key` (`fv_idem_check`). Keep that when adding one.
8. **One PR per change.** CI green (vitest, prettier, Playwright) before merge. End commit messages with the attribution line the session gives you.
9. **Plain language in the UI:** Title Case for labels, headings, buttons and tabs; plain sentences for hints and messages. No jargon without a legend, no all-caps prompts.
10. **Don't touch** `fullvision-user-inputs.xlsx`, `fullvision-documentation-inventory.xlsx`, or the gradebook site's CSS from classroom-content work.

## Current state (2026-10-17)

- Grading compliance with Schoology/Teams (`docs/grading-compliance-plan.md`): Phase 1 and Phase 2 are implemented and live.
- Course soft-delete with 30-day purge is live. Removing a student withdraws them (`migrations/20261019_withdraw_students.sql`); permanent delete is a second step from the Withdrawn list in Class Management.
- `codex.md` is historical; the open-work list is `docs/ROADMAP.md`.
