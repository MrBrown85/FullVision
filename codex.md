# FullVision Open Work

This is the only active work list for the repo. All pending work, design
decisions, and deploy steps live here — no sibling docs (XSS, pilot, ops) to
keep in sync. Implementation history still belongs in
`docs/backend-design/HANDOFF.md`; everything else is here.

Last pilot audit: 2026-04-23.

Tag glossary (inline on each ticket title):

- `[agent-ready]` — an agent can scope and ship a PR without further product input.
- `[needs-design]` — blocked on a human product / architecture decision before any code.
- `[user-blocked]` — external (credentials, billing, Supabase provisioning) — only the user can clear.

## User-blocked / operational

### P1.0 · Netlify quota fix `[user-blocked]`

- `fullvision.ca` is documented as returning `503 usage_exceeded`.
- Resolve in Netlify billing/quota settings before trusting production verification.

### P1.1 · Rotate leaked publishable Supabase key `[user-blocked]`

- Replace the old leaked publishable key in Netlify and local envs, then disable it in Supabase.

### P1.3 · Production push / production smoke follow-through `[user-blocked]`

- After the quota issue is resolved and the user wants a production update, run a live smoke on the deployed site.
- Trigger condition: more local-only commits accumulate, or the user asks.

### P2.3 · Apply course soft-delete migration live and verify the delete flow `[user-blocked]` (deploy) + `[agent-ready]` (RLS fix)

- Repo-side implementation is done: `delete_course` is modeled as a 30-day soft-delete, reads hide `Course.deleted_at`, retention cleanup purges stale soft-deleted courses, and the current destructive UI now says "Delete class" with 30-day copy.
- Remaining debt:
  - apply the live Supabase migration for `Course.deleted_at`, `delete_course`, read filters, RLS helper predicates, and retention cleanup.
  - verify the real delete flow on a live account: delete class → class disappears immediately → active course falls back cleanly → no immediate hard-delete regression.
  - confirm the scheduled retention job now purges 30-day-stale soft-deleted courses in production, not just teachers + audit rows.
  - tighten `teacher_self` RLS policy to filter `deleted_at IS NULL`: a soft-deleted teacher can currently still read/write their own `teacher` row during the 30-day grace window (flagged by the 2026-04-23 pilot audit).

## Platform / integration

### P2.1 · Realtime rollout verification for v2 invalidation `[user-blocked]`

- `course_sync_cursor` schema/docs, SQL trigger/publication plan, and client invalidation wiring exist in the repo.
- Still needs live Supabase rollout verification before this can be treated as fully closed.

### T-UI-05 / T-BE-01 · Data export `[needs-design]`

- Blocked on the missing backend export surface: `window.v2.exportMyData` / `export_my_data`.
- Product decision owed: shape of export (ZIP of JSON? single CSV? per-course PDFs?) and whether parents/students get access.

### T-OPS-02 · Sentry project + DSN wiring `[user-blocked]` (Sentry account) + `[agent-ready]` (wiring)

- Register for Sentry (or equivalent); capture DSN.
- Client wiring: add Sentry SDK via CDN in `login.html`, `teacher/app.html`, `teacher-mobile/index.html`; initialize in `shared/supabase.js` using `window.__ENV.SENTRY_DSN` (inject via `netlify/edge-functions/inject-env.js`).
- Global `window.onerror` + `window.onunhandledrejection` → `Sentry.captureException`.
- Server-side RPC errors: add an `fv_error_log` table (teacher_id, endpoint, error, created_at, context jsonb) + `log_error(p_endpoint text, p_error text, p_context jsonb)` SECURITY DEFINER RPC. Wire `shared/data.js`'s `_rpcOrNoop` error path to call it when online.
- CSP violation reporter (pairs with P5.7): `netlify/edge-functions/csp-report.js` receives `application/csp-report` POST bodies, rate-limited to first N per day, logs to `fv_error_log`.
- Acceptance: a test page with `throw new Error('sentry-test')` lands in Sentry within 60s; a failing RPC surfaces in `fv_error_log`; CSP violation surfaces in `fv_error_log`.

## Validation / demo follow-through

### P3.5 · Reconcile remaining Playwright failures `[agent-ready]`

- Targeted smoke coverage and PR CI are green, but the broader Playwright suite still needs a clean reconciliation pass.

## District pilot readiness

Pilot-audit findings from 2026-04-23. Ordered: blockers first, then HIGH, then MEDIUM.

### P5.1 · Multi-tenancy: school_id / district_id `[needs-design]` — BLOCKER

- Current state: flat `teacher.id = auth.uid()`, no tenancy hierarchy ([schema.sql:37-57](schema.sql)). A 15-school district today = 15 Supabase projects.
- Decisions owed before any code changes:
  1. One district = one Supabase org, or one district = rows scoped by `district_id` in a single schema?
  2. If scoped: put `district_id` on `teacher` only, or propagate to `course` / `student` for read-path efficiency?
  3. A school-admin can see all teachers in their school — how does RLS express that? Probably a `teacher_membership(teacher_id, school_id, role)` table joining into every ownership predicate.
  4. Migration path for existing single-teacher accounts: freeze as `school_id = null` "standalone teacher" or require self-assignment on next login?
- Blocks P5.2 and P5.3.

### P5.2 · District / school admin role + admin UI + bulk provisioning `[needs-design]` — BLOCKER

- Current portals: teacher / student / parent only. No admin tier.
- Depends on P5.1 (tenancy model).
- Decisions owed: admin UI mounts at `/admin/`? bulk-invite via CSV upload? roster sync with external SIS (PowerSchool, MyEducationBC)?
- Acceptance deferred until P5.1 shape is known.

### P5.3 · RLS cross-tenant integration tests `[needs-design]` (infra) + `[agent-ready]` (implementation) — BLOCKER

- Current state: [tests/security-data.test.js](tests/security-data.test.js) only checks LS key format. `e2e/` specs use `mockAuth` — no test proves teacher A cannot read teacher B's rows against a real DB.
- Infra decision owed (user): spin up a dedicated Supabase "fullvision-ci-rls" project (cheap; ~$25/mo), put service-role key in GitHub Actions secrets.
- Once infra is ready (agent-ready):
  - `tests/rls/` directory, one file per entity group (course, student, enrollment, score, observation, assessment, report, tag, term_rating).
  - Helper `tests/rls/setup.mjs` provisions two teachers via Admin API, exposes `withTeacher(...)` client factory, `resetFixtures()` calls a server-side `fv_ci_reset_rls_fixtures()` RPC that truncates and re-seeds.
  - Matrix per table: teacher-A select, update, delete, insert-with-B's-id, mutation-RPC-with-B's-id, anonymous select, soft-deleted-teacher access.
  - `e2e/rls-cross-tenant.spec.js`: seed teacher B with a student named `SENTINEL_VALUE_XYZ`; sign in as teacher A; navigate every route; assert the string never appears in HTML.
- CI gate: `paths:` filter so the job runs only when `schema.sql` / `shared/data.js` changes.
- Depends on P5.1 (what RLS actually enforces across schools).

### P5.4 · Demo-mode auth bypass ✅ done 2026-04-23

- Landed: companion-token gate. [login-auth.js](login-auth.js) legitimate demo entry paths (`?demo=1` URL + "Try Demo Mode" button) now set a random UUID at `localStorage['gb-demo-mode-token']` alongside `gb-demo-mode=1`. New [window.isDemoMode()](shared/supabase.js) helper requires both flags (token ≥16 chars) and is used by `requireAuth()` and [initAllCourses()](shared/data.js). A lone `gb-demo-mode=1` written in DevTools after sign-out is stripped as an orphan; demo mode does not activate.
- Tests: [tests/demo-mode-gate.test.js](tests/demo-mode-gate.test.js) — 8 cases covering both flags / lone flag / lone token / short token / empty token plus `requireAuth` orphan-strip. Full suite 765/765 passing.
- Browser preview: legitimate "Try Demo Mode" flow verified (27-student seed, full widgets); attack path (lone `gb-demo-mode=1`) confirms `isDemoMode() === false` and orphan stripped. Production-redirect leg to `/login.html` is environment-gated by `_isDevMode` — will take effect automatically on Netlify since `__ENV.SUPABASE_URL` is set there; un-testable locally without stubbing.
- Deploy: bump [sw.js](sw.js) `CACHE_NAME` when shipping. No SQL migration needed.

### P5.5 · Session hardening `[agent-ready]` — HIGH

- Problem A: [shared/supabase.js:246-261](shared/supabase.js) fast-path checks `expires_at` from localStorage only — editable on shared devices, no server-side validation.
- Problem B: [shared/data.js:119-135](shared/data.js) 35s echo-guard window is longer than typical RPC timeout (~5–10s). A batch taking >35s can trigger a Realtime refetch mid-flight and surface stale state.
- Fix A: call `sb.auth.getUser()` (server round-trip, ~200ms) once per page load, cache for that page load only; drop the `expires_at`-only branch in production (keep for dev-mode stub).
- Fix B: reduce echo guard to 8s, or gate the refetch on server-provided `updated_at` comparison rather than time alone.
- Acceptance: manually-edited `expires_at` in localStorage does not grant access; long-running batch completes without a stale-refetch race.

### P5.6 · Idempotency retrofit follow-up `[agent-ready]` — HIGH

- Phase 1 done 2026-04-23: [migrations/20260423_write_path_idempotency.sql](migrations/20260423_write_path_idempotency.sql) retrofits `create_observation`, `create_assessment`, `duplicate_assessment`, `create_custom_tag`, `upsert_note`, `create_student_and_enroll`. `IDEMPOTENT_ENDPOINTS` allowlist in [shared/offline-queue.js](shared/offline-queue.js) matches.
- Deploy still needed: apply the migration to `gradebook-prod` (`[user-blocked]` until the user runs the MCP call).
- Follow-up retrofits (same three-line pattern; see docstring at top of the migration):
  - `create_course`, `duplicate_course`.
  - `import_roster_csv`, `import_teams_class`, `import_json_restore`.
  - `upsert_observation_template`.
  - Null-id insert branch of `upsert_category`, `upsert_module`, `upsert_rubric`, `upsert_subject`, `upsert_competency_group`, `upsert_section`, `upsert_tag`.
- Each retrofit: (1) add `p_idempotency_key uuid default null` as last param, (2) `fv_idem_check` at top — early-return cached result, (3) `fv_idem_store` before final `return`, (4) update `grant execute` signature, (5) add endpoint name to `IDEMPOTENT_ENDPOINTS` in the client.

### P5.7 · XSS hardening follow-up `[agent-ready]` — HIGH

Day 1 done 2026-04-23: audit script [scripts/audit-innerhtml.mjs](scripts/audit-innerhtml.mjs) shipped; 117 sites catalogued (47 LITERAL + 15 TRUSTED_EXPR + 11 ESC_WRAPPED proven safe, 44 UNKNOWN needing review); `cssColor()` helper in [shared/data.js](shared/data.js) with 7 unit tests; color-format validation migration [migrations/20260423_color_format_validation.sql](migrations/20260423_color_format_validation.sql); gradebook `data-tip` WeakMap refactor; 3 defence-in-depth wraps landed. Audit regenerates via `node scripts/audit-innerhtml.mjs`.

Deploy steps owed (user):

- Pre-scan prod for malformed colors: `select table_name, count(*) from (... union all ...) where color is not null and color !~ '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'`. Normalize any rows before the constraint migration runs.
- Apply `migrations/20260423_color_format_validation.sql`.
- Bump `CACHE_NAME` in [sw.js](sw.js) (currently `fullvision-v35`).

Remaining agent work:

- **Regression tests.** Extend [tests/security-sanitize.test.js](tests/security-sanitize.test.js) with: esc() unit tests covering all 5 replacements including the `&` ordering trap; HTML-entity-encoded attack test — input `&lt;img onerror=alert(1)&gt;` → assert no `<img` in `sanitizeHtml()` output (fix [teacher/ui.js:4](teacher/ui.js) to normalize entities before walking if the test fails). New `e2e/xss.spec.js`: sign in, seed entities with `<img src=x onerror=window.__xss=1>` payloads in every user-text field (student firstName/lastName/pronouns, observation body, note body, assessment title, tag label, subject/section/module name, goal text, report narrative); navigate each route; assert `window.__xss` stays undefined.
- **CI gate.** Wire `node scripts/audit-innerhtml.mjs` into [.github/workflows/ci.yml](.github/workflows/ci.yml). Build `xss-allowlist.json` from the ~43 safe sites already classified; script fails CI if any new UNKNOWN site is introduced outside the allowlist. Add `// xss-safe: <reason>` inline comments on allowlisted sites opportunistically.
- **CSP tightening.** Edit [netlify/edge-functions/inject-env.js](netlify/edge-functions/inject-env.js): drop `'unsafe-inline'` from `style-src` (audit/migrate inline `style=` to classes first — biggest subtask), drop `https://cdn.jsdelivr.net` from `script-src` if network trace shows no active use, add `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`. Add `report-to` header → new `netlify/edge-functions/csp-report.js` function logging to `fv_error_log` (depends on T-OPS-02 infra).

### P5.8 · Delete-account → Supabase Auth Admin API `[agent-ready]` — MEDIUM

- Current: `fv_retention_cleanup` hard-deletes the `teacher` row after 30d, cascading all owned data. Does NOT delete the `auth.users` row — orphans the identity. FOIPPA requires full identity removal.
- Fix: either extend `fv_retention_cleanup` to call `auth.admin_delete_user(teacher_id)` (available in Supabase via service-role), OR add a dedicated `fv_delete_auth_user(teacher_id uuid) returns void` SECURITY DEFINER RPC that the cron calls.
- Acceptance: teacher deletes account → 30 days later → `select * from auth.users where id = teacher_id` returns 0 rows; sign-in with that email returns "user not found," not "wrong password."

### P5.13 · Assignment-status enum standardization ✅ done 2026-04-23

- Discovered during a pilot-audit follow-up: NS / EXC / LATE status flags had been silently broken by a three-way string-format inconsistency.
  - Desktop wrote `'notSubmitted'` / `'excused'` / `'late'` to LocalStorage.
  - Mobile wrote `'NS'` / `'EXC'` / `'LATE'`.
  - Server [set_score_status RPC](docs/backend-design/write-paths.sql) accepted only the short form — desktop writes were rejected with `"invalid status"` and silently swallowed.
  - [shared/calc.js](shared/calc.js) only recognized long form — mobile-set flags were visually on but mathematically a no-op.
- Fixed: standardized every client path on `'NS'` / `'EXC'` / `'LATE'` (matching the server CHECK constraint), added a one-time LocalStorage migration, ported desktop's NS-auto-zero behavior to mobile so both surfaces produce identical records.
- Files touched: [shared/calc.js](shared/calc.js) (3 compares), [shared/data.js](shared/data.js) (new `_migrateAssignmentStatusFormat()` called from top of `initAllCourses()`, backs up to `gb-mig-bak-statuses-<cid>`), [teacher/page-assignments.js](teacher/page-assignments.js) (~13 sites + `data-status` attribute values), [teacher/page-student.js](teacher/page-student.js) (3 render compares), [teacher/ui.js](teacher/ui.js) (3 render compares), [teacher-mobile/tab-grade.js](teacher-mobile/tab-grade.js) (NS auto-zero block + score-button UI reset).
- Tests: full suite 792/792 pass. New [tests/data-statuses-migration.test.js](tests/data-statuses-migration.test.js) (8 cases pinning migration idempotency, backup behavior, mixed short+long form, parse failures); extended [tests/mobile-grade.test.js](tests/mobile-grade.test.js) with 3 NS/EXC/LATE behavior tests; extended [tests/calc-integration.test.js](tests/calc-integration.test.js) with `getAssessmentOverallScore` enum contract + legacy-ignored regression guards.
- Browser preview: pre-seeded broken LS `{"st1:sci8a1":"notSubmitted",…}` → on reload, migration rewrote to `{"st1:sci8a1":"NS",…}` with backup intact. Mobile tapping NS on an assessment with active tag scores [PI:3, EM:4, CA:3] zeroed all tags, pill activated, button colors cleared. `getAssessmentOverallScore` returns `0` for NS students, `null` for EXC — calc now behaves as promised.
- Deploy: client-only. [sw.js](sw.js) `CACHE_NAME` bumped `fullvision-v35` → `fullvision-v36`. No SQL migration — server schema is already the source of truth.
- Side effect: desktop statuses now persist to the server for the first time (previously failed silently). Teachers' historical desktop-set flags exist only in LS; next page action that touches a status will sync it up to prod.

### P5.9 · Score-date course-timezone handling ✅ done 2026-04-23

- Landed: new [courseToday(cid)](shared/data.js) helper formats today in the course's timezone via `Intl.DateTimeFormat('en-CA', { timeZone, year, month, day }).formatToParts(new Date())`. Falls back to `America/Vancouver` when the course has no timezone (legacy seed data) and ultimately to UTC if Intl is unavailable.
- Call-site sweep: swapped every `new Date().toISOString().slice(0, 10)` that produces a SCORE date — [shared/data.js](shared/data.js) upsertScore fallback + the bulk-score push path, [teacher/page-gradebook.js](teacher/page-gradebook.js) four score-write call sites, and [shared/calc.js](shared/calc.js) `setSectionOverride` date stamp. Assessment due-date/date-assigned inputs, roster enrollment dates, export filenames, and past-due comparisons were intentionally left alone — they are either user-picked, range filters, or filename-only.
- Tests: [tests/data-create-course-timezone.test.js](tests/data-create-course-timezone.test.js) gained 6 cases covering 11 pm PST → same-day, 11 pm EDT → same-day, UTC pass-through, missing-timezone fallback, unknown-cid fallback, and YYYY-MM-DD zero-padding. Full suite 771/771 passing.
- Browser preview: Demo Mode's `sci8` course has no `timezone` field (legacy seed) — `courseToday('sci8')` correctly returned `"2026-04-23"` at 17:00 PDT while the naive `new Date().toISOString().slice(0, 10)` gave `"2026-04-24"`. Exactly the bug this ticket fixes, now measurable.
- Deploy: client-only change, bump [sw.js](sw.js) `CACHE_NAME` when shipping.

### P5.10 · Deploy + migration + rollback framework `[needs-design]` — MEDIUM

- Current: [schema.sql](schema.sql) is a readable snapshot, not replayable. `migrations/` didn't exist before 2026-04-23. No documented rollback. No runbook for district onboarding or deploy verification. Service-worker cache-busting ([sw.js](sw.js) `CACHE_NAME`) is bumped manually per release.
- Decisions owed:
  1. Adopt a migration tool (Supabase CLI migrations? Flyway? Stay with hand-numbered `migrations/*.sql` + forward-only convention?). Affects every future DB change.
  2. Rollback policy: forward-only with fix-up migrations, or reversible up/down pairs?
  3. Service worker contract: does a schema change auto-bump `CACHE_NAME` in the build step, or is it always manual?
- Once decided (agent-ready follow-ups): deploy runbook in codex.md, district-onboarding runbook in codex.md, SW cache-bust hook in [scripts/build.sh](scripts/build.sh).

### P5.11 · Soft-delete on assessment / score / observation `[needs-design]` — MEDIUM

- Current: only `teacher` and `course` have `deleted_at` ([schema.sql:42, 71](schema.sql)). Assessment / score / observation deletes are permanent. No audit recovery if a teacher accidentally deletes a column of scores.
- Decision owed: which entities warrant soft-delete, and for how long? Trade-off is storage cost + query cost of the `deleted_at IS NULL` filter on very large tables (score especially).
- Once decided (agent-ready): migration adds `deleted_at timestamptz` + read-path filters + retention cron extension.

### P5.12 · Idle-timeout warning for generic routes `[agent-ready]` — LOW

- Current: [shared/supabase.js:322-341](shared/supabase.js) fires signOut after 30 min of no mousemove/keydown/touchstart/scroll. Long-form writing contexts (report builder, questionnaire narrative) are already protected via `isLongFormAuthContextActive` + `markLongFormSessionExpired` which preserves draft state. Ordinary navigation (dashboard, gradebook, assignments) gets silent signOut with no warning.
- Fix: at 28 min, show a non-blocking "You'll be signed out in 2 minutes — click to stay signed in" toast. Click resets the idle timer; ignoring runs the existing signOut at 30 min.
- Acceptance: load /teacher/app.html, leave the tab idle for 28 min (test harness can shorten `IDLE_TIMEOUT`), assert toast appears with a dismiss button; click "Stay signed in" → idle timer resets, no signOut at 30 min.

## Deferred / external work

### D1 · Term-rating narrative auto-generate

- Deferred to the separate external workstream/repo.
- Keep the button hidden in this repo until that workstream is ready.

### D2 · Cross-year historical context on student profiles

- Explicitly deferred to v2+.
- Current product remains course-scoped per active design decisions.

### D3 · Offline read-side caching beyond the current write queue

- The write queue is implemented. Reads also work offline today via LocalStorage fallback: [getScores in shared/data.js:3960](shared/data.js:3960) and the sibling read paths for students, observations, notes, flags all fall back to `localStorage.getItem('gb-<type>-<cid>')` when the cache is cold, and LocalStorage is populated by every write. The offline banner at [teacher/ui.js:27](teacher/ui.js:27) and [teacher-mobile/index.html:176](teacher-mobile/index.html:176) lets the user know they're offline.
- What's deferred is the ARCHITECTURAL upgrade: IndexedDB (more storage headroom than LocalStorage's ~5-10 MB) + structured delta-refresh on reconnect (bandwidth-efficient `?since=<timestamp>` diffs vs. full refetch). Not pilot-blocking.

### D5 · Migrate Demo Mode to `buildDemoSeedPayload`

- Local Demo Mode still depends on `shared/seed-data.js` (legacy camelCase, string IDs).
- `buildDemoSeedPayload` uses v2 snake_case schema; a full client-side hydration layer would be needed to swap. Deferred until the schema gap is smaller or maintenance cost becomes acute.

### D4 · UI surfaces deferred beyond the current repo scope

- Parent portal
- Student portal
- File uploads / attachments
- Calendar / schedule view
- Email / push notifications

### D6 · Redesigned Teams import

- The original Microsoft Teams CSV/XLSX import wizard was removed on 2026-04-23 (commit `f618f9b`) because it never dispatched through the v2 `import_teams_class` RPC and silently lost data on sync.
- The server-side `import_teams_class` RPC is still deployed on `gradebook-prod` and untouched — a future client flow can call it once redesigned.
- Before reintroducing: decide on the parse surface (reuse SheetJS vs. CSV-only), define the payload-normalization layer that aligns with the RPC, and spec the UI wizard.

### D7 · Curriculum bundle — already lazy-loaded ✅

- Both `curriculum_data.js` (971 KB) and `curriculum_by_course.json` (1.3 MB) are fetched on demand by [`loadCurriculumIndex()` in shared/data.js:2724](shared/data.js:2724), NOT at page load. [teacher/app.html:34](teacher/app.html:34) deliberately omits the `<script>` tag for `curriculum_data.js`; it's injected lazily.
- [sw.js](sw.js) lists `/curriculum_data.js` in `PRECACHE_URLS`, but service-worker install runs AFTER the page is interactive — it's a background cache warm-up, not a blocking download.
- Further splitting `curriculum_by_course.json` into per-course files would only help if teachers frequently switch between courses AND have network-constrained devices. Revisit if real teacher feedback flags slow first-load of a specific route; otherwise leave alone.

### D8 · Gradebook DOM virtualization `[agent-ready, deferred]`

- What IS in place: network/DB fetch pagination. [\_selectCourseTable in shared/data.js:632-665](shared/data.js) pages past PostgREST's 1000-row cap when loading scores; [`p_page_size`](shared/data.js) is passed on bulk reads. A course with 5k scores correctly loads every row.
- What is NOT in place: DOM-side virtualization. [page-gradebook.js:830](teacher/page-gradebook.js) does `sortedStudents.forEach(...)` and builds every row into an HTML string assigned via innerHTML. A class with 25-30 students × 50-80 assessments = 1.5-2.4k cells, which modern browsers handle without issue. Degradation shows up around 8-10k cells (year-end 30-student class with 200+ assessment columns) and becomes noticeable on low-end Chromebooks.
- Fix if needed: virtualize the row list (IntersectionObserver + fixed-height row tracks, render only the visible window).
- Deferred because current pilot-class sizes stay comfortably under the degradation threshold. Revisit if teacher feedback reports year-end jitter, or if a class hits ~10k cells.

### D9 · Accessibility audit `[agent-ready, deferred]`

- Current: [e2e/accessibility.spec.js](e2e/accessibility.spec.js) checks skip link + 3 aria-labels. Not a WCAG 2.1 AA audit.
- Fix: wire axe-core into Playwright; add keyboard-nav + color-contrast specs per key route.
- Deferred because no district has requested formal accessibility sign-off. Revisit when asked.
