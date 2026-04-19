# FullVision Architecture

A learning profile builder and communicator for BC teachers. Two entry points — desktop SPA (`teacher/app.html`) and mobile PWA (`teacher-mobile/index.html`) — sharing a common data layer that syncs to Supabase.

## Directory Structure

```
shared/                   Shared modules (both desktop + mobile)
  supabase.js             Supabase client init + auth API (signIn, signOut, requireAuth)
  constants.js            Shared constants (DEFAULT_COURSES, LEARNING_MAP, proficiency labels/colors)
  data.js                 Data access layer (cache-through pattern, localStorage + Supabase sync)
  calc.js                 Proficiency calculation engine (4 methods, section/tag/overall rollups)
  seed-data.js            Demo data seeder for new accounts (lazy-loaded)

teacher/                  Desktop SPA
  app.html                Entry point — loads all CSS + JS, defines DOM mount points
  ui.js                   Shared UI components (dock, sidebar, student header, modals, toasts)
  router.js               Hash-based SPA router with page lifecycle
  page-dashboard.js       Dashboard: student roster overview, class manager, curriculum wizard
  page-assignments.js     Assignment management and scoring
  page-student.js         Individual student detail view
  page-gradebook.js       Spreadsheet-style class gradebook
  page-observations.js    Quick observations / anecdotal notes
  page-reports.js         Report card generation
  dash-class-manager.js   Submodule: class/student CRUD, drag reordering, student merge
  assign-collab.js        Submodule: collaborative pairs/groups
  report-blocks.js        Submodule: report block renderers
  report-questionnaire.js Submodule: term questionnaire UI
  teams-import.js         Submodule: CSV/Excel roster import (uses SheetJS)
  *.css                   Page-specific stylesheets

teacher-mobile/           Mobile PWA
  index.html              Entry point — standalone mobile shell
  shell.js                Boot, auth, routing, pull-to-refresh, navigation stacks
  components.js           Shared mobile UI components (sheets, toasts, swipe gestures)
  tab-students.js         Students tab — roster list, student detail, section detail
  tab-observe.js          Observe tab — observation feed, capture sheet
  tab-grade.js            Grade tab — assignment list, score entry
  card-stack.js           Card stack view — swipeable student cards
  styles.css              Mobile styles (iOS-native patterns)

vendor/                   Third-party libraries
  supabase.min.js         Supabase SDK (with CDN fallback)
  xlsx.mini.min.js        SheetJS for CSV/Excel parsing (with CDN fallback)

netlify/                  Netlify configuration
  edge-functions/
    inject-env.js         Replaces __SUPABASE_URL__/__SUPABASE_KEY__ in HTML at edge

scripts/
  build.sh                Copies public files to dist/ for Netlify deploy

login.html                Auth page (email/password, sign up, password reset)
sw.js                     Service worker — precache + network-first strategy
```

## Script Load Order (Desktop)

Defined in `teacher/app.html`. Order matters because modules attach to `window` and later scripts depend on earlier ones:

1. `vendor/supabase.min.js` - Supabase client SDK (with CDN fallback)
2. `shared/supabase.js` - Auth layer (needs Supabase SDK)
3. `shared/constants.js` - Constants (no dependencies)
4. `shared/data.js` - Data layer (needs constants + Supabase)
5. `shared/calc.js` - Calculation engine (needs data layer)
6. `teacher/ui.js` - Shared UI (needs data + calc)
7. `vendor/xlsx.mini.min.js` + `teacher/teams-import.js` - Roster import
8. Submodules: `report-blocks.js`, `report-questionnaire.js`, `dash-class-manager.js`, `assign-collab.js`
9. Page modules: `page-dashboard.js`, `page-assignments.js`, `page-student.js`, `page-gradebook.js`, `page-observations.js`, `page-reports.js`
10. `teacher/router.js` - Router (needs all page modules on `window`)

Note: `shared/seed-data.js` is lazy-loaded by `loadSeedIfNeeded()` — only fetched for new accounts. `curriculum_data.js` (994KB) is loaded via `<script>` in `app.html` but should be lazy-loaded.

The router auto-boots at the bottom of `router.js` via `Router.boot()`.

## Page Routing System

`teacher/router.js` implements hash-based routing as an IIFE exposing `window.Router`.

**Route table:**
```
#/dashboard    -> window.PageDashboard
#/assignments  -> window.PageAssignments
#/student      -> window.PageStudent
#/gradebook    -> window.PageGradebook
#/observations -> window.PageObservations
#/reports      -> window.PageReports
```

**Hash format:** `#/student?id=st1&course=sci8` - path + query params parsed by `_parseHash()`.

**Page lifecycle:**

Each page module is an IIFE that returns `{ init(params), destroy() }`:

- `init(params)` - receives parsed query params, renders into DOM mount points
- `destroy()` - cleans up event listeners, timers, and DOM state

**Route change flow (`_onRoute`):**
1. Parse hash into path + params
2. Call `_currentPage.destroy()` if a previous page exists
3. Clear DOM mounts: `#main`, `#page-toolbar-mount`, `#sidebar-mount`
4. Re-render the navigation dock via `_renderDock()`
5. Call `module.init(params)` on the new page

**DOM mount points** (defined in `app.html`):
- `#dock-mount` - top navigation bar
- `#sidebar-mount` - student roster sidebar
- `#page-toolbar-mount` - page-specific toolbar
- `#main` - primary content area

**Navigation:** `Router.navigate(hash, replace)` sets `location.hash` which triggers `hashchange` -> `_onRoute`. Pass `replace=true` to use `replaceState` instead of pushing history.

**Boot sequence** (`Router.boot()`, runs once):
1. `requireAuth()` - redirect to login if no session
2. `seedIfNeeded()` - create demo data for new accounts
3. `initAllCourses()` - load global course list from Supabase/localStorage
4. `initData(cid)` - load active course data into cache
5. `migrateAllStudents()` - apply schema migrations
6. Attach `hashchange` listener and intercept dock link clicks
7. Trigger initial route

## Data Layer

`shared/data.js` implements a **cache-through** pattern: synchronous in-memory reads, async background writes to Supabase via canonical RPCs, with localStorage as the durable cache.

### Architecture

```
Page Code
   │
   │ get*() — synchronous read from _cache (falls back to localStorage)
   │ save*() — write to _cache + persist to localStorage + fire-and-forget canonical RPC
   ▼
_cache (in-memory object)
   │
   ├── _saveCourseField() — central local write path
   │     1. Update _cache[field][cid]
   │     2. Clear proficiency cache if the field affects calculations
   │     3. Persist to localStorage (gb-{key}-{cid})
   │     4. Broadcast change to other tabs (BroadcastChannel)
   │
   └── _persist*ToCanonical() — async canonical RPC dispatch
         1. Diff prev vs new array (added / modified / withdrawn)
         2. Route each row to its canonical RPC
         3. Patch _cache row.id with the canonical UUID returned
         4. Re-persist localStorage so the canonical id sticks across reloads
```

The two write paths run in parallel: localStorage is updated synchronously so the UI never blocks on the network; canonical RPCs publish in the background and patch the cache when they return.

### Initialization

`initAllCourses()` runs first (called by both `Router.boot()` and `shell.js` on mobile):
1. Check for a valid Supabase session → set `_useSupabase`, `_teacherId`
2. Demo mode (`localStorage.gb-demo-mode === '1'`) hard-skips Supabase and runs from localStorage only
3. Otherwise call `get_teacher_preferences()` + `list_teacher_courses()` in parallel
4. Convert canonical rows to the legacy `COURSES` blob shape (UUID-keyed) and mirror to localStorage as offline cache
5. On any RPC failure, fall through to localStorage so the app still loads offline

`initData(cid)` now loads per-course data from canonical RPCs, then mirrors the loaded state back into localStorage as an offline cache. The read path currently covers `list_course_roster`, `list_course_assessments`, `list_course_scores`, `list_course_observations`, `get_course_policy`, `get_report_config`, `list_course_outcomes`, `list_assignment_statuses`, `list_term_ratings_for_course`, `projection.list_student_flags`, plus per-student calls for goals, reflections, and overrides.

Some entities are still intentionally client-only: modules, rubrics, custom tags, and notes still load from localStorage because there is no canonical server-backed storage for them yet.

### Canonical schema (Supabase)

Multi-namespace design with **public-schema RPCs as the only client interface** — direct table access is not exposed via PostgREST. Every RPC is `SECURITY DEFINER` with `auth.uid()` checks, so clients can't bypass authorization.

| Schema | Purpose | Notable tables |
|--------|---------|----------------|
| `academics` | Course offerings, students, enrollments, designations | `course_offering`, `course_outcome`, `course_policy`, `student`, `enrollment`, `designation_type`, `enrollment_designation` |
| `assessment` | Assignments and scores | `assessment`, `assessment_target`, `assignment_status`, `score_current`, `score_revision` |
| `observation` | Anecdotal notes | `observation` |
| `reporting` | End-of-term reporting | `term_rating`, `report_config`, `student_goal`, `student_reflection`, `section_override` |
| `identity` | Teacher accounts | `teacher_profile`, `teacher_preference` |
| `projection` | Read-optimized projections | `dashboard_student_summary`, `flag_tag`, `student_flag` |
| `integration` | Import staging | `import_job`, `import_row` |

Public RPCs the client calls (selection):

| Read | Write |
|------|-------|
| `list_teacher_courses` | `create_course`, `update_course` |
| `get_teacher_preferences` | `save_teacher_preferences` |
| `get_course_policy` | `save_course_policy` |
| `get_report_config` | `save_report_config` |
| `list_course_outcomes` | `save_learning_map` |
| `list_course_roster` | `enroll_student`, `update_enrollment`, `update_student`, `withdraw_enrollment` |
| `list_course_assessments` | `create_assessment`, `update_assessment`, `delete_assessment` |
| `list_course_scores` | `save_course_score`, `bulk_save_course_scores`, `delete_course_score` |
| `list_course_observations` | `create_observation`, `update_observation`, `delete_observation` |
| `get_student_goals` | `save_student_goals` |
| `list_student_reflections` | `save_student_reflection` |
| `list_section_overrides` | `save_section_override`, `clear_section_override` |
| `list_term_ratings_for_course`, `get_term_rating` | `upsert_term_rating` |
| `list_assignment_statuses` | `save_assignment_status` |
| `list_import_jobs`, `list_import_rows` | `stage_import`, `validate_import_job`, `commit_import_job` |
| `projection.list_student_flags` | `projection.add_student_flag`, `projection.remove_student_flag`, `toggle_student_flag` |

**Sync patterns by entity:**
- **Students** (`saveStudents`): diffs prev vs new → routes to `enroll_student` / `update_enrollment` + `update_student` / `withdraw_enrollment`. Patches cache `id` to canonical `enrollment_id`, stores `personId = student_id`. Per-course async queue serializes saves so rapid clicks don't double-enroll.
- **Assessments** (`saveAssessments`): same diff pattern → `create_assessment` / `update_assessment` / `delete_assessment`. `tagIds` filtered to UUIDs only so demo-mode text codes don't fail the canonical UUID cast.
- **Scores** (`upsertScore`): single-row → `save_course_score`. UUID-gated on all four IDs (cid/sid/aid/tid) — if any is still local, only localStorage holds the score until IDs resolve.
- **Observations** (`addQuickOb` / `updateQuickOb` / `deleteQuickOb`): single-row → `create_observation` / `update_observation` / `delete_observation`. Create patches cache `id` to canonical `observation_id`.
- **Per-course reads** (`initData`): RPC results are normalized into the existing cache/helper surface so page modules continue to use `getStudents`, `getSections`, `getAllTags`, `getScores`, etc. without needing to understand the canonical wire format directly.

All canonical RPC writes are gated on `gb-demo-mode !== '1'` AND `_useSupabase` so demo mode and offline mode stay 100% local. All RPCs are fire-and-forget with `console.warn` on error.

**localStorage keys:** `gb-{dataKey}-{courseId}` (e.g., `gb-students-{uuid}`, `gb-scores-{uuid}`). Course IDs are now UUIDs except in demo mode where the seed uses text IDs (`sci8`, etc.).

### Getter/Setter Pattern

Every data type follows the same pattern:
```js
function getStudents(cid)       { return _cache.students[cid] || []; }
function saveStudents(cid, arr) { _saveCourseField('students', cid, arr); }
```

The `_saveCourseField` function is the central write path that handles cache update, proficiency cache invalidation, Supabase sync, and cross-tab broadcasting.

### Sync Behavior

- Writes are fire-and-forget: UI stays responsive, sync happens in background
- Sync status indicator in the dock shows idle/syncing/error states
- Failed syncs are queued in `_retryQueue` and retried after 10 seconds
- Inflight deduplication via `_inflightSyncs` / `_pendingWrites` Maps
- Cross-tab conflict detection via `BroadcastChannel` (fallback: `storage` event)

### Data Types (cache fields -> localStorage/Supabase keys)

| Cache Field    | Data Key       | Type              | Description                           |
|----------------|----------------|-------------------|---------------------------------------|
| students       | students       | Array             | Student roster                        |
| assessments    | assessments    | Array             | Assignment definitions                |
| scores         | scores         | Object {sid: []}  | Score entries keyed by student ID     |
| learningMaps   | learningmap    | Object            | Sections and tags (curriculum map)    |
| courseConfigs   | courseconfig   | Object            | Per-course settings (calc method, etc)|
| modules        | modules        | Array             | Teaching modules/units                |
| rubrics        | rubrics        | Array             | Rubric definitions                    |
| flags          | flags          | Object {sid: bool}| Flagged students                      |
| goals          | goals          | Object {sid: ...} | Student goals                         |
| reflections    | reflections    | Object {sid: ...} | Student reflections                   |
| overrides      | overrides      | Object            | Teacher proficiency overrides         |
| statuses       | statuses       | Object            | Assignment statuses (excused, NS)     |
| observations   | quick-obs      | Object {sid: []}  | Quick observations                    |
| termRatings    | term-ratings   | Object            | Core competency term ratings          |
| customTags     | custom-tags    | Array             | Custom learning tags                  |
| notes          | notes          | Object {sid: ...} | Student notes                         |
| reportConfig   | report-config  | Object            | Report card configuration             |

## Authentication Flow

`shared/supabase.js` wraps the Supabase Auth SDK as an IIFE.

**Key functions (all on `window`):**
- `requireAuth()` - called at boot. Checks localStorage for a cached Supabase session token. If valid and not expired, allows the page to load immediately. Otherwise, calls `sb.auth.getSession()` and redirects to `login.html` if no session.
- `signOut()` - signs out via Supabase, clears all `gb-*` localStorage keys (FOIPPA compliance for shared computers), redirects to `login.html`.
- `getCurrentUser()` / `isLoggedIn()` - async session checks
- `onAuthChange(callback)` - listens for auth state changes; shows "Session expired" toast on `SIGNED_OUT`

**Idle timeout:** A separate IIFE sets a 30-minute inactivity timer. Resets on mouse/keyboard/touch/scroll events. Calls `signOut()` on expiry. Designed for shared classroom computers.

**Session flow:**
1. User loads `teacher/app.html` -> `Router.boot()` -> `requireAuth()`
2. Fast path: parse `sb-*-auth-token` from localStorage, check `expires_at`
3. Slow path: call `sb.auth.getSession()` if no cached token
4. No session -> redirect to `login.html` (separate page, not part of SPA)

**Mobile auth:** `shell.js` has its own auth check in `boot()`. On network error, the auth screen is shown (no silent bypass). After successful sign-in, `_bootApp()` initializes the data layer and renders tabs.

## Proficiency Calculation Engine

`shared/calc.js` computes proficiency levels (0-4 scale) from score data.

### Proficiency Scale

| Level | Label       |
|-------|-------------|
| 0     | No Evidence |
| 1     | Emerging    |
| 2     | Developing  |
| 3     | Proficient  |
| 4     | Extending   |

### Calculation Methods

Configured per-course in `courseConfig.calcMethod`:

- **mostRecent** - uses the last score by date
- **highest** - uses the maximum score
- **mode** - most frequent score (ties broken by most recent among tied values); assessment weights affect frequency count
- **decayingAvg** - exponentially weighted average where newer scores have more influence. Controlled by `decayWeight` (default 0.65). Formula: `avg = avg * (1 - dw) + score * dw`

### Calculation Hierarchy

```
Score entries (per student, per tag, per assessment)
  |
  v
getTagScores(cid, sid, tagId)
  - Filters by tag, excludes "excused" statuses
  - Converts points-mode scores to proficiency via grading scale boundaries
  |
  v
getTagProficiency(cid, sid, tagId)
  - Splits scores into summative/formative categories
  - Applies category weights (summative vs formative)
  - Runs _calcGroup() with the course's chosen method
  |
  v
getSectionProficiency(cid, sid, sectionId)
  - Averages tag proficiencies within a section
  - Applies teacher override if one exists
  |
  v
getOverallProficiency(cid, sid)
  - Averages all section proficiencies
```

### Supporting Features

- **Teacher overrides:** `setSectionOverride()` stores a manual proficiency level with a reason and the calculated value at time of override
- **Points-to-proficiency conversion:** `pointsToProf()` converts raw point scores using configurable percentage boundaries
- **Category weights:** summative/formative weighting via `getCategoryWeights()`
- **Assessment weights:** individual assessments can be weighted (default 1)
- **Memoization:** Three caches (`_tagScoresCache`, `_tagProfCache`, `_awCache`) cleared by `clearProfCache()` whenever scores, assessments, overrides, statuses, or configs change (triggered automatically by `_saveCourseField`)
- **Growth sparklines:** `getSectionGrowthData()` builds chronological proficiency snapshots for charting
- **Focus areas:** `getFocusAreas()` identifies tags with no evidence or lowest proficiency
- **Letter grades:** `calcLetterGrade()` converts average proficiency to letter grade + percentage

## Key Data Structures

### Course
```js
{ id: 'sci8', name: 'Science 8', gradingSystem: 'proficiency',
  calcMethod: 'mostRecent', decayWeight: 0.65, curriculumTags: ['SCI8'] }
```

### Student
```js
{ id: 'sXXX', firstName: '', lastName: '', preferred: '',
  pronouns: '', studentNumber: '', dateOfBirth: '', email: '',
  designations: ['D','G'],  // BC designation codes
  attendance: [{ date: '2025-01-15', status: 'present' }] }
```

### Assessment
```js
{ id: 'aXXX', title: '', date: '2025-01-15', type: 'summative',
  tags: ['QAP','PI'],  // linked learning tags
  weight: 1, scoreMode: 'proficiency',  // or 'points'
  maxPoints: 10,  // if points mode
  excludedStudents: [], pairs: [], groups: [] }
```

### Score Entry
```js
{ score: 3, date: '2025-01-15', type: 'summative',
  tagId: 'QAP', assessmentId: 'aXXX', rawPoints: 8 }
```
Scores are stored as `{ [studentId]: Score[] }`.

### Learning Map
```js
{ subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
  sections: [{
    id: 'SCI8_questioning', subject: 'SCI8', name: 'Questioning and Predicting',
    shortName: 'Questioning', color: '#0891b2',
    tags: [{ id: 'QAP', label: 'Question and Predict', text: '',
             i_can_statements: ['I can...'] }]
  }],
  _customized: true, _version: 1 }
```

### Assignment Status
Keyed as `"studentId:assessmentId"` -> `'excused'` | `'notSubmitted'` | `null`

### Module
```js
{ id: 'mXXX', title: '', startDate: '', endDate: '',
  assessmentIds: [] }
```

## Shared UI Components

`teacher/ui.js` provides reusable UI rendered into the DOM mount points:

- **renderDock()** - top navigation bar with page tabs, sync indicator, and user menu
- **renderSidebar()** - student roster with search, course switcher, proficiency badges, and "Add Student" button
- **renderStudentHeader()** - student detail header with avatar, overall proficiency, stats (assessed/tags/observations/attendance), metadata chips, and designation badges
- **Toasts** - `showSyncToast()` for sync status, `showUndoToast()` for reversible actions
- **showConfirm()** - modal confirmation dialog with focus trap and keyboard support
- **Delegated click handler** - global `[data-action]` delegation for sidebar clicks, user menu, sign out, undo, etc.
- **Error monitoring** - global `error` and `unhandledrejection` handlers that log to Supabase `error_logs` table

## Module Pattern

All page modules and the router use the IIFE (Immediately Invoked Function Expression) pattern:

```js
window.PageExample = (function() {
  'use strict';
  // Private state
  var activeCourse;
  var _listeners = [];

  function init(params) {
    // Mount UI, attach listeners
  }

  function destroy() {
    // Remove listeners, clear timers
    _listeners.forEach(l => document.removeEventListener(l.type, l.handler));
    _listeners = [];
  }

  return { init, destroy };
})();
```

Functions are exposed on `window` for cross-module access (e.g., `window.Calc`, `window.UI`, `window.Router`). Submodules (like `dash-class-manager.js`) add their functions directly to `window` or are called by their parent page module.

## Hosting & Deployment

- **Netlify** hosts the app with a build step (`scripts/build.sh`) that copies only public files to `dist/`
- **Edge function** (`netlify/edge-functions/inject-env.js`) replaces `__SUPABASE_URL__` / `__SUPABASE_KEY__` placeholders in HTML responses with environment variables, generates a per-request nonce, and emits the `Content-Security-Policy` header (with `script-src 'self' 'nonce-...'` — no `unsafe-inline` for scripts)
- **Service worker** (`sw.js`) precaches all app files and uses a network-first strategy with cache fallback. Bump `CACHE_NAME` on every deploy so installed PWAs reload fresh.
- **Demo mode** is the recommended way to try the app without Supabase — it short-circuits auth and seeds the Science 8 sample class from `shared/seed-data.js` (113 KB, lazy-loaded only on demand)
