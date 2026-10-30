/* Runs Generate in Node for the evaluation scripts (plan PR 14), on one
 * class's data saved from the browser. Nothing here reaches the network:
 * getSupabase is a stub with no client behind it, and the class arrives as a
 * local file.
 *
 * The class file is what get_class_bundle returns for the class (the same
 * shape the app loads); its gradebook.course is the class's course row. A
 * file of { bundle, course } is read too, `course` then being the class's
 * list_teacher_courses row. The PR that added these scripts says how to save
 * one from fullvision.ca.
 *
 * Privacy: real student data is read only from a path outside the repo and
 * written only to a path outside it (assertOutsideRepo). Nothing about a
 * student is printed. */
import { readFileSync } from 'fs';
import { dirname, relative, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* Student data never sits in the repo, where a commit could take it to
   GitHub: every input and output path must be outside it. */
export function assertOutsideRepo(path, what) {
  const abs = resolve(path);
  const rel = relative(ROOT, abs);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(what + ' must be outside the FullVision folder, so student data is never committed: ' + abs);
  }
  return abs;
}

export function readJson(path, what) {
  const abs = assertOutsideRepo(path, what);
  try {
    return JSON.parse(readFileSync(abs, 'utf-8'));
  } catch (e) {
    throw new Error('Could not read ' + what + ' (' + abs + '): ' + e.message);
  }
}

const FILES = [
  'shared/constants.js',
  'shared/reporting-term-presets.js',
  'shared/data.js',
  'shared/calc.js',
  'shared/rubric-draft.js',
  'shared/rubric-checks.js',
  'teacher/ui.js',
  'teacher/report-blocks.js',
  'shared/comment-bank.js',
  'teacher/comment-realiser.js',
  'teacher/comment-bank.js',
  'shared/questionnaire-templates.js',
  'teacher/questionnaires.js',
  'teacher/student-voice.js',
];

let _report = 1;

function memoryStorage() {
  return {
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
}

function stubElement() {
  return {
    innerHTML: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    appendChild() {},
    contains: () => false,
    closest: () => null,
    childNodes: [],
    attributes: [],
    textContent: '',
  };
}

/* The browser globals the app's scripts read while loading, then the
   scripts themselves, in the order app.html loads them. Under vitest
   (tests/setup.js) they are loaded already. */
export function loadApp() {
  const g = globalThis;
  if (!g.window) g.window = g;
  if (!g.localStorage) g.localStorage = memoryStorage();
  if (!g.sessionStorage) g.sessionStorage = memoryStorage();
  if (!g.document) {
    g.document = {
      createElement: () => stubElement(),
      createTextNode: t => ({ nodeType: 3, textContent: t }),
      getElementById: () => stubElement(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { appendChild() {} },
    };
  }
  // The report picker: ReportBlocks.getTermId() reads the report from it.
  const byId = g.document.getElementById;
  if (!byId._evalReport) {
    const picker = function (id) {
      if (id === 'report-period') return { value: 'Report ' + _report, options: [], selectedIndex: -1 };
      return byId.call(g.document, id);
    };
    picker._evalReport = true;
    g.document.getElementById = picker;
  }
  if (g.CommentBank) return;
  if (!g.navigator) g.navigator = { userAgent: 'node' };
  if (!g.addEventListener) g.addEventListener = () => {};
  if (!g.location) g.location = { hash: '', href: '', pathname: '', search: '' };
  if (!g.history) g.history = { replaceState() {}, pushState() {} };
  if (!g.requestAnimationFrame) g.requestAnimationFrame = fn => fn();
  if (!g.BroadcastChannel) {
    g.BroadcastChannel = class {
      postMessage() {}
      close() {}
    };
  }
  // No client behind it: the class comes from the file, never the network.
  if (!g.getSupabase) g.getSupabase = () => null;
  if (!g.showSyncToast) g.showSyncToast = () => {};
  const realSetTimeout = g.setTimeout;
  g.setTimeout = () => 0;
  try {
    FILES.forEach(file => runInThisContext(readFileSync(resolve(ROOT, file), 'utf-8'), { filename: file }));
  } finally {
    g.setTimeout = realSetTimeout;
  }
}

/* Puts one class into the data layer exactly as get_class_bundle does in
   the app, for report N (Report N, term-N; 1 when not given), scoped to that
   reporting term when the class has one (the Reports page's rule). Returns {
   cid, termId, students } with the roster in the Term Questionnaire's order
   (last name). */
export function loadClass(classData, report) {
  loadApp();
  const g = globalThis;
  const bundle = classData && classData.gradebook ? classData : classData && classData.bundle;
  if (!bundle || !bundle.gradebook) throw new Error('The class file is not get_class_bundle data (no gradebook).');
  const course = (classData && classData.course) || bundle.gradebook.course;
  if (!course || !course.id) throw new Error('The class file has no course row (gradebook.course.id).');
  const cid = course.id;
  _report = Number(report) >= 1 ? Math.floor(Number(report)) : 1;
  g.localStorage.clear();
  // data.js keeps these as script-level let/const, which only another
  // script can reach.
  g.__evalClass = { course, bundle };
  runInThisContext(
    `(function (c) {
      _useSupabase = false;
      COURSES = _canonicalCoursesToBlob([c.course]);
      _cache.courses = COURSES;
      _bundleToCache(c.course.id, c.bundle);
    })(globalThis.__evalClass);`,
    { filename: 'eval-load-class' },
  );
  delete g.__evalClass;
  if (typeof g.clearProfCache === 'function') g.clearProfCache();
  const hasTerm = (g.getReportingTerms(cid) || []).some(t => Number(t.ordinal) === _report);
  g.setActiveTerm(cid, hasTerm ? _report : null);
  const termId = g.ReportBlocks.getTermId();
  const students = g.sortStudents(g.getStudents(cid) || [], 'lastName');
  return { cid, termId, students };
}
