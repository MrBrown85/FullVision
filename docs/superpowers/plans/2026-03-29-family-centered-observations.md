# Family-Centered Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add connection tags, share-with-family toggle, and Family Context section to the observation system so teachers can build strengths-first, relational records for Indigenous and all families.

**Architecture:** Extends the existing observation data model with three new fields (`connectionTags`, `connectionNote`, `sharedWithFamily`) and adds a `familyContext` array to the student object. UI changes touch the desktop and mobile observation capture/feed, plus a new Family Context card on the student detail view. All data flows through the existing `saveStudents()` and observation CRUD in `shared/data.js`.

**Tech Stack:** Vanilla JS (IIFE modules), CSS custom properties, Supabase (Postgres), Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `shared/constants.js` | New `CONNECTION_TAGS` constant (5 tags with IDs, labels, icons) |
| `shared/data.js` | Extended `addQuickOb()` and `updateQuickOb()` signatures; new family context CRUD functions |
| `teacher/page-observations.js` | Connection tag row, connection note field, share toggle in capture bar; render new fields in feed cards |
| `teacher/observations.css` | Styles for connection tags, connection note, share toggle, shared indicator |
| `teacher/ui.js` | New `renderFamilyContext()` function, inserted into `renderStudentHeader()` |
| `teacher/styles.css` | Styles for Family Context card |
| `teacher-mobile/tab-observe.js` | Connection tags, connection note, share toggle in mobile capture; render new fields in feed cards |
| `teacher-mobile/tab-students.js` | Family Context section in student detail sheet |
| `teacher-mobile/styles.css` | Mobile styles for connection tags, share toggle, Family Context |
| `tests/data-observations.test.js` | Tests for new observation fields, share default logic |
| `tests/data-family-context.test.js` | Tests for family context CRUD on student object |

---

### Task 1: Add CONNECTION_TAGS constant

**Files:**
- Modify: `shared/constants.js:184` (after `OBS_CONTEXTS`)

- [ ] **Step 1: Add the constant after OBS_CONTEXTS**

In `shared/constants.js`, after line 184 (end of `OBS_CONTEXTS`), add:

```javascript
const CONNECTION_TAGS = {
  'land-place':        { label: 'Land & place',      icon: '🌿' },
  'family-elders':     { label: 'Family & elders',   icon: '👪' },
  'community':         { label: 'Community',          icon: '🏘' },
  'cultural-practice': { label: 'Cultural practice',  icon: '🪶' },
  'student-interest':  { label: 'Student interest',   icon: '⭐' }
};
```

- [ ] **Step 2: Export the constant**

Find the `window.` exports block at the bottom of `constants.js` and add `CONNECTION_TAGS` to it, following the existing pattern for `OBS_SENTIMENTS`, `OBS_CONTEXTS`, etc.

- [ ] **Step 3: Verify no errors**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All existing tests still pass. No reference errors.

- [ ] **Step 4: Commit**

```bash
git add shared/constants.js
git commit -m "feat: add CONNECTION_TAGS constant for family-centered observations"
```

---

### Task 2: Extend observation data model

**Files:**
- Modify: `shared/data.js:2399-2465` (addQuickOb, updateQuickOb)
- Test: `tests/data-observations.test.js`

- [ ] **Step 1: Write failing tests for new observation fields**

Append to `tests/data-observations.test.js`, inside or after the existing `addQuickOb` describe block:

```javascript
describe('addQuickOb — connection fields', () => {
  it('stores connectionTags when provided', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Great link to fishing', ['engagement'], 'strength', 'whole-class', null, ['family-elders', 'land-place'], 'Connected to uncle fishing trip', null);
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].connectionTags).toEqual(['family-elders', 'land-place']);
    expect(obs[0].connectionNote).toBe('Connected to uncle fishing trip');
  });

  it('defaults sharedWithFamily to true for strength sentiment', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Good work', [], 'strength');
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sharedWithFamily).toBe(true);
  });

  it('defaults sharedWithFamily to false for growth sentiment', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Needs practice', [], 'growth');
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sharedWithFamily).toBe(false);
  });

  it('defaults sharedWithFamily to false for concern sentiment', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Struggled today', [], 'concern');
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sharedWithFamily).toBe(false);
  });

  it('defaults sharedWithFamily to false when no sentiment', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Quick note', []);
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sharedWithFamily).toBe(false);
  });

  it('omits connectionTags and connectionNote when not provided', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Plain obs', [], 'strength');
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].connectionTags).toBeUndefined();
    expect(obs[0].connectionNote).toBeUndefined();
  });
});

describe('updateQuickOb — connection fields', () => {
  it('updates connectionTags', () => {
    saveQuickObs(CID, { stu1: [{ id: 'ob1', text: 'test', created: '2025-01-01T10:00:00Z', connectionTags: ['community'] }] });
    updateQuickOb(CID, 'stu1', 'ob1', { connectionTags: ['land-place', 'family-elders'] });
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].connectionTags).toEqual(['land-place', 'family-elders']);
  });

  it('updates sharedWithFamily', () => {
    saveQuickObs(CID, { stu1: [{ id: 'ob1', text: 'test', created: '2025-01-01T10:00:00Z', sharedWithFamily: true }] });
    updateQuickOb(CID, 'stu1', 'ob1', { sharedWithFamily: false });
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sharedWithFamily).toBe(false);
  });

  it('updates connectionNote', () => {
    saveQuickObs(CID, { stu1: [{ id: 'ob1', text: 'test', created: '2025-01-01T10:00:00Z' }] });
    updateQuickOb(CID, 'stu1', 'ob1', { connectionNote: 'Linked to elder visit' });
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].connectionNote).toBe('Linked to elder visit');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/data-observations.test.js --reporter=verbose 2>&1 | tail -20`

Expected: New tests FAIL (addQuickOb doesn't accept connectionTags/connectionNote args yet).

- [ ] **Step 3: Extend addQuickOb signature**

In `shared/data.js`, modify the `addQuickOb` function (line 2399). Change the signature from:

```javascript
function addQuickOb(cid, sid, text, dims, sentiment, context, assignmentContext) {
```

to:

```javascript
function addQuickOb(cid, sid, text, dims, sentiment, context, assignmentContext, connectionTags, connectionNote, sharedWithFamily) {
```

After line 2411 (`if (assignmentContext) entry.assignmentContext = assignmentContext;`), add:

```javascript
    if (connectionTags && connectionTags.length) entry.connectionTags = connectionTags;
    if (connectionNote) entry.connectionNote = connectionNote.trim();
    entry.sharedWithFamily = sharedWithFamily != null ? sharedWithFamily : (sentiment === 'strength');
```

In the Supabase sync block (the object passed to `_syncToSupabase` around line 2415), add these fields:

```javascript
      connection_tags: entry.connectionTags || null,
      connection_note: entry.connectionNote || null,
      shared_with_family: entry.sharedWithFamily
```

- [ ] **Step 4: Extend updateQuickOb to handle new fields**

In `shared/data.js`, in the `updateQuickOb` function (around line 2441), after the line `if (updates.context !== undefined) ob.context = updates.context || null;` add:

```javascript
    if (updates.connectionTags !== undefined) ob.connectionTags = updates.connectionTags;
    if (updates.connectionNote !== undefined) ob.connectionNote = updates.connectionNote;
    if (updates.sharedWithFamily !== undefined) ob.sharedWithFamily = updates.sharedWithFamily;
```

In the Supabase sync object within `updateQuickOb`, add:

```javascript
      connection_tags: ob.connectionTags || null,
      connection_note: ob.connectionNote || null,
      shared_with_family: ob.sharedWithFamily != null ? ob.sharedWithFamily : false
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/data-observations.test.js --reporter=verbose 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/data.js tests/data-observations.test.js
git commit -m "feat: add connectionTags, connectionNote, sharedWithFamily to observation model"
```

---

### Task 3: Add Family Context CRUD to student object

**Files:**
- Modify: `shared/data.js`
- Create: `tests/data-family-context.test.js`

- [ ] **Step 1: Write failing tests for family context CRUD**

Create `tests/data-family-context.test.js`:

```javascript
/**
 * Family Context CRUD tests — student.familyContext array
 */
const CID = 'test';

beforeEach(() => {
  _cache.students[CID] = undefined;
  localStorage.clear();
});

describe('family context CRUD', () => {
  it('addFamilyContext adds a note to the student', () => {
    saveStudents(CID, [{ id: 'stu1', firstName: 'A', lastName: 'B' }]);
    const note = addFamilyContext(CID, 'stu1', 'Fishes with uncle on weekends');
    expect(note.id).toMatch(/^fc_/);
    expect(note.text).toBe('Fishes with uncle on weekends');
    expect(note.created).toBeDefined();
    expect(note.updated).toBeDefined();
    const st = getStudents(CID).find(s => s.id === 'stu1');
    expect(st.familyContext).toHaveLength(1);
    expect(st.familyContext[0].text).toBe('Fishes with uncle on weekends');
  });

  it('addFamilyContext trims whitespace', () => {
    saveStudents(CID, [{ id: 'stu1', firstName: 'A', lastName: 'B' }]);
    addFamilyContext(CID, 'stu1', '  Grandmother speaks Halkomelem  ');
    const st = getStudents(CID).find(s => s.id === 'stu1');
    expect(st.familyContext[0].text).toBe('Grandmother speaks Halkomelem');
  });

  it('updateFamilyContext modifies existing note', () => {
    saveStudents(CID, [{ id: 'stu1', firstName: 'A', lastName: 'B', familyContext: [
      { id: 'fc_1', text: 'Old note', created: '2026-01-01T10:00:00Z', updated: '2026-01-01T10:00:00Z' }
    ]}]);
    updateFamilyContext(CID, 'stu1', 'fc_1', 'Updated note');
    const st = getStudents(CID).find(s => s.id === 'stu1');
    expect(st.familyContext[0].text).toBe('Updated note');
    expect(st.familyContext[0].updated).not.toBe('2026-01-01T10:00:00Z');
  });

  it('deleteFamilyContext removes the note', () => {
    saveStudents(CID, [{ id: 'stu1', firstName: 'A', lastName: 'B', familyContext: [
      { id: 'fc_1', text: 'Note 1', created: '2026-01-01T10:00:00Z', updated: '2026-01-01T10:00:00Z' },
      { id: 'fc_2', text: 'Note 2', created: '2026-01-02T10:00:00Z', updated: '2026-01-02T10:00:00Z' }
    ]}]);
    deleteFamilyContext(CID, 'stu1', 'fc_1');
    const st = getStudents(CID).find(s => s.id === 'stu1');
    expect(st.familyContext).toHaveLength(1);
    expect(st.familyContext[0].id).toBe('fc_2');
  });

  it('addFamilyContext initializes familyContext array if missing', () => {
    saveStudents(CID, [{ id: 'stu1', firstName: 'A', lastName: 'B' }]);
    addFamilyContext(CID, 'stu1', 'First note');
    const st = getStudents(CID).find(s => s.id === 'stu1');
    expect(Array.isArray(st.familyContext)).toBe(true);
    expect(st.familyContext).toHaveLength(1);
  });

  it('returns null for non-existent student', () => {
    saveStudents(CID, []);
    const result = addFamilyContext(CID, 'nobody', 'Test');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/data-family-context.test.js --reporter=verbose 2>&1 | tail -10`

Expected: FAIL — `addFamilyContext is not defined`.

- [ ] **Step 3: Implement family context functions in data.js**

In `shared/data.js`, after the observation CRUD section (after `hasAssignmentFeedback` around line 2479), add:

```javascript
/* ── Family Context — per-student relationship notes ──── */
function addFamilyContext(cid, sid, text) {
  const students = getStudents(cid);
  const st = students.find(s => s.id === sid);
  if (!st) return null;
  if (!st.familyContext) st.familyContext = [];
  const note = {
    id: 'fc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    text: text.trim(),
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };
  st.familyContext.push(note);
  saveStudents(cid, students);
  return note;
}

function updateFamilyContext(cid, sid, noteId, text) {
  const students = getStudents(cid);
  const st = students.find(s => s.id === sid);
  if (!st || !st.familyContext) return;
  const note = st.familyContext.find(n => n.id === noteId);
  if (!note) return;
  note.text = text.trim();
  note.updated = new Date().toISOString();
  saveStudents(cid, students);
}

function deleteFamilyContext(cid, sid, noteId) {
  const students = getStudents(cid);
  const st = students.find(s => s.id === sid);
  if (!st || !st.familyContext) return;
  st.familyContext = st.familyContext.filter(n => n.id !== noteId);
  saveStudents(cid, students);
}
```

- [ ] **Step 4: Export the new functions**

Find the `window.` exports at the bottom of `data.js` and add:

```javascript
  addFamilyContext,
  updateFamilyContext,
  deleteFamilyContext,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/data-family-context.test.js --reporter=verbose 2>&1 | tail -15`

Expected: All 6 tests PASS.

- [ ] **Step 6: Run all tests to confirm no regressions**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add shared/data.js tests/data-family-context.test.js
git commit -m "feat: add family context CRUD (add, update, delete notes on student)"
```

---

### Task 4: Desktop observation capture — connection tags & share toggle

**Files:**
- Modify: `teacher/page-observations.js`
- Modify: `teacher/observations.css`

- [ ] **Step 1: Add module-level state variables**

In `teacher/page-observations.js`, near the top where `activeTags`, `activeSentiment`, `activeContext` are declared, add:

```javascript
  var activeConnectionTags = [];
  var activeConnectionNote = '';
  var activeSharedWithFamily = false;
```

- [ ] **Step 2: Add connection tag toggle function**

Near the existing `toggleSentiment` and `toggleContext` functions, add:

```javascript
  function toggleConnectionTag(val) {
    var idx = activeConnectionTags.indexOf(val);
    if (idx >= 0) activeConnectionTags.splice(idx, 1);
    else activeConnectionTags.push(val);
    _updateCaptureConnection();
  }
```

- [ ] **Step 3: Add _updateCaptureConnection for partial DOM updates**

```javascript
  function _updateCaptureConnection() {
    var wrap = document.getElementById('connection-section');
    if (!wrap) return;
    // Update tag pills
    wrap.querySelectorAll('[data-conn-tag]').forEach(function(btn) {
      btn.classList.toggle('active', activeConnectionTags.indexOf(btn.dataset.connTag) >= 0);
    });
    // Show/hide connection note
    var noteWrap = document.getElementById('connection-note-wrap');
    if (noteWrap) noteWrap.style.display = activeConnectionTags.length > 0 ? '' : 'none';
  }
```

- [ ] **Step 4: Add renderCaptureConnection function**

This renders the connection tag row, connection note field, and share toggle. Add it near `renderCaptureSecondary`:

```javascript
  function renderCaptureConnection() {
    var h = '<div class="obs-connection-section" id="connection-section">';
    // Connection tags
    h += '<div class="obs-connection-tags">';
    h += '<span class="obs-connection-label">Connection</span>';
    Object.keys(CONNECTION_TAGS).forEach(function(key) {
      var t = CONNECTION_TAGS[key];
      h += '<button class="obs-connection-pill' + (activeConnectionTags.indexOf(key) >= 0 ? ' active' : '') + '" data-action="toggleConnectionTag" data-conn-tag="' + key + '">' + t.icon + ' ' + t.label + '</button>';
    });
    h += '</div>';
    // Connection note (hidden when no tags selected)
    h += '<div class="obs-connection-note-wrap" id="connection-note-wrap" style="' + (activeConnectionTags.length > 0 ? '' : 'display:none') + '">';
    h += '<input class="obs-connection-note-input" id="connection-note-input" type="text" placeholder="Briefly, what\u2019s the connection?" value="' + esc(activeConnectionNote) + '" autocomplete="off">';
    h += '</div>';
    // Share toggle
    var isShared = activeSharedWithFamily;
    h += '<div class="obs-share-row">';
    h += '<label class="obs-share-toggle"><input type="checkbox" id="share-toggle" ' + (isShared ? 'checked' : '') + ' data-action="toggleShare"> Share with family</label>';
    h += '<span class="obs-share-hint" id="share-hint"></span>';
    h += '</div>';
    h += '</div>';
    return h;
  }
```

- [ ] **Step 5: Insert renderCaptureConnection into the capture bar**

In the `render()` function, find where `renderCaptureSecondary()` is called (line 108). Change:

```javascript
    '</div>' + renderCaptureSecondary() + '</div>';
```

to:

```javascript
    '</div>' + renderCaptureSecondary() + renderCaptureConnection() + '</div>';
```

- [ ] **Step 6: Update share default when sentiment changes**

In the existing `toggleSentiment` function, after `activeSentiment = activeSentiment === val ? null : val;`, add:

```javascript
    activeSharedWithFamily = activeSentiment === 'strength';
```

- [ ] **Step 7: Wire submitOb to pass new fields**

In the `submitOb` function, find the line (around line 471):

```javascript
    selectedStudents.forEach(function(sid) { addQuickOb(activeCourse, sid, text, activeTags.slice(), activeSentiment, activeContext); });
```

Change to:

```javascript
    var connNote = (document.getElementById('connection-note-input') || {}).value || '';
    var shared = !!(document.getElementById('share-toggle') || {}).checked;
    selectedStudents.forEach(function(sid) { addQuickOb(activeCourse, sid, text, activeTags.slice(), activeSentiment, activeContext, null, activeConnectionTags.slice(), connNote, shared); });
```

Also reset the new state after submission. Find where `activeTags = []; activeSentiment = null; activeContext = null;` and add:

```javascript
    activeConnectionTags = []; activeConnectionNote = ''; activeSharedWithFamily = false;
```

- [ ] **Step 8: Add event handlers**

In the `handlers` object inside `_handleClick` (around line 574), add:

```javascript
      'toggleConnectionTag': function() { toggleConnectionTag(el.dataset.connTag); },
      'toggleShare':         function() { activeSharedWithFamily = el.checked; _showShareHint(); },
```

Add the share hint function:

```javascript
  function _showShareHint() {
    var hint = document.getElementById('share-hint');
    if (!hint) return;
    if (activeSharedWithFamily && activeSentiment && activeSentiment !== 'strength') {
      var count = parseInt(localStorage.getItem('td-share-hint-count') || '0', 10);
      if (count < 3) {
        hint.textContent = 'This observation will be visible to families. Consider strengths-first language.';
        hint.style.display = '';
        localStorage.setItem('td-share-hint-count', String(count + 1));
        setTimeout(function() { hint.textContent = ''; hint.style.display = 'none'; }, 4000);
      }
    } else {
      hint.textContent = ''; hint.style.display = 'none';
    }
  }
```

- [ ] **Step 9: Handle the checkbox change event**

The share toggle uses a checkbox `<input>`, which won't fire via `data-action` on click in the same way buttons do. Add a change listener in the render function, after `wireSearch();`:

```javascript
    var shareToggle = document.getElementById('share-toggle');
    if (shareToggle) shareToggle.addEventListener('change', function() {
      activeSharedWithFamily = this.checked;
      _showShareHint();
    });
```

Remove the `'toggleShare'` handler from the `handlers` object (it's handled by the change listener instead).

- [ ] **Step 10: Add CSS for connection section**

Append to `teacher/observations.css`:

```css
/* ── Connection tags ──────────────────────────────────── */
.obs-connection-section { padding: 6px 16px 10px; }
.obs-connection-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.obs-connection-label { font-size: 12px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 2px; }
.obs-connection-pill {
  font-size: 13px; padding: 4px 10px; border-radius: 99px;
  border: 1px solid var(--divider); background: var(--bg-2); color: var(--text-2);
  cursor: pointer; transition: all 0.15s;
}
.obs-connection-pill:hover { border-color: var(--text-3); }
.obs-connection-pill.active { background: #f5ebe0; border-color: #b08968; color: #6d4c2e; font-weight: 600; }
.obs-connection-note-wrap { padding: 6px 0 0; }
.obs-connection-note-input {
  width: 100%; padding: 6px 10px; font-size: 13px;
  border: 1px solid var(--divider); border-radius: var(--radius);
  background: var(--bg); color: var(--text);
}
.obs-connection-note-input:focus { border-color: var(--active); outline: none; }

/* ── Share toggle ─────────────────────────────────────── */
.obs-share-row { display: flex; align-items: center; gap: 8px; padding: 6px 0 0; }
.obs-share-toggle {
  font-size: 13px; color: var(--text-2); cursor: pointer;
  display: flex; align-items: center; gap: 6px;
}
.obs-share-toggle input[type="checkbox"] { accent-color: var(--active); }
.obs-share-hint {
  font-size: 12px; color: var(--score-2); font-style: italic;
  display: none;
}

/* ── Dark mode adjustments ────────────────────────────── */
[data-theme="dark"] .obs-connection-pill.active { background: #3d2e1f; border-color: #b08968; color: #ddb892; }
```

- [ ] **Step 11: Verify the capture bar renders without errors**

Run the app locally or run existing tests:

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
git add teacher/page-observations.js teacher/observations.css
git commit -m "feat: add connection tags, connection note, and share toggle to desktop observation capture"
```

---

### Task 5: Desktop observation feed — render new fields

**Files:**
- Modify: `teacher/page-observations.js` (renderFeedHtml function, lines 306-340)
- Modify: `teacher/observations.css`

- [ ] **Step 1: Add connection tags to feed cards**

In `renderFeedHtml`, find the section after the dims rendering (after line 333, after the `obs-card-dims` div closes). Add connection tag and note rendering. Find:

```javascript
        out += '</div>';
```

(the line that closes the `obs-card` div, around line 335). Before that closing `</div>`, add:

```javascript
        if (ob.connectionTags && ob.connectionTags.length > 0) {
          out += '<div class="obs-card-connections">';
          ob.connectionTags.forEach(function(ct) {
            var info = CONNECTION_TAGS[ct];
            if (info) out += '<span class="obs-card-conn-tag">' + info.icon + ' ' + esc(info.label) + '</span>';
          });
          out += '</div>';
        }
        if (ob.connectionNote) {
          out += '<div class="obs-card-conn-note">' + esc(ob.connectionNote) + '</div>';
        }
```

- [ ] **Step 2: Add shared indicator to card header**

In `renderFeedHtml`, find the delete button in the card header (line 328). Before the delete button, add a shared indicator:

Find the pattern:
```javascript
'<button class="obs-card-delete"
```

Insert before it:
```javascript
(ob.sharedWithFamily ? '<span class="obs-card-shared" title="Shared with family">👨‍👩‍👧</span>' : '') +
```

- [ ] **Step 3: Add CSS for feed card additions**

Append to `teacher/observations.css`:

```css
/* ── Connection tags in feed cards ────────────────────── */
.obs-card-connections { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.obs-card-conn-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 99px;
  background: #f5ebe0; color: #6d4c2e; white-space: nowrap;
}
[data-theme="dark"] .obs-card-conn-tag { background: #3d2e1f; color: #ddb892; }
.obs-card-conn-note { font-size: 12px; color: var(--text-2); font-style: italic; margin-top: 4px; }
.obs-card-shared { font-size: 13px; margin-right: 4px; opacity: 0.7; }
```

- [ ] **Step 4: Verify visually and run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add teacher/page-observations.js teacher/observations.css
git commit -m "feat: render connection tags, notes, and shared indicator in desktop observation feed"
```

---

### Task 6: Desktop student detail — Family Context card

**Files:**
- Modify: `teacher/ui.js:102-239` (renderStudentHeader)
- Modify: `teacher/styles.css`

- [ ] **Step 1: Add renderFamilyContext function**

In `teacher/ui.js`, before the `renderStudentHeader` function (before line 102), add:

```javascript
/* ── Family & Community Context card ───────────────────── */
function renderFamilyContext(cid, sid) {
  const students = getStudents(cid);
  const student = students.find(s => s.id === sid);
  if (!student) return '';

  const notes = student.familyContext || [];
  let html = '<div class="family-context-card">';
  html += '<div class="fc-header"><span class="fc-title">Family & Community Context</span>';
  html += '<button class="fc-add-btn" data-action="addFamilyContext" data-sid="' + sid + '" aria-label="Add family context note">+ Add</button></div>';

  if (notes.length === 0) {
    html += '<div class="fc-empty">No family context notes yet. Add what you know about this student\u2019s family, community, and interests.</div>';
  } else {
    notes.forEach(function(n) {
      var timeStr = new Date(n.updated || n.created).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
      html += '<div class="fc-note" data-note-id="' + n.id + '">' +
        '<div class="fc-note-text">' + esc(n.text) + '</div>' +
        '<div class="fc-note-meta">' +
          '<span class="fc-note-time">' + timeStr + '</span>' +
          '<button class="fc-note-edit" data-action="editFamilyContext" data-sid="' + sid + '" data-note-id="' + n.id + '" title="Edit">✎</button>' +
          '<button class="fc-note-delete" data-action="deleteFamilyContext" data-sid="' + sid + '" data-note-id="' + n.id + '" title="Delete">🗑</button>' +
        '</div></div>';
    });
  }

  html += '</div>';
  return html;
}
```

- [ ] **Step 2: Insert Family Context into renderStudentHeader**

In `renderStudentHeader`, find the end (line 238):

```javascript
  html += `</div>`; // end student-header-top
  return html;
```

Change to:

```javascript
  html += `</div>`; // end student-header-top
  html += renderFamilyContext(cid, sid);
  return html;
```

- [ ] **Step 3: Export renderFamilyContext**

Add `renderFamilyContext` to the window exports at the bottom of `ui.js`.

- [ ] **Step 4: Wire event handlers for Family Context CRUD**

Find the main click handler in the page that renders the student header (likely in `teacher/page-gradebook.js` or the main page module that uses `renderStudentHeader`). The Family Context buttons use `data-action` attributes that need handlers. Add handlers in the appropriate page's click delegation:

```javascript
'addFamilyContext': function() {
  var sid = el.dataset.sid;
  var text = prompt('Add a family/community context note:');
  if (text && text.trim()) {
    addFamilyContext(activeCourse, sid, text);
    render();
  }
},
'editFamilyContext': function() {
  var sid = el.dataset.sid;
  var noteId = el.dataset.noteId;
  var students = getStudents(activeCourse);
  var st = students.find(function(s) { return s.id === sid; });
  var note = st && st.familyContext ? st.familyContext.find(function(n) { return n.id === noteId; }) : null;
  var text = prompt('Edit note:', note ? note.text : '');
  if (text !== null && text.trim()) {
    updateFamilyContext(activeCourse, sid, noteId, text);
    render();
  }
},
'deleteFamilyContext': function() {
  var sid = el.dataset.sid;
  var noteId = el.dataset.noteId;
  if (confirm('Delete this family context note?')) {
    deleteFamilyContext(activeCourse, sid, noteId);
    render();
  }
},
```

Note: Find which file handles click delegation for the student detail view (check `teacher/page-gradebook.js` or `teacher/page-student.js`) and add the handlers there. These handlers use `prompt()` and `confirm()` for simplicity — matching the existing pattern for quick inline edits. A future iteration could use the app's `showConfirm()` modal.

- [ ] **Step 5: Add CSS for Family Context card**

Append to `teacher/styles.css`:

```css
/* ── Family & Community Context ───────────────────────── */
.family-context-card {
  margin: 12px 0; padding: 12px 16px;
  background: var(--bg-2); border-radius: var(--radius);
  border: 1px solid var(--divider);
}
.fc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.fc-title { font-size: 13px; font-weight: 600; color: var(--text); text-transform: uppercase; letter-spacing: 0.5px; }
.fc-add-btn {
  font-size: 12px; padding: 4px 10px; border-radius: 99px;
  border: 1px solid var(--active); color: var(--active); background: transparent;
  cursor: pointer;
}
.fc-add-btn:hover { background: var(--active-light); }
.fc-empty { font-size: 13px; color: var(--text-3); font-style: italic; padding: 8px 0; }
.fc-note { padding: 8px 0; border-bottom: 1px solid var(--divider-subtle); }
.fc-note:last-child { border-bottom: none; }
.fc-note-text { font-size: 13px; color: var(--text); line-height: 1.4; }
.fc-note-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.fc-note-time { font-size: 11px; color: var(--text-3); }
.fc-note-edit, .fc-note-delete {
  font-size: 12px; border: none; background: transparent;
  color: var(--text-3); cursor: pointer; padding: 2px 4px;
  opacity: 0; transition: opacity 0.15s;
}
.fc-note:hover .fc-note-edit,
.fc-note:hover .fc-note-delete { opacity: 1; }
.fc-note-delete:hover { color: var(--score-1); }
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add teacher/ui.js teacher/styles.css
git commit -m "feat: add Family & Community Context card to desktop student detail"
```

---

### Task 7: Mobile observation capture — connection tags & share toggle

**Files:**
- Modify: `teacher-mobile/tab-observe.js`
- Modify: `teacher-mobile/styles.css`

- [ ] **Step 1: Read the mobile capture UI code**

Read `teacher-mobile/tab-observe.js` to find the exact location of the mobile observation creation sheet/form. Locate:
- Where sentiment pills are rendered
- Where the submit handler is
- Where dims/tags are rendered

The mobile capture uses a different pattern than desktop — likely a bottom sheet with form elements.

- [ ] **Step 2: Add connection tag pills to mobile capture**

In the mobile observation creation sheet, after the dimension tag pills, add a connection tag section. Follow the exact pattern used for dimension pills (horizontal scrollable row):

```javascript
// Connection tags
h += '<div class="m-obs-conn-tags">';
h += '<div class="m-obs-section-label">Connection</div>';
h += '<div class="m-obs-conn-row">';
Object.keys(CONNECTION_TAGS).forEach(function(key) {
  var t = CONNECTION_TAGS[key];
  h += '<button class="m-obs-conn-pill' + (activeConnectionTags.indexOf(key) >= 0 ? ' active' : '') + '" data-action="m-obs-toggle-conn" data-conn-tag="' + key + '">' + t.icon + ' ' + t.label + '</button>';
});
h += '</div></div>';
// Connection note (shown when tags selected)
h += '<div class="m-obs-conn-note-wrap" id="m-conn-note-wrap" style="' + (activeConnectionTags.length > 0 ? '' : 'display:none') + '">';
h += '<input class="m-obs-conn-note" id="m-conn-note" type="text" placeholder="Briefly, what\u2019s the connection?" autocomplete="off">';
h += '</div>';
// Share toggle
h += '<label class="m-obs-share-toggle"><input type="checkbox" id="m-share-toggle" ' + (activeSharedWithFamily ? 'checked' : '') + '> Share with family</label>';
```

- [ ] **Step 3: Add state variables and toggle handler**

Add module-level state (if not already via a shared pattern):

```javascript
var activeConnectionTags = [];
var activeSharedWithFamily = false;
```

Add handler in the mobile click delegation:

```javascript
'm-obs-toggle-conn': function() {
  var key = el.dataset.connTag;
  var idx = activeConnectionTags.indexOf(key);
  if (idx >= 0) activeConnectionTags.splice(idx, 1);
  else activeConnectionTags.push(key);
  el.classList.toggle('active');
  var noteWrap = document.getElementById('m-conn-note-wrap');
  if (noteWrap) noteWrap.style.display = activeConnectionTags.length > 0 ? '' : 'none';
},
```

Wire share checkbox via change listener after rendering:

```javascript
var mShareToggle = document.getElementById('m-share-toggle');
if (mShareToggle) mShareToggle.addEventListener('change', function() {
  activeSharedWithFamily = this.checked;
});
```

- [ ] **Step 4: Update mobile sentiment toggle to set share default**

When sentiment changes on mobile, update the share default:

```javascript
activeSharedWithFamily = (sentiment === 'strength');
var mShareToggle = document.getElementById('m-share-toggle');
if (mShareToggle) mShareToggle.checked = activeSharedWithFamily;
```

- [ ] **Step 5: Pass new fields through mobile submit**

Find the mobile observation submit handler and add:

```javascript
var connNote = (document.getElementById('m-conn-note') || {}).value || '';
var shared = (document.getElementById('m-share-toggle') || {}).checked || false;
```

Pass `activeConnectionTags.slice()` and `connNote` as the new arguments to `addQuickOb`. Reset state after submit:

```javascript
activeConnectionTags = []; activeSharedWithFamily = false;
```

- [ ] **Step 6: Add mobile CSS**

Append to `teacher-mobile/styles.css`:

```css
/* ── Connection tags (mobile) ─────────────────────────── */
.m-obs-conn-tags { padding: 8px 16px 0; }
.m-obs-section-label { font-size: 11px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.m-obs-conn-row { display: flex; gap: 6px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
.m-obs-conn-pill {
  font-size: 13px; padding: 6px 12px; border-radius: 99px; white-space: nowrap;
  border: 1px solid var(--divider); background: var(--bg-2); color: var(--text-2);
  cursor: pointer; flex-shrink: 0;
}
.m-obs-conn-pill.active { background: #f5ebe0; border-color: #b08968; color: #6d4c2e; font-weight: 600; }
[data-theme="dark"] .m-obs-conn-pill.active { background: #3d2e1f; border-color: #b08968; color: #ddb892; }
.m-obs-conn-note-wrap { padding: 8px 16px 0; }
.m-obs-conn-note {
  width: 100%; padding: 8px 12px; font-size: 14px;
  border: 1px solid var(--divider); border-radius: var(--radius);
  background: var(--bg); color: var(--text);
}
.m-obs-share-toggle {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text-2); padding: 10px 16px 0;
  cursor: pointer;
}
.m-obs-share-toggle input[type="checkbox"] { accent-color: var(--active); width: 18px; height: 18px; }
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add teacher-mobile/tab-observe.js teacher-mobile/styles.css
git commit -m "feat: add connection tags, note, and share toggle to mobile observation capture"
```

---

### Task 8: Mobile observation feed — render new fields

**Files:**
- Modify: `teacher-mobile/tab-observe.js` (card rendering, lines 52-124)
- Modify: `teacher-mobile/styles.css`

- [ ] **Step 1: Add connection tags to mobile feed cards**

In `_renderObsCards`, find where `tagChips` are rendered (around line 95-100). After the existing tag chips, add connection tag rendering:

```javascript
var connChips = '';
if (ob.connectionTags && ob.connectionTags.length) {
  ob.connectionTags.forEach(function(ct) {
    var info = CONNECTION_TAGS[ct];
    if (info) connChips += '<span class="m-obs-conn-chip">' + info.icon + ' ' + MC.esc(info.label) + '</span>';
  });
}
```

In the card HTML, after the existing `tagChips` line:

```javascript
(tagChips ? '<div class="m-obs-tags m-post-tags">' + tagChips + '</div>' : '') +
```

Add:

```javascript
(connChips ? '<div class="m-obs-conn-chips">' + connChips + '</div>' : '') +
(ob.connectionNote ? '<div class="m-obs-conn-note-text">' + MC.esc(ob.connectionNote) + '</div>' : '') +
```

- [ ] **Step 2: Add shared indicator to mobile card header**

In the mobile card header, near the sentiment icon, add:

```javascript
(ob.sharedWithFamily ? '<span class="m-obs-shared-icon" title="Shared with family">👨‍👩‍👧</span>' : '') +
```

- [ ] **Step 3: Add mobile CSS for feed additions**

Append to `teacher-mobile/styles.css`:

```css
/* ── Connection chips in feed ─────────────────────────── */
.m-obs-conn-chips { display: flex; gap: 4px; flex-wrap: wrap; padding: 4px 0 0; }
.m-obs-conn-chip {
  font-size: 11px; padding: 2px 8px; border-radius: 99px;
  background: #f5ebe0; color: #6d4c2e;
}
[data-theme="dark"] .m-obs-conn-chip { background: #3d2e1f; color: #ddb892; }
.m-obs-conn-note-text { font-size: 12px; color: var(--text-2); font-style: italic; padding: 2px 0 0; }
.m-obs-shared-icon { font-size: 12px; opacity: 0.6; margin-left: 4px; }
```

- [ ] **Step 4: Also render new fields in the student detail observations**

In `teacher-mobile/tab-students.js`, find the recent observations section (around line 442-461). After the existing `tagChips` rendering, add the same connection tag and note rendering:

```javascript
        var connChips = '';
        if (ob.connectionTags && ob.connectionTags.length) {
          ob.connectionTags.forEach(function(ct) {
            var info = CONNECTION_TAGS[ct];
            if (info) connChips += '<span class="m-obs-conn-chip">' + info.icon + ' ' + MC.esc(info.label) + '</span>';
          });
        }
```

And in the card HTML, after `(tagChips ? ... : '')`:

```javascript
          (connChips ? '<div class="m-obs-conn-chips">' + connChips + '</div>' : '') +
          (ob.connectionNote ? '<div class="m-obs-conn-note-text">' + MC.esc(ob.connectionNote) + '</div>' : '') +
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add teacher-mobile/tab-observe.js teacher-mobile/tab-students.js teacher-mobile/styles.css
git commit -m "feat: render connection tags, notes, and shared indicator in mobile observation feed"
```

---

### Task 9: Mobile student detail — Family Context section

**Files:**
- Modify: `teacher-mobile/tab-students.js` (student detail rendering)
- Modify: `teacher-mobile/styles.css`

- [ ] **Step 1: Add Family Context section to mobile student detail**

In `teacher-mobile/tab-students.js`, find where the student detail screen is assembled (around line 465-474). Insert the Family Context section between the hero/stats and the sections. Find:

```javascript
        hero + stats +
        focusHTML +
```

Change to:

```javascript
        hero + stats +
        _renderMobileFamilyContext(cid, sid, st) +
        focusHTML +
```

- [ ] **Step 2: Implement _renderMobileFamilyContext**

Add this function inside the tab-students module:

```javascript
  function _renderMobileFamilyContext(cid, sid, st) {
    var notes = st.familyContext || [];
    var h = '<div class="m-list-inset-header">Family & Community Context' +
      '<button class="m-fc-add" data-action="m-fc-add" data-sid="' + sid + '">+ Add</button></div>';
    if (notes.length === 0) {
      h += '<div class="m-fc-empty">No family context notes yet. Add what you know about this student\u2019s family, community, and interests.</div>';
    } else {
      notes.forEach(function(n) {
        var timeStr = new Date(n.updated || n.created).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        h += '<div class="m-fc-note">' +
          '<div class="m-fc-note-text">' + MC.esc(n.text) + '</div>' +
          '<div class="m-fc-note-meta">' +
            '<span class="m-fc-note-time">' + timeStr + '</span>' +
            '<button class="m-fc-note-edit" data-action="m-fc-edit" data-sid="' + sid + '" data-note-id="' + n.id + '">✎</button>' +
            '<button class="m-fc-note-delete" data-action="m-fc-delete" data-sid="' + sid + '" data-note-id="' + n.id + '">&times;</button>' +
          '</div></div>';
      });
    }
    return h;
  }
```

- [ ] **Step 3: Wire mobile Family Context event handlers**

In the mobile click handler (in `tab-students.js` or `shell.js`, wherever student detail actions are handled), add:

```javascript
'm-fc-add': function() {
  var sid = el.dataset.sid;
  var text = prompt('Add a family/community context note:');
  if (text && text.trim()) {
    addFamilyContext(activeCid, sid, text);
    _refreshStudentDetail(sid);
  }
},
'm-fc-edit': function() {
  var sid = el.dataset.sid;
  var noteId = el.dataset.noteId;
  var students = getStudents(activeCid);
  var st = students.find(function(s) { return s.id === sid; });
  var note = st && st.familyContext ? st.familyContext.find(function(n) { return n.id === noteId; }) : null;
  var text = prompt('Edit note:', note ? note.text : '');
  if (text !== null && text.trim()) {
    updateFamilyContext(activeCid, sid, noteId, text);
    _refreshStudentDetail(sid);
  }
},
'm-fc-delete': function() {
  var sid = el.dataset.sid;
  var noteId = el.dataset.noteId;
  if (confirm('Delete this family context note?')) {
    deleteFamilyContext(activeCid, sid, noteId);
    _refreshStudentDetail(sid);
  }
},
```

Note: `_refreshStudentDetail` should re-render the student detail sheet. Check what function the mobile app uses to re-render the current student detail view and use that.

- [ ] **Step 4: Add mobile CSS for Family Context**

Append to `teacher-mobile/styles.css`:

```css
/* ── Family Context (mobile) ──────────────────────────── */
.m-fc-add {
  float: right; font-size: 12px; padding: 2px 10px; border-radius: 99px;
  border: 1px solid var(--active); color: var(--active); background: transparent;
}
.m-fc-empty { font-size: 13px; color: var(--text-3); font-style: italic; padding: 8px 16px 16px; }
.m-fc-note { padding: 8px 16px; border-bottom: 1px solid var(--divider-subtle); }
.m-fc-note:last-child { border-bottom: none; }
.m-fc-note-text { font-size: 14px; color: var(--text); line-height: 1.4; }
.m-fc-note-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.m-fc-note-time { font-size: 11px; color: var(--text-3); flex: 1; }
.m-fc-note-edit, .m-fc-note-delete {
  font-size: 14px; border: none; background: transparent;
  color: var(--text-3); padding: 4px 8px; min-height: 44px; min-width: 44px;
  display: flex; align-items: center; justify-content: center;
}
.m-fc-note-delete:active { color: var(--score-1); }
```

Note: Mobile edit/delete buttons have `min-height: 44px; min-width: 44px` to meet Apple HIG touch target requirements.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add teacher-mobile/tab-students.js teacher-mobile/styles.css
git commit -m "feat: add Family & Community Context section to mobile student detail"
```

---

### Task 10: Share toggle behaviour — sentiment change interaction

**Files:**
- Modify: `teacher/page-observations.js`
- Test: `tests/data-observations.test.js`

- [ ] **Step 1: Write test for sentiment-change share flip**

Add to `tests/data-observations.test.js`:

```javascript
describe('sharedWithFamily sentiment interaction', () => {
  it('changing sentiment from strength to concern flips sharedWithFamily off', () => {
    saveQuickObs(CID, { stu1: [{
      id: 'ob1', text: 'test', created: '2025-01-01T10:00:00Z',
      sentiment: 'strength', sharedWithFamily: true
    }]});
    updateQuickOb(CID, 'stu1', 'ob1', { sentiment: 'concern', sharedWithFamily: false });
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sharedWithFamily).toBe(false);
  });

  it('editing text on shared observation keeps it shared', () => {
    saveQuickObs(CID, { stu1: [{
      id: 'ob1', text: 'original', created: '2025-01-01T10:00:00Z',
      sentiment: 'strength', sharedWithFamily: true
    }]});
    updateQuickOb(CID, 'stu1', 'ob1', { text: 'edited' });
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sharedWithFamily).toBe(true);
    expect(obs[0].text).toBe('edited');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

These tests should already pass since `updateQuickOb` handles `sharedWithFamily` from Task 2. Verify:

Run: `npx vitest run tests/data-observations.test.js --reporter=verbose 2>&1 | tail -15`

Expected: All tests PASS.

- [ ] **Step 3: Handle sentiment change in desktop edit flow (if edit exists)**

Check if the desktop observation page has an edit flow. If observations can be edited inline (not just deleted), ensure that when sentiment changes on an existing shared observation, `sharedWithFamily` is set to `false` and a toast is shown:

```javascript
// In the edit handler, after sentiment change:
if (oldSentiment === 'strength' && newSentiment !== 'strength' && ob.sharedWithFamily) {
  updates.sharedWithFamily = false;
  showSyncToast('Sharing turned off — sentiment changed.', 'info');
}
```

If no edit flow exists for changing sentiment on existing observations, skip this step — it will only matter when editing is built.

- [ ] **Step 4: Commit**

```bash
git add tests/data-observations.test.js teacher/page-observations.js
git commit -m "test: add share toggle behaviour tests for sentiment changes"
```

---

### Task 11: Supabase schema migration

**Files:**
- Modify: `schema.sql` (or create a migration file)

- [ ] **Step 1: Add new columns to observations table**

Create a migration that adds the three new columns to the `observations` table in Supabase:

```sql
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS connection_tags jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS connection_note text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shared_with_family boolean DEFAULT false;
```

No new table needed for `familyContext` — it's stored as part of the `students` JSONB bulk sync.

- [ ] **Step 2: Run the migration**

Apply via Supabase dashboard or CLI. Verify columns exist:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'observations' AND column_name IN ('connection_tags', 'connection_note', 'shared_with_family');
```

Expected: 3 rows returned.

- [ ] **Step 3: Update schema.sql to document the new columns**

If `schema.sql` is the canonical DDL, add the columns to the `observations` CREATE TABLE statement with comments.

- [ ] **Step 4: Commit**

```bash
git add schema.sql
git commit -m "feat: add connection_tags, connection_note, shared_with_family to observations schema"
```

---

### Task 12: Final integration test & cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -10`

Expected: All tests pass, including new tests from Tasks 2, 3, and 10.

- [ ] **Step 2: Verify no console errors in desktop**

Open the app in a browser, navigate to Observations page. Open DevTools console. Verify no errors. Create an observation with connection tags and share toggle. Verify it appears in the feed with connection pills and shared indicator.

- [ ] **Step 3: Verify mobile**

Open the app at mobile width (375px) or on a phone. Navigate to Observe tab. Create an observation with connection tags. Navigate to Students tab, open a student, verify Family Context section appears with empty state. Add a note, verify it persists.

- [ ] **Step 4: Bump service worker cache version**

In `sw.js`, find the cache version constant and increment it so returning users get the new code:

```javascript
const CACHE_VERSION = 'v22'; // was v21
```

- [ ] **Step 5: Commit**

```bash
git add sw.js
git commit -m "fix: bump SW cache v22 for family-centered observations feature"
```
