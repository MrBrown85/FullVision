/**
 * How many times the page on screen is drawn again as a class and its
 * Draft and Returned rows load (S2-F1, the third review). The first time a
 * class's rows are read in a session the page is drawn (it may have drawn
 * while they were missing and waited, ReportScores.ready); a refresh that
 * brings a changed class is drawn once, by the refresh itself; a check
 * that finds nothing new draws nothing. A class whose student page is off
 * is drawn as it always was.
 *
 * The harness is tests/grade-return-server.test.js's.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';
import { syntheticClass } from './eval-fixture.js';

// Production loads the outbox next to shared/data.js; so does this test.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = 'e0000000-0000-4000-8000-000000000001';
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NOOR = id(100);
const MATEO = id(101);
const PRIYA = id(102);
const CAUSES = id(300); // 1.1 Causes of the War: Significance and Evidence
const WEEK1 = id(301); // Current Events: Week 1: Continuity and Change
const SIGNIFICANCE = id(400);
const CHANGE = id(402);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NEW_RPCS = /grade_return|return_grades|student_card|draft_count/;

let fake;
let original;
let version; // the class's version on the server
let course; // what the server holds of the two settings
let rows; // what list_course_grade_returns sends; null: what the rule gives, as the triggers would
let toasts;

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const names = () => fake.calls.map(c => c.name);
const callsTo = name => fake.calls.filter(c => c.name === name).map(c => c.params);
const patches = () => callsTo('update_course').map(p => p.p_patch);
const state = (sid, aid) => GradeState.stateOf(CID, sid, aid);
const level = (sid, aid, tag, value) => Grader.setLevel(CID, sid, aid, tag, value, 0);

function forgetMemory() {
  Object.keys(_DATA_KEYS).forEach(function (field) {
    delete _cache[field][CID];
  });
  delete _classVersion[CID];
  delete _classFresh[CID];
  delete _refreshState[CID];
  delete _loadError[CID];
  delete _gradeReturnsLoadedFor[CID];
  delete _gradeReturnsReadThisSession[CID];
  delete _gradeReturnsRefresh[CID];
  if (typeof _gradeReturnsStale !== 'undefined') delete _gradeReturnsStale[CID];
  // A new session reads the server's word from the saved copy's record.
  if (typeof _serverStudentPage !== 'undefined') delete _serverStudentPage[CID];
  delete _localWrites[CID];
  _serverState = {};
  _dirtyMarked = {};
  clearProfCache();
}

// The server's triggers keep the rows this device's rule keeps (the cases
// file holds the two together), so a test that is not about a difference
// has the server send what this device holds.
const serverRows = () => (rows === null ? getGradeReturns(CID) : rows);

function serverClass() {
  const bundle = syntheticClass();
  bundle.version = version;
  if (course) Object.assign(bundle.gradebook.course, course);
  return bundle;
}

// Everything this device still has to do about the class's rows.
async function quiet() {
  for (let i = 0; i < 40; i++) {
    await settle();
    const st = _gradeReturnsRefresh[CID];
    const refresh = _refreshState[CID];
    if (!(st && st.running) && !(refresh && refresh.running) && !_hasUnsentWrites()) return;
    await Promise.race([
      Promise.all([st && st.running, refresh && refresh.running]),
      new Promise(r => setTimeout(r, 300)),
    ]);
  }
  throw new Error('the class never went quiet');
}
async function sendAll() {
  setOnline(true);
  await window.v2Queue.flush();
  await settle();
}
async function openClass() {
  await initData(CID);
  await settle();
}

beforeEach(() => {
  original = {
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    teacher: _teacherId,
    quiet: _REFRESH_QUIET_MS,
    toast: globalThis.showSyncToast,
  };
  _REFRESH_QUIET_MS = 0;
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-a';
  globalThis.__FV_CLASS_BUNDLE = true;
  localStorage.clear();
  forgetMemory();
  version = 1;
  course = { student_page_enabled: true, return_grades: 'on_return' };
  rows = {};
  toasts = [];
  globalThis.showSyncToast = (...args) => toasts.push(args);
  fake = makeFakeSupabase();
  fake.on('get_class_bundle', p =>
    p.p_if_version === version
      ? { data: { not_modified: true, version }, error: null }
      : { data: serverClass(), error: null },
  );
  fake.on('list_course_grade_returns', () => ({ data: structuredClone(serverRows()), error: null }));
  globalThis.getSupabase = () => fake;
  setOnline(true);
  window.v2Queue.clear();
  saveCourses({ [CID]: { id: CID, name: 'History 12' } });
  saveConfig({ activeCourse: CID });
  fake.calls.length = 0;
});

afterEach(async () => {
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  _loadRetryCount = 0;
  window.v2Queue.clear();
  forgetMemory();
  globalThis.getSupabase = original.getSupabase;
  globalThis.showSyncToast = original.toast;
  _useSupabase = original.useSupabase;
  _teacherId = original.teacher;
  _REFRESH_QUIET_MS = original.quiet;
  globalThis.__FV_CLASS_BUNDLE = false;
  setOnline(true);
  localStorage.clear();
});

describe('how many times the page on screen is drawn again', () => {
  const counting = async fn => {
    const drawn = [];
    const was = Router.getCurrentPage;
    Router.getCurrentPage = () => ({ render: () => drawn.push(1) });
    try {
      await fn();
    } finally {
      Router.getCurrentPage = was;
    }
    return drawn.length;
  };
  const refresh = async () => {
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();
  };
  it.each([
    // As main draws it: the first open draws after the load, each changed refresh once.
    ['student page off', { student_page_enabled: false, return_grades: null }, [0, 1, 1, 0, 0]],
    ['student page on, As Soon As I Save', { student_page_enabled: true, return_grades: 'on_save' }, [1, 1, 1, 0, 1]],
    [
      'student page on, When I Return Them',
      { student_page_enabled: true, return_grades: 'on_return' },
      [1, 1, 1, 0, 1],
    ],
  ])('%s', async (name, cfg, want) => {
    course = cfg;
    // The first open of the session: the class is downloaded.
    const atOpen = await counting(async () => {
      await openClass();
      await quiet();
    });
    // Another device changes the class, twice.
    version = 2;
    const atRefresh = await counting(refresh);
    version = 3;
    const atRefresh2 = await counting(refresh);
    // A check that finds nothing new.
    const atCheck = await counting(refresh);
    // A saved copy the server says is current, its rows not read yet (as at the start of a session).
    delete _gradeReturnsLoadedFor[CID];
    const unchangedRowsMissing = await counting(refresh);
    expect([atOpen, atRefresh, atRefresh2, atCheck, unchangedRowsMissing]).toEqual(want);
  });
});
