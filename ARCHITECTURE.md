# FullVision Architecture

A learning profile builder and communicator for BC teachers. Single-page application served from a single `app.html` entry point, using hash-based routing, IIFE page modules, and a local-first data layer that syncs to Supabase.

## Application Structure

```
app.html                  Entry point - loads all CSS + JS, defines DOM mount points
gb-constants.js           Shared constants (DEFAULT_COURSES, LEARNING_MAP, proficiency labels/colors)
gb-supabase.js            Supabase client init + auth API (signIn, signOut, requireAuth)
gb-data.js                Data access layer (cache-through pattern, localStorage + Supabase sync)
gb-calc.js                Proficiency calculation engine (4 methods, section/tag/overall rollups)
gb-ui.js                  Shared UI components (dock, sidebar, student header, modals, toasts)
gb-seed-data.js           Demo data seeder for new accounts
gb-router.js              Hash-based SPA router with page lifecycle

page-dashboard.js         Dashboard: student roster overview, class manager, curriculum wizard
page-assignments.js       Assignment management and scoring
page-student.js           Individual student detail view
page-gradebook.js         Spreadsheet-style class gradebook
page-observations.js      Quick observations / anecdotal notes
page-reports.js           Report card generation

dash-overview.js          Dashboard submodule: overview tab rendering
dash-class-manager.js     Dashboard submodule: class/student CRUD
dash-curriculum-wizard.js Dashboard submodule: BC curriculum import wizard
assign-form.js            Assignments submodule: create/edit form
assign-scoring.js         Assignments submodule: score entry UI
assign-rubric-editor.js   Assignments submodule: rubric builder
report-blocks.js          Reports submodule: report block components
report-builder.js         Reports submodule: report layout builder
report-narrative.js       Reports submodule: narrative generation
```

## Script Load Order

Defined in `app.html`. Order matters because modules attach to `window` and later scripts depend on earlier ones:

1. `curriculum_data.js` - BC curriculum dataset
2. `vendor/supabase.min.js` - Supabase client SDK (with CDN fallback)
3. `gb-supabase.js` - Auth layer (needs Supabase SDK)
4. `gb-constants.js` - Constants (no dependencies)
5. `gb-data.js` - Data layer (needs constants + Supabase)
6. `gb-calc.js` - Calculation engine (needs data layer)
7. `gb-ui.js` - Shared UI (needs data + calc)
8. `gb-seed-data.js` - Demo seeder
9. Submodules (`dash-*.js`, `assign-*.js`, `report-*.js`)
10. Page modules (`page-*.js`) - must load after their submodules
11. `gb-router.js` - Router (needs all page modules registered on `window`)

The router auto-boots at the bottom of `gb-router.js` via `Router.boot()`.

## Page Routing System

`gb-router.js` implements hash-based routing as an IIFE exposing `window.Router`.

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

`gb-data.js` implements a **cache-through** pattern: synchronous in-memory reads, async background writes to Supabase with localStorage fallback.

### Architecture

```
Page Code
   |
   | get*() - synchronous read from _cache
   | save*() - write to _cache + trigger sync
   v
_cache (in-memory object)
   |
   | _saveCourseField() - central write path
   |   1. Update _cache[field][cid]
   |   2. Clear proficiency cache if field affects calculations
   |   3. Sync to Supabase (or localStorage if offline)
   |   4. Broadcast change to other tabs
   v
Supabase (primary)  OR  localStorage (fallback)
```

### Initialization

`initAllCourses()` runs first:
1. Check for valid Supabase session -> set `_useSupabase` flag
2. Fetch `teacher_config` rows (courses list + global config)
3. Fall back to localStorage if Supabase unavailable
4. If localStorage has data but Supabase doesn't, seed Supabase in background

`initData(cid)` loads a specific course:
1. Fetch all `course_data` rows for (teacher_id, course_id) from Supabase
2. Populate `_cache` fields from the returned rows
3. If Supabase had no data, load from localStorage and seed Supabase

### Data Storage

**Supabase tables:**
- `teacher_config` - global data keyed by `(teacher_id, config_key)`. Keys: `'courses'`, `'config'`
- `course_data` - per-course data keyed by `(teacher_id, course_id, data_key)`. Keys match `_DATA_KEYS`

**localStorage keys:** `gb-{dataKey}-{courseId}` (e.g., `gb-students-sci8`, `gb-scores-ss10`)

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

`gb-supabase.js` wraps the Supabase Auth SDK as an IIFE.

**Key functions (all on `window`):**
- `requireAuth()` - called at boot. Checks localStorage for a cached Supabase session token. If valid and not expired, allows the page to load immediately. Otherwise, calls `sb.auth.getSession()` and redirects to `login.html` if no session.
- `signOut()` - signs out via Supabase, clears all `gb-*` localStorage keys (FOIPPA compliance for shared computers), redirects to `login.html`.
- `getCurrentUser()` / `isLoggedIn()` - async session checks
- `onAuthChange(callback)` - listens for auth state changes; shows "Session expired" toast on `SIGNED_OUT`

**Idle timeout:** A separate IIFE sets a 30-minute inactivity timer. Resets on mouse/keyboard/touch/scroll events. Calls `signOut()` on expiry. Designed for shared classroom computers.

**Session flow:**
1. User loads `app.html` -> `Router.boot()` -> `requireAuth()`
2. Fast path: parse `sb-*-auth-token` from localStorage, check `expires_at`
3. Slow path: call `sb.auth.getSession()` if no cached token
4. No session -> redirect to `login.html` (separate page, not part of SPA)

## Proficiency Calculation Engine

`gb-calc.js` computes proficiency levels (0-4 scale) from score data.

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

`gb-ui.js` provides reusable UI rendered into the DOM mount points:

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
