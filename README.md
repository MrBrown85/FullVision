# FullVision

A standards-based grading and observation tool for British Columbia teachers. Track student proficiency against BC curriculum competencies, record classroom observations, and generate parent-friendly reports.

Built with vanilla JavaScript and a simple copy build for Netlify deploys. Backed by Supabase for auth and canonical RPC-based data access, deployed on Netlify.

**Primary URL:** [fullvision.ca](https://fullvision.ca) · [Mobile](https://fullvision.ca/teacher-mobile/)

Production may temporarily return `503` if the Netlify site has exhausted its quota. Use the local run instructions below for reliable verification.

---

## Features

**Desktop**

- **Proficiency-based grading** — 4-level scale (Emerging → Extending) aligned to BC curriculum
- **4 calculation methods** — Most Recent, Decaying Average, Mode, Mean
- **BC curriculum mapping** — Tag assessments to specific learning standards
- **Gradebook** — Spreadsheet view with per-tag and overall scores
- **Student profiles** — Score timeline, sparklines, and smart insights (Apple Health style)
- **Observations** — Quick notes with sentiment tagging (strength / growth / concern)
- **Report builder** — 15 configurable block types, drag-to-reorder, auto narrative generation
- **Term questionnaire** — Disposition ratings per student per term
- **CSV import** — Bulk import students; Microsoft Teams roster support
- **Multi-course** — Independent grading config per course
- **Dark mode** — Full light/dark theme via CSS custom properties

**Mobile PWA** (installable on iOS/Android)

- **Cards view** — Swipeable student cards showing proficiency + recent observation
- **List view** — Sortable by name, proficiency, missing work, or last observed
- **Speed grader** — Tap to score assessments one student at a time
- **Observation feed** — Social-feed style; one-tap quick-post
- **Pull-to-refresh** — Manual sync with last-synced timestamp
- **Offline-capable** — Service worker pre-caches all assets

---

## Tech Stack

| Layer           | Technology                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Frontend        | Vanilla JS (IIFE modules), CSS custom properties                                                                          |
| Auth & Database | [Supabase](https://supabase.com) — Auth, Postgres, RLS, multi-namespace canonical schema with public-schema RPC interface |
| Hosting         | [Netlify](https://netlify.com) (static site, publish `dist/`) — edge function injects env vars + per-request CSP nonce    |
| Testing         | [Vitest](https://vitest.dev) — 655 unit tests · [Playwright](https://playwright.dev) — 137 E2E specs                      |
| Formatting      | [Prettier](https://prettier.io)                                                                                           |
| PWA             | Web app manifest + service worker (network-first, offline-capable)                                                        |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (for the dev server and test runner)
- A [Supabase](https://supabase.com) project (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/MrBrown85/FullVision.git
cd FullVision
npm install
```

### 2. Set up Supabase

Create a Supabase project in **ca-central-1 (Montreal)** for FOIPPA compliance.

The deployed schema is captured in [`schema.sql`](schema.sql) (auto-generated from `supabase_migrations.schema_migrations` — do not edit by hand). This checkout currently includes the generated schema dump, but not a checked-in `supabase/` migrations directory, so bootstrap a fresh project from `schema.sql` or restore the migrations separately before using `supabase db push`.

The schema is multi-namespace (`academics.*`, `assessment.*`, `observation.*`, `reporting.*`, `identity.*`, `projection.*`, `integration.*`) with a public-schema RPC interface. Clients only call public RPCs — direct table access is not exposed via PostgREST.

### 3. Configure credentials

Credentials are injected at serve time by [`netlify/edge-functions/inject-env.js`](netlify/edge-functions/inject-env.js). Set `SUPABASE_URL` and `SUPABASE_KEY` in Netlify → **Site configuration → Environment variables**. Never commit credentials to source.

For local signed-in development, copy [`.env.example`](/Users/colinbrown/Documents/FullVision/.env.example) to `.env`, fill in `SUPABASE_URL` and `SUPABASE_KEY`, then run `npm run dev:local`. For local dev without Supabase, use **Demo Mode** instead — no credentials needed.

### 4. Run locally

```bash
npm run dev
```

Opens on port 8347. The root redirects to [`/login.html`](http://localhost:8347/login.html). Click **"Try Demo Mode"** to skip auth and load the Science 8 sample class — handy for UI work without a live Supabase backend.

Signed-in local run:

```bash
cp .env.example .env
npm run dev:local
```

`dev:local` serves the app directly from the repo, injects `SUPABASE_URL` / `SUPABASE_KEY` into HTML the same way production does, and avoids requiring a Netlify deploy just to test authenticated flows.

E2E tests:

```bash
npm run test:e2e          # headless
npm run test:e2e:headed   # see the browser
```

---

## Project Structure

```
TeacherDashboard/
│
├── teacher/                    # Desktop SPA
│   ├── app.html                # Entry point
│   ├── router.js               # Hash-based SPA router
│   ├── page-dashboard.js       # Class overview + student cards
│   ├── page-assignments.js     # Assessment CRUD, scoring, rubrics
│   ├── page-gradebook.js       # Spreadsheet scores view
│   ├── page-student.js         # Individual student profile
│   ├── page-observations.js    # Observation capture
│   ├── page-reports.js         # Report builder
│   ├── dash-class-manager.js   # Class + student management
│   ├── report-blocks.js        # 15 report block renderers
│   ├── report-questionnaire.js # Term questionnaire + auto narrative
│   └── ui.js                   # Toast, modal, and DOM helpers
│
├── teacher-mobile/             # Mobile PWA
│   ├── index.html              # Entry point
│   ├── shell.js                # Boot, tab routing, pull-to-refresh
│   ├── tab-students.js         # Card stack + list + student detail
│   ├── tab-observe.js          # Observation feed + compose sheet
│   ├── tab-grade.js            # Speed grader
│   ├── components.js           # Shared iOS-style UI components
│   └── styles.css              # Mobile styles
│
├── shared/                     # Shared across both apps
│   ├── data.js                 # Cache-through Supabase sync layer
│   ├── calc.js                 # Proficiency calculation engine
│   ├── constants.js            # Shared constants
│   ├── supabase.js             # Supabase client
│   └── seed-data.js            # Demo data for new accounts
│
├── sw.js                       # Service worker (offline caching)
├── manifest.json               # PWA manifest
├── schema.sql                  # Database schema
├── netlify.toml                # Netlify config
├── _headers                    # Security + cache headers
├── curriculum_data.js          # BC curriculum data
├── tests/                      # Vitest unit suite (657 tests)
├── e2e/                        # Playwright E2E suite (137 tests)
└── docs/                       # Architecture + privacy docs
```

### Architecture

- **Routing**: Hash-based router in [`teacher/router.js`](teacher/router.js) swaps page modules without full reloads
- **Data layer**: [`shared/data.js`](shared/data.js) — cache-through pattern; synchronous reads from an in-memory `_cache` backed by localStorage. `initData` now hydrates per-course data from canonical Supabase RPCs, mirrors that state into localStorage for offline fallback, and keeps writes on fire-and-forget canonical RPCs in the background. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.
- **Database**: Multi-namespace canonical schema (`academics.*`, `assessment.*`, `observation.*`, `reporting.*`, `identity.*`, `projection.*`, `integration.*`) with a public-schema RPC interface. Every RPC is `SECURITY DEFINER` with `auth.uid()` checks — clients can't bypass authorization via direct table access.
- **Demo mode**: `localStorage.gb-demo-mode='1'` short-circuits Supabase; the Science 8 sample class is auto-seeded by [`shared/seed-data.js`](shared/seed-data.js).
- **Calculation engine**: [`shared/calc.js`](shared/calc.js) — four proficiency methods (mostRecent / highest / mode / decayingAvg) with memoization.
- **Mobile shell**: [`teacher-mobile/shell.js`](teacher-mobile/shell.js) — boot, tab switching, pull-to-refresh, all event delegation via `data-action` attributes.

---

## Privacy and Compliance

Designed for [FOIPPA](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96165_00) compliance:

| Area                | Detail                                                |
| ------------------- | ----------------------------------------------------- |
| Data residency      | Canada only — Supabase on AWS ca-central-1 (Montreal) |
| Row-Level Security  | Teachers can only access their own data               |
| Idle timeout        | Auto sign-out after 30 minutes of inactivity          |
| Logout              | Clears all local data on sign-out                     |
| No student accounts | Only the teacher accesses the system                  |
| Security headers    | CSP, HSTS, X-Frame-Options, X-Content-Type-Options    |

See `docs/` for the Privacy Impact Assessment, Data Retention Policy, and Breach Notification Procedure.

---

## Testing

```bash
npm test               # Run full suite
npm run test:watch     # Watch mode
```

~655 tests covering the calculation engine, data layer, and mobile UI components. See [`tests/`](tests/) and [`e2e/`](e2e/).

---

## Commands

| Command                   | What it does                                                         |
| ------------------------- | -------------------------------------------------------------------- |
| `npm run dev`             | Local dev server on port 8347                                        |
| `npm test`                | Vitest unit suite (one-shot)                                         |
| `npm run test:watch`      | Vitest in watch mode                                                 |
| `npm run test:e2e`        | Playwright E2E suite (headless)                                      |
| `npm run test:e2e:headed` | Playwright with visible browser                                      |
| `npm run format`          | Format all code with Prettier                                        |
| `npm run format:check`    | Check formatting without writing                                     |
| `npm run build`           | `bash scripts/build.sh` — copies public files to `dist/` for Netlify |

First-time Playwright setup: `npx playwright install chromium`.

---

## Deployment

Push to `main` — Netlify deploys automatically. `bash scripts/build.sh` copies the static site into `dist/`, Netlify publishes `dist/`, and [`netlify/edge-functions/inject-env.js`](netlify/edge-functions/inject-env.js) injects Supabase credentials + per-request CSP nonce into HTML responses at request time.

Env vars to set on the Netlify site (Settings → Environment variables):

| Variable       | Source                                               |
| -------------- | ---------------------------------------------------- |
| `SUPABASE_URL` | Supabase → Project Settings → API                    |
| `SUPABASE_KEY` | Supabase → Project Settings → API Keys → publishable |

**Bump `CACHE_NAME` in [`sw.js`](sw.js) on every deploy** so installed PWAs evict the stale cache and pick up the new JS on next load.

---

## License

All rights reserved. Proprietary software.
