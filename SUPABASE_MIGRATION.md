# Supabase Migration — Comprehensive Implementation Guide

## Overview
Migrate FullVision from browser localStorage to Supabase (PostgreSQL) with authentication, enabling multi-teacher deployment, FOIPPA compliance (data in Canada), and real data persistence.

**Architecture:** Local-first with background sync. localStorage remains the cache layer for instant UI. Supabase is the source of truth. The app works offline and syncs when connected.

**Region:** `ca-central-1` (Montreal) — FOIPPA requirement for BC student data.

---

## Phase 0: Supabase Project Setup (User Action)

1. Create account at supabase.com
2. New Project → Region: **Canada Central (ca-central-1)**
3. Name: `fullvision-prod`
4. Copy from Settings → API:
   - `Project URL` (e.g., `https://xxxxx.supabase.co`)
   - `anon public key`

---

## Phase 1: Database Schema

### 14 Tables (mapping all 20 localStorage keys)

```sql
-- ═══════════════════════════════════════════
-- TEACHER / AUTH
-- ═══════════════════════════════════════════
CREATE TABLE teachers (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  email text UNIQUE,
  display_name text,
  preferences jsonb DEFAULT '{}',  -- replaces gb-config (activeCourse, etc.)
  created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════
-- COURSES
-- ═══════════════════════════════════════════
CREATE TABLE courses (
  id text NOT NULL,
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name text NOT NULL,
  grading_system text DEFAULT 'proficiency',
  calc_method text DEFAULT 'mostRecent',
  decay_weight real DEFAULT 0.65,
  curriculum_tags text[] DEFAULT '{}',
  description text DEFAULT '',
  grade_level text DEFAULT '',
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id, teacher_id)
);

-- ═══════════════════════════════════════════
-- COURSE CONFIG (grading scale, weights, report settings)
-- ═══════════════════════════════════════════
CREATE TABLE course_configs (
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  config jsonb DEFAULT '{}',
  report_config jsonb DEFAULT '{}',  -- replaces gb-report-config-{cid} from reports.html
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, teacher_id)
);

-- ═══════════════════════════════════════════
-- STUDENTS
-- ═══════════════════════════════════════════
CREATE TABLE students (
  id text NOT NULL,
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  first_name text,
  last_name text,
  preferred text,
  pronouns text,
  student_number text,
  date_of_birth date,
  email text,
  enrolled_date date,
  designations text[] DEFAULT '{}',
  attendance jsonb DEFAULT '[]',
  sort_name text,
  date_withdrawn date,
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (id, course_id, teacher_id)
);

-- ═══════════════════════════════════════════
-- ASSESSMENTS
-- ═══════════════════════════════════════════
CREATE TABLE assessments (
  id text NOT NULL,
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  title text NOT NULL,
  date date,
  type text CHECK (type IN ('summative', 'formative')),
  tag_ids text[] DEFAULT '{}',
  evidence_type text,
  notes text DEFAULT '',
  core_competency_ids text[] DEFAULT '{}',
  rubric_id text,
  score_mode text DEFAULT 'proficiency' CHECK (score_mode IN ('proficiency', 'points')),
  max_points integer,
  weight real DEFAULT 1.0,
  module_id text,
  collaboration text DEFAULT 'individual' CHECK (collaboration IN ('individual', 'pair', 'group')),
  pairs jsonb DEFAULT '[]',
  groups jsonb DEFAULT '[]',
  due_date date,
  date_assigned date,
  created_at timestamptz DEFAULT now(),
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (id, course_id, teacher_id)
);

-- ═══════════════════════════════════════════
-- SCORES (largest table — needs indexes)
-- ═══════════════════════════════════════════
CREATE TABLE scores (
  id text NOT NULL,
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  student_id text NOT NULL,
  assessment_id text NOT NULL,
  tag_id text NOT NULL,
  score real DEFAULT 0,
  date date,
  type text,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (id, teacher_id)
);

CREATE INDEX idx_scores_lookup ON scores (course_id, teacher_id, student_id, tag_id);
CREATE INDEX idx_scores_student ON scores (course_id, teacher_id, student_id);
CREATE INDEX idx_scores_assessment ON scores (course_id, teacher_id, assessment_id);
CREATE UNIQUE INDEX idx_scores_unique ON scores (course_id, teacher_id, student_id, assessment_id, tag_id);

-- ═══════════════════════════════════════════
-- RUBRICS
-- ═══════════════════════════════════════════
CREATE TABLE rubrics (
  id text NOT NULL,
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  name text NOT NULL,
  criteria jsonb DEFAULT '[]',
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (id, course_id, teacher_id)
);

-- ═══════════════════════════════════════════
-- LEARNING MAPS (custom curriculum per course)
-- ═══════════════════════════════════════════
CREATE TABLE learning_maps (
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  subjects jsonb DEFAULT '[]',
  sections jsonb DEFAULT '[]',
  customized boolean DEFAULT false,
  version integer DEFAULT 1,
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, teacher_id)
);

-- ═══════════════════════════════════════════
-- MODULES (teaching units)
-- ═══════════════════════════════════════════
CREATE TABLE modules (
  id text NOT NULL,
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  name text,
  color text,
  sort_order integer DEFAULT 0,
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (id, course_id, teacher_id)
);

-- ═══════════════════════════════════════════
-- ASSIGNMENT STATUSES (excused / not submitted)
-- ═══════════════════════════════════════════
CREATE TABLE assignment_statuses (
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  student_id text NOT NULL,
  assessment_id text NOT NULL,
  status text CHECK (status IN ('excused', 'notSubmitted')),
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, teacher_id, student_id, assessment_id)
);

-- ═══════════════════════════════════════════
-- OBSERVATIONS (quick obs / anecdotal notes)
-- ═══════════════════════════════════════════
CREATE TABLE observations (
  id text NOT NULL,
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  student_id text NOT NULL,
  text text,
  dims text[] DEFAULT '{}',
  sentiment text,
  context text,
  assignment_context jsonb,
  created_at timestamptz DEFAULT now(),
  date date,
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (id, teacher_id)
);

CREATE INDEX idx_obs_student ON observations (course_id, teacher_id, student_id);

-- ═══════════════════════════════════════════
-- TERM RATINGS (end-of-term learner profiles)
-- ═══════════════════════════════════════════
CREATE TABLE term_ratings (
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  student_id text NOT NULL,
  term_id text NOT NULL,
  dims jsonb DEFAULT '{}',
  narrative text DEFAULT '',
  work_habits integer,
  participation integer,
  traits text[] DEFAULT '{}',
  mention_assessments text[] DEFAULT '{}',
  mention_observations text[] DEFAULT '{}',
  strengths text[] DEFAULT '{}',
  growth_areas text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  modified_at timestamptz DEFAULT now(),
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, teacher_id, student_id, term_id)
);

-- ═══════════════════════════════════════════
-- STUDENT META (flags, goals, reflections, custom tags)
-- ═══════════════════════════════════════════
CREATE TABLE student_meta (
  course_id text NOT NULL,
  teacher_id uuid NOT NULL,
  student_id text NOT NULL,
  flags jsonb DEFAULT '{}',
  goals jsonb DEFAULT '{}',
  reflections jsonb DEFAULT '{}',
  custom_tags text[] DEFAULT '{}',
  overrides jsonb DEFAULT '{}',
  FOREIGN KEY (course_id, teacher_id) REFERENCES courses(id, teacher_id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, teacher_id, student_id)
);
```

### Row-Level Security (ALL tables)

```sql
-- Enable RLS on every table
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_meta ENABLE ROW LEVEL SECURITY;

-- Teacher sees own data only
CREATE POLICY "own_data" ON teachers FOR ALL USING (id = auth.uid());
CREATE POLICY "own_data" ON courses FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON course_configs FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON students FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON assessments FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON scores FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON rubrics FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON learning_maps FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON modules FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON assignment_statuses FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON observations FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON term_ratings FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "own_data" ON student_meta FOR ALL USING (teacher_id = auth.uid());
```

---

## Phase 2: Supabase Client Setup

### New file: `gb-supabase.js`

- Download `supabase-js` from CDN and save locally as `vendor/supabase.min.js` (file:// compatible)
- Initialize client with project URL + anon key
- Auth helper functions: getUser(), isLoggedIn(), signIn(), signUp(), signOut()
- Sync engine: queue writes, flush on interval or on demand
- Conflict resolution: timestamp-based last-write-wins

### Script load order (all HTML files):
```html
<script src="vendor/supabase.min.js"></script>
<script src="gb-supabase.js"></script>
<script src="gb-constants.js"></script>
<script src="gb-data.js"></script>
<script src="gb-calc.js"></script>
<script src="gb-ui.js"></script>
<script src="gb-seed-data.js"></script>
```

---

## Phase 3: Rewrite gb-data.js (Hybrid Mode)

### Strategy: localStorage = instant cache, Supabase = source of truth

**Read path:**
1. Always read from localStorage (instant, works offline)
2. On app load: pull from Supabase → update localStorage cache

**Write path:**
1. Write to localStorage immediately (instant UI update)
2. Queue the write for Supabase sync
3. Flush queue every 500ms (debounced) or on page unload

**Sync on load:**
```js
async function syncFromSupabase(cid) {
  if (!isLoggedIn()) return;
  const { data: students } = await supabase.from('students').select('*').eq('course_id', cid);
  if (students) localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
  // ... repeat for each entity
}
```

### Functions to rewrite (47 total):

| Category | Count | Functions |
|----------|-------|-----------|
| Courses | 5 | loadCourses, saveCourses, createCourse, updateCourse, deleteCourseData |
| Students | 2 | getStudents, saveStudents |
| Assessments | 2 | getAssessments, saveAssessments |
| Scores | 4 | getScores, saveScores, getPointsScore, setPointsScore |
| Overrides | 2 | getOverrides, saveOverrides |
| Learning Map | 4 | getLearningMap, saveLearningMap, resetLearningMap, ensureCustomLearningMap |
| Modules | 3 | getModules, saveModules, getModuleById |
| Config | 4 | getCourseConfig, saveCourseConfig, getConfig, saveConfig |
| Rubrics | 3 | getRubrics, saveRubrics, deleteRubric |
| Statuses | 4 | getAssignmentStatuses, saveAssignmentStatuses, getAssignmentStatus, setAssignmentStatus |
| Flags/Goals/Refl | 6 | getFlags, saveFlags, getGoals, saveGoals, getReflections, saveReflections |
| Observations | 9 | getQuickObs, saveQuickObs, addQuickOb, deleteQuickOb, getStudentQuickObs, getAllQuickObs, getQuickObsByDim, getAssignmentObs, getStudentAssignmentFeedback |
| Custom Tags | 3 | getCustomTags, saveCustomTags, addCustomTag, removeCustomTag |
| Term Ratings | 4 | getTermRatings, saveTermRatings, getStudentTermRating, upsertTermRating |
| Report Config | 2 | getReportConfig, saveReportConfig (move from reports.html to gb-data.js) |
| Active Course | 2 | getActiveCourse, setActiveCourse |

### Also fix: Direct localStorage calls outside gb-data.js

| File | Issue | Fix |
|------|-------|-----|
| reports.html | getReportConfig/saveReportConfig bypass gb-data.js | Move to gb-data.js, add Supabase sync |
| settings.html | localStorage.clear() in reset button | Replace with deleteCourseData + Supabase delete |
| settings.html | localStorage.removeItem in clearData() | Route through gb-data.js |
| gb-ui.js | gb-sidebar-vis in localStorage | Keep as UI-only state (no Supabase needed) |

---

## Phase 4: Authentication

### New file: `login.html`

- Email + password login form
- Sign up flow with email verification
- "Forgot Password" link
- Matches Apple HIG design system
- On success → redirect to index.html with session cookie

### Auth guard (added to every page):
```js
(async function() {
  const user = await getUser();
  if (!user && location.protocol !== 'file:') {
    window.location = 'login.html';
    return;
  }
  // Sync COURSES global from Supabase before any rendering
  if (isLoggedIn()) {
    await syncCoursesFromSupabase(); // Refreshes COURSES global + localStorage
    await syncFromSupabase(getActiveCourse()); // Sync active course data
  }
  seedIfNeeded(); // Only seeds if no data exists
  render();
})();
```

### file:// bypass:
When running locally via file://, skip auth entirely. App works as before with localStorage only.

---

## Phase 5: Sync Engine

### `gb-supabase.js` sync system:

```js
const _syncQueue = {};      // pending writes
const _syncTimers = {};     // debounce timers
const SYNC_DELAY = 500;     // ms debounce

function queueSync(table, courseId, data) {
  const key = table + ':' + courseId;
  _syncQueue[key] = { table, courseId, data, timestamp: Date.now() };
  clearTimeout(_syncTimers[key]);
  _syncTimers[key] = setTimeout(() => flushSync(key), SYNC_DELAY);
}

async function flushSync(key) {
  if (!isLoggedIn()) return;
  const item = _syncQueue[key];
  if (!item) return;
  delete _syncQueue[key];
  try {
    await _writeToSupabase(item.table, item.courseId, item.data);
    updateSyncIndicator('synced');
  } catch (err) {
    console.error('Sync failed:', err);
    updateSyncIndicator('error', Object.keys(_syncQueue).length);
    // Re-queue for retry
    _syncQueue[key] = item;
  }
}

// Flush all pending on page unload
window.addEventListener('beforeunload', () => {
  Object.keys(_syncQueue).forEach(flushSync);
});
```

### Sync indicator in dock (gb-ui.js):
- 🟢 `Synced` — all writes confirmed
- 🟡 `Syncing...` — writes pending
- 🔴 `Offline (N pending)` — no connection, writes queued

---

## Phase 6: Data Migration (Existing Users)

### Upload existing localStorage to Supabase:
```js
async function migrateLocalToSupabase() {
  // Show progress UI
  const courseIds = Object.keys(COURSES);
  for (const cid of courseIds) {
    await uploadCourse(cid);      // courses table
    await uploadStudents(cid);    // students table
    await uploadAssessments(cid); // assessments table
    await uploadScores(cid);      // scores table (largest)
    await uploadRubrics(cid);
    await uploadObservations(cid);
    await uploadTermRatings(cid);
    // ... etc
  }
  // Mark migration complete
  localStorage.setItem('gb-migrated', 'true');
}
```

### First-login flow:
1. Teacher signs up → check if localStorage has data
2. If yes → offer "Upload existing gradebook data?"
3. If no → start fresh (empty gradebook)

---

## Phase 7: Seed Data for Demo Mode

- `seedIfNeeded()` stays in `gb-seed-data.js`
- Only runs when: no courses exist AND (file:// protocol OR user clicks "Load Demo Data")
- "Load Demo Data" button in Class Management for logged-in users who want to explore
- "Reset Demo Data" button stays in Advanced settings

---

## Implementation Order

| Step | What | Time |
|------|------|------|
| 1 | User creates Supabase project (ca-central-1) | 15 min |
| 2 | Run SQL schema + RLS policies in Supabase SQL editor | 30 min |
| 3 | Download supabase-js, create gb-supabase.js | 30 min |
| 4 | Build login.html | 1 hour |
| 5 | Rewrite gb-data.js (hybrid mode) — all 56 functions | 3-4 hours |
| 6 | Fix direct localStorage calls in reports.html + settings.html | 30 min |
| 7 | Add auth guard to all 6 pages | 30 min |
| 8 | Add sync indicator to dock | 30 min |
| 9 | Build data migration flow | 1 hour |
| 10 | End-to-end testing | 1-2 hours |

**Total: ~8-10 hours**

---

## Legacy Data Resolution

### Overrides — Decision: Build the feature

**What overrides is:** A teacher's professional judgment override of a calculated proficiency. The calculation says a student is at 2.4 (Developing) for a section, but the teacher has observed growth that isn't captured in the numbers and wants to record "Proficient" instead, with a justification.

**Data shape:**
```js
// gb-overrides-{cid}
{
  "studentId": {
    "sectionId": {
      "level": 3,                    // 1-4 proficiency override
      "reason": "Demonstrated proficient understanding in class discussion and peer teaching",
      "date": "2026-03-15",
      "calculated": 2.4              // what the calculation said (for audit trail)
    }
  }
}
```

**Supabase storage:** `student_meta.overrides (jsonb)` — already in the schema.

**Calculation integration (gb-calc.js):**

Modify `getSectionProficiency()` to check for an override AFTER calculating:
```js
function getSectionProficiency(cid, studentId, sectionId) {
  const section = getSections(cid).find(s => s.id === sectionId);
  if (!section) return 0;
  const profs = section.tags.map(t => getTagProficiency(cid, studentId, t.id)).filter(p => p > 0);
  if (profs.length === 0) return 0;
  const calculated = profs.reduce((a,b) => a+b, 0) / profs.length;

  // Check for teacher override
  const overrides = getOverrides(cid);
  const override = overrides[studentId]?.[sectionId];
  if (override && override.level > 0) return override.level;

  return calculated;
}
```

This means overrides flow through to `getOverallProficiency()` automatically — no other calc changes needed.

**UI (student.html — section proficiency card header):**

Next to the existing proficiency badge on each section card, add a small override icon:
```
┌─────────────────────────────────────────────────┐
│ ▌ Questioning and Predicting     PROFICIENT  ✎ │
│   Science 8                                     │
```

- **No override set:** Small pencil icon (✎), grey, subtle. Hover tooltip: "Override proficiency"
- **Override active:** Pencil icon turns blue. Badge shows overridden level. Small "overridden" label below badge in grey italic.
- **Click pencil:** Opens inline override panel below the header:

```
┌─────────────────────────────────────────────────┐
│ Override Proficiency                          ✕ │
│                                                 │
│ Calculated: 2.4 Developing                      │
│                                                 │
│ Override to:                                    │
│ [1 Emerging] [2 Developing] [3 Proficient] [4]  │
│                                                 │
│ Reason:                                         │
│ ┌─────────────────────────────────────────────┐ │
│ │ Based on classroom observations and...      │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│              [Clear Override]  [Save Override]   │
└─────────────────────────────────────────────────┘
```

- **Level selector:** 4 proficiency buttons (same segmented control pattern as TQ dispositions)
- **Reason field:** Required — teacher must explain why. 1-2 sentences.
- **Clear Override:** Removes the override, reverts to calculated value
- **Save Override:** Saves to `gb-overrides-{cid}` → syncs to Supabase

**Where overrides are visible:**

| Location | Behavior |
|----------|----------|
| Student dashboard section card | Shows overridden level + "overridden" label |
| Student dashboard overall proficiency | Recalculated using overridden section values |
| Teacher dashboard student cards | Overall reflects override |
| Gradebook summary view | Section columns reflect override |
| Reports — academic summary | Shows overridden level |
| Reports — progress report | Shows overridden level with note: "Teacher override" |
| Spreadsheet overall column | Reflects override |

**Where overrides are NOT visible:**
- Individual tag proficiencies — overrides are at section level, not tag level
- Score entry (speedgrader) — raw scores stay as entered
- Observations — independent of scoring

**Reports integration:**
When generating progress reports, if a section has an override, show both:
```
Questioning and Predicting: Proficient (teacher assessment)
  Calculated from evidence: 2.4 Developing
  Teacher note: "Demonstrated proficient understanding in recent lab work
  and peer teaching that isn't fully reflected in formal assessments."
```

**Implementation order:**
1. Define data shape in gb-data.js (already has getOverrides/saveOverrides)
2. Modify getSectionProficiency in gb-calc.js (3 lines)
3. Add override UI to student.html section cards (~50 lines CSS + ~40 lines JS)
4. Add "overridden" indicator to reports.html
5. Add override to export/import (already included)

### Notes — Decision: Complete the migration, then sunset

**What notes is:** The original observation system. `gb-notes-{cid}` stored per-student text notes. It was replaced by `gb-quick-obs-{cid}` which adds sentiment, context, dimensions, and assignment linking.

**Current state:**
- Migration code already exists in `gb-seed-data.js` (lines 2158-2179) — it converts old notes into quick-obs format on app startup
- `getNotes()` / `saveNotes()` still exist in gb-data.js
- Only used in: export/import (settings.html) and deleteStudent undo snapshot (index.html)
- No UI reads or writes notes directly — all observation UI uses quick-obs

**The migration code does this:**
```
For each course:
  Read gb-notes-{cid}
  For each student's notes:
    If note.id not already in quick-obs:
      Push note into quick-obs (with dims:[], no sentiment/context)
  Save quick-obs
  Delete gb-notes-{cid}
```

**Supabase plan:**
1. **During Supabase data upload** — run the notes→observations migration FIRST, before uploading observations to Supabase. This ensures all legacy notes are converted.
2. **After migration** — `gb-notes-{cid}` no longer exists in localStorage. The Supabase `observations` table contains everything.
3. **Keep getNotes/saveNotes in gb-data.js** for import compatibility — if someone imports an old JSON backup with `notes:{}`, it gets converted on the next app load.
4. **No Supabase table needed for notes** — they are fully absorbed into observations.

**Migration action (add to Phase 6: Data Migration):**
```js
async function migrateLocalToSupabase() {
  for (const cid of Object.keys(COURSES)) {
    // Step 0: Convert any remaining legacy notes → quick-obs FIRST
    const oldNotes = getNotes(cid);
    if (Object.keys(oldNotes).some(sid => (oldNotes[sid]||[]).length > 0)) {
      const obs = getQuickObs(cid);
      Object.keys(oldNotes).forEach(sid => {
        if (!obs[sid]) obs[sid] = [];
        const existingIds = new Set(obs[sid].map(o => o.id));
        (oldNotes[sid]||[]).forEach(n => {
          if (!existingIds.has(n.id)) {
            obs[sid].push({
              id: n.id, text: n.text, dims: [],
              created: n.created || new Date().toISOString(),
              date: (n.created || '').slice(0,10) || getTodayStr()
            });
          }
        });
      });
      saveQuickObs(cid, obs);
      localStorage.removeItem('gb-notes-' + cid);
    }
    // Step 1-N: Upload everything to Supabase...
    await uploadCourse(cid);
    await uploadStudents(cid);
    // ... etc
  }
}
```

---

## What Stays Unchanged

- `gb-constants.js` — pure constants, no data access
- `gb-calc.js` — pure calculation, reads via gb-data.js functions
- `gb-ui.js` — rendering, reads via gb-data.js functions (except sidebar-vis which stays localStorage)
- `gb-styles.css` — all CSS unchanged
- `curriculum_data.js` — static reference data, no migration needed
- All 6 HTML page rendering logic — unchanged
- The `file://` development flow — still works without Supabase

---

## What the User Provides

1. Supabase Project URL
2. Supabase anon public key
3. Decision: email/password auth OR district SSO (can add SSO later)

---

## FOIPPA Compliance Checklist

- [x] Data stored in Canada (ca-central-1 Montreal)
- [x] Encrypted in transit (HTTPS via Supabase)
- [x] Encrypted at rest (Supabase default)
- [x] Row-Level Security (teacher isolation)
- [x] Authentication required
- [x] No student data in URL parameters
- [ ] Privacy Impact Assessment document (draft after deployment)
- [ ] Data retention policy (define with district)
- [ ] Breach notification procedure (define with district)
- [ ] Accessibility audit (WCAG 2.1 — partial, needs completion)

---

## Pre-Implementation Tasks (Do Before Phase 1)

These must be completed before writing any Supabase code:

1. **Move getReportConfig/saveReportConfig from reports.html to gb-data.js** — currently bypasses the data layer
2. **Fix settings.html clearData()** — replace direct `localStorage.removeItem` calls with `deleteCourseData()`
3. **Fix settings.html reset button** — replace `localStorage.clear()` with proper cleanup through gb-data.js
4. **Add scores table date index** — `CREATE INDEX idx_scores_date ON scores (course_id, teacher_id, date)` for growth sparklines
5. **Download supabase-js locally** — save to `vendor/supabase.min.js` for file:// compatibility (CDN won't work on file://)

---

## Audit Results (Verified 2026-03-22, Second Pass)

| Check | Result |
|-------|--------|
| All 20 localStorage keys mapped to tables | PASS |
| All 56 data functions listed | PASS (after adding 9 missing helpers) |
| Direct localStorage calls outside gb-data.js identified | PASS (4 found, 3 need fixing) |
| Data shapes match schema columns | PASS |
| Dependency chain has no circular deps | PASS |
| RLS policies on all 13 tables | PASS |
| Score indexes cover query patterns | PASS |
| COURSES global staleness handled | PASS (syncCoursesFromSupabase added) |
| CASCADE covers deleteCourseData | PASS (all 16 keys cascade) |
| Curriculum loader compatible | PASS (stays client-side only) |
| Collaboration fields (pairs/groups) in assessments | PASS (added in second review) |
| Score mode compatibility (proficiency + points in one column) | PASS |
| Grading scale fallback to defaults | PASS |
| Report config shape fits jsonb column | PASS |
| Module-assessment relationship (ON DELETE SET NULL) | PASS |
| Notes legacy migration path documented | PASS (migrate notes → observations before Supabase upload) |
| Overrides data shape | PASS (empty stub — store in student_meta.overrides jsonb, costs nothing) |
