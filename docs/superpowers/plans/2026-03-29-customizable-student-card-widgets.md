# Customizable Student Card Widgets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable, reorderable widget system to the mobile student card, surfacing questionnaire data (dispositions, traits, reflections) alongside academic metrics, with long-press edit mode.

**Architecture:** Card rendering is refactored from a monolithic `_renderStudentCard()` function into a registry of widget render functions. A config object (ordered array of enabled widget keys) drives layout. The config is persisted globally in localStorage. Long-press on the card opens an editor sheet for toggling and reordering widgets.

**Tech Stack:** Vanilla JS (no frameworks), CSS variables, localStorage, existing MComponents sheet system, existing MCardStack swipe system, SVG for petal chart, Vitest for tests.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `shared/constants.js` | Add `SOCIAL_TRAITS` array (moved from desktop-only report-questionnaire.js), add `WIDGET_REGISTRY` constant |
| `shared/data.js` | Add `getCardWidgetConfig()` / `saveCardWidgetConfig()` helpers |
| `teacher-mobile/card-widgets.js` | New file: widget render functions (one per widget), config loader, petal SVG generator |
| `teacher-mobile/card-widget-editor.js` | New file: edit mode sheet — toggle/reorder UI, drag-to-reorder touch handling |
| `teacher-mobile/tab-students.js` | Refactor `_renderStudentCard()` to use widget system, add long-press handler |
| `teacher-mobile/styles.css` | Widget-specific styles, editor sheet styles, scroll indicator |
| `teacher-mobile/index.html` | No changes needed (sheet DOM anchors already exist) |
| `tests/mobile-card-widgets.test.js` | New file: tests for widget rendering and config |
| `tests/mobile-card-widget-editor.test.js` | New file: tests for editor logic |

---

## Task 1: Widget Config Data Layer

**Files:**
- Modify: `shared/data.js:2554` (before Namespace section)
- Modify: `shared/constants.js:157` (add WIDGET_REGISTRY after OBS_DIMS)
- Create: `tests/mobile-card-widgets.test.js`

- [ ] **Step 1: Write the failing test for config read/write**

In `tests/mobile-card-widgets.test.js`:

```javascript
import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Card Widget Config', () => {
  beforeEach(() => {
    localStorage.clear();
    if (typeof _cache !== 'undefined') {
      // Clear any cached widget config
      delete _cache.cardWidgets;
    }
  });

  it('returns default config when no localStorage entry exists', () => {
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'sectionBars', 'obsSnippet', 'actions']);
    expect(config.disabled).toContain('completion');
    expect(config.disabled).toContain('dispositions');
    expect(config.disabled).toContain('narrative');
    expect(config.disabled.length).toBe(12);
  });

  it('reads saved config from localStorage', () => {
    var custom = {
      order: ['hero', 'completion', 'actions'],
      disabled: ['sectionBars', 'obsSnippet', 'missingWork', 'growth', 'obsSummary',
                 'flagStatus', 'reflection', 'dispositions', 'traits', 'concerns',
                 'workHabits', 'growthAreas', 'narrative']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(custom));
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'completion', 'actions']);
  });

  it('saves config to localStorage', () => {
    var config = {
      order: ['hero', 'sectionBars', 'completion', 'obsSnippet', 'actions'],
      disabled: ['missingWork', 'growth', 'obsSummary', 'flagStatus', 'reflection',
                 'dispositions', 'traits', 'concerns', 'workHabits', 'growthAreas', 'narrative']
    };
    saveCardWidgetConfig(config);
    var raw = JSON.parse(localStorage.getItem('m-card-widgets'));
    expect(raw.order).toEqual(config.order);
  });

  it('handles new widgets added in future releases', () => {
    // Simulate old config missing a widget key
    var old = {
      order: ['hero', 'sectionBars', 'obsSnippet', 'actions'],
      disabled: ['completion', 'missingWork']
      // Missing: growth, obsSummary, flagStatus, reflection, dispositions, traits, concerns, workHabits, growthAreas, narrative
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(old));
    var config = getCardWidgetConfig();
    // Missing keys should appear in disabled
    expect(config.disabled).toContain('growth');
    expect(config.disabled).toContain('dispositions');
    expect(config.disabled).toContain('narrative');
  });

  it('ignores unknown widget keys in localStorage', () => {
    var bad = {
      order: ['hero', 'unknownWidget', 'actions'],
      disabled: ['sectionBars']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(bad));
    var config = getCardWidgetConfig();
    expect(config.order).not.toContain('unknownWidget');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: FAIL — `getCardWidgetConfig` is not defined

- [ ] **Step 3: Add WIDGET_REGISTRY to constants.js**

In `shared/constants.js`, after the `OBS_CONTEXTS` block (~line 184), add:

```javascript
/* ── Card Widget Registry ─────────────────────────────────── */
const WIDGET_REGISTRY = [
  { key: 'hero',         label: 'Name & Proficiency',         defaultOn: true },
  { key: 'sectionBars',  label: 'Section Progress',           defaultOn: true },
  { key: 'completion',   label: 'Completion',                 defaultOn: false },
  { key: 'missingWork',  label: 'Missing Work',               defaultOn: false },
  { key: 'growth',       label: 'Growth Journey',             defaultOn: false },
  { key: 'obsSnippet',   label: 'Latest Observation',         defaultOn: true },
  { key: 'obsSummary',   label: 'Observation Insights',       defaultOn: false },
  { key: 'flagStatus',   label: 'Flag',                       defaultOn: false },
  { key: 'reflection',   label: 'Student Voice',              defaultOn: false },
  { key: 'dispositions', label: 'Learner Dispositions',       defaultOn: false },
  { key: 'traits',       label: 'Character Strengths',        defaultOn: false },
  { key: 'concerns',     label: 'Concerns',                   defaultOn: false },
  { key: 'workHabits',   label: 'Work Habits & Participation',defaultOn: false },
  { key: 'growthAreas',  label: 'Growth Areas',               defaultOn: false },
  { key: 'narrative',    label: 'Teacher Narrative',           defaultOn: false },
  { key: 'actions',      label: 'Action Buttons',             defaultOn: true },
];
const WIDGET_KEYS = WIDGET_REGISTRY.map(function(w) { return w.key; });
```

- [ ] **Step 4: Add SOCIAL_TRAITS to constants.js**

In `shared/constants.js`, after `WIDGET_KEYS`, add:

```javascript
/* ── Social / Character Traits ────────────────────────────── */
const SOCIAL_TRAITS_POSITIVE = [
  {id:'leader', label:'Leader'}, {id:'collaborative', label:'Collaborative'},
  {id:'independent', label:'Independent'}, {id:'peer-mentor', label:'Peer Mentor'},
  {id:'risk-taker', label:'Risk Taker'}, {id:'reflective', label:'Reflective'},
  {id:'creative', label:'Creative Thinker'}, {id:'persistent', label:'Persistent'},
  {id:'organized', label:'Organized'}, {id:'empathetic', label:'Empathetic'},
  {id:'curious', label:'Curious'}, {id:'respectful', label:'Respectful'},
  {id:'positive-attitude', label:'Positive Attitude'}, {id:'detail-oriented', label:'Detail-Oriented'},
  {id:'advocate', label:'Self-Advocate'}
];
const SOCIAL_TRAITS_CONCERN = [
  {id:'needs-support', label:'Needs Support'}, {id:'often-late', label:'Often Late'},
  {id:'device-issue', label:'Device Issue'}, {id:'reminders-focus', label:'Reminders to Focus'},
  {id:'often-absent', label:'Often Absent'}, {id:'incomplete-work', label:'Incomplete Work'},
  {id:'disorganized', label:'Disorganized'}, {id:'off-task', label:'Off-Task Behaviour'},
  {id:'social-conflicts', label:'Social Conflicts'}, {id:'low-confidence', label:'Low Confidence'},
  {id:'avoids-challenges', label:'Avoids Challenges'}, {id:'rushed-work', label:'Rushes Work'}
];
const SOCIAL_TRAITS_POSITIVE_IDS = new Set(SOCIAL_TRAITS_POSITIVE.map(function(t) { return t.id; }));
const SOCIAL_TRAITS_CONCERN_IDS = new Set(SOCIAL_TRAITS_CONCERN.map(function(t) { return t.id; }));
```

- [ ] **Step 5: Add getCardWidgetConfig / saveCardWidgetConfig to data.js**

In `shared/data.js`, before the `/* ── Namespace ──` section (~line 2554), add:

```javascript
/* ── Card Widget Config ───────────────────────────────────── */
function _defaultWidgetConfig() {
  var order = [];
  var disabled = [];
  WIDGET_REGISTRY.forEach(function(w) {
    if (w.defaultOn) order.push(w.key);
    else disabled.push(w.key);
  });
  return { order: order, disabled: disabled };
}

function getCardWidgetConfig() {
  var raw = _safeParseLS('m-card-widgets', null);
  if (!raw || !Array.isArray(raw.order)) return _defaultWidgetConfig();

  // Filter out unknown keys
  var validKeys = new Set(WIDGET_KEYS);
  var order = raw.order.filter(function(k) { return validKeys.has(k); });
  var disabled = Array.isArray(raw.disabled)
    ? raw.disabled.filter(function(k) { return validKeys.has(k); })
    : [];

  // Find any registry keys missing from both arrays (future-proofing)
  var present = new Set(order.concat(disabled));
  WIDGET_KEYS.forEach(function(k) {
    if (!present.has(k)) disabled.push(k);
  });

  return { order: order, disabled: disabled };
}

function saveCardWidgetConfig(config) {
  _safeLSSet('m-card-widgets', JSON.stringify(config));
}
```

Also add `getCardWidgetConfig` and `saveCardWidgetConfig` to the `window.GB` namespace or make them global (same pattern as other data functions in this file — they are already global via `function` declaration).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: All 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add shared/constants.js shared/data.js tests/mobile-card-widgets.test.js
git commit -m "feat: add widget config data layer and registry constants"
```

---

## Task 2: Core Widget Render Functions (Existing Widgets)

**Files:**
- Create: `teacher-mobile/card-widgets.js`
- Modify: `tests/mobile-card-widgets.test.js`

- [ ] **Step 1: Write failing tests for existing widget renderers**

Append to `tests/mobile-card-widgets.test.js`:

```javascript
import '../tests/setup-mobile.js';

// Load the new module
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);
const root2 = resolve(__dirname2, '..');
function load(file) {
  const code = readFileSync(resolve(root2, file), 'utf-8');
  runInThisContext(code, { filename: file });
}

describe('Widget Renderers — Existing', () => {
  var MC, st, cid;

  beforeEach(() => {
    localStorage.clear();
    MC = window.MComponents;
    cid = 'course-1';
    st = { id: 's1', firstName: 'Cece', lastName: 'Adams', pronouns: 'she/her', designations: [] };
  });

  it('hero renders avatar, name, pronouns, and proficiency', () => {
    // Seed a score so proficiency > 0
    localStorage.setItem('gb-scores-course-1', JSON.stringify({
      s1: [{ tagId: 't1', assessmentId: 'a1', score: 3, type: 'summative', date: '2026-03-01' }]
    }));
    if (_cache.scores) delete _cache.scores['course-1'];

    var html = MCardWidgets.render('hero', st, cid, {});
    expect(html).toContain('Cece');
    expect(html).toContain('she/her');
    expect(html).toContain('m-scard-prof');
  });

  it('hero fallback renders minimal name when toggled off', () => {
    var html = MCardWidgets.renderFallbackHero(st);
    expect(html).toContain('Cece');
    expect(html).toContain('m-scard-hero-min');
    expect(html).not.toContain('m-scard-prof');
  });

  it('sectionBars renders one row per section', () => {
    var data = { sections: [
      { id: 'sec1', name: 'Questioning', color: '#4A90D9' },
      { id: 'sec2', name: 'Planning', color: '#50C878' }
    ]};
    var html = MCardWidgets.render('sectionBars', st, cid, data);
    expect(html).toContain('Questioning');
    expect(html).toContain('Planning');
    expect(html).toContain('m-scard-sec-row');
  });

  it('obsSnippet renders observation text', () => {
    localStorage.setItem('gb-quickobs-course-1', JSON.stringify({
      s1: [{ text: 'Volunteered to share results', created: new Date().toISOString(), sentiment: 'strength' }]
    }));
    if (_cache.quickObs) delete _cache.quickObs['course-1'];

    var html = MCardWidgets.render('obsSnippet', st, cid, {});
    expect(html).toContain('Volunteered');
    expect(html).toContain('m-scard-obs');
  });

  it('obsSnippet shows empty state when no observations', () => {
    var html = MCardWidgets.render('obsSnippet', st, cid, {});
    expect(html).toContain('No observations yet');
  });

  it('actions renders Observe and View Profile buttons', () => {
    var html = MCardWidgets.render('actions', st, cid, {});
    expect(html).toContain('Observe');
    expect(html).toContain('View Profile');
    expect(html).toContain('data-sid="s1"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: FAIL — `MCardWidgets` is not defined

- [ ] **Step 3: Create card-widgets.js with existing widget renderers**

Create `teacher-mobile/card-widgets.js`:

```javascript
/* card-widgets.js — Widget render functions for student card */

window.MCardWidgets = (function() {
  'use strict';

  var MC = window.MComponents;
  var MAX_PROF = 4;

  /* ── Widget render registry ─────────────────────────────── */
  var _renderers = {};

  function render(key, st, cid, data) {
    var fn = _renderers[key];
    if (!fn) return '';
    return fn(st, cid, data);
  }

  /* ── Shared badge helper ────────────────────────────────── */
  function _renderBadges(st) {
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function(code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += '<span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += '<span class="m-badge m-badge-mod">MOD</span>';
      });
    }
    return badges;
  }

  /* ── hero ────────────────────────────────────────────────── */
  _renderers.hero = function(st, cid, data) {
    var overall = getOverallProficiency(cid, st.id);
    var rounded = Math.round(overall);
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    var badges = _renderBadges(st);

    // Flag icon if flagStatus widget is enabled
    var config = getCardWidgetConfig();
    var flagOn = config.order.indexOf('flagStatus') >= 0;
    var flagIcon = '';
    if (flagOn && isStudentFlagged(cid, st.id)) {
      flagIcon = '<span class="m-scard-flag" title="Flagged">&#9873;</span>';
    }

    return '<div class="m-scard-hero">' +
      '<div class="m-scard-avatar" style="background:' + color + '">' + initials + '</div>' +
      '<div class="m-scard-info">' +
        '<div class="m-scard-name">' + MC.esc(name) + '</div>' +
        (st.pronouns ? '<div class="m-scard-sub">' + MC.esc(st.pronouns) + '</div>' : '') +
        (badges ? '<div class="m-scard-badges">' + badges + flagIcon + '</div>' : (flagIcon ? '<div class="m-scard-badges">' + flagIcon + '</div>' : '')) +
      '</div>' +
      '<div class="m-scard-prof">' +
        '<div class="m-scard-prof-val" style="color:' + MC.profBg(rounded) + '">' + (overall > 0 ? overall.toFixed(1) : '\u2014') + '</div>' +
        '<div class="m-scard-prof-label">' + (PROF_LABELS[rounded] || 'No Evidence') + '</div>' +
      '</div>' +
    '</div>';
  };

  /* ── hero fallback (always shown if hero toggled off) ────── */
  function renderFallbackHero(st) {
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    return '<div class="m-scard-hero-min">' +
      '<div class="m-scard-avatar-min" style="background:' + color + '">' + initials + '</div>' +
      '<div class="m-scard-name-min">' + MC.esc(name) + '</div>' +
    '</div>';
  }

  /* ── sectionBars ────────────────────────────────────────── */
  _renderers.sectionBars = function(st, cid, data) {
    var sections = data.sections;
    if (!sections || !sections.length) return '';
    var html = '';
    sections.forEach(function(sec) {
      var secProf = getSectionProficiency(cid, st.id, sec.id);
      var pct = Math.min(100, Math.round(secProf / MAX_PROF * 100));
      html += '<div class="m-scard-sec-row">' +
        '<div class="m-scard-sec-dot" style="background:' + (sec.color || '#888') + '"></div>' +
        '<div class="m-scard-sec-name">' + MC.esc(sec.shortName || sec.name) + '</div>' +
        '<div class="m-scard-sec-bar"><div class="m-scard-sec-fill" style="width:' + pct + '%;background:' + MC.profBg(Math.round(secProf)) + '"></div></div>' +
      '</div>';
    });
    return '<div class="m-scard-sections">' + html + '</div>';
  };

  /* ── obsSnippet ─────────────────────────────────────────── */
  _renderers.obsSnippet = function(st, cid) {
    var obs = getStudentQuickObs(cid, st.id);
    if (obs.length) {
      var latest = obs[0];
      var text = (latest.text || '').substring(0, 80);
      if (latest.text && latest.text.length > 80) text += '\u2026';
      return '<div class="m-scard-obs">' +
        '<span style="color:var(--text-3);font-size:12px">' + MC.relativeTime(latest.created) + '</span> ' +
        MC.esc(text) +
      '</div>';
    }
    return '<div class="m-scard-obs-empty">No observations yet</div>';
  };

  /* ── actions ────────────────────────────────────────────── */
  _renderers.actions = function(st) {
    return '<div class="m-scard-actions">' +
      '<button class="m-scard-btn m-scard-btn-observe" data-action="m-obs-quick-menu" data-sid="' + st.id + '">Observe</button>' +
      '<button class="m-scard-btn m-scard-btn-view" data-action="m-student-detail" data-sid="' + st.id + '">View Profile</button>' +
    '</div>';
  };

  /* ── Public API ─────────────────────────────────────────── */
  return {
    render: render,
    renderFallbackHero: renderFallbackHero
  };
})();
```

- [ ] **Step 4: Update setup-mobile.js to load card-widgets.js**

In `tests/setup-mobile.js`, after the line `load('teacher-mobile/card-stack.js');` (line 89), add:

```javascript
load('teacher-mobile/card-widgets.js');
```

- [ ] **Step 5: Update test file imports**

Replace the top of `tests/mobile-card-widgets.test.js` with a single clean import:

```javascript
import './setup-mobile.js';
import { describe, it, expect, beforeEach } from 'vitest';
```

Remove the duplicate manual `load()` function that was added earlier — `setup-mobile.js` now loads everything.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add teacher-mobile/card-widgets.js tests/setup-mobile.js tests/mobile-card-widgets.test.js
git commit -m "feat: extract existing card elements into widget render functions"
```

---

## Task 3: New Widget Renderers — Metric Widgets

**Files:**
- Modify: `teacher-mobile/card-widgets.js`
- Modify: `tests/mobile-card-widgets.test.js`

- [ ] **Step 1: Write failing tests for completion, missingWork, growth**

Append to `tests/mobile-card-widgets.test.js`:

```javascript
describe('Widget Renderers — Metrics', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', designations: [] };

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
    _cache.scores = {}; _cache.tags = {}; _cache.statuses = {};
    _cache.quickObs = {}; _cache.termRatings = {};
  });

  it('completion renders arc ring with percentage', () => {
    // Seed tags and scores so completion > 0
    localStorage.setItem('gb-tags-course-1', JSON.stringify([
      { id: 't1', name: 'Tag1' }, { id: 't2', name: 'Tag2' }
    ]));
    localStorage.setItem('gb-scores-course-1', JSON.stringify({
      s1: [{ tagId: 't1', assessmentId: 'a1', score: 3, type: 'summative', date: '2026-03-01' }]
    }));
    var html = MCardWidgets.render('completion', st, cid, {});
    expect(html).toContain('m-wdg-arc');
    expect(html).toContain('50'); // 1 of 2 tags = 50%
    expect(html).toContain('Complete');
  });

  it('missingWork renders count when missing > 0', () => {
    var data = {
      assessments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      statuses: { 's1:a1': 'NS', 's1:a2': 'NS' }
    };
    var html = MCardWidgets.render('missingWork', st, cid, data);
    expect(html).toContain('2');
    expect(html).toContain('Missing');
    expect(html).toContain('m-wdg-alert');
  });

  it('missingWork returns empty string when 0 missing', () => {
    var data = { assessments: [{ id: 'a1' }], statuses: {} };
    var html = MCardWidgets.render('missingWork', st, cid, data);
    expect(html).toBe('');
  });

  it('growth renders journey text when multiple scores exist', () => {
    localStorage.setItem('gb-scores-course-1', JSON.stringify({
      s1: [
        { tagId: 't1', assessmentId: 'a1', score: 1, type: 'summative', date: '2026-01-01' },
        { tagId: 't1', assessmentId: 'a2', score: 3, type: 'summative', date: '2026-03-01' }
      ]
    }));
    var html = MCardWidgets.render('growth', st, cid, {});
    expect(html).toContain('m-wdg-growth');
    expect(html).toContain('\u2192'); // arrow
  });

  it('growth returns empty string when no scores', () => {
    var html = MCardWidgets.render('growth', st, cid, {});
    expect(html).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: FAIL — `MCardWidgets.render('completion', ...)` returns `''`

- [ ] **Step 3: Implement completion widget**

In `teacher-mobile/card-widgets.js`, add after the `actions` renderer:

```javascript
  /* ── completion — Arc ring metric tile ──────────────────── */
  _renderers.completion = function(st, cid) {
    var pct = getCompletionPct(cid, st.id);
    var color = pct >= 80 ? 'var(--score-3)' : pct >= 50 ? 'var(--score-2)' : 'var(--score-1)';
    // SVG arc ring (28px diameter, 3px stroke)
    var r = 11, cx = 14, cy = 14, circ = 2 * Math.PI * r;
    var offset = circ * (1 - pct / 100);
    var svg = '<svg class="m-wdg-arc" width="28" height="28" viewBox="0 0 28 28">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--bg-secondary)" stroke-width="3"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3" ' +
        'stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" ' +
        'stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' +
      '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" dominant-baseline="central" ' +
        'font-size="9" font-weight="700" fill="' + color + '">' + Math.round(pct) + '</text>' +
    '</svg>';

    return '<div class="m-wdg-tile">' +
      svg +
      '<div class="m-wdg-tile-label">Complete</div>' +
    '</div>';
  };
```

- [ ] **Step 4: Implement missingWork widget**

In `teacher-mobile/card-widgets.js`, add:

```javascript
  /* ── missingWork — Alert metric tile ────────────────────── */
  _renderers.missingWork = function(st, cid, data) {
    var statuses = data.statuses || getAssignmentStatuses(cid);
    var assessments = data.assessments || getAssessments(cid);
    var count = 0;
    assessments.forEach(function(a) {
      if (statuses[st.id + ':' + a.id] === 'NS') count++;
    });
    if (count === 0) return '';
    return '<div class="m-wdg-tile m-wdg-alert">' +
      '<div class="m-wdg-alert-val">' + count + '</div>' +
      '<div class="m-wdg-tile-label">Missing</div>' +
    '</div>';
  };
```

- [ ] **Step 5: Implement growth widget**

In `teacher-mobile/card-widgets.js`, add:

```javascript
  /* ── growth — Journey pill ──────────────────────────────── */
  _renderers.growth = function(st, cid) {
    var allScores = getScores(cid)[st.id] || [];
    var summative = allScores.filter(function(s) { return s.type === 'summative' && s.score > 0; });
    if (summative.length === 0) return '';

    summative.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var first = summative[0].score;
    var last = summative[summative.length - 1].score;
    var firstLabel = PROF_LABELS[Math.round(first)] || 'No Evidence';
    var lastLabel = PROF_LABELS[Math.round(last)] || 'No Evidence';

    var html;
    if (summative.length === 1) {
      html = '<span class="m-wdg-growth-label">' + firstLabel + '</span>' +
        '<span class="m-wdg-growth-meta"> \u2014 1 assessment</span>';
    } else {
      var arrowColor = last > first ? 'var(--score-3)' : last < first ? 'var(--score-1)' : 'var(--text-3)';
      html = '<span class="m-wdg-growth-label">' + firstLabel + '</span>' +
        '<span class="m-wdg-growth-arrow" style="color:' + arrowColor + '"> \u2192 </span>' +
        '<span class="m-wdg-growth-label">' + lastLabel + '</span>';
    }
    return '<div class="m-wdg-growth">' + html + '</div>';
  };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add teacher-mobile/card-widgets.js tests/mobile-card-widgets.test.js
git commit -m "feat: add completion, missingWork, growth widget renderers"
```

---

## Task 4: New Widget Renderers — Questionnaire Widgets

**Files:**
- Modify: `teacher-mobile/card-widgets.js`
- Modify: `tests/mobile-card-widgets.test.js`

- [ ] **Step 1: Write failing tests for obsSummary, reflection, dispositions, traits, concerns**

Append to `tests/mobile-card-widgets.test.js`:

```javascript
describe('Widget Renderers — Questionnaire', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', designations: [] };

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
    _cache.scores = {}; _cache.tags = {}; _cache.statuses = {};
    _cache.quickObs = {}; _cache.termRatings = {};
    _cache.reflections = {}; _cache.goals = {};
  });

  it('obsSummary renders context sentence', () => {
    localStorage.setItem('gb-quickobs-course-1', JSON.stringify({
      s1: [
        { text: 'Obs 1', created: '2026-03-01T10:00:00Z', context: 'small-group' },
        { text: 'Obs 2', created: '2026-03-02T10:00:00Z', context: 'small-group' },
        { text: 'Obs 3', created: '2026-03-03T10:00:00Z', context: 'whole-class' }
      ]
    }));
    var html = MCardWidgets.render('obsSummary', st, cid, {});
    expect(html).toContain('3 observations');
    expect(html).toContain('small-group');
    expect(html).toContain('m-wdg-obs-summary');
  });

  it('obsSummary returns empty when no observations', () => {
    var html = MCardWidgets.render('obsSummary', st, cid, {});
    expect(html).toBe('');
  });

  it('reflection renders student voice with left accent', () => {
    localStorage.setItem('gb-reflections-course-1', JSON.stringify({
      s1: { text: 'I feel confident about fractions now' }
    }));
    var html = MCardWidgets.render('reflection', st, cid, {});
    expect(html).toContain('m-wdg-reflection');
    expect(html).toContain('Student voice');
    expect(html).toContain('confident about fractions');
  });

  it('reflection falls back to goals when no reflections', () => {
    localStorage.setItem('gb-goals-course-1', JSON.stringify({
      s1: { text: 'Improve my writing skills' }
    }));
    var html = MCardWidgets.render('reflection', st, cid, {});
    expect(html).toContain('Improve my writing');
  });

  it('reflection returns empty when neither exists', () => {
    var html = MCardWidgets.render('reflection', st, cid, {});
    expect(html).toBe('');
  });

  it('dispositions renders petal SVG and summary text', () => {
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': {
        dims: { engagement: 4, collaboration: 3, selfRegulation: 2, resilience: 3, curiosity: 4, respect: 3 }
      }}
    }));
    var html = MCardWidgets.render('dispositions', st, cid, { termId: 'term-1' });
    expect(html).toContain('<svg');
    expect(html).toContain('m-wdg-dispositions');
    // Should mention top 2 dimensions
    expect(html).toMatch(/Engagement|Curiosity/);
  });

  it('dispositions returns empty when no term rating', () => {
    var html = MCardWidgets.render('dispositions', st, cid, { termId: 'term-1' });
    expect(html).toBe('');
  });

  it('traits renders positive trait chips', () => {
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': {
        dims: { engagement:0, collaboration:0, selfRegulation:0, resilience:0, curiosity:0, respect:0 },
        socialTraits: ['leader', 'empathetic', 'persistent', 'creative', 'curious']
      }}
    }));
    var html = MCardWidgets.render('traits', st, cid, { termId: 'term-1' });
    expect(html).toContain('m-wdg-traits');
    expect(html).toContain('Leader');
    expect(html).toContain('Empathetic');
    expect(html).toContain('+1'); // 5 traits, max 4 shown
  });

  it('traits returns empty when no positive traits', () => {
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': { dims: {}, socialTraits: ['needs-support'] } }
    }));
    var html = MCardWidgets.render('traits', st, cid, { termId: 'term-1' });
    expect(html).toBe('');
  });

  it('concerns renders concern trait chips in red', () => {
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': {
        dims: {},
        socialTraits: ['low-confidence', 'avoids-challenges']
      }}
    }));
    var html = MCardWidgets.render('concerns', st, cid, { termId: 'term-1' });
    expect(html).toContain('m-wdg-concerns');
    expect(html).toContain('Low Confidence');
    expect(html).toContain('Avoids Challenges');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: FAIL — renderers not found

- [ ] **Step 3: Implement obsSummary widget**

In `teacher-mobile/card-widgets.js`, add:

```javascript
  /* ── obsSummary — Context sentence ──────────────────────── */
  _renderers.obsSummary = function(st, cid) {
    var obs = getStudentQuickObs(cid, st.id);
    if (obs.length === 0) return '';

    // Count contexts
    var ctxCounts = {};
    obs.forEach(function(o) {
      var c = o.context || 'unknown';
      ctxCounts[c] = (ctxCounts[c] || 0) + 1;
    });

    // Find most frequent context
    var topCtx = null, topCount = 0;
    var allSame = true, firstCount = null;
    Object.keys(ctxCounts).forEach(function(c) {
      if (firstCount === null) firstCount = ctxCounts[c];
      else if (ctxCounts[c] !== firstCount) allSame = false;
      if (ctxCounts[c] > topCount) { topCtx = c; topCount = ctxCounts[c]; }
    });

    var contextLabel = OBS_CONTEXTS[topCtx] ? OBS_CONTEXTS[topCtx].label.toLowerCase() : topCtx;
    var text = obs.length + ' observation' + (obs.length !== 1 ? 's' : '');
    if (allSame && Object.keys(ctxCounts).length > 1) {
      text += ' \u00b7 across settings';
    } else if (topCtx && topCtx !== 'unknown') {
      text += ' \u00b7 strongest in ' + contextLabel;
    }

    return '<div class="m-wdg-obs-summary">' + text + '</div>';
  };
```

- [ ] **Step 4: Implement reflection widget**

```javascript
  /* ── reflection — Student voice block ───────────────────── */
  _renderers.reflection = function(st, cid) {
    var reflections = getReflections(cid);
    var goals = getGoals(cid);
    var text = '';

    if (reflections[st.id] && reflections[st.id].text) {
      text = reflections[st.id].text;
    } else if (goals[st.id] && goals[st.id].text) {
      text = goals[st.id].text;
    }

    if (!text) return '';

    var truncated = text.substring(0, 60);
    if (text.length > 60) truncated += '\u2026';

    return '<div class="m-wdg-reflection">' +
      '<div class="m-wdg-reflection-label">\ud83c\udfaf Student voice</div>' +
      '<div class="m-wdg-reflection-text">' + MC.esc(truncated) + '</div>' +
    '</div>';
  };
```

- [ ] **Step 5: Implement dispositions widget (petal SVG)**

```javascript
  /* ── dispositions — Petal chart + summary ───────────────── */
  _renderers.dispositions = function(st, cid, data) {
    var termId = data.termId || 'term-1';
    var rating = getStudentTermRating(cid, st.id, termId);
    if (!rating || !rating.dims) return '';

    var dims = rating.dims;
    var vals = OBS_DIMS.map(function(d) { return dims[d] || 0; });
    if (vals.every(function(v) { return v === 0; })) return '';

    // Build petal SVG (48x48, 6 axes)
    var size = 48, cx = size / 2, cy = size / 2, maxR = 20;
    var svg = '<svg class="m-wdg-petal" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';

    // Background hexagon (max radius)
    svg += _petalPath(6, maxR, cx, cy, 'var(--bg-secondary)', 'none');

    // Data shape
    var points = [];
    for (var i = 0; i < 6; i++) {
      var angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
      var r = (vals[i] / MAX_PROF) * maxR;
      points.push((cx + r * Math.cos(angle)).toFixed(1) + ',' + (cy + r * Math.sin(angle)).toFixed(1));
    }
    svg += '<polygon points="' + points.join(' ') + '" fill="var(--active-light)" stroke="var(--active)" stroke-width="1.5"/>';
    svg += '</svg>';

    // Find top 2 dimensions
    var indexed = OBS_DIMS.map(function(d, i) { return { dim: d, val: vals[i] }; });
    indexed.sort(function(a, b) { return b.val - a.val; });
    var top2 = indexed.slice(0, 2).map(function(x) { return OBS_LABELS[x.dim]; });
    var summaryText = 'Strong in ' + top2.join(', ');

    return '<div class="m-wdg-dispositions">' +
      svg +
      '<div class="m-wdg-disp-text">' + summaryText + '</div>' +
    '</div>';
  };

  function _petalPath(sides, radius, cx, cy, fill, stroke) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var angle = (Math.PI * 2 * i / sides) - Math.PI / 2;
      pts.push((cx + radius * Math.cos(angle)).toFixed(1) + ',' + (cy + radius * Math.sin(angle)).toFixed(1));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke="' + (stroke || 'none') + '" stroke-width="1"/>';
  }
```

- [ ] **Step 6: Implement traits widget**

```javascript
  /* ── traits — Blue chip row ─────────────────────────────── */
  _renderers.traits = function(st, cid, data) {
    var termId = data.termId || 'term-1';
    var rating = getStudentTermRating(cid, st.id, termId);
    if (!rating || !rating.socialTraits) return '';

    var positive = rating.socialTraits.filter(function(t) { return SOCIAL_TRAITS_POSITIVE_IDS.has(t); });
    if (positive.length === 0) return '';

    var maxShow = 4;
    var chips = '';
    positive.slice(0, maxShow).forEach(function(tid) {
      var trait = SOCIAL_TRAITS_POSITIVE.find(function(t) { return t.id === tid; });
      var label = trait ? trait.label : tid;
      chips += '<span class="m-wdg-chip m-wdg-chip-positive">' + MC.esc(label) + '</span>';
    });
    if (positive.length > maxShow) {
      chips += '<span class="m-wdg-chip m-wdg-chip-more">+' + (positive.length - maxShow) + '</span>';
    }

    return '<div class="m-wdg-traits">' + chips + '</div>';
  };
```

- [ ] **Step 7: Implement concerns widget**

```javascript
  /* ── concerns — Red alert chips ─────────────────────────── */
  _renderers.concerns = function(st, cid, data) {
    var termId = data.termId || 'term-1';
    var rating = getStudentTermRating(cid, st.id, termId);
    if (!rating || !rating.socialTraits) return '';

    var concern = rating.socialTraits.filter(function(t) { return SOCIAL_TRAITS_CONCERN_IDS.has(t); });
    if (concern.length === 0) return '';

    var maxShow = 4;
    var chips = '';
    concern.slice(0, maxShow).forEach(function(tid) {
      var trait = SOCIAL_TRAITS_CONCERN.find(function(t) { return t.id === tid; });
      var label = trait ? trait.label : tid;
      chips += '<span class="m-wdg-chip m-wdg-chip-concern">' + MC.esc(label) + '</span>';
    });
    if (concern.length > maxShow) {
      chips += '<span class="m-wdg-chip m-wdg-chip-more">+' + (concern.length - maxShow) + '</span>';
    }

    return '<div class="m-wdg-concerns">' + chips + '</div>';
  };
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add teacher-mobile/card-widgets.js tests/mobile-card-widgets.test.js
git commit -m "feat: add questionnaire widget renderers (dispositions, traits, concerns, reflection, obsSummary)"
```

---

## Task 5: Remaining Widget Renderers — workHabits, growthAreas, narrative, flagStatus

**Files:**
- Modify: `teacher-mobile/card-widgets.js`
- Modify: `tests/mobile-card-widgets.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/mobile-card-widgets.test.js`:

```javascript
describe('Widget Renderers — Remaining', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', designations: [] };

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
    _cache.scores = {}; _cache.tags = {}; _cache.statuses = {};
    _cache.quickObs = {}; _cache.termRatings = {};
    _cache.flags = {};
  });

  it('workHabits renders dual segmented bar', () => {
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': { dims: {}, workHabits: 3, participation: 2 } }
    }));
    var html = MCardWidgets.render('workHabits', st, cid, { termId: 'term-1' });
    expect(html).toContain('m-wdg-habits');
    expect(html).toContain('Work Habits');
    expect(html).toContain('Participation');
    expect(html).toContain('m-wdg-pip-filled');
  });

  it('workHabits returns empty when no term rating', () => {
    var html = MCardWidgets.render('workHabits', st, cid, { termId: 'term-1' });
    expect(html).toBe('');
  });

  it('growthAreas renders tag chips with section dots', () => {
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': { dims: {}, growthAreas: ['t1', 't2'] } }
    }));
    localStorage.setItem('gb-tags-course-1', JSON.stringify([
      { id: 't1', name: 'Fractions', sectionId: 'sec1' },
      { id: 't2', name: 'Decimals', sectionId: 'sec1' }
    ]));
    localStorage.setItem('gb-sections-course-1', JSON.stringify([
      { id: 'sec1', name: 'Number', color: '#4A90D9' }
    ]));
    if (_cache.sections) delete _cache.sections['course-1'];

    var html = MCardWidgets.render('growthAreas', st, cid, { termId: 'term-1' });
    expect(html).toContain('m-wdg-growth-areas');
    expect(html).toContain('Growth Areas');
    expect(html).toContain('Fractions');
    expect(html).toContain('#4A90D9');
  });

  it('narrative renders truncated excerpt with shadow', () => {
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': {
        dims: {},
        narrative: '<p>Cece has demonstrated outstanding growth in mathematical reasoning this term. She approaches challenges with curiosity.</p>'
      }}
    }));
    var html = MCardWidgets.render('narrative', st, cid, { termId: 'term-1' });
    expect(html).toContain('m-wdg-narrative');
    expect(html).toContain('Term Report');
    expect(html).toContain('demonstrated outstanding growth');
    expect(html).toContain('\u2026'); // truncated
  });

  it('narrative returns empty when no narrative exists', () => {
    var html = MCardWidgets.render('narrative', st, cid, { termId: 'term-1' });
    expect(html).toBe('');
  });

  it('flagStatus is not a standalone renderer (returns empty)', () => {
    // flagStatus renders inside hero, not as its own row
    var html = MCardWidgets.render('flagStatus', st, cid, {});
    expect(html).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: FAIL

- [ ] **Step 3: Implement workHabits widget**

In `teacher-mobile/card-widgets.js`, add:

```javascript
  /* ── workHabits — Dual segmented bar ────────────────────── */
  _renderers.workHabits = function(st, cid, data) {
    var termId = data.termId || 'term-1';
    var rating = getStudentTermRating(cid, st.id, termId);
    if (!rating) return '';
    var wh = rating.workHabits || 0;
    var pa = rating.participation || 0;
    if (wh === 0 && pa === 0) return '';

    function _pips(val, max) {
      var html = '';
      for (var i = 1; i <= max; i++) {
        var filled = i <= val;
        var color = filled ? MC.profBg(val) : 'var(--bg-secondary)';
        html += '<div class="m-wdg-pip' + (filled ? ' m-wdg-pip-filled' : '') + '" style="background:' + color + '"></div>';
      }
      return html;
    }

    return '<div class="m-wdg-habits">' +
      '<div class="m-wdg-habit-col">' +
        '<div class="m-wdg-pips">' + _pips(wh, 4) + '</div>' +
        '<div class="m-wdg-tile-label">Work Habits</div>' +
      '</div>' +
      '<div class="m-wdg-habit-col">' +
        '<div class="m-wdg-pips">' + _pips(pa, 4) + '</div>' +
        '<div class="m-wdg-tile-label">Participation</div>' +
      '</div>' +
    '</div>';
  };
```

- [ ] **Step 4: Implement growthAreas widget**

```javascript
  /* ── growthAreas — Dot-prefixed tag chips ───────────────── */
  _renderers.growthAreas = function(st, cid, data) {
    var termId = data.termId || 'term-1';
    var rating = getStudentTermRating(cid, st.id, termId);
    if (!rating || !rating.growthAreas || !rating.growthAreas.length) return '';

    var sections = getSections(cid);
    var secMap = {};
    sections.forEach(function(s) { secMap[s.id] = s; });

    var maxShow = 3;
    var chips = '';
    rating.growthAreas.slice(0, maxShow).forEach(function(tid) {
      var tag = getTagById(cid, tid);
      if (!tag) return;
      var label = tag.shortName || tag.label || tag.name || tid;
      var sec = secMap[tag.sectionId];
      var dotColor = sec ? sec.color : '#888';
      chips += '<span class="m-wdg-chip m-wdg-chip-neutral">' +
        '<span class="m-wdg-chip-dot" style="background:' + dotColor + '"></span>' +
        MC.esc(label) +
      '</span>';
    });
    if (rating.growthAreas.length > maxShow) {
      chips += '<span class="m-wdg-chip m-wdg-chip-more">+' + (rating.growthAreas.length - maxShow) + '</span>';
    }

    return '<div class="m-wdg-growth-areas">' +
      '<div class="m-wdg-section-label">Growth Areas</div>' +
      '<div class="m-wdg-chips">' + chips + '</div>' +
    '</div>';
  };
```

- [ ] **Step 5: Implement narrative widget**

```javascript
  /* ── narrative — Shadowed excerpt card ──────────────────── */
  _renderers.narrative = function(st, cid, data) {
    var termId = data.termId || 'term-1';
    var rating = getStudentTermRating(cid, st.id, termId);
    if (!rating || !rating.narrative) return '';

    // Strip HTML tags and truncate
    var plain = rating.narrative.replace(/<[^>]+>/g, '').trim();
    if (!plain) return '';
    var truncated = plain.substring(0, 80);
    if (plain.length > 80) truncated += '\u2026';

    return '<div class="m-wdg-narrative">' +
      '<div class="m-wdg-section-label">Term Report</div>' +
      '<div class="m-wdg-narrative-text">' + MC.esc(truncated) + '</div>' +
    '</div>';
  };
```

- [ ] **Step 6: Add flagStatus as no-op renderer**

```javascript
  /* ── flagStatus — renders inside hero, not standalone ───── */
  _renderers.flagStatus = function() { return ''; };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add teacher-mobile/card-widgets.js tests/mobile-card-widgets.test.js
git commit -m "feat: add workHabits, growthAreas, narrative, flagStatus widget renderers"
```

---

## Task 6: Card Assembly — Wire Widgets Into Student Card

**Files:**
- Modify: `teacher-mobile/card-widgets.js` (add `assembleCard` function)
- Modify: `teacher-mobile/tab-students.js` (refactor `_renderStudentCard`)
- Modify: `tests/mobile-card-widgets.test.js`

- [ ] **Step 1: Write failing test for card assembly**

Append to `tests/mobile-card-widgets.test.js`:

```javascript
describe('Card Assembly', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', pronouns: 'she/her', designations: [] };

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
    _cache.scores = {}; _cache.tags = {}; _cache.statuses = {};
    _cache.quickObs = {}; _cache.termRatings = {};
  });

  it('assembles default card with hero, sectionBars, obsSnippet, actions', () => {
    var data = { sections: [{ id: 'sec1', name: 'Questioning', color: '#4A90D9' }] };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard');
    expect(html).toContain('m-scard-hero');
    expect(html).toContain('m-scard-sections');
    expect(html).toContain('m-scard-obs');
    expect(html).toContain('m-scard-actions');
    // Should have pinned hero and actions with scrollable middle
    expect(html).toContain('m-scard-widgets');
  });

  it('shows hero fallback when hero is disabled', () => {
    saveCardWidgetConfig({
      order: ['sectionBars', 'obsSnippet', 'actions'],
      disabled: ['hero', 'completion', 'missingWork', 'growth', 'obsSummary',
                 'flagStatus', 'reflection', 'dispositions', 'traits', 'concerns',
                 'workHabits', 'growthAreas', 'narrative']
    });
    var data = { sections: [] };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard-hero-min');
    expect(html).not.toContain('m-scard-prof');
  });

  it('renders completion and missingWork as 2-up when both enabled', () => {
    saveCardWidgetConfig({
      order: ['hero', 'completion', 'missingWork', 'actions'],
      disabled: ['sectionBars', 'obsSnippet', 'growth', 'obsSummary',
                 'flagStatus', 'reflection', 'dispositions', 'traits', 'concerns',
                 'workHabits', 'growthAreas', 'narrative']
    });
    localStorage.setItem('gb-tags-course-1', JSON.stringify([{ id: 't1', name: 'Tag1' }]));
    var data = {
      sections: [],
      assessments: [{ id: 'a1' }],
      statuses: { 's1:a1': 'NS' }
    };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-wdg-2up');
  });

  it('skips disabled widgets', () => {
    saveCardWidgetConfig({
      order: ['hero', 'actions'],
      disabled: ['sectionBars', 'obsSnippet', 'completion', 'missingWork', 'growth',
                 'obsSummary', 'flagStatus', 'reflection', 'dispositions', 'traits',
                 'concerns', 'workHabits', 'growthAreas', 'narrative']
    });
    var html = MCardWidgets.assembleCard(st, cid, { sections: [] });
    expect(html).not.toContain('m-scard-sections');
    expect(html).not.toContain('m-scard-obs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: FAIL — `MCardWidgets.assembleCard` is not a function

- [ ] **Step 3: Implement assembleCard function**

In `teacher-mobile/card-widgets.js`, add before the return statement:

```javascript
  /* ── Card Assembly ──────────────────────────────────────── */
  function assembleCard(st, cid, data) {
    var config = getCardWidgetConfig();
    var order = config.order;

    // Hero: pinned top (or fallback if disabled)
    var heroIdx = order.indexOf('hero');
    var heroHtml = heroIdx >= 0
      ? render('hero', st, cid, data)
      : renderFallbackHero(st);

    // Actions: pinned bottom
    var actionsIdx = order.indexOf('actions');
    var actionsHtml = actionsIdx >= 0 ? render('actions', st, cid, data) : '';

    // Middle widgets: everything except hero, actions, flagStatus (which lives inside hero)
    var skip = new Set(['hero', 'actions', 'flagStatus']);
    var middleHtml = '';

    // Check for completion+missingWork 2-up pairing
    var hasCompletion = order.indexOf('completion') >= 0;
    var hasMissing = order.indexOf('missingWork') >= 0;
    var paired = hasCompletion && hasMissing;
    var pairedRendered = false;

    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      if (skip.has(key)) continue;

      // 2-up pairing: render both at the position of whichever comes first
      if (paired && (key === 'completion' || key === 'missingWork')) {
        if (pairedRendered) continue; // already rendered the pair
        pairedRendered = true;
        var compHtml = render('completion', st, cid, data);
        var missHtml = render('missingWork', st, cid, data);
        if (compHtml || missHtml) {
          middleHtml += '<div class="m-wdg-2up">' + compHtml + missHtml + '</div>';
        }
        continue;
      }

      middleHtml += render(key, st, cid, data);
    }

    return '<div class="m-scard">' +
      heroHtml +
      '<div class="m-scard-widgets">' + middleHtml + '</div>' +
      actionsHtml +
    '</div>';
  }
```

Update the return statement to include `assembleCard`:

```javascript
  return {
    render: render,
    renderFallbackHero: renderFallbackHero,
    assembleCard: assembleCard
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mobile-card-widgets.test.js`
Expected: All tests PASS

- [ ] **Step 5: Refactor tab-students.js to use assembleCard**

In `teacher-mobile/tab-students.js`, replace the `_renderStudentCard` function (lines 111-168) with:

```javascript
  /* ── Rich Student Card (for card stack) ───────────────────── */
  function _renderStudentCard(st, cid, data) {
    return MCardWidgets.assembleCard(st, cid, data);
  }
```

Also update `initCardStack` (line 189) to pass more data to the render function. Replace:

```javascript
    var sections = getSections(cid);
    var data = { sections: sections };
```

With:

```javascript
    var sections = getSections(cid);
    var allStatuses = getAssignmentStatuses(cid);
    var allAssessments = getAssessments(cid);
    var data = {
      sections: sections,
      statuses: allStatuses,
      assessments: allAssessments,
      termId: 'term-1'
    };
```

- [ ] **Step 6: Remove the now-unused `_renderBadges` from tab-students.js**

The `_renderBadges` function at lines 13-23 of `tab-students.js` is still needed by `_buildCells` (list view). Keep it — it's used by the list cell renderer. The widget system has its own copy in `card-widgets.js`.

- [ ] **Step 7: Run all mobile tests to verify nothing broke**

Run: `npx vitest run tests/mobile-*.test.js`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add teacher-mobile/card-widgets.js teacher-mobile/tab-students.js tests/mobile-card-widgets.test.js
git commit -m "feat: wire widget system into student card rendering"
```

---

## Task 7: Widget CSS

**Files:**
- Modify: `teacher-mobile/styles.css`

- [ ] **Step 1: Add widget-specific styles**

In `teacher-mobile/styles.css`, after the existing `.m-scard-btn-view` rule (~line 1742), add:

```css
/* ═══════════════════════════════════════════════════════════════
   CARD WIDGETS — Modular student card components
   ═══════════════════════════════════════════════════════════════ */

/* Scrollable middle zone */
.m-scard-widgets { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:10px;
  -webkit-overflow-scrolling:touch; scrollbar-width:none; }
.m-scard-widgets::-webkit-scrollbar { display:none; }

/* Scroll fade indicator at bottom of widget zone */
.m-scard-widgets::after { content:''; position:sticky; bottom:0; left:0; right:0;
  height:8px; background:linear-gradient(transparent, var(--surface)); pointer-events:none;
  flex-shrink:0; }

/* Hero fallback (minimal name-only) */
.m-scard-hero-min { display:flex; align-items:center; gap:10px; padding-bottom:10px; }
.m-scard-avatar-min { width:32px; height:32px; border-radius:50%; color:#fff;
  display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; }
.m-scard-name-min { font-size:15px; font-weight:600; color:var(--text); }

/* Flag icon inside hero */
.m-scard-flag { color:#F5A623; font-size:16px; margin-left:4px; }

/* ── Metric tiles ─────────────────────────────────────────── */
.m-wdg-tile { display:flex; flex-direction:column; align-items:center; gap:4px;
  background:var(--bg); border-radius:10px; padding:10px; flex:1; }
.m-wdg-tile-label { font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:0.5px; color:var(--text-3); }
.m-wdg-2up { display:flex; gap:10px; }

/* Alert metric tile */
.m-wdg-alert .m-wdg-alert-val { font-size:18px; font-weight:800; color:var(--priority); }

/* Arc ring SVG */
.m-wdg-arc { flex-shrink:0; }

/* ── Growth journey pill ──────────────────────────────────── */
.m-wdg-growth { background:var(--bg); border-radius:10px; padding:10px 14px;
  font-size:13px; color:var(--text-2); }
.m-wdg-growth-label { font-weight:600; color:var(--text); }
.m-wdg-growth-arrow { font-weight:700; }
.m-wdg-growth-meta { color:var(--text-3); }

/* ── Observation summary ──────────────────────────────────── */
.m-wdg-obs-summary { font-size:13px; color:var(--text-3); padding:4px 0; }

/* ── Reflection / Student voice ───────────────────────────── */
.m-wdg-reflection { border-left:3px solid var(--active); padding-left:12px; }
.m-wdg-reflection-label { font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:0.5px; color:var(--text-3); margin-bottom:4px; }
.m-wdg-reflection-text { font-size:13px; font-style:italic; color:var(--text-2); line-height:1.35; }

/* ── Dispositions petal chart ─────────────────────────────── */
.m-wdg-dispositions { display:flex; align-items:center; gap:12px; }
.m-wdg-petal { flex-shrink:0; }
.m-wdg-disp-text { font-size:13px; color:var(--text-2); line-height:1.3; }

/* ── Chip rows (traits, concerns, growth areas) ───────────── */
.m-wdg-traits, .m-wdg-concerns, .m-wdg-chips { display:flex; flex-wrap:wrap; gap:6px; }
.m-wdg-chip { font-size:11px; font-weight:500; padding:4px 8px; border-radius:14px; white-space:nowrap; }
.m-wdg-chip-positive { background:var(--active-light); color:var(--active); }
.m-wdg-chip-concern { background:var(--priority-light); color:var(--priority); }
.m-wdg-chip-neutral { background:var(--bg); color:var(--text-2); display:flex; align-items:center; gap:4px; }
.m-wdg-chip-more { background:none; color:var(--text-3); font-weight:400; }
.m-wdg-chip-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }

/* ── Work habits segmented pips ───────────────────────────── */
.m-wdg-habits { display:flex; gap:10px; }
.m-wdg-habit-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; }
.m-wdg-pips { display:flex; gap:3px; }
.m-wdg-pip { width:16px; height:8px; border-radius:2px; background:var(--bg-secondary); }

/* ── Growth areas ─────────────────────────────────────────── */
.m-wdg-growth-areas { display:flex; flex-direction:column; gap:6px; }
.m-wdg-section-label { font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:0.5px; color:var(--text-3); }

/* ── Narrative excerpt ────────────────────────────────────── */
.m-wdg-narrative { background:var(--surface); border-radius:12px; padding:10px 14px;
  box-shadow:0 1px 4px rgba(0,0,0,0.06); }
.m-wdg-narrative-text { font-size:13px; color:var(--text-2); line-height:1.4; margin-top:4px; }
```

- [ ] **Step 2: Slim down action buttons**

Find the existing `.m-scard-btn` rule and update padding/font:

Replace:
```css
.m-scard-btn {
  flex:1; padding:10px 0; border-radius:12px; border:none; font-size:14px; font-weight:600;
  cursor:pointer; text-align:center; transition:opacity 0.15s;
}
```

With:
```css
.m-scard-btn {
  flex:1; padding:8px 0; border-radius:12px; border:none; font-size:13px; font-weight:600;
  cursor:pointer; text-align:center; transition:opacity 0.15s;
}
```

- [ ] **Step 3: Verify visually by running the dev server**

Run: `npx vitest run tests/mobile-*.test.js`
Expected: All tests PASS (CSS changes don't affect unit tests but ensure nothing is broken)

- [ ] **Step 4: Commit**

```bash
git add teacher-mobile/styles.css
git commit -m "feat: add widget CSS styles and slim action buttons"
```

---

## Task 8: Widget Editor — Long-Press Edit Mode

**Files:**
- Create: `teacher-mobile/card-widget-editor.js`
- Create: `tests/mobile-card-widget-editor.test.js`
- Modify: `teacher-mobile/tab-students.js` (add long-press listener)
- Modify: `teacher-mobile/styles.css` (editor styles)
- Modify: `tests/setup-mobile.js` (load new module)

- [ ] **Step 1: Write failing tests for editor**

Create `tests/mobile-card-widget-editor.test.js`:

```javascript
import './setup-mobile.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Card Widget Editor', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
  });

  it('builds editor HTML with all widgets listed', () => {
    var html = MCardWidgetEditor.buildEditorHTML();
    expect(html).toContain('Customize Card');
    // All 16 widgets should appear
    WIDGET_REGISTRY.forEach(function(w) {
      expect(html).toContain(w.label);
    });
  });

  it('shows enabled widgets with toggles on', () => {
    var html = MCardWidgetEditor.buildEditorHTML();
    // Default: hero, sectionBars, obsSnippet, actions are on
    expect(html).toContain('data-widget="hero"');
    // Check that default-on widgets have checked toggle
    expect(html).toMatch(/data-widget="hero"[^>]*data-enabled="true"/);
  });

  it('toggleWidget enables a disabled widget', () => {
    var config = getCardWidgetConfig();
    expect(config.disabled).toContain('completion');
    MCardWidgetEditor.toggleWidget('completion');
    config = getCardWidgetConfig();
    expect(config.order).toContain('completion');
    expect(config.disabled).not.toContain('completion');
  });

  it('toggleWidget disables an enabled widget', () => {
    var config = getCardWidgetConfig();
    expect(config.order).toContain('sectionBars');
    MCardWidgetEditor.toggleWidget('sectionBars');
    config = getCardWidgetConfig();
    expect(config.order).not.toContain('sectionBars');
    expect(config.disabled).toContain('sectionBars');
  });

  it('moveWidget reorders within enabled list', () => {
    // Default order: hero, sectionBars, obsSnippet, actions
    MCardWidgetEditor.moveWidget('obsSnippet', 1); // move to index 1
    var config = getCardWidgetConfig();
    expect(config.order[0]).toBe('hero');
    expect(config.order[1]).toBe('obsSnippet');
    expect(config.order[2]).toBe('sectionBars');
  });

  it('resetToDefaults clears saved config', () => {
    saveCardWidgetConfig({ order: ['hero'], disabled: [] });
    MCardWidgetEditor.resetToDefaults();
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'sectionBars', 'obsSnippet', 'actions']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mobile-card-widget-editor.test.js`
Expected: FAIL — `MCardWidgetEditor` is not defined

- [ ] **Step 3: Create card-widget-editor.js**

Create `teacher-mobile/card-widget-editor.js`:

```javascript
/* card-widget-editor.js — Long-press edit mode for student card widgets */

window.MCardWidgetEditor = (function() {
  'use strict';

  var MC = window.MComponents;

  /* ── Build Editor Sheet HTML ────────────────────────────── */
  function buildEditorHTML() {
    var config = getCardWidgetConfig();
    var enabledSet = new Set(config.order);

    var html = '<div class="m-wdg-editor">' +
      '<div class="m-wdg-editor-header">' +
        '<div class="m-wdg-editor-title">Customize Card</div>' +
        '<button class="m-wdg-editor-done" data-action="m-dismiss-sheet">Done</button>' +
      '</div>';

    // Enabled widgets (in order)
    html += '<div class="m-wdg-editor-section-label">Visible</div>';
    html += '<div class="m-wdg-editor-list" id="m-wdg-enabled-list">';
    config.order.forEach(function(key) {
      var w = WIDGET_REGISTRY.find(function(r) { return r.key === key; });
      if (!w) return;
      var noDrag = key === 'flagStatus';
      html += _editorRow(w, true, noDrag);
    });
    html += '</div>';

    // Disabled widgets
    html += '<div class="m-wdg-editor-section-label">More Widgets</div>';
    html += '<div class="m-wdg-editor-list" id="m-wdg-disabled-list">';
    config.disabled.forEach(function(key) {
      var w = WIDGET_REGISTRY.find(function(r) { return r.key === key; });
      if (!w) return;
      html += _editorRow(w, false, false);
    });
    html += '</div>';

    // Reset link
    html += '<button class="m-wdg-editor-reset" data-action="m-wdg-reset">Reset to Defaults</button>';

    html += '</div>';
    return html;
  }

  function _editorRow(widget, enabled, noDrag) {
    return '<div class="m-wdg-editor-row" data-widget="' + widget.key + '" data-enabled="' + enabled + '">' +
      (noDrag ? '<div class="m-wdg-editor-drag-spacer"></div>' : '<div class="m-wdg-editor-drag" data-action="m-wdg-drag">\u2630</div>') +
      '<div class="m-wdg-editor-label">' + widget.label + '</div>' +
      '<button class="m-wdg-editor-toggle' + (enabled ? ' m-wdg-toggle-on' : '') + '" data-action="m-wdg-toggle" data-widget="' + widget.key + '">' +
        '<div class="m-wdg-toggle-knob"></div>' +
      '</button>' +
    '</div>';
  }

  /* ── Toggle Widget ──────────────────────────────────────── */
  function toggleWidget(key) {
    var config = getCardWidgetConfig();
    var orderIdx = config.order.indexOf(key);

    if (orderIdx >= 0) {
      // Disable: move from order to disabled
      config.order.splice(orderIdx, 1);
      config.disabled.push(key);
    } else {
      // Enable: move from disabled to end of order
      var disIdx = config.disabled.indexOf(key);
      if (disIdx >= 0) config.disabled.splice(disIdx, 1);
      config.order.push(key);
    }

    saveCardWidgetConfig(config);
  }

  /* ── Move Widget ────────────────────────────────────────── */
  function moveWidget(key, toIndex) {
    var config = getCardWidgetConfig();
    var fromIndex = config.order.indexOf(key);
    if (fromIndex < 0) return; // not enabled

    config.order.splice(fromIndex, 1);
    config.order.splice(toIndex, 0, key);
    saveCardWidgetConfig(config);
  }

  /* ── Reset ──────────────────────────────────────────────── */
  function resetToDefaults() {
    localStorage.removeItem('m-card-widgets');
  }

  /* ── Show Editor ────────────────────────────────────────── */
  function show(onUpdate) {
    MC.presentSheet(buildEditorHTML(), { half: false });
    MC.haptic();
    _onUpdate = onUpdate || null;
  }

  var _onUpdate = null;

  /* ── Handle Editor Actions ──────────────────────────────── */
  function handleAction(action, el) {
    if (action === 'm-wdg-toggle') {
      var key = el.dataset.widget;
      toggleWidget(key);
      // Re-render the editor sheet
      var container = document.getElementById('m-sheet-container');
      var content = container.querySelector('.m-sheet-content');
      if (content) content.innerHTML = buildEditorHTML();
      if (_onUpdate) _onUpdate();
      return true;
    }

    if (action === 'm-wdg-reset') {
      resetToDefaults();
      var container = document.getElementById('m-sheet-container');
      var content = container.querySelector('.m-sheet-content');
      if (content) content.innerHTML = buildEditorHTML();
      if (_onUpdate) _onUpdate();
      return true;
    }

    return false;
  }

  /* ── Drag-to-Reorder ────────────────────────────────────── */
  var _dragState = null;

  function initDragListeners() {
    var container = document.getElementById('m-sheet-container');
    if (!container) return;

    container.addEventListener('touchstart', function(e) {
      var drag = e.target.closest('[data-action="m-wdg-drag"]');
      if (!drag) return;
      var row = drag.closest('.m-wdg-editor-row');
      if (!row) return;

      e.preventDefault();
      var touch = e.touches[0];
      var rect = row.getBoundingClientRect();
      _dragState = {
        key: row.dataset.widget,
        el: row,
        startY: touch.clientY,
        offsetY: touch.clientY - rect.top,
        rowHeight: rect.height
      };
      row.classList.add('m-wdg-row-dragging');
      MC.haptic();
    }, { passive: false });

    container.addEventListener('touchmove', function(e) {
      if (!_dragState) return;
      e.preventDefault();
      var touch = e.touches[0];
      var dy = touch.clientY - _dragState.startY;
      _dragState.el.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: false });

    container.addEventListener('touchend', function() {
      if (!_dragState) return;
      var el = _dragState.el;
      var dy = parseFloat(el.style.transform.replace('translateY(', '').replace('px)', '')) || 0;
      var slots = Math.round(dy / _dragState.rowHeight);

      el.classList.remove('m-wdg-row-dragging');
      el.style.transform = '';

      if (slots !== 0) {
        var config = getCardWidgetConfig();
        var fromIdx = config.order.indexOf(_dragState.key);
        if (fromIdx >= 0) {
          var toIdx = Math.max(0, Math.min(config.order.length - 1, fromIdx + slots));
          moveWidget(_dragState.key, toIdx);
          // Re-render editor
          var content = document.querySelector('#m-sheet-container .m-sheet-content');
          if (content) content.innerHTML = buildEditorHTML();
          if (_onUpdate) _onUpdate();
        }
      }

      _dragState = null;
    });
  }

  return {
    buildEditorHTML: buildEditorHTML,
    toggleWidget: toggleWidget,
    moveWidget: moveWidget,
    resetToDefaults: resetToDefaults,
    show: show,
    handleAction: handleAction,
    initDragListeners: initDragListeners
  };
})();
```

- [ ] **Step 4: Update setup-mobile.js to load card-widget-editor.js**

In `tests/setup-mobile.js`, after `load('teacher-mobile/card-widgets.js');`, add:

```javascript
load('teacher-mobile/card-widget-editor.js');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mobile-card-widget-editor.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add teacher-mobile/card-widget-editor.js tests/mobile-card-widget-editor.test.js tests/setup-mobile.js
git commit -m "feat: add widget editor with toggle, reorder, and reset"
```

---

## Task 9: Long-Press Activation and Shell Integration

**Files:**
- Modify: `teacher-mobile/tab-students.js`
- Modify: `teacher-mobile/shell.js`
- Modify: `teacher-mobile/index.html`

- [ ] **Step 1: Add long-press detection to card stack**

In `teacher-mobile/tab-students.js`, add a long-press handler inside `initCardStack`, after the `_stackInstance = MCardStack.create(...)` call:

```javascript
    // Long-press to edit card layout
    var _longPressTimer = null;
    container.addEventListener('touchstart', function(e) {
      // Don't trigger long-press on buttons
      if (e.target.closest('button') || e.target.closest('[data-action]')) return;
      _longPressTimer = setTimeout(function() {
        _longPressTimer = null;
        MCardWidgetEditor.show(function onUpdate() {
          // Re-render current card live
          initCardStack(cid);
        });
        MCardWidgetEditor.initDragListeners();
      }, 500);
    }, { passive: true });

    container.addEventListener('touchmove', function() {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    }, { passive: true });

    container.addEventListener('touchend', function() {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    }, { passive: true });
```

- [ ] **Step 2: Add editor action routing to shell.js**

In `teacher-mobile/shell.js`, in the click event handler (the section that routes `data-action` attributes), add before the final catch-all:

```javascript
      // Widget editor actions
      if (action === 'm-wdg-toggle' || action === 'm-wdg-reset') {
        MCardWidgetEditor.handleAction(action, target);
        return;
      }
```

- [ ] **Step 3: Add card-widgets.js and card-widget-editor.js to index.html**

In `teacher-mobile/index.html`, find where `card-stack.js` is loaded and add after it:

```html
    <script src="card-widgets.js"></script>
    <script src="card-widget-editor.js"></script>
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run tests/mobile-*.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add teacher-mobile/tab-students.js teacher-mobile/shell.js teacher-mobile/index.html
git commit -m "feat: wire long-press edit mode and shell action routing"
```

---

## Task 10: Editor CSS

**Files:**
- Modify: `teacher-mobile/styles.css`

- [ ] **Step 1: Add editor sheet styles**

Append to `teacher-mobile/styles.css` after the widget CSS added in Task 7:

```css
/* ═══════════════════════════════════════════════════════════════
   CARD WIDGET EDITOR — Long-press customization sheet
   ═══════════════════════════════════════════════════════════════ */
.m-wdg-editor { padding:8px 0 24px; }
.m-wdg-editor-header { display:flex; align-items:center; justify-content:space-between;
  padding:0 16px 16px; }
.m-wdg-editor-title { font-size:17px; font-weight:600; color:var(--text); }
.m-wdg-editor-done { font-size:15px; font-weight:600; color:var(--active);
  background:none; border:none; padding:4px 8px; cursor:pointer; }

.m-wdg-editor-section-label { font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:0.5px; color:var(--text-3); padding:12px 16px 6px; }

.m-wdg-editor-list { padding:0 8px; }

.m-wdg-editor-row { display:flex; align-items:center; gap:12px; padding:10px 8px;
  border-radius:10px; transition:background 0.15s; }
.m-wdg-editor-row[data-enabled="false"] { opacity:0.5; }

.m-wdg-editor-drag { font-size:16px; color:var(--text-3); cursor:grab; padding:4px;
  -webkit-tap-highlight-color:transparent; user-select:none; }
.m-wdg-editor-drag-spacer { width:24px; }

.m-wdg-editor-label { flex:1; font-size:15px; color:var(--text); }

/* iOS-style toggle switch */
.m-wdg-editor-toggle { width:44px; height:26px; border-radius:13px; border:none;
  background:var(--bg-secondary); position:relative; cursor:pointer; padding:0;
  transition:background 0.2s; flex-shrink:0; }
.m-wdg-editor-toggle.m-wdg-toggle-on { background:var(--active); }
.m-wdg-toggle-knob { width:22px; height:22px; border-radius:11px; background:#fff;
  position:absolute; top:2px; left:2px; transition:transform 0.2s;
  box-shadow:0 1px 3px rgba(0,0,0,0.15); }
.m-wdg-toggle-on .m-wdg-toggle-knob { transform:translateX(18px); }

/* Drag state */
.m-wdg-row-dragging { background:var(--bg); box-shadow:0 4px 12px rgba(0,0,0,0.12);
  z-index:10; position:relative; }

/* Reset button */
.m-wdg-editor-reset { display:block; width:100%; background:none; border:none;
  color:var(--priority); font-size:14px; font-weight:500; padding:16px;
  cursor:pointer; text-align:center; margin-top:8px; }
```

- [ ] **Step 2: Commit**

```bash
git add teacher-mobile/styles.css
git commit -m "feat: add widget editor sheet CSS with iOS toggle switches"
```

---

## Task 11: Integration Test and Cleanup

**Files:**
- Modify: `tests/mobile-card-widgets.test.js`

- [ ] **Step 1: Write integration test for full card render cycle**

Append to `tests/mobile-card-widgets.test.js`:

```javascript
describe('Integration — Full Card Render Cycle', () => {
  var cid = 'course-1';
  var st = { id: 's1', firstName: 'Cece', lastName: 'Adams', pronouns: 'she/her', designations: ['A'] };

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function(k) { delete _cache[k]; });
    _cache.scores = {}; _cache.tags = {}; _cache.statuses = {};
    _cache.quickObs = {}; _cache.termRatings = {};
    _cache.reflections = {}; _cache.goals = {}; _cache.flags = {};

    // Seed comprehensive data
    localStorage.setItem('gb-sections-course-1', JSON.stringify([
      { id: 'sec1', name: 'Questioning', shortName: 'Quest', color: '#4A90D9', tags: [{ id: 't1', name: 'Tag1' }] }
    ]));
    localStorage.setItem('gb-tags-course-1', JSON.stringify([
      { id: 't1', name: 'Tag1', sectionId: 'sec1' }
    ]));
    localStorage.setItem('gb-scores-course-1', JSON.stringify({
      s1: [
        { tagId: 't1', assessmentId: 'a1', score: 2, type: 'summative', date: '2026-01-15' },
        { tagId: 't1', assessmentId: 'a2', score: 3, type: 'summative', date: '2026-03-15' }
      ]
    }));
    localStorage.setItem('gb-quickobs-course-1', JSON.stringify({
      s1: [{ text: 'Great participation in group work', created: '2026-03-20T14:00:00Z', sentiment: 'strength', context: 'small-group' }]
    }));
    localStorage.setItem('gb-term-ratings-course-1', JSON.stringify({
      s1: { 'term-1': {
        dims: { engagement: 4, collaboration: 3, selfRegulation: 2, resilience: 3, curiosity: 4, respect: 3 },
        workHabits: 3, participation: 4,
        socialTraits: ['leader', 'empathetic', 'low-confidence'],
        growthAreas: ['t1'],
        narrative: '<p>Cece has shown excellent growth this term.</p>'
      }}
    }));
    localStorage.setItem('gb-reflections-course-1', JSON.stringify({
      s1: { text: 'I feel more confident about science now' }
    }));
  });

  it('renders all widgets when all are enabled', () => {
    saveCardWidgetConfig({
      order: ['hero', 'sectionBars', 'completion', 'missingWork', 'growth',
              'obsSnippet', 'obsSummary', 'flagStatus', 'reflection',
              'dispositions', 'traits', 'concerns', 'workHabits', 'growthAreas',
              'narrative', 'actions'],
      disabled: []
    });

    var data = {
      sections: [{ id: 'sec1', name: 'Questioning', shortName: 'Quest', color: '#4A90D9' }],
      assessments: [{ id: 'a1' }, { id: 'a2' }],
      statuses: {},
      termId: 'term-1'
    };
    var html = MCardWidgets.assembleCard(st, cid, data);

    // All widgets should be present
    expect(html).toContain('m-scard-hero');        // hero
    expect(html).toContain('m-scard-sections');     // sectionBars
    expect(html).toContain('m-wdg-arc');           // completion
    expect(html).toContain('m-wdg-growth');        // growth
    expect(html).toContain('m-scard-obs');          // obsSnippet
    expect(html).toContain('m-wdg-obs-summary');   // obsSummary
    expect(html).toContain('m-wdg-reflection');    // reflection
    expect(html).toContain('m-wdg-dispositions');  // dispositions
    expect(html).toContain('m-wdg-traits');        // traits
    expect(html).toContain('m-wdg-concerns');      // concerns
    expect(html).toContain('m-wdg-habits');        // workHabits
    expect(html).toContain('m-wdg-growth-areas');  // growthAreas
    expect(html).toContain('m-wdg-narrative');      // narrative
    expect(html).toContain('m-scard-actions');      // actions
  });

  it('editor toggle cycle preserves other widgets', () => {
    // Start with defaults
    var config = getCardWidgetConfig();
    expect(config.order.length).toBe(4);

    // Enable dispositions
    MCardWidgetEditor.toggleWidget('dispositions');
    config = getCardWidgetConfig();
    expect(config.order).toContain('dispositions');
    expect(config.order.length).toBe(5);

    // Disable sectionBars
    MCardWidgetEditor.toggleWidget('sectionBars');
    config = getCardWidgetConfig();
    expect(config.order).not.toContain('sectionBars');
    expect(config.order).toContain('dispositions');
    expect(config.order.length).toBe(4);

    // Card still renders
    var data = { sections: [], assessments: [], statuses: {}, termId: 'term-1' };
    var html = MCardWidgets.assembleCard(st, cid, data);
    expect(html).toContain('m-scard');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run tests/mobile-*.test.js`
Expected: All tests PASS

- [ ] **Step 3: Run the full test suite to catch regressions**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/mobile-card-widgets.test.js
git commit -m "test: add integration tests for full widget render cycle"
```

---

## Task 12: Load card-widgets.js in index.html and Final Verification

**Files:**
- Verify: `teacher-mobile/index.html`

- [ ] **Step 1: Verify script loading order in index.html**

Read `teacher-mobile/index.html` and confirm the scripts are loaded in this order:
1. `../shared/constants.js`
2. `../shared/data.js`
3. `../shared/calc.js`
4. `components.js`
5. `card-stack.js`
6. `card-widgets.js` (new)
7. `card-widget-editor.js` (new)
8. `tab-students.js`
9. `tab-observe.js`
10. `tab-grade.js`
11. `shell.js`

If the order is wrong, fix it. `card-widgets.js` must come after `components.js` (uses `MComponents`) and before `tab-students.js` (which calls `MCardWidgets.assembleCard`). `card-widget-editor.js` must come after `card-widgets.js`.

- [ ] **Step 2: Run the full test suite one final time**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: verify script loading order and final cleanup"
```
