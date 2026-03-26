# FullVision — Action Plan

Based on full codebase audit (March 2026). Issues organized by priority.

---

## P0 — Fix Now (before any production use with real student data)

### 1. Move Supabase credentials to environment variables

**Problem:** URL and publishable key are hardcoded in `gb-supabase.js:6-7`.
Anyone viewing source can see the database endpoint.

**Fix:**

- Create a minimal build/inject step. Two options:

  **Option A — Netlify env vars + inline script (no build step):**
  1. Set `SUPABASE_URL` and `SUPABASE_KEY` in Netlify UI → Site settings → Environment variables
  2. Create `netlify/edge-functions/inject-config.js` that replaces a placeholder in `app.html`
  3. In `app.html`, add before other scripts:
     ```html
     <script>
       window.__ENV = { SUPABASE_URL: '__SUPABASE_URL__', SUPABASE_KEY: '__SUPABASE_KEY__' };
     </script>
     ```
  4. Edge function replaces the `__SUPABASE_URL__` and `__SUPABASE_KEY__` placeholders at serve time

  **Option B — Simple build script (recommended):**
  1. Add a `build.sh` that copies `gb-supabase.js.template` → `gb-supabase.js` with `sed` replacements
  2. Update `netlify.toml`: `[build] command = "bash build.sh"`
  3. Keep `.env` locally for dev, Netlify env vars for production
  4. Add `gb-supabase.js` to `.gitignore`, commit only the template

- In `gb-supabase.js`, replace hardcoded values:
  ```javascript
  // Before (lines 6-7):
  const SUPABASE_URL = 'https://novsfeqjhbleyyaztmlh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable__CxM2aY7iVOxRid2EMtCiw_jT1g_n96';

  // After:
  const SUPABASE_URL = window.__ENV?.SUPABASE_URL || '';
  const SUPABASE_KEY = window.__ENV?.SUPABASE_KEY || '';
  ```

- **Rotate the existing key** in Supabase dashboard since it's been committed to git history.

---

### 2. Replace inline onclick handlers with event delegation

**Problem:** 5+ locations use `onclick="..."` in HTML template strings. If any interpolated value
is ever user-controlled, this is an XSS vector. Also blocks adding CSP headers.

**Files and lines to fix:**

| File | Line(s) | Current code | Fix |
|------|---------|-------------|-----|
| `gb-supabase.js` | ~178 | `onclick="window.location.href='login.html'"` | Add `data-action="go-login"` and a delegated click handler |
| `gb-data.js` | ~166 | `onclick="_crossTabAlerted=false;window.location.reload()"` | Add `data-action="reload-tab"` |
| `gb-data.js` | ~186 | Same reload pattern | Same fix |
| `gb-ui.js` | ~474 | `onclick="if(typeof retrySyncs==='function')retrySyncs();dismissSyncToast();"` | Add `data-action="retry-sync"` |
| `gb-ui.js` | ~599 | `onclick="window.location.reload()"` | Add `data-action="reload-page"` |

**Pattern to apply everywhere:**

```javascript
// Before (inline handler):
html += '<button onclick="doThing()">Click</button>';

// After (data-action delegation):
html += '<button data-action="do-thing">Click</button>';

// Add once, at module level:
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'do-thing': doThing(); break;
    case 'reload-page': window.location.reload(); break;
    case 'go-login': window.location.href = 'login.html'; break;
    case 'retry-sync':
      if (typeof retrySyncs === 'function') retrySyncs();
      dismissSyncToast();
      break;
  }
});
```

Since toasts are created dynamically, a single delegated listener on `document` handles all cases.

---

### 3. Add empty-array guards before Math.max/Math.min spreads

**Problem:** `Math.max(...[])` returns `-Infinity`. Two locations risk this after filtering.

**Fixes:**

```javascript
// gb-calc.js:83 — in the "highest" method branch
// Before:
return Math.max(...valid.map(s => s.score));

// After:
var mapped = valid.map(s => s.score);
return mapped.length ? Math.max(...mapped) : 0;
```

```javascript
// page-reports.js:2342-2343 — in report score aggregation
// Before:
Math.max(...aScores.map(...))

// After:
var vals = aScores.map(...);
var maxVal = vals.length ? Math.max(...vals) : 0;
```

Search for other instances: `grep -n 'Math\.\(max\|min\)(\.\.\.' *.js`

---

## P1 — Near Term (next sprint / next few sessions)

### 4. Add CI pipeline

- Create `.github/workflows/test.yml`:
  ```yaml
  name: Tests
  on: [push, pull_request]
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 20 }
        - run: npm ci
        - run: npm test
  ```
- Also add `npm run format:check` as a CI step.

### 5. Add parseInt radix everywhere

- Find all: `grep -n 'parseInt(' *.js` (expect 15-20 hits)
- Add `, 10` as second argument to each call
- Files known to need it: `page-student.js`, `page-assignments.js`, `page-reports.js`

### 6. Handle localStorage QuotaExceededError

- In `gb-data.js`, wrap all `localStorage.setItem()` calls:
  ```javascript
  function _safeLSSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('localStorage full, clearing old data');
        _clearStaleLSData();
      }
    }
  }
  ```
- Replace direct `localStorage.setItem` calls with `_safeLSSet`.

### 7. Replace empty catch blocks

- `gb-data.js:195` — `catch(e){}` → `catch(e){ console.warn('BroadcastChannel error:', e); }`
- `gb-data.js:467` — `catch{}` → `catch(e){ console.warn('Course load fallback:', e); }`
- Audit for others: `grep -n 'catch\s*{' *.js` and `grep -n 'catch(.*)\s*{}' *.js`

### 8. Add CSP headers (after P0-2 is done)

- In `netlify.toml` or `_headers`, add:
  ```
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  ```
- Test thoroughly — inline styles are used heavily, so `'unsafe-inline'` for style-src is needed.
- No `'unsafe-inline'` for script-src since inline handlers will be removed in P0-2.

---

## P2 — Medium Term (next month)

### 9. Expand test coverage

Priority targets (most failure-prone, least tested):

1. **Supabase sync layer** (`gb-data.js:200-280`)
   - Mock Supabase client, test retry queue, test sync status transitions
   - Test `_doSync` success/failure/retry paths
2. **Page module init/destroy lifecycle**
   - Verify event listeners are cleaned up on page switch
3. **Report generation** (`report-blocks.js`)
   - Test block rendering with various data states

### 10. Add exponential backoff to retry queue

- In `gb-data.js`, replace fixed `setTimeout(10000)`:
  ```javascript
  var retryDelay = Math.min(10000 * Math.pow(2, retryCount), 300000); // max 5 min
  ```

### 11. Debounce gradebook rendering

- In `page-gradebook.js`, wrap filter/sort handlers:
  ```javascript
  var _renderTimer;
  function scheduleRender() {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(render, 150);
  }
  ```

### 12. Add error monitoring

- Integrate Sentry (free tier) or similar:
  ```javascript
  window.addEventListener('error', function(e) { /* report */ });
  window.addEventListener('unhandledrejection', function(e) { /* report */ });
  ```
- Especially important for catching Supabase sync failures in production.

### 13. Add asset fingerprinting

- If adding a build step (P0-1 Option B), extend it to append content hashes:
  `gb-calc.js` → `gb-calc.a1b2c3.js`
- Update `app.html` references during build.
- Change cache headers to `max-age=31536000` (1 year) for fingerprinted assets.

---

## P3 — Long Term (roadmap)

### 14. Introduce a build step

Even a minimal one (no bundler needed) enables:
- Env var injection (solves P0-1 permanently)
- Asset fingerprinting (solves P2-13)
- Minification (~30-40% size reduction)
- Could use a simple shell script or esbuild (fast, zero-config)

### 15. Evaluate ES modules migration

- Current IIFE pattern works but prevents tree-shaking and modern tooling.
- Migration path: Convert one module at a time, starting with leaf modules (`gb-constants.js`, `gb-calc.js`).
- Keep backward compat during transition with a bundler that outputs IIFE.

### 16. Add E2E tests

- Playwright recommended (fast, reliable, good Netlify integration).
- Start with critical paths: login → create class → add student → score assignment → view report.
- Run in CI on deploy previews.

### 17. Standardize naming conventions

- Adopt consistent rules:
  - `camelCase` for variables and functions
  - `SCREAMING_CASE` for true constants
  - `_prefixed` only for module-private variables
- Apply incrementally, one module per PR.

---

## Quick Reference: File Locations

| File | Lines | Role |
|------|-------|------|
| `gb-supabase.js` | 200 | Auth, credentials (**P0-1**) |
| `gb-data.js` | 1,223 | Data layer, sync, caching (**P0-2, P1-6, P1-7**) |
| `gb-calc.js` | 463 | Proficiency engine (**P0-3**) |
| `gb-ui.js` | 655 | UI helpers, toasts (**P0-2**) |
| `page-reports.js` | 2,780 | Report generation (**P0-3**) |
| `page-assignments.js` | 2,097 | Assignments (**P1-5**) |
| `page-gradebook.js` | 871 | Gradebook (**P2-11**) |
| `page-student.js` | 848 | Student view (**P1-5**) |
| `netlify.toml` | 23 | Deploy config (**P1-8**) |
