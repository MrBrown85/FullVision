# FullVision

FullVision is a teacher-facing web application for standards-based grading, classroom observations, and report preparation in British Columbia classroom workflows.

The repository ships two production runtimes:

- a desktop single-page app at `teacher/app.html`
- a mobile PWA at `teacher-mobile/index.html`

Both surfaces share the same authentication, data, offline queue, and grading logic.

Production is deployed at [fullvision.ca](https://fullvision.ca). For engineering work, treat local runs as the reliable verification path: the live site can temporarily return `503 usage_exceeded` when Netlify quota is exhausted.

## Product scope

FullVision currently supports a teacher-owned workflow, not student or parent self-service.

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

## Current application state

- `main` is the source-of-truth branch.
- The Supabase-backed v2 read/write architecture is the live application model.
- Desktop and mobile both run against the shared runtime under `shared/`.
- The only active work list is [codex.md](codex.md).
- Multi-session implementation continuity lives in [docs/backend-design/HANDOFF.md](docs/backend-design/HANDOFF.md).

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

Netlify publishes the static output in `dist/`.

Relevant files:

- [netlify.toml](netlify.toml)
- [scripts/build.sh](scripts/build.sh)
- [netlify/edge-functions/inject-env.js](netlify/edge-functions/inject-env.js)

Required Netlify environment variables:

- `SUPABASE_URL`
- `SUPABASE_KEY`

If a deploy changes cached frontend assets, bump `CACHE_NAME` in [sw.js](sw.js) so installed PWAs drop stale caches.

## Backend and data model

The live backend is Supabase Auth plus a public RPC surface over Postgres.

Primary SQL mirrors:

- [schema.sql](schema.sql)
- [docs/backend-design/read-paths.sql](docs/backend-design/read-paths.sql)
- [docs/backend-design/write-paths.sql](docs/backend-design/write-paths.sql)
- [docs/backend-design/rls-policies.sql](docs/backend-design/rls-policies.sql)

Primary backend-design references:

- [docs/backend-design/HANDOFF.md](docs/backend-design/HANDOFF.md)
- [docs/backend-design/read-paths.md](docs/backend-design/read-paths.md)
- [docs/backend-design/write-paths.md](docs/backend-design/write-paths.md)
- [docs/backend-design/auth-lifecycle.md](docs/backend-design/auth-lifecycle.md)
- [docs/backend-design/offline-sync.md](docs/backend-design/offline-sync.md)

## Repository layout

```text
FullVision/
├── teacher/                 desktop SPA
├── teacher-mobile/          mobile PWA
├── shared/                  shared runtime modules
├── docs/                    architecture, backend design, and reference assets
├── e2e/                     Playwright specs
├── tests/                   Vitest specs
├── scripts/                 local/dev/build scripts
├── netlify/                 edge-function support
├── dist/                    generated static output
├── schema.sql               top-level schema mirror
├── codex.md                 only live work list
└── README.md
```

## Documentation map

Use the docs in this order if you need to understand the current repository quickly:

1. [README.md](README.md)
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
3. [docs/backend-design/HANDOFF.md](docs/backend-design/HANDOFF.md)
4. [codex.md](codex.md)

Additional references:

- [docs/diagrams/README.md](docs/diagrams/README.md) for reference-only visual assets

## Operational notes

- Production availability can be affected by Netlify quota exhaustion.
- Remaining open work includes a mix of user-blocked, deferred, and implementation items; see [codex.md](codex.md).
- The runtime is teacher-facing today. Student and parent portals are deferred work, not part of the shipped application.

## License

All rights reserved. Proprietary software.
