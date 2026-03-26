# FullVision

A learning profile builder and communicator for British Columbia teachers. Track student achievement against BC curriculum competencies using proficiency-based grading, record observations, manage learner dispositions, and generate parent-friendly reports.

Built as a single-page application with vanilla JavaScript -- no framework, no build step. Backed by Supabase for authentication and data storage with Row-Level Security, deployed on Netlify.

## Screenshots

<!-- Add screenshots here -->
<!-- ![Dashboard overview](docs/screenshots/dashboard.png) -->
<!-- ![Gradebook spreadsheet](docs/screenshots/gradebook.png) -->
<!-- ![Report builder](docs/screenshots/reports.png) -->

## Features

- **Proficiency-based grading** -- 4-level scale (Emerging, Developing, Proficient, Extending) aligned with BC curriculum
- **4 calculation methods** -- Most Recent, Decaying Average, Mode, Mean
- **BC curriculum mapping** -- Built-in curriculum data for tagging assessments to learning standards
- **Student observations** -- Quick notes with disposition dimensions (social, personal, intellectual)
- **Report builder** -- Configurable report cards with drag-and-drop block ordering
- **Term questionnaire** -- Disposition ratings per student per term
- **CSV import** -- Bulk import students from CSV files
- **Multi-course** -- Manage multiple courses with independent grading configurations
- **Dark mode** -- Full light/dark theme support via CSS custom properties
- **Offline caching** -- Service worker pre-caches all app assets for offline use
- **FOIPPA compliant** -- Student data stored in Canada (AWS ca-central-1), idle timeout, logout clears local data

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (IIFE modules), CSS custom properties |
| Auth & Database | [Supabase](https://supabase.com) (Auth, Postgres, Row-Level Security) |
| Hosting | [Netlify](https://netlify.com) (static site) |
| Testing | [Vitest](https://vitest.dev) |
| Formatting | [Prettier](https://prettier.io) |
| Offline | Service worker with pre-caching |
| PWA | Web app manifest for installability |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (for the local dev server and test runner)
- A [Supabase](https://supabase.com) project (free tier works)

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd FullVision
npm install
```

### 2. Set up Supabase

Create a Supabase project in the **ca-central-1 (Montreal)** region for FOIPPA compliance.

Run the SQL migration files in order in the Supabase SQL Editor:

```
1. supabase_schema.sql       -- Creates all tables and indexes
2. supabase_rls.sql          -- Enables Row-Level Security policies
3. supabase_errors.sql       -- Error handling setup
4. supabase_course_data.sql  -- Course data initialization (optional)
```

### 3. Configure environment

Copy the example environment file:

```bash
cp .env.example .env
```

Update `gb-supabase.js` with your Supabase project URL and anon key. See `.env.example` for reference. Do not commit credentials to version control.

### 4. Run locally

```bash
npm run dev
```

This starts a local server on port 8347. Open [http://localhost:8347/app.html](http://localhost:8347/app.html).

## Project Structure

```
FullVision/
├── app.html                    # SPA entry point
├── login.html                  # Auth page
│
├── gb-router.js                # Hash-based SPA router
├── gb-supabase.js              # Supabase client and auth
├── gb-data.js                  # Data layer (cache-through pattern)
├── gb-calc.js                  # Proficiency calculation engine
├── gb-constants.js             # Shared constants and defaults
├── gb-ui.js                    # UI utilities (toasts, modals, helpers)
├── gb-seed-data.js             # Demo data for new accounts
├── gb-styles.css               # Global styles and design system
│
├── page-dashboard.js           # Dashboard page module
├── page-assignments.js         # Assignments page module
├── page-gradebook.js           # Spreadsheet/gradebook page
├── page-student.js             # Student detail page
├── page-observations.js        # Observations page
├── page-reports.js             # Reports page module
│
├── dash-overview.js            # Dashboard overview component
├── dash-class-manager.js       # Class/student management + CSV import
├── dash-curriculum-wizard.js   # Curriculum selection wizard
├── assign-form.js              # Assignment creation form
├── assign-scoring.js           # Score entry interface
├── assign-rubric-editor.js     # Rubric editor component
├── report-builder.js           # Report builder orchestration
├── report-blocks.js            # Report section renderers
├── report-narrative.js         # Narrative report generation
│
├── curriculum_data.js          # BC curriculum data (auto-generated)
├── curriculum_by_course.json   # Raw curriculum JSON
├── vendor/supabase.min.js      # Supabase client library
├── sw.js                       # Service worker (offline caching)
├── manifest.json               # PWA manifest
├── netlify.toml                # Netlify deployment config
├── _headers                    # Security and cache headers
│
├── supabase_schema.sql         # Database schema
├── supabase_rls.sql            # Row-Level Security policies
├── supabase_errors.sql         # Error handling
├── supabase_course_data.sql    # Seed course data
│
├── docs/
│   ├── ARCHITECTURE.md                 # Technical architecture guide
│   ├── Privacy_Impact_Assessment.md    # FOIPPA PIA
│   ├── Data_Retention_Policy.md        # Data retention rules
│   └── Breach_Notification_Procedure.md # Incident response plan
│
└── package.json                # Dev dependencies and scripts
```

### Architecture overview

- **SPA routing**: Hash-based router (`gb-router.js`) swaps page modules without full reloads
- **Data layer**: Cache-through pattern in `gb-data.js` -- reads from localStorage first, syncs with Supabase in the background
- **Calculation engine**: `gb-calc.js` supports four proficiency methods (mostRecent, decayingAverage, mode, mean) with memoization
- **Modules**: Each page is an IIFE module (e.g., `page-gradebook.js`) that exports `init()` and `destroy()` lifecycle hooks

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical guide.

## Database

14 Postgres tables with Row-Level Security ensuring each teacher can only access their own data. Key tables include `courses`, `students`, `assessments`, `scores`, `observations`, `learning_maps`, `term_ratings`, and `report_config`.

See `supabase_schema.sql` for the complete schema definition.

## Privacy and Compliance

FullVision is designed for FOIPPA (Freedom of Information and Protection of Privacy Act) compliance:

- **Data residency** -- All data stored in Canada via Supabase on AWS ca-central-1 (Montreal)
- **Row-Level Security** -- Each teacher's data is isolated at the database level
- **Idle timeout** -- Automatic sign-out after 30 minutes of inactivity
- **Logout clears data** -- All `gb-*` localStorage keys are removed on sign-out
- **No student accounts** -- Only teachers access the system
- **Security headers** -- CSP, HSTS, X-Frame-Options, and X-Content-Type-Options configured in `_headers`

See the `docs/` directory for the full Privacy Impact Assessment, Data Retention Policy, and Breach Notification Procedure.

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode during development:

```bash
npm run test:watch
```

Tests use [Vitest](https://vitest.dev) and cover the proficiency calculation engine.

## Code Formatting

```bash
npm run format          # Format all files with Prettier
npm run format:check    # Check formatting without writing
```

## Deployment

The app is configured for Netlify static hosting. Push to a Git repository connected to Netlify and it deploys automatically.

The `netlify.toml` configuration:
- Publish directory: `.` (project root, no build step)
- Root `/` redirects to `/app.html`
- JS and CSS cached for 1 hour; HTML pages are not cached

Security headers are defined in `_headers` and include Content-Security-Policy, Strict-Transport-Security, and frame/content-type protections.

## License

All rights reserved. This software is proprietary.
