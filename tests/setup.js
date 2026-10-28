/**
 * Test setup — bridges script-tag globals into Node for Vitest.
 * Reads source files as text and evaluates them so all top-level
 * functions become available as globals, just like in the browser.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { runInThisContext } from 'vm';
import { beforeEach } from 'vitest';

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
// Delivers to every other open channel with the same name, a tick later, the
// way the browser does between tabs. A test that loads shared/offline-queue.js
// twice gets two "tabs" that hear each other.
const _channels = {};
globalThis.BroadcastChannel = class {
  constructor(name) {
    this.name = String(name);
    this.onmessage = null;
    this._open = true;
    (_channels[this.name] = _channels[this.name] || []).push(this);
  }
  postMessage(data) {
    const copy = JSON.parse(JSON.stringify(data === undefined ? null : data));
    (_channels[this.name] || []).forEach(ch => {
      if (ch === this || !ch._open) return;
      queueMicrotask(() => {
        if (ch._open && typeof ch.onmessage === 'function') ch.onmessage({ data: copy });
      });
    });
  }
  close() {
    this._open = false;
    _channels[this.name] = (_channels[this.name] || []).filter(ch => ch !== this);
  }
};
// Web Locks: one holder per name, the rest wait in order; a waiter can leave
// with its AbortSignal. shared/offline-queue.js elects the sending tab with it.
const _locks = {};
function _fakeLocksRequest(name, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  return new Promise((resolve, reject) => {
    const lock = (_locks[name] = _locks[name] || { held: false, waiters: [] });
    const waiter = { run, abort };
    function run() {
      lock.held = true;
      Promise.resolve()
        .then(() => callback({ name, mode: 'exclusive' }))
        .then(
          value => {
            letGo();
            resolve(value);
          },
          err => {
            letGo();
            reject(err);
          },
        );
    }
    function letGo() {
      lock.held = false;
      const next = lock.waiters.shift();
      if (next) next.run();
    }
    function abort() {
      const at = lock.waiters.indexOf(waiter);
      if (at < 0) return;
      lock.waiters.splice(at, 1);
      reject(new Error('AbortError: the lock request was aborted'));
    }
    if (options.signal) {
      if (options.signal.aborted) return reject(new Error('AbortError: the lock request was aborted'));
      options.signal.addEventListener('abort', abort);
    }
    if (lock.held) lock.waiters.push(waiter);
    else run();
  });
}
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
// Tests mock the separate reads; tests/data-class-bundle.test.js turns the
// single get_class_bundle request on.
globalThis.__FV_CLASS_BUNDLE = false;
// Override setTimeout to prevent gb-ui.js _populateDockUser from firing
const _realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => {
  /* no-op during setup */
};
// navigator is read-only in Node — define serviceWorker if missing
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'test' };
Object.defineProperty(globalThis.navigator, 'locks', {
  value: { request: _fakeLocksRequest },
  configurable: true,
  writable: true,
});
globalThis.requestAnimationFrame = fn => fn();
globalThis.addEventListener = () => {};
globalThis.history = { replaceState() {}, pushState() {} };
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
load('shared/reporting-term-presets.js');
load('shared/data.js');
load('shared/calc.js');
load('shared/rubric-draft.js');
load('shared/rubric-checks.js');
load('teacher/ui.js');
load('teacher/report-blocks.js');
load('teacher/report-sheets.js');
load('teacher/report-issues.js');
load('shared/comment-bank.js');
load('teacher/comment-bank.js');
load('teacher/report-questionnaire.js');
load('teacher/report-studio.js');
load('teacher/report-preview.js');
load('vendor/qrcode.js');
load('shared/questionnaire-templates.js');
load('teacher/questionnaires.js');
load('teacher/qr-slips.js');
load('teacher/cm-questionnaires.js');
load('teacher/student-voice.js');
load('teacher/learner-profile.js');
load('shared/phone-report-view.js');
load('teacher/phone-reports.js');
load('teacher/dash-class-manager.js');
load('teacher/dash-overview.js');
load('teacher/dash-observations.js');
load('teacher/dash-student-cards.js');
load('teacher/dash-insights.js');
load('teacher/assign-collab.js');
load('teacher/assessment-copy.js');
load('teacher/rubric-guard.js');
load('teacher/obs-capture.js');
load('teacher/obs-card.js');
load('teacher/student-evidence.js');
load('teacher/competency-evidence.js');
load('teacher/student-overrides.js');
load('teacher/rubric-print.js');
load('teacher/grades-print.js');
load('teacher/rubric-library.js');
load('teacher/rubric-bank.js');
load('teacher/grading-setup-copy.js');
load('teacher/router.js');

// Restore real setTimeout after loading (tests may need it)
globalThis.setTimeout = _realSetTimeout;

// The server-state baseline (shared/data.js) is per-session memory; each test
// starts a fresh session alongside its cleared localStorage and cache.
beforeEach(() => {
  _serverState = {};
  _localWrites = {};
  _refreshState = {};
});
