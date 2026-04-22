/**
 * Test setup — bridges script-tag globals into Node for Vitest.
 * Reads source files as text and evaluates them so all top-level
 * functions become available as globals, just like in the browser.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { runInThisContext } from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

// Shim browser globals that source files reference
globalThis.window = globalThis;
globalThis.localStorage = {
  _store: {},
  getItem(k) {
    return this._store[k] ?? null;
  },
  setItem(k, v) {
    this._store[k] = String(v);
  },
  removeItem(k) {
    delete this._store[k];
  },
  clear() {
    this._store = {};
  },
  key(i) {
    return Object.keys(this._store)[i] ?? null;
  },
  get length() {
    return Object.keys(this._store).length;
  },
};
globalThis.sessionStorage = {
  _store: {},
  getItem(k) {
    return this._store[k] ?? null;
  },
  setItem(k, v) {
    this._store[k] = String(v);
  },
  removeItem(k) {
    delete this._store[k];
  },
  clear() {
    this._store = {};
  },
};
// Minimal DOM element stub
function _stubElement() {
  return {
    innerHTML: '',
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    removeAttribute() {},
    appendChild() {},
    contains() {
      return false;
    },
    closest() {
      return null;
    },
    childNodes: [],
    nodeType: 1,
    tagName: 'DIV',
    attributes: [],
    replaceWith() {},
    textContent: '',
  };
}
globalThis.document = {
  createElement: () => _stubElement(),
  createTextNode: t => ({ nodeType: 3, textContent: t }),
  getElementById: () => _stubElement(),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { appendChild: () => {} },
};
globalThis.URLSearchParams = URLSearchParams;
globalThis.BroadcastChannel = class {
  postMessage() {}
  close() {}
  onmessage() {}
};
globalThis.getSupabase = () => ({
  auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    getUser: () => Promise.resolve({ data: { user: null } }),
  },
  from: () => ({
    upsert: () => Promise.resolve({}),
    delete: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }) }),
    select: () => Promise.resolve({ data: [] }),
  }),
});
globalThis.showSyncToast = () => {};
// Override setTimeout to prevent gb-ui.js _populateDockUser from firing
const _realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => {
  /* no-op during setup */
};
// navigator is read-only in Node — define serviceWorker if missing
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'test' };
globalThis.requestAnimationFrame = fn => fn();
globalThis.addEventListener = () => {};
globalThis.history = { replaceState() {} };
globalThis.location = { hash: '', href: '', pathname: '', search: '' };

// Page module stubs (required by gb-router.js)
['PageDashboard', 'PageAssignments', 'PageStudent', 'PageGradebook', 'PageObservations', 'PageReports'].forEach(p => {
  globalThis[p] = { init() {}, destroy() {} };
});

// Boot dependency stubs (required by gb-router.js boot())
globalThis.requireAuth = () => {};
globalThis.initAllCourses = async () => {};
globalThis.initData = async () => {};
globalThis.seedIfNeeded = () => {};
globalThis.migrateAllStudents = () => {};

// Load source files in dependency order using vm.runInThisContext
// This executes code in the actual global scope (unlike new Function which creates a new scope)
function load(file) {
  const code = readFileSync(resolve(root, file), 'utf-8');
  runInThisContext(code, { filename: file });
}

load('shared/constants.js');
load('shared/data.js');
load('shared/calc.js');
load('teacher/ui.js');
load('teacher/router.js');

// Restore real setTimeout after loading (tests may need it)
globalThis.setTimeout = _realSetTimeout;
