# FullVision

FullVision is a teacher-facing web application for standards-based grading, classroom observations, and report preparation in British Columbia classroom workflows.

The repository ships three production runtimes:

- a desktop single-page app at `teacher/app.html`
- a mobile PWA at `teacher-mobile/index.html`
- the student page at `s/index.html`

The desktop and phone apps share the same authentication, data, offline queue, and grading logic. The student page has no sign-in of its own: a student opens it with a printed card, and it talks to the server through the `student-submit` edge function.

Production is deployed at [fullvision.ca](https://fullvision.ca). For engineering work, treat local runs as the reliable verification path: the live site can temporarily return `503 usage_exceeded` when Netlify quota is exhausted.

## Product scope

FullVision is a teacher-owned workflow. Students have no accounts: they open their own page (`s/`) with a printed card or slip. There is no parent portal.

Core capabilities include:

- standards-based assessment authoring and scoring
- spreadsheet-style gradebook workflows
- category-aware grading configuration
- rubric editing with criterion weights and level overrides
- student profile and performance views
- classroom observations and reusable observation templates
- report builder and term questionnaire flows
- roster and course-management tools
- mobile speed-grading and observation capture
- offline-aware client behavior with queued retry
- the student page (`s/`): assignments, feedback, My Learning, questionnaires and phone reports (behind a per-class build switch)
- student cards and slips, printed from Class Settings › Student Page (behind a per-class build switch)
- Send Work: students send photos or PDFs of their work (behind a per-class build switch)
- Mark Up: the teacher draws on a student's work, on desktop and phone (behind a per-class build switch)
- Preview as Student: the teacher sees what a student's page shows (behind a per-class build switch)
- the help site at `fullvision.ca/help`, built from `help/articles/`
- Download All My Data: one Excel workbook of every class, from the account menu

## Current application state

- `main` is the source-of-truth branch.
- The Supabase-backed v2 read/write architecture is the live application model.
- Desktop and mobile both run against the shared runtime under `shared/`. The student page reads some of it too.
- The open-work list is [docs/ROADMAP.md](docs/ROADMAP.md); decisions and their reasons are in [docs/DECISIONS.md](docs/DECISIONS.md).
- Rules for working in the repo are in [CLAUDE.md](CLAUDE.md).
- [codex.md](codex.md) and [docs/backend-design/HANDOFF.md](docs/backend-design/HANDOFF.md) are history from the v2 rebuild and are no longer maintained.

## Architecture summary

FullVision is a vanilla JavaScript application built from browser-global modules rather than a framework runtime.

Shared runtime:

- `shared/supabase.js` handles auth, session refresh, sign-out, and sensitive re-authentication
- `shared/data.js` handles boot hydration, local cache orchestration, and canonical RPC dispatch
- `shared/offline-queue.js` provides queued retry, dead-letter handling, and UI subscriptions
- `shared/calc.js` provides grading, category, percentage, and letter-calculation helpers

Desktop runtime:

- entry point: `teacher/app.html`
- router: `teacher/router.js`
- page modules in `teacher/`

Mobile runtime:

- entry point: `teacher-mobile/index.html`
- shell: `teacher-mobile/shell.js`
- tab modules in `teacher-mobile/`

Platform model:

- static site deployment on Netlify
- runtime environment injection through `netlify/edge-functions/inject-env.js`
- Supabase Auth, Postgres, RLS, and public RPC surface for persistence
- two Supabase edge functions, `supabase/functions/student-submit` (the student page's server) and `supabase/functions/teacher-cards` (makes student cards and slips); they deploy separately from Netlify
- local cache plus `localStorage` fallback for responsiveness and offline safety
- retry queue via `window.v2Queue`

For the stable system view, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

### Prerequisites

- Node.js
- npm

### Install

```bash
git clone https://github.com/MrBrown85/FullVision.git
cd FullVision
npm install
```

### Run locally in demo mode

```bash
npm run dev
```

This serves the app at `http://localhost:8347`. Demo Mode can be launched from `login.html` and is the fastest way to inspect the UI without live credentials.

### Run locally with Supabase credentials

1. Copy `.env.example` to `.env`
2. Set:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
3. Start the local authenticated server:

```bash
npm run dev:local
```

`dev:local` injects credentials into served HTML so authenticated flows can be exercised locally without a Netlify deployment.

## Development commands

| Command                   | Purpose                                  |
| ------------------------- | ---------------------------------------- |
| `npm run dev`             | Serve the app locally on port `8347`     |
| `npm run dev:local`       | Serve with local Supabase env injection  |
| `npm test`                | Run the Vitest suite                     |
| `npm run test:watch`      | Run Vitest in watch mode                 |
| `npm run test:e2e`        | Run Playwright headless                  |
| `npm run test:e2e:headed` | Run Playwright with a visible browser    |
| `npm run format`          | Format JS, CSS, HTML, JSON, and Markdown |
| `npm run format:check`    | Check formatting without rewriting files |
| `npm run build`           | Build the static site into `dist/`       |
| `npm run build:e2e`       | Build the E2E static output              |

This README intentionally avoids hard-coding test counts because they drift frequently.

## Deployment

Netlify publishes the static output in `dist/` from the `production` branch. Work merges into `main` without deploying; a release is one pull request from `main` into `production`, which is one deploy.

Relevant files:

- [netlify.toml](netlify.toml)
- [scripts/build.sh](scripts/build.sh)
- [netlify/edge-functions/inject-env.js](netlify/edge-functions/inject-env.js)

Required Netlify environment variables:

- `SUPABASE_URL`
- `SUPABASE_KEY`

`scripts/build.sh` names the service-worker cache after the deploy's commit, so installed PWAs drop stale caches on every deploy; there's nothing to bump by hand. When a page starts loading a new file, add it to `PRECACHE_URLS` in [sw.js](sw.js); `tests/sw-precache.test.js` fails until you do.

## Backend and data model

The live backend is Supabase Auth plus a public RPC surface over Postgres.

The exact schema is [docs/schema.generated.sql](docs/schema.generated.sql). CI fails when it no longer matches the live database.

Other SQL:

- [schema.sql](schema.sql)
- [docs/backend-design/read-paths.sql](docs/backend-design/read-paths.sql), [docs/backend-design/write-paths.sql](docs/backend-design/write-paths.sql) and [docs/backend-design/rls-policies.sql](docs/backend-design/rls-policies.sql) are April design copies. They are missing most of today's functions.

Primary backend-design references:

- [docs/backend-design/HANDOFF.md](docs/backend-design/HANDOFF.md) (history)
- [docs/backend-design/read-paths.md](docs/backend-design/read-paths.md)
- [docs/backend-design/write-paths.md](docs/backend-design/write-paths.md)
- [docs/backend-design/auth-lifecycle.md](docs/backend-design/auth-lifecycle.md)
- [docs/backend-design/offline-sync.md](docs/backend-design/offline-sync.md)

## Repository layout

```text
FullVision/
├── teacher/                 desktop SPA
├── teacher-mobile/          mobile PWA
├── s/                       student page
├── shared/                  shared runtime modules
├── help/                    help site articles and images
├── supabase/                edge functions (student-submit, teacher-cards)
├── migrations/              database migrations, one file per change
├── data/                    BC curriculum data files
├── assets/                  icons, splash and sample-work images
├── vendor/                  third-party libraries
├── docs/                    architecture, backend design, and reference assets
├── e2e/                     Playwright specs
├── e2e-real/                Playwright specs against a real Supabase project
├── tests/                   Vitest specs
├── scripts/                 local/dev/build scripts
├── .github/                 CI workflow
├── netlify/                 edge-function support
├── dist/                    generated static output
├── schema.sql               top-level schema mirror
├── codex.md                 v2 rebuild work list (history)
└── README.md
```

## Documentation map

Use the docs in this order if you need to understand the current repository quickly:

1. [README.md](README.md)
2. [CLAUDE.md](CLAUDE.md)
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
4. [docs/ROADMAP.md](docs/ROADMAP.md)
5. [docs/DECISIONS.md](docs/DECISIONS.md)

Additional references:

- [docs/diagrams/README.md](docs/diagrams/README.md) for reference-only visual assets

## Operational notes

- Production availability can be affected by Netlify quota exhaustion.
- Open work is in [docs/ROADMAP.md](docs/ROADMAP.md).
- Teachers sign in. Students have no accounts: they answer questionnaires and read phone reports on the student page (`s/`) with a printed card or slip. There is no parent portal.

## License

All rights reserved. Proprietary software.
