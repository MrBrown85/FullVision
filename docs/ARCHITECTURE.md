# FullVision Architecture

This document describes the current application architecture at a stable, high level. It is intentionally not the place for task tracking, migration history, or temporary production issues.

Use this file for system shape and runtime boundaries.
Use the backend-design docs for implementation detail and the live handoff/backlog docs for current work.

## System overview

FullVision is a teacher-facing web application with two shipped runtime surfaces:

- Desktop SPA at `teacher/app.html`
- Mobile PWA at `teacher-mobile/index.html`

Both surfaces share the same core client runtime:

- authentication in `shared/supabase.js`
- local cache and data orchestration in `shared/data.js`
- offline retry infrastructure in `shared/offline-queue.js`
- grading and reporting calculations in `shared/calc.js`

The app persists teacher data through Supabase Auth plus a public RPC surface. It is deployed as a static site on Netlify, with environment values injected into HTML at request time by an edge function.

## Runtime surfaces

### Login and account entry

- `login.html` and `login-auth.js` handle sign-in, sign-up, password reset, and Demo Mode entry.
- Authenticated users are routed into the teacher experience.
- The current production architecture is teacher-only; future student/parent portals are not part of the active runtime.

### Desktop SPA

- Entry point: `teacher/app.html`
- Router: `teacher/router.js`
- Main page modules:
  - `page-dashboard.js`
  - `page-assignments.js`
  - `page-student.js`
  - `page-gradebook.js`
  - `page-observations.js`
  - `page-reports.js`
- Shared desktop UI shell: `teacher/ui.js`

The desktop app is a hash-routed single-page app. Page modules render into shared mount points for the dock, sidebar, page toolbar, and main content area.

### Mobile PWA

- Entry point: `teacher-mobile/index.html`
- Shell: `teacher-mobile/shell.js`
- Main tab modules:
  - `tab-students.js`
  - `tab-observe.js`
  - `tab-grade.js`

The mobile experience reuses the same shared auth, data, queue, and calculation layers as desktop, but presents them through a separate shell and touch-first UI.

## Shared client architecture

### Script and module model

The app uses vanilla JavaScript with browser-global IIFE modules rather than a bundler-driven framework runtime.

Shared runtime modules load before desktop or mobile page modules:

1. Supabase SDK
2. `shared/supabase.js`
3. `shared/constants.js`
4. `shared/data.js`
5. `shared/offline-queue.js`
6. `shared/demo-seed.js`
7. `shared/calc.js`

Desktop or mobile modules then layer on top of that shared runtime.

### Static and lazy-loaded assets

- `curriculum_data.js` is a large static curriculum index and should be treated as reference data, not core boot state.
- `shared/demo-seed.js` defines the current Welcome Class seed payload builder.
- `shared/seed-data.js` remains part of the Demo Mode path.

## Boot and session flow

### Desktop boot

Desktop boot is orchestrated by `Router.boot()` in `teacher/router.js`:

1. `requireAuth()`
2. `initAllCourses()`
3. `initData(activeCourseId)`
4. `loadSeedIfNeeded()`
5. `migrateAllStudents()`
6. route initial render

### Mobile boot

Mobile boot in `teacher-mobile/shell.js` follows the same core pattern:

1. check session
2. `initAllCourses()`
3. `initData(activeCourseId)`
4. `loadSeedIfNeeded()`
5. `migrateAllStudents()`
6. render the active mobile tab shell

### Authentication behavior

`shared/supabase.js` owns:

- Supabase client initialization
- sign-in and sign-up
- password re-authentication for sensitive actions
- session refresh
- sign-out and local data clearing
- unauthenticated redirects back to `login.html`

The current account lifecycle also includes:

- restore-on-sign-in handling for soft-deleted teacher accounts
- long-form session-expiry recovery for narrative/reporting surfaces
- full local data wipe on sign-out for shared-device safety

## Data and persistence model

### Core model

The current app is local-first in the UI, but not local-only in source of truth.

At runtime, the client uses:

- in-memory `_cache` for synchronous reads
- localStorage as durable browser cache and offline fallback
- explicit Supabase RPC dispatch for server persistence
- `window.v2Queue` for queued retry behavior when applicable

This is no longer the older generic “local blob plus background bridge” design. The active model is domain-specific dispatch over the v2 RPC surface.

### Boot reads

Global boot state is loaded by `initAllCourses()` and `initData()` in `shared/data.js`.

Current signed-in flow:

- `bootstrap_teacher(...)` ensures teacher bootstrap state exists
- `list_teacher_courses()` provides course-level boot metadata
- `get_gradebook(courseId)` hydrates the active course cache
- `get_student_profile(enrollmentId)` supports deeper student detail reads

Legacy per-course fan-out reads are no longer the active architecture.

### Writes

Local writes update `_cache` and localStorage first so the UI stays responsive.
Remote persistence then happens through explicit v2 helpers and dispatchers, including `window.v2.*` methods for:

- course and policy updates
- roster and student writes
- assessment CRUD
- score and rubric writes
- observations
- term ratings
- report configuration and preferences
- imports and restore flows

### Offline and retry

`shared/offline-queue.js` exposes `window.v2Queue`, which provides:

- queued writes
- retry with backoff
- dead-letter handling
- queue stats
- subscription hooks for UI surfaces

Desktop UI currently exposes queue and offline state through:

- offline banner
- unsynced badge
- sync status popover

The queue is the active retry mechanism for flows that opt into queued dispatch.

### Cross-tab behavior

The browser cache remains shared across tabs. Cross-tab state coordination still uses browser messaging and storage events where needed, but the old generic realtime bridge is not the primary architecture anymore.

## Domain architecture

### Teacher-facing scope

FullVision is organized around a teacher-owned data model:

- teachers
- courses
- students and enrollments
- assessments and scores
- observations
- term/report artifacts
- preferences and report configuration

The app is designed around teacher-owned classroom workflows rather than student or parent self-service access.

### Grading model

The current grading architecture supports two parallel grading pipelines:

- proficiency reporting
- letter/percentage reporting

Courses select a `grading_system` of:

- `proficiency`
- `letter`
- `both`

Current desktop grading behavior is category-driven:

- categories drive the letter/percentage pipeline
- proficiency remains based on sections, tags, and score evidence
- desktop assignments, gradebook, and report/header flows now use category-aware logic

This means the older “summative/formative is the primary grading architecture” framing is no longer accurate as a system-level description.

## Welcome Class and demo data

There are two distinct sample-data paths:

- Welcome Class seeding for signed-in first-time teacher bootstrap
- Demo Mode for local-only exploration without Supabase

`shared/demo-seed.js` defines the canonical Welcome Class payload builder.
`shared/seed-data.js` still powers the existing Demo Mode seed flow.

These paths are related, but they are not yet the same runtime implementation.

## Deployment architecture

### Build and publish

- `scripts/build.sh` copies the public app into `dist/`
- Netlify publishes `dist/`
- `netlify/edge-functions/inject-env.js` injects `SUPABASE_URL` and `SUPABASE_KEY` into HTML responses
- the same edge function sets a per-request CSP nonce

### Local signed-in development

`scripts/dev-local.mjs` mirrors the Netlify HTML injection behavior locally:

- serves files directly from the repo
- injects Supabase env vars into HTML
- sets a CSP matching production behavior closely enough for local auth testing

### Service worker and PWA behavior

- `sw.js` is registered by both desktop and mobile entry points
- the manifest and service worker provide installability and cached asset behavior

## Source-of-truth documents

This file is intentionally high-level. For authoritative detail, use:

- [`README.md`](../README.md) for repo entry and run instructions
- [`docs/backend-design/HANDOFF.md`](backend-design/HANDOFF.md) for current live state and discovered gaps
- [`codex.md`](../codex.md) for the live open-work list
- [`schema.sql`](../schema.sql) and [`docs/backend-design/rls-policies.sql`](backend-design/rls-policies.sql) for deployed reference artifacts
- [`docs/backend-design/read-paths.md`](backend-design/read-paths.md) and [`docs/backend-design/write-paths.md`](backend-design/write-paths.md) for backend design detail

## What this document should not carry

To reduce future drift, this file should not become:

- a task tracker
- a migration diary
- a production incident log
- a list of temporary test counts
- a duplicate of `HANDOFF.md`

If a fact is expected to change frequently, it belongs in the handoff or backlog docs, not here.
