# Architecture Guide

Technical reference for developers working on FullVision.

## Overview

FullVision is a single-page application (SPA) built with vanilla JavaScript. There is no framework, no build step, and no module bundler. Scripts are loaded via `<script>` tags in `app.html` in dependency order, and each module attaches itself to `window`.

The app uses a **cache-through data pattern**: all reads are synchronous from an in-memory cache, and all writes update the cache immediately then sync to Supabase in the background.

## Entry Point

`app.html` is the SPA shell. It loads:
1. Global styles (8 CSS files)
2. Vendor scripts (`supabase.min.js`)
3. Core modules in order: `gb-supabase.js` → `gb-constants.js` → `gb-data.js` → `gb-calc.js` → `gb-ui.js`
4. Component modules (dash-*, assign-*, report-*)
5. Page modules (page-*.js)
6. Router (`gb-router.js`) — boots the app

`login.html` is a separate page for authentication. It redirects to `app.html` on successful login.

## Routing

**File:** `gb-router.js`

Hash-based SPA router. Routes map to page modules:

| Hash | Module | Page |
|------|--------|------|
| `#/dashboard` | `PageDashboard` | Teacher dashboard with class overview |
| `#/assignments` | `PageAssignments` | Assignment list and scoring |
| `#/student` | `PageStudent` | Individual student detail view |
| `#/gradebook` | `PageGradebook` | Spreadsheet-style grade entry |
| `#/observations` | `PageObservations` | Quick observation notes |
| `#/reports` | `PageReports` | Report builder and generation |

### Page Lifecycle

Each page module is an IIFE that returns an object with:
- `init(params)` — Called when navigating to the page. Receives parsed hash params.
- `destroy()` — Called when leaving the page. Cleans up event listeners and DOM.

The router clears three DOM mount points on every navigation:
- `#main` — Page content
- `#page-toolbar-mount` — Page-specific toolbar
- `#sidebar-mount` — Page-specific sidebar

### Navigation

```javascript
Router.navigate('/student?id=st1&course=sci8');
```

Backward-compatible with old HTML filenames (e.g., `settings.html` → `#/assignments`).

## Data Layer

**File:** `gb-data.js`

### Cache-Through Pattern

```
┌──────────────┐     sync read      ┌──────────────┐
│   get*()     │ ←────────────────── │   _cache     │
│  (instant)   │                     │  (in-memory) │
└──────────────┘                     └──────┬───────┘
                                            │
┌──────────────┐     save*()         ┌──────┴───────┐
│  UI update   │ ──────────────────→ │  _cache +    │
│  (immediate) │                     │  Supabase    │
└──────────────┘                     │  (async bg)  │
                                     └──────────────┘
```

1. `initData(courseId)` fetches all data from Supabase into `_cache`
2. `get*()` functions read synchronously from `_cache` — no async, no loading states
3. `save*()` functions update `_cache` immediately, then fire a background Supabase write
4. If Supabase is unavailable, falls back to localStorage

### Data Keys

Each data type maps to a localStorage key and a Supabase table:

| Cache Field | localStorage Key | Supabase Table |
|-------------|-----------------|----------------|
| students | `gb-{cid}-students` | `students` |
| assessments | `gb-{cid}-assessments` | `assessments` |
| scores | `gb-{cid}-scores` | `scores` |
| learningMaps | `gb-{cid}-learningmap` | `learning_maps` |
| courseConfigs | `gb-{cid}-courseconfig` | `course_config` |
| modules | `gb-{cid}-modules` | `modules` |
| observations | `gb-{cid}-quick-obs` | `observations` |
| termRatings | `gb-{cid}-term-ratings` | `term_ratings` |
| reportConfig | `gb-{cid}-report-config` | `report_config` |

### Sync and Conflict Resolution

- Writes are debounced (500ms) to batch rapid changes
- BroadcastChannel detects multi-tab conflicts
- On conflict, a toast warns the user and offers to reload
- Sync failures show a toast with retry option

### Course Switching

`initData(courseId)` can be called with a different course ID at any time. It:
1. Clears the proficiency cache (`clearProfCache()`)
2. Fetches all data for the new course
3. Page modules re-render with the new data

## Calculation Engine

**File:** `gb-calc.js`

Pure functions for proficiency calculation. No DOM access, no side effects (except memoization caches).

### Core Flow

```
scores[] → filter by tag → split summative/formative → _calcGroup() → weighted merge → proficiency (0-4)
```

### Calculation Methods

| Method | Logic |
|--------|-------|
| `mostRecent` | Last non-zero score by date |
| `highest` | Maximum score |
| `mode` | Most frequent score (ties broken by recency) |
| `decayingAvg` | Weighted running average where newer scores have more influence |

### Function Hierarchy

```
getOverallProficiency(cid, studentId)
  └→ getSectionProficiency(cid, studentId, sectionId)  [checks overrides]
       └→ getTagProficiency(cid, studentId, tagId)       [per-tag calc]
            └→ calcProficiency(scores, method, decay, opts)
                 └→ _calcGroup(scores, method, decay, weights)
```

### Memoization

Three caches speed up repeated calculations:
- `_tagScoresCache` — Filtered/converted scores per student-tag
- `_tagProfCache` — Calculated proficiency per student-tag
- `_awCache` — Assessment weight maps per course

All cleared by `clearProfCache()` when scores, assessments, or overrides change.

### Points-to-Proficiency Conversion

Assessments scored in points mode are converted using percentage boundaries:

| Percentage | Proficiency |
|-----------|-------------|
| ≥ 86% | 4 (Extending) |
| ≥ 73% | 3 (Proficient) |
| ≥ 60% | 2 (Developing) |
| ≥ 0% | 1 (Emerging) |

Boundaries are configurable per course via `grading_scales`.

## Authentication

**File:** `gb-supabase.js`

- Supabase email/password auth
- `requireAuth()` checks for a valid session token in localStorage (fast path) before hitting the Supabase API (slow path)
- 30-minute idle timeout auto-signs out (FOIPPA requirement for shared computers)
- Sign-out clears all `gb-*` localStorage keys

## Security

### Row-Level Security (RLS)

Every table has RLS enabled. Policies ensure:
- Teachers can only SELECT/INSERT/UPDATE/DELETE rows where `teacher_id = auth.uid()` (for `courses`)
- Child tables (students, assessments, scores, etc.) check that `course_id` belongs to the authenticated teacher via a subquery

### XSS Prevention

All user-generated content is escaped via `esc()` (in `gb-ui.js`) before DOM insertion. This includes student names, assessment titles, observation text, and any other user input.

## CSS Architecture

### Design System

CSS custom properties define the design system in `gb-styles.css`:

- `--text-1`, `--text-2`, `--text-3` — Text hierarchy
- `--surface-0` through `--surface-3` — Background layers
- `--active`, `--active-bg` — Interactive element colors
- `--score-1` through `--score-4` — Proficiency level colors
- `--radius-s`, `--radius-m`, `--radius-l` — Border radii

### Dark Mode

`@media (prefers-color-scheme: dark)` overrides all custom properties. No JavaScript toggle — follows system preference.

### Page-Specific Styles

Each page has its own CSS file (`dashboard.css`, `assignments.css`, etc.) loaded in `app.html`. All files are loaded upfront since the SPA never reloads.

## Key Globals

| Global | Source | Purpose |
|--------|--------|---------|
| `COURSES` | `gb-data.js` | Active courses object |
| `Router` | `gb-router.js` | SPA router |
| `Calc` | `gb-calc.js` | Calculation engine namespace |
| `getSupabase()` | `gb-supabase.js` | Supabase client accessor |
| `getStudents(cid)` | `gb-data.js` | Get students for a course |
| `getAssessments(cid)` | `gb-data.js` | Get assessments for a course |
| `getScores(cid)` | `gb-data.js` | Get all scores for a course |
| `saveScores(cid, data)` | `gb-data.js` | Save scores (cache + Supabase) |
| `showSyncToast(msg, type)` | `gb-ui.js` | Show sync status notification |

## Adding a New Page

1. Create `page-newpage.js` as an IIFE returning `{ init, destroy }`
2. Add a route in `gb-router.js`: `'/newpage': window.PageNewPage`
3. Add the script tag in `app.html` before `gb-router.js`
4. Add a dock icon in the `renderDock()` function in `app.html`
5. Create `newpage.css` if needed and add the `<link>` in `app.html`

## Adding a New Data Type

1. Add the table to `supabase_schema.sql` with appropriate foreign keys
2. Add RLS policies in `supabase_rls.sql`
3. Add a cache field in `_cache` object in `gb-data.js`
4. Add the key mapping in `_DATA_KEYS`
5. Create `get*()` and `save*()` functions following existing patterns
6. Add to the `initData()` fetch list
