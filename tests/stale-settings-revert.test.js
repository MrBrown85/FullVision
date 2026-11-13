/**
 * A device with an old copy of a class's settings must not put them back.
 *
 * Saving one class setting sent this device's copy of every other setting
 * (saveCourseConfig built its update_course patch from the whole copy). So a
 * laptop that loaded the class before a change made at school put the old
 * value back the next time it saved anything, with no word to the teacher.
 * And a class load never replaced the calculation method or decay weight in
 * the device's copy, so the laptop went on putting them back, and grading
 * with them, even after it reloaded.
 *
 * Two devices here are "the laptop" (the device this file drives: the real
 * data layer, outbox and Class Settings) and "the school computer". The
 * school computer's change reaches the stand-in server as one request
 * naming the one setting (server.fromAnotherDevice); the first describe
 * checks that this is what a real device with a fresh copy sends, and the
 * grades test near the end runs both devices for real, one after the other.
 *
 * The server is tests/helpers/class-settings-server.js: the live
 * update_course and save_categories rules over one class.
 *
 * The phone has no screen that saves a class setting; the last describe
 * holds that. Demo Mode has one device and no server, so nothing here
 * applies to it (tests/demo-mode-no-server-calls.test.js holds that it
 * sends nothing).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { settle } from './helpers/fake-supabase.js';
import {
  CAT_ASSIGNMENTS,
  CAT_TESTS,
  CID,
  TEACHER,
  UPDATE_COURSE_COLUMNS,
  classSettingsServer,
} from './helpers/class-settings-server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf-8');
const QUEUE_SOURCE = read('shared/offline-queue.js');
const clone = v => JSON.parse(JSON.stringify(v));
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const STUDENTS = [100, 101, 102, 103, 104].map(id); // the fixture's five, in roster order

/* The real waits above (two seconds, then one-second retries) can stack in a
   test that opens the app twice, so the five-second default is too tight on a
   busy machine. The wait itself ends the moment the laptop is quiet. */
const QUIET_CAP_MS = 20000;
vi.setConfig({ testTimeout: 30000 });

let server;
let original;
let tabs = [];

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

/* ── The laptop ─────────────────────────────────────────────────────────── */

/* Everything a page holds in memory goes, as on a reload or when the tab is
   closed. localStorage (the saved classes and the outbox) stays. */
function forgetPage() {
  Object.keys(_cache).forEach(function (field) {
    _cache[field] = field === 'courses' || field === 'config' ? null : {};
  });
  COURSES = loadCourses();
  _classVersion = {};
  _classFresh = {};
  _refreshState = {};
  _loadError = {};
  _localWrites = {};
  _serverState = {};
  _dirtyMarked = {};
  _classLoads = {};
  _initPromise = null;
  _gradeReturnsLoadedFor = {};
  _studentSaveQueue = {};
  _assessmentSaveQueue = {};
  _categorySaveQueue = {};
  _learningMapSaveQueue = {};
  _learningMapIdRemap = {};
  _noteSaveQueue = {};
  _idRekeys = {};
  _pendingSyncs = 0;
  _pendingLocalCids.clear();
  _idmapRaw = null;
  _idmapCache = null;
  _echoNeedsReload = false;
  _classBundleMissing = false;
  _useSupabase = false;
  _supabaseDegraded = false;
  _teacherId = null;
  // The next write configures whichever copy of the outbox is current.
  _outboxConfigured = false;
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  clearProfCache();
  DashClassManager.resetState();
}

/* The outbox module loads again with the page. Offline while it loads, so
   its start-up flush stays quiet (as tests/write-path-audit.test.js does). */
function loadOutbox() {
  setOnline(false);
  runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
  tabs.push(window.v2Queue);
  setOnline(true);
}

/* Until the laptop has nothing left to send or load. The outbox sends its
   first flush a real two seconds after it loads (shared/offline-queue.js,
   _becomeOwner), and a send that fails waits a real second before its retry,
   so this waits for the state, not for a count of turns: a count that is
   just over two seconds on a quick machine is under it on a busy one. The
   twenty seconds only ends a run that is really stuck. */
async function quiet() {
  const giveUp = Date.now() + QUIET_CAP_MS;
  while (Date.now() < giveUp) {
    await settle();
    const refresh = _refreshState[CID];
    if (!(refresh && refresh.running) && !_hasUnsentWrites()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('the laptop never went quiet');
}

/* The teacher opens the app: sign-in state, the class list, the class, and
   Class Settings on that class. `connected: false` opens it with no
   connection (the saved copy, the outbox holding its writes). */
async function openApp(opts) {
  const connected = !opts || opts.connected !== false;
  forgetPage();
  loadOutbox();
  setOnline(connected);
  server.reachable = connected;
  await initAllCourses();
  await initData(CID);
  if (connected) await quiet();
  else await settle();
  DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager();
  DashClassManager.handleAction('cmTermCancel', { dataset: {} }); // no term edits left from another test
  await settle();
  if (connected) await quiet();
}

/* The class changed on the server and the laptop hears of it (its sync
   cursor moves): the class is read again. */
async function hearOfChange() {
  await _handleExternalCourseUpdate(CID, 'gradebook');
  await quiet();
}

async function goOffline() {
  setOnline(false);
  server.reachable = false;
}
async function goOnline() {
  server.reachable = true;
  setOnline(true);
  await window.v2Queue.flush();
  await quiet();
}

/* A device's saved state, so two devices can take turns in one test: what
   is in its browser (localStorage). Its memory is gone when it comes back,
   as after the app is closed. */
function closeApp() {
  const image = JSON.stringify(localStorage._store);
  forgetPage();
  return image;
}
function useDevice(image) {
  forgetPage();
  localStorage._store = image ? JSON.parse(image) : {};
}

/* ── Class Settings, as the teacher's clicks reach it ───────────────────── */
const act = (action, dataset) => DashClassManager.handleAction(action, { dataset: dataset || {} });
const input = (action, dataset, value) =>
  DashClassManager.handleInput({ dataset: Object.assign({ actionInput: action }, dataset), value: String(value) });
const change = (action, props) =>
  DashClassManager.handleChange(Object.assign({ dataset: { actionChange: action } }, props));
const blur = (action, value) => DashClassManager.handleBlur({ dataset: { actionBlur: action }, value: value });

const BC_SCALE = () => ({
  boundaries: clone(DEFAULT_GRADING_SCALE.boundaries),
  percents: clone(BC_LETTER_BAND_PERCENTS),
  labels: null,
});
const TERMS_A = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-08', ends_on: '2027-01-29' },
  { ordinal: 2, label: 'Term 2', starts_on: '2027-02-01', ends_on: '2027-06-25' },
];
const TERMS_B = [
  { ordinal: 1, label: 'Semester 1', starts_on: '2026-09-08', ends_on: '2027-01-22' },
  { ordinal: 2, label: 'Semester 2', starts_on: '2027-01-25', ends_on: '2027-06-29' },
];

/* Every class setting, each with: the server column that holds it; the
   value the laptop has (`was`) and the one the school computer gives it
   (`now`), as the column holds them; `set`, the teacher's own action in
   Class Settings; and `held`, what this device works with, read the way the
   app reads it. `harm` is the reviewer's list: these change grades or
   report dates. */
const SETTINGS = [
  {
    name: 'Calculation Method',
    col: 'calc_method',
    harm: true,
    was: 'mostRecent',
    now: 'highest',
    set: v => act('cmSetCalcMethod', { value: v }),
    // shared/calc.js: cc.calcMethod || course.calcMethod || 'average'
    held: () => (getCourseConfig(CID) || {}).calcMethod || (COURSES[CID] || {}).calcMethod || 'average',
  },
  {
    name: 'Decay Weight',
    col: 'decay_weight',
    harm: true,
    was: 0.7,
    now: 0.9,
    set: v => input('cmDecaySlider', {}, Math.round(v * 100)),
    // shared/calc.js: cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65
    held: () => {
      const cc = getCourseConfig(CID) || {};
      return Number(cc.decayWeight != null ? cc.decayWeight : (COURSES[CID] || {}).decayWeight || 0.65);
    },
  },
  {
    name: 'Count Only the Most Recent',
    col: 'recent_score_limit',
    harm: true,
    was: 3,
    now: 5,
    set: v => change('cmRecentLimit', { value: v ? String(v) : '' }),
    held: () => getRecentScoreLimit(CID) || null,
  },
  {
    name: 'Count Only the Most Recent, back to All Scores',
    col: 'recent_score_limit',
    harm: true,
    was: 3,
    now: null,
    set: v => change('cmRecentLimit', { value: v ? String(v) : '' }),
    held: () => getRecentScoreLimit(CID) || null,
  },
  {
    name: 'Folders Count as One',
    col: 'folders_count_as_one',
    harm: true,
    was: false,
    now: true,
    set: v => change('cmFoldersCountAsOne', { checked: v }),
    held: () => getFoldersCountAsOne(CID),
  },
  {
    name: 'Each Course Counts Equally',
    col: 'courses_count_equally',
    harm: true,
    was: true,
    now: false,
    set: v => change('cmCoursesCountEqually', { checked: v }),
    held: () => getCoursesCountEqually(CID),
  },
  {
    name: 'Grading Scale',
    col: 'grading_scale',
    harm: true,
    was: BC_SCALE(),
    now: clone(DEFAULT_GRADING_SCALE),
    // The two scales Class Settings has a button for.
    set: v => act(v.percents['4-'] != null ? 'cmPointsScaleBc' : 'cmPointsScaleReset'),
    held: () => clone(getGradingScale(CID)),
  },
  {
    name: 'Category Weights (the course’s summative and formative split)',
    col: 'category_weights',
    harm: true,
    was: { summative: 0.6, formative: 0.4 },
    now: { summative: 0.8, formative: 0.2 },
    // No screen sets it today; saved as any caller of the data layer would.
    set: v => saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { categoryWeights: clone(v) })),
    held: () => clone(getCategoryWeights(CID)),
  },
  {
    name: 'Round to a Whole %',
    col: 'round_percent',
    harm: true,
    was: true,
    now: false,
    set: v => act('cmSetRoundPercent', { value: v ? 'whole' : 'decimal' }),
    held: () => getRoundWholePercent(CID),
    other: 'Rubric Levels',
  },
  {
    name: 'Grading Style',
    col: 'grading_system',
    harm: true,
    was: 'letter',
    now: 'both',
    set: v => act('cmSetGradingSystem', { value: v }),
    held: () => courseGradeMode(CID),
  },
  {
    name: 'Reporting Terms',
    col: 'reporting_terms',
    harm: true,
    was: TERMS_A,
    now: TERMS_B,
    set: rows => {
      act('cmTermPreset', { value: 'semesters' }); // two rows to type into
      rows.forEach((r, i) =>
        ['label', 'starts_on', 'ends_on'].forEach(f => input('cmTermLive', { idx: String(i), field: f }, r[f])),
      );
      act('cmTermSave');
    },
    held: () => clone(getReportingTerms(CID)),
  },
  {
    name: 'Rubric Levels',
    col: 'level_order',
    was: 'asc',
    now: 'desc',
    set: v => act('cmSetLevelOrder', { value: v }),
    held: () => (levelOrderFor(CID)[0] === 1 ? 'asc' : 'desc'),
  },
  {
    name: 'Time Zone',
    col: 'timezone',
    was: 'America/Vancouver',
    now: 'America/Edmonton',
    set: null, // no screen changes it: create_course sets it, the server keeps it
    held: () => (COURSES[CID] || {}).timezone,
  },
  {
    name: 'Late Work Policy',
    col: 'late_work_policy',
    was: 'Two days of grace.',
    now: 'No late work after the unit test.',
    set: v => blur('cmLateWorkPolicy', v),
    held: () => (COURSES[CID] || {}).lateWorkPolicy,
  },
];
const byName = name => SETTINGS.find(s => s.name === name);

/* The laptop came to hold `was`: it chose it itself, some time ago. (Time
   Zone has no screen, so the server starts with it.) */
async function laptopHolds(s) {
  if (!s.set) {
    expect(server.course[s.col]).toEqual(s.was);
    return;
  }
  s.set(s.was);
  await quiet();
  expect(server.course[s.col], 'the laptop’s own earlier change reached the server').toEqual(s.was);
}
/* At school, later: one request naming the one setting. */
function schoolSets(s) {
  server.fromAnotherDevice('update_course', { p_course_id: CID, p_patch: { [s.col]: clone(s.now) } });
  expect(server.course[s.col]).toEqual(s.now);
}
/* Tonight, on the laptop: a different setting, nothing else. */
async function laptopSavesAnother(s) {
  const other = byName(s.other || 'Round to a Whole %');
  other.set(other.was);
  await quiet();
  expect(server.course[other.col], 'the setting the laptop did change was saved').toEqual(other.was);
}

beforeEach(() => {
  original = {
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    teacher: _teacherId,
    quiet: _REFRESH_QUIET_MS,
    bundle: globalThis.__FV_CLASS_BUNDLE,
    confirm: globalThis.showConfirm,
    queue: window.v2Queue,
    store: localStorage._store,
  };
  tabs = [];
  _REFRESH_QUIET_MS = 0;
  globalThis.__FV_CLASS_BUNDLE = true;
  // Every "this changes grades for N students" question is answered Change.
  globalThis.showConfirm = (title, message, ok, style, onConfirm) => onConfirm();
  localStorage._store = {};
  server = classSettingsServer();
  globalThis.getSupabase = () => server.fake;
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  tabs.forEach(tab => {
    tab.clear();
    tab.release();
  });
  forgetPage();
  window.v2Queue = original.queue;
  if (original.queue && typeof original.queue.claim === 'function') original.queue.claim();
  globalThis.getSupabase = original.getSupabase;
  globalThis.showConfirm = original.confirm;
  globalThis.__FV_CLASS_BUNDLE = original.bundle;
  _useSupabase = original.useSupabase;
  _teacherId = original.teacher;
  _REFRESH_QUIET_MS = original.quiet;
  localStorage._store = original.store;
  setOnline(true);
});

/* ── The stand-in server and the school computer are true to life ───────── */

describe('the stand-in server', () => {
  // The live function: the migration that last wrote it whole, with every
  // later in-place patch (migrations/local-test/batch-a-prelude.sql), then
  // Batch A's two columns (migrations/2026110902_grade_return.sql).
  function liveUpdateCourse() {
    const prelude = read('migrations/local-test/batch-a-prelude.sql');
    const from = prelude.indexOf('create or replace function public.update_course(');
    const body = prelude.slice(from, prelude.indexOf('$function$;', from));
    const batchA = read('migrations/2026110902_grade_return.sql');
    const patch = batchA.slice(batchA.indexOf("array['public.update_course(uuid,jsonb)'"));
    return body + patch.slice(0, patch.indexOf("array['public.move_rubric_scores"));
  }

  it('reads every column of update_course the way the live function does: only from a key the patch has', () => {
    const sql = liveUpdateCourse();
    const found = {};
    // name = coalesce(p_patch->>'name', name)   |   color = case when p_patch ? 'color' then … else color end
    const assign = /^\s+(\w+)\s*=\s*(coalesce\(p_patch->>'(\w+)',\s*(\w+)\)|case when p_patch \? '(\w+)')/gm;
    let m;
    while ((m = assign.exec(sql))) {
      const col = m[1];
      if (m[3]) {
        expect([m[3], m[4]], col).toEqual([col, col]);
        found[col] = 'coalesce';
      } else {
        expect(m[5], col).toBe(col);
        // …and the column keeps its value when the key is not there.
        expect(sql, col).toMatch(
          new RegExp(col + "\\s*=\\s*case when p_patch \\? '" + col + "'[\\s\\S]*?else " + col + ' end'),
        );
        found[col] = 'key';
      }
    }
    expect(found).toEqual(UPDATE_COURSE_COLUMNS);
    // Nothing else is assigned from the patch: updated_at is the one other column set.
    const set = sql.slice(sql.indexOf('update course set'), sql.indexOf('where id = p_course_id'));
    const assigned = (set.match(/^\s{8}(\w+)\s*=/gm) || []).map(l => l.trim().split(/\s/)[0]);
    expect(assigned.filter(c => !UPDATE_COURSE_COLUMNS[c])).toEqual(['updated_at']);
  });

  it('leaves every other column alone when a patch names one', () => {
    const before = clone(server.course);
    server.fromAnotherDevice('update_course', { p_course_id: CID, p_patch: { round_percent: true } });
    const after = clone(server.course);
    expect(after.round_percent).toBe(true);
    delete before.round_percent;
    delete after.round_percent;
    delete before.updated_at;
    delete after.updated_at;
    expect(after).toEqual(before);
  });
});

describe('a device with a fresh copy of the class', () => {
  it.each(SETTINGS.filter(s => s.set).map(s => [s.name, s]))('saves %s, and the server takes it', async (_, s) => {
    await openApp();
    s.set(s.now);
    await quiet();
    expect(server.course[s.col]).toEqual(s.now);
    expect(s.held()).toEqual(s.now);
  });
});

/* ── (a) A save sends only what the action changed ──────────────────────── */

describe('the laptop holds an old copy and was never told of the change', () => {
  it.each(SETTINGS.map(s => [s.name, s]))(
    '%s changed at school stays changed when the laptop saves a different setting',
    async (_, s) => {
      await openApp();
      await laptopHolds(s);
      schoolSets(s);
      await laptopSavesAnother(s);
      expect(server.course[s.col]).toEqual(s.now);
    },
  );
});

describe('the laptop holds an old copy, then the class is read again from the server', () => {
  it.each(SETTINGS.map(s => [s.name, s]))(
    '%s changed at school stays changed when the laptop then saves a different setting',
    async (_, s) => {
      await openApp();
      await laptopHolds(s);
      schoolSets(s);
      await hearOfChange();
      await laptopSavesAnother(s);
      expect(server.course[s.col]).toEqual(s.now);
    },
  );
});

describe('the laptop holds an old copy, then the app is closed and opened again', () => {
  it.each(SETTINGS.map(s => [s.name, s]))(
    '%s changed at school stays changed when the laptop then saves a different setting',
    async (_, s) => {
      await openApp();
      await laptopHolds(s);
      schoolSets(s);
      await openApp(); // a new page: memory gone, the saved copy kept, the class list and the class read again
      await laptopSavesAnother(s);
      expect(server.course[s.col]).toEqual(s.now);
    },
  );
});

describe('what does not change', () => {
  it('two devices change the SAME setting: the later save is the one that stays', async () => {
    // Last write wins, for one setting. Nothing tells either teacher.
    const method = byName('Calculation Method');
    await openApp();
    await laptopHolds(method); // Most Recent
    schoolSets(method); // Highest
    method.set('decayingAvg'); // the laptop, later, not told
    await quiet();
    expect(server.course.calc_method).toBe('decayingAvg');
  });

  it('a laptop that only ever loaded the method never sent it: a method changed at school already stayed', async () => {
    // Why not every stale device did harm: the method and decay weight are
    // in a device's settings copy only once that device has chosen them
    // (or made the class). Every other setting is there from the first load.
    server.course.calc_method = 'mostRecent';
    const method = byName('Calculation Method');
    await openApp();
    expect(method.held()).toBe('mostRecent');
    schoolSets(method);
    await laptopSavesAnother(method);
    expect(server.course.calc_method).toBe('highest');
  });
});

describe('a second tab in the same browser', () => {
  // Two tabs share localStorage. The copy to compare a save against is the
  // one this tab loaded, not the one in localStorage: the other tab has
  // already written its change there.
  it('changed Rubric Levels: this tab, not told, saves a different setting and leaves it changed', async () => {
    const levels = byName('Rubric Levels');
    await openApp();
    await laptopHolds(levels);
    // The other tab's save: the server takes it, and the browser's saved copy has it.
    schoolSets(levels);
    const saved = JSON.parse(localStorage.getItem('gb-courseconfig-' + CID));
    expect(saved.levelOrder).toBe('asc');
    saved.levelOrder = 'desc';
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(saved));
    await laptopSavesAnother(levels);
    expect(server.course.level_order).toBe('desc');
  });
});

describe('a second tab, with no connection in either', () => {
  // The class cannot load from the server, so this tab works from the copy
  // it read from the browser's storage when it opened. The other tab then
  // writes its own change into that storage. What this tab saves must be
  // compared with what it read, not with the storage as it is now.
  it('changed Rubric Levels: this tab saves a different setting and queues that one key', async () => {
    const levels = byName('Rubric Levels');
    await openApp();
    await laptopHolds(levels); // Emerging First
    closeApp();

    // This tab opens with no connection: sync is paused, the class comes
    // from storage. (No retries of the first request: they only take time.)
    const delays = _BOOTSTRAP_RETRY_DELAYS_MS.splice(0);
    try {
      await openApp({ connected: false });
    } finally {
      _BOOTSTRAP_RETRY_DELAYS_MS.push(...delays);
    }
    expect(levels.held()).toBe('asc');
    expect(_hasServerState('courseConfigs', CID)).toBe(false);

    // The other tab: Extending First. Its copy goes into the shared storage
    // and its write into the shared outbox.
    const saved = JSON.parse(localStorage.getItem('gb-courseconfig-' + CID));
    saved.levelOrder = 'desc';
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(saved));
    window.v2Queue.push('update_course', { p_course_id: CID, p_patch: { level_order: 'desc', _changed_only: true } });

    act('cmSetRoundPercent', { value: 'whole' });
    await settle();
    expect(window.v2Queue.queued('update_course').map(e => e.payload.p_patch)).toEqual([
      { level_order: 'desc', _changed_only: true },
      { round_percent: true, _changed_only: true },
    ]);
    if (_recoveryProbeTimer) clearTimeout(_recoveryProbeTimer);
    _recoveryProbeTimer = null;
  });
});

/* Every way the desktop saves a class setting, each against the Calculation
   Method changed at school. */
describe('every save of a class setting on the desktop leaves a method changed at school alone', () => {
  const SRC = 'e0000000-0000-4000-8000-0000000000b2';
  const SAVES = SETTINGS.filter(s => s.set && s.col !== 'calc_method').map(s => [s.name, () => s.set(s.was)]);
  SAVES.push([
    'Class Name',
    () =>
      DashClassManager.handleBlur({
        dataset: { actionBlur: 'cmUpdateName' },
        value: 'History 12 (Block C)',
        style: {},
      }),
  ]);
  SAVES.push([
    'Copy Grading Setup into the class (Course % and Rubric Levels from another class)',
    async () => {
      // Another class on this device, set up differently.
      COURSES[SRC] = { id: SRC, name: 'History 11', gradeLevel: '11', gradingSystem: 'proficiency' };
      _cache.courseConfigs[SRC] = { roundPercent: true, levelOrder: 'asc' };
      const plan = GradingSetupCopy.planSetup(SRC, CID, { roundPercent: true, levelOrder: true });
      expect(plan.changes.map(c => c.key)).toEqual(['roundPercent', 'levelOrder']);
      await GradingSetupCopy.applySetup(plan);
    },
  ]);
  SAVES.push([
    'Save Categories (a new weighting)',
    async () => {
      input('cmCatWeightLive', { idx: '0' }, 70);
      input('cmCatWeightLive', { idx: '1' }, 30);
      act('cmCatSave');
      await quiet();
      expect(server.categories.map(c => c.weight)).toEqual([70, 30]);
    },
  ]);

  it.each(SAVES)('%s', async (_, save) => {
    const method = byName('Calculation Method');
    await openApp();
    await laptopHolds(method);
    schoolSets(method);
    await save();
    await quiet();
    expect(server.course.calc_method).toBe('highest');
  });
});

/* ── (b) A load replaces this device's settings with the server's ───────── */

describe('a class load gives this device the server’s settings', () => {
  const LOADS = [
    ['the class read again after a change elsewhere (its sync cursor moved)', hearOfChange],
    ['the app closed and opened again', () => openApp()],
    [
      'the older load, for a server with no get_class_bundle',
      async () => {
        globalThis.__FV_CLASS_BUNDLE = false;
        await openApp();
      },
    ],
  ];
  LOADS.forEach(([how, load]) => {
    it.each(SETTINGS.map(s => [s.name, s]))(how + ': %s', async (_, s) => {
      await openApp();
      await laptopHolds(s);
      schoolSets(s);
      await load();
      expect(s.held()).toEqual(s.now);
    });
  });
});

describe('two computers, one class: the grades each one works out', () => {
  // Second defect. shared/calc.js reads the method from the device's
  // settings copy first, and a class load never replaced it there. So until
  // the laptop's next settings save put the old method back on the server,
  // the two computers showed different grades for the same marks.
  const everyStudent = () => STUDENTS.map(sid => getOverallProficiency(CID, sid));
  const MOST_RECENT = [3.5, 2.5, 3, 3, 1.5];
  const HIGHEST = [4, 2.75, 3, 3.5, 2];

  it('are the same once the laptop has opened the app again after the method changed at school', async () => {
    const method = byName('Calculation Method');
    // Last month, on the laptop.
    await openApp();
    method.set('mostRecent');
    await quiet();
    expect(everyStudent()).toEqual(MOST_RECENT);
    const laptop = closeApp();

    // Today, at school: a computer that has never opened the class.
    useDevice(null);
    await openApp();
    expect(everyStudent()).toEqual(MOST_RECENT);
    method.set('highest');
    await quiet();
    expect(server.course.calc_method).toBe('highest');
    expect(everyStudent()).toEqual(HIGHEST);
    closeApp();

    // Tonight the laptop opens the app again: the class list and the class
    // are read from the server.
    useDevice(laptop);
    await openApp();
    expect(server.course.calc_method).toBe('highest');
    expect(everyStudent()).toEqual(HIGHEST);
  });

  it('are the same once the laptop has heard of the change, without closing the app', async () => {
    const method = byName('Calculation Method');
    await openApp();
    await laptopHolds(method);
    expect(everyStudent()).toEqual(MOST_RECENT);
    schoolSets(method);
    await hearOfChange();
    expect(everyStudent()).toEqual(HIGHEST);
  });
});

describe('a class this device saved with the code before this fix', () => {
  // That code never took the method from the server, so the copy it saved
  // can hold this device's own old method beside the server's version
  // number. The server answers "not modified" for that version: unless the
  // copy is distrusted once, the laptop would go on grading with its own.
  const asked = () => server.fake.calls.filter(c => c.name === 'get_class_bundle').map(c => c.params.p_if_version);

  it('is downloaded in full once, so the method it kept gives way to the server’s though nothing has changed since', async () => {
    const method = byName('Calculation Method');
    await openApp();
    await laptopHolds(method); // Most Recent
    schoolSets(method); // Highest
    await hearOfChange(); // the laptop has the class at the server's version
    closeApp();
    // As the earlier code left it: the same version, its own method kept.
    const saved = JSON.parse(localStorage.getItem('gb-courseconfig-' + CID));
    saved.calcMethod = 'mostRecent';
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(saved));
    const meta = JSON.parse(localStorage.getItem('gb-bundle-meta-' + CID));
    expect(meta).toMatchObject({ version: server.version, dirty: false, settings: 1 });
    delete meta.settings;
    localStorage.setItem('gb-bundle-meta-' + CID, JSON.stringify(meta));

    server.fake.calls.length = 0;
    await openApp();
    expect(asked()).toEqual([null]); // the whole class, not "anything new since my version?"
    expect(method.held()).toBe('highest');
    expect(STUDENTS.map(sid => getOverallProficiency(CID, sid))).toEqual([4, 2.75, 3, 3.5, 2]);

    // Once: the copy it saved this time is trusted like any other.
    server.fake.calls.length = 0;
    await openApp();
    expect(asked()).toEqual([server.version]);
    expect(method.held()).toBe('highest');
  });
});

describe('a change this device has made and not yet sent', () => {
  it('is not overwritten by the class loading: made offline, the app closed, opened again online', async () => {
    const round = byName('Round to a Whole %');
    await openApp();
    await goOffline();
    round.set(true);
    await settle();
    expect(server.course.round_percent).toBe(null);
    await openApp(); // online again: the class list and the class load while the change still waits
    await goOnline();
    expect(server.course.round_percent).toBe(true);
    expect(getRoundWholePercent(CID)).toBe(true);
  });

  it('is not overwritten by a change heard of from elsewhere while it waits', async () => {
    const levels = byName('Rubric Levels');
    await openApp();
    await goOffline();
    levels.set('asc');
    await settle();
    schoolSets(byName('Count Only the Most Recent')); // something else changes at school
    server.reachable = true;
    setOnline(true);
    await hearOfChange();
    expect(server.course.level_order).toBe('asc');
    expect(levels.held()).toBe('asc');
    expect(server.course.recent_score_limit).toBe(5);
    expect(getRecentScoreLimit(CID)).toBe(5);
  });

  it('a Grading Style change made offline shows on this device after the app is opened again', async () => {
    const style = byName('Grading Style');
    await openApp();
    await goOffline();
    style.set('letter');
    await settle();
    await openApp();
    await goOnline();
    expect(server.course.grading_system).toBe('letter');
    expect(style.held()).toBe('letter');
  });
});

/* ── The outbox ─────────────────────────────────────────────────────────── */

describe('a save made offline with an old copy, sent later', () => {
  it.each(SETTINGS.filter(s => s.harm).map(s => [s.name, s]))(
    '%s changed at school stays changed when the laptop’s offline save of a different setting goes out',
    async (_, s) => {
      await openApp();
      await laptopHolds(s);
      await goOffline();
      schoolSets(s);
      const other = byName(s.other || 'Round to a Whole %');
      other.set(other.was);
      await settle();
      expect(server.sent.filter(r => r.name === 'update_course').length, 'nothing sent while offline').toBe(
        server.patches().length,
      );
      await goOnline();
      expect(server.course[other.col]).toEqual(other.was);
      expect(server.course[s.col]).toEqual(s.now);
    },
  );

  it('still stays changed when the app was closed in between and the outbox is sent by the next page', async () => {
    const method = byName('Calculation Method');
    await openApp();
    await laptopHolds(method);
    await goOffline();
    schoolSets(method);
    act('cmSetRoundPercent', { value: 'whole' });
    await settle();
    await openApp(); // the next evening, online
    await goOnline();
    expect(server.course.round_percent).toBe(true);
    expect(server.course.calc_method).toBe('highest');
  });
});

describe('an update_course written to the outbox by the code before this fix', () => {
  /* What main's saveCourseConfig queued for "Round to a Whole %": the
     device's whole copy. The laptop had loaded the class and chosen Most
     Recent a month earlier. */
  const WHOLE_COPY = {
    calc_method: 'mostRecent',
    round_percent: true,
    level_order: 'desc',
  };

  it('is what main queued (so the entry below is a true copy of one); the same save now queues the one key', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    server.sent.length = 0;
    act('cmSetRoundPercent', { value: 'whole' });
    await quiet();
    // On main this was the whole copy: expect(server.patches()).toEqual([WHOLE_COPY])
    // passed there (commit bf757b81). With the fix it is the one key the
    // teacher changed, as this test said it would be.
    expect(server.patches()).toEqual([{ round_percent: true }]);
    expect(Object.keys(WHOLE_COPY)).toContain('round_percent');
  });

  it('does not put back a method changed at school since', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    await goOffline();
    // The old code's save: the copy saved on this device, the whole of it queued.
    const cc = Object.assign({}, getCourseConfig(CID), { roundPercent: true });
    _saveCourseField('courseConfigs', CID, cc);
    _outbox();
    window.v2Queue.push('update_course', { p_course_id: CID, p_patch: clone(WHOLE_COPY) });
    await settle();
    schoolSets(byName('Calculation Method'));
    // The app updates; the next page sends what the old one left.
    await openApp();
    await goOnline();
    expect(server.course.calc_method).toBe('highest');
  });

  // Until Nov 10 this test read "still saves the one change it was made for
  // when nothing else changed on the server". Colin's ruling that day:
  // discard on any difference. One key differing could be the teacher's own
  // change or an old value this device had kept; the two cannot be told
  // apart, and sending the second reverts another computer with no sign.
  it('is not sent even when the one change it was made for is all that differs: the teacher sets it again', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    await goOffline();
    const cc = Object.assign({}, getCourseConfig(CID), { roundPercent: true });
    _saveCourseField('courseConfigs', CID, cc);
    _outbox();
    window.v2Queue.push('update_course', { p_course_id: CID, p_patch: clone(WHOLE_COPY) });
    await settle();
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(server.patches()).toEqual([]);
    expect(server.course.round_percent).toBe(null);
    expect(server.course.calc_method).toBe('mostRecent');
    // The laptop shows the setting as not set, as the server has it.
    expect((getCourseConfig(CID) || {}).roundPercent).toBeUndefined();
    expect(getSyncDotState().status).toBe('error');
  });
});

describe('an old whole-copy update_course is weighed against the server’s row before it goes', () => {
  /* The old code's save, as the tests above make it: the copy saved on this
     device, and the whole of it queued. */
  async function oldCodeQueues(patch, localCopy) {
    await goOffline();
    _saveCourseField('courseConfigs', CID, Object.assign({}, getCourseConfig(CID), localCopy));
    _outbox();
    window.v2Queue.push('update_course', { p_course_id: CID, p_patch: clone(patch) });
    await settle();
  }
  const NOT_SENT = ['An older settings save that could not be checked was not sent', 'warning'];
  let told;
  let sentry;
  beforeEach(() => {
    told = [];
    sentry = window.Sentry;
    window.Sentry = { captureMessage: (message, level) => told.push([message, level]), captureException() {} };
    // The outbox knows who is signed in from the session the browser keeps:
    // it gives a failed write its one more try on the next page only then.
    localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ user: { id: TEACHER } }));
  });
  afterEach(() => {
    window.Sentry = sentry;
  });

  it('nothing differs: nothing is sent, and nothing is wrong', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    await oldCodeQueues({ calc_method: 'mostRecent', level_order: 'desc' }, {});
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(server.patches()).toEqual([]);
    expect(window.v2Queue.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
    expect(getSyncDotState().status).toBe('idle');
    expect(told).toEqual([]);
  });

  it('two settings differ: neither is sent, the sync dot and Sentry say so, and the laptop shows the server’s', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method')); // Most Recent
    // The old code's save of Emerging First: the method went with it.
    await oldCodeQueues({ calc_method: 'mostRecent', level_order: 'asc' }, { levelOrder: 'asc' });
    schoolSets(byName('Calculation Method')); // Highest
    server.sent.length = 0;
    await openApp();
    await goOnline();

    expect(server.patches()).toEqual([]);
    expect(server.course.calc_method).toBe('highest');
    expect(server.course.level_order).toBe('desc');
    // Rule 5: the sync dot, and nothing else.
    expect(getSyncDotState()).toEqual({ status: 'error', title: "Some changes couldn't be saved" });
    // What Sentry hears is true of one computer too: nothing says "another device".
    expect(told).toEqual([NOT_SENT]);
    // The class was read again: this device shows what the server holds.
    expect(byName('Calculation Method').held()).toBe('highest');
    expect(byName('Rubric Levels').held()).toBe('desc');
    expect(window.v2Queue.stats().queued).toBe(0);
  });

  it('one setting differs, a genuine change made offline on the old app: it is not sent either, and shows as the server has it', async () => {
    // The cost of the ruling, and why: this key could as well be an old
    // value the device had kept while another computer changed it.
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    await oldCodeQueues({ calc_method: 'mostRecent', level_order: 'asc' }, { levelOrder: 'asc' });
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(server.patches()).toEqual([]);
    expect(server.course.level_order).toBe('desc');
    expect(byName('Rubric Levels').held()).toBe('desc');
    expect(getSyncDotState().status).toBe('error');
    expect(told).toEqual([NOT_SENT]);
    // The teacher sets it again, and that goes.
    act('cmSetLevelOrder', { value: 'asc' });
    await quiet();
    expect(server.patches()).toEqual([{ level_order: 'asc' }]);
  });

  it('one old value the device had kept, and no change of its own: not sent (the case one-key-differs cannot be told from)', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method')); // Most Recent, chosen here long ago
    await oldCodeQueues({ calc_method: 'mostRecent', level_order: 'desc' }, {}); // a save that changed nothing
    schoolSets(byName('Calculation Method')); // Highest
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(server.patches()).toEqual([]);
    expect(server.course.calc_method).toBe('highest');
  });

  it('nothing of a discarded save reaches the server by another route: not what is not a setting, not a later load', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    // The old save of the BC grading scale, a setting the server has never
    // held for this class. A class load sends up such a setting when only
    // this device has it; after a discard it must not.
    const scale = BC_SCALE();
    await oldCodeQueues(
      { name: 'History 12 (Block C)', calc_method: 'mostRecent', grading_scale: clone(scale), round_percent: true },
      { gradingScale: clone(scale), roundPercent: true },
    );
    schoolSets(byName('Calculation Method'));
    server.sent.length = 0;
    await openApp();
    await goOnline();
    await hearOfChange();
    expect(server.sent).toEqual([]);
    expect(server.course.grading_scale).toBe(null);
    expect(server.course.round_percent).toBe(null);
    expect(server.course.name).toBe('History 12');
    // And this device shows them as the server has them: not set.
    const cc = getCourseConfig(CID) || {};
    expect(cc.gradingScale).toBeUndefined();
    expect(cc.roundPercent).toBeUndefined();
    // Not by a later save of something else, either.
    act('cmSetLevelOrder', { value: 'asc' });
    await quiet();
    expect(server.patches()).toEqual([{ level_order: 'asc' }]);
    // Nor on the next page.
    await openApp();
    await hearOfChange();
    expect(server.patches()).toEqual([{ level_order: 'asc' }]);
    expect(server.course.grading_scale).toBe(null);
  });

  it('a class load that comes while the old save still waits sends nothing of it up', async () => {
    await openApp();
    const scale = BC_SCALE();
    await oldCodeQueues({ grading_scale: clone(scale), level_order: 'desc' }, { gradingScale: clone(scale) });
    server.sent.length = 0;
    // The row arrives while the write is still in the outbox.
    _applyBundleCourseConfig(CID, { grading_scale: null, category_weights: null }, clone(server.course));
    await settle();
    expect(window.v2Queue.queued('update_course').length).toBe(1);
    await goOnline();
    expect(server.sent).toEqual([]);
    expect(server.course.grading_scale).toBe(null);
  });

  it('the red dot stays through later saves, until the class has been read again and the app opened again', async () => {
    await openApp();
    await oldCodeQueues({ grading_scale: BC_SCALE(), level_order: 'desc' }, { gradingScale: BC_SCALE() });
    const send = server.fake.rpc;
    const classReads = allow => {
      let reads = 0;
      server.fake.rpc = function (name, params) {
        if (name === 'get_class_bundle' && ++reads > allow) {
          return Promise.resolve({ data: null, error: { message: 'network: failed to fetch' } });
        }
        return send(name, params);
      };
    };
    // The next page. The old save is weighed (one read of the class) and
    // discarded; after that the class cannot be read again for a while.
    classReads(1);
    server.sent.length = 0;
    await openApp();
    expect(told).toEqual([NOT_SENT]);
    expect(getSyncDotState().status).toBe('error');
    // A later settings save for the class lands. It used to clear the
    // failed save, and the red dot with it, in the same second.
    act('cmSetRoundPercent', { value: 'whole' });
    await quiet();
    expect(server.patches()).toEqual([{ round_percent: true }]);
    expect(getSyncDotState().status).toBe('error');
    // A page load before the class has been read again: still red.
    classReads(0);
    await openApp();
    expect(window.v2Queue.stats().deadLettered).toBe(1);
    expect(getSyncDotState().status).toBe('error');
    // The class is read again: the screen shows the server's. Red for the
    // rest of this page, so it is seen; gone with the next.
    server.fake.rpc = send;
    await openApp();
    expect((getCourseConfig(CID) || {}).gradingScale).toBeUndefined();
    expect(getSyncDotState().status).toBe('error');
    await openApp();
    expect(window.v2Queue.stats().deadLettered).toBe(0);
    expect(getSyncDotState().status).toBe('idle');
    expect(server.course.grading_scale).toBe(null);
    expect(server.patches()).toEqual([{ round_percent: true }]);
  });

  /* A page load, as far as the outbox and the class list: the outbox loads
     and sends what waits; no class is opened. */
  async function pageWithoutTheClass() {
    forgetPage();
    loadOutbox();
    server.reachable = true;
    setOnline(true);
    await initAllCourses();
    await window.v2Queue.flush();
    await settle();
  }

  it('a class deleted on another device after the discard, before this computer read it again: the dot clears once the class list says it is gone', async () => {
    await openApp();
    await oldCodeQueues({ grading_scale: BC_SCALE(), level_order: 'desc' }, { gradingScale: BC_SCALE() });
    // The next page: the old save is weighed and discarded before the class
    // is read again.
    await pageWithoutTheClass();
    expect(told).toEqual([NOT_SENT]);
    expect(getSyncDotState().status).toBe('error');
    // On another device the class is deleted.
    const gone = () => ({ data: null, error: { message: 'course not found', code: 'P0002' } });
    server.fake.on('get_class_bundle', gone);
    server.fake.on('get_gradebook', gone);
    server.fake.on('list_teacher_courses', () => ({ data: [], error: null }));
    // It used to stay red on every page load until sign-out.
    await pageWithoutTheClass();
    expect(window.v2Queue.stats().deadLettered).toBe(0);
    expect(getSyncDotState().status).toBe('idle');
    await pageWithoutTheClass();
    expect(getSyncDotState().status).toBe('idle');
  });

  it('an archived class nobody opens: red for the rest of that sitting, clear at the next app open once the class list has been read', async () => {
    await openApp();
    await oldCodeQueues({ calc_method: 'median', round_percent: true, level_order: 'desc' }, { roundPercent: true });
    server.course.is_archived = true;
    // The class open on screen is another one: an archived class is not preloaded.
    server.fake.on('bootstrap_teacher', () => ({
      data: { id: TEACHER, email: 'teacher@example.test', preferences: { active_course_id: null } },
      error: null,
    }));
    await pageWithoutTheClass();
    await preloadClasses();
    await settle();
    expect(told).toEqual([NOT_SENT]);
    expect(isCourseArchived(CID)).toBe(true);
    expect(isClassLoaded(CID)).toBe(false);
    expect(getSyncDotState().status).toBe('error');
    // The class list read again in the same sitting: still red, so it is seen.
    await initAllCourses();
    await settle();
    expect(getSyncDotState().status).toBe('error');
    // The next time the app is opened, the list is the server's word on it.
    await pageWithoutTheClass();
    expect(window.v2Queue.stats().deadLettered).toBe(0);
    expect(getSyncDotState().status).toBe('idle');
    expect(server.patches()).toEqual([]);
  });

  it('an open class that is not archived still stays red, through page loads that read the class list, until the class itself has been read again', async () => {
    await openApp();
    await oldCodeQueues({ grading_scale: BC_SCALE(), level_order: 'desc' }, { gradingScale: BC_SCALE() });
    await pageWithoutTheClass();
    expect(getSyncDotState().status).toBe('error');
    await pageWithoutTheClass();
    await pageWithoutTheClass();
    expect(window.v2Queue.stats().deadLettered).toBe(1);
    expect(getSyncDotState().status).toBe('error');
    await openApp(); // the class is read again: red for the rest of this page
    expect(getSyncDotState().status).toBe('error');
    await openApp();
    expect(getSyncDotState().status).toBe('idle');
  });

  it('waits when the class cannot be read, and is weighed once it can', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    await oldCodeQueues({ calc_method: 'mostRecent', level_order: 'asc' }, { levelOrder: 'asc' });
    server.sent.length = 0;
    setOnline(true); // the browser says it is online; the server does not answer
    await window.v2Queue.flush();
    await settle();
    expect(window.v2Queue.stats()).toMatchObject({ queued: 1, deadLettered: 0 });
    expect(told).toEqual([]);
    await goOnline();
    expect(server.patches()).toEqual([]);
    expect(told).toEqual([NOT_SENT]);
  });

  it('one the server had already refused under the old code is weighed the same way on its one more try', async () => {
    await openApp();
    await laptopHolds(byName('Calculation Method'));
    closeApp();
    // As the old code left it: refused once, waiting for the next page.
    localStorage.setItem(
      'fv-sync-dead-letter-v1',
      JSON.stringify([
        {
          id: 'e0000000-0000-4000-8000-00000000dead',
          created_at: '2026-11-09T18:00:00.000Z',
          owner: TEACHER,
          key: 'course:' + CID,
          endpoint: 'update_course',
          payload: { p_course_id: CID, p_patch: { calc_method: 'mostRecent', level_order: 'asc' } },
          attempts: 1,
          last_error: 'statement timeout',
          last_code: '57014',
        },
      ]),
    );
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(server.patches()).toEqual([]);
    expect(server.course.level_order).toBe('desc');
    expect(told).toEqual([NOT_SENT]);
    expect(getSyncDotState().status).toBe('error');
    await openApp();
    expect(window.v2Queue.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
    expect(getSyncDotState().status).toBe('idle');
  });
});

describe('what a settings write is kept and sent as', () => {
  it('a save that changes nothing sends no request', async () => {
    await openApp();
    const before = server.fake.calls.length;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID)));
    act('cmSetLevelOrder', { value: 'desc' }); // Extending First, as the class already is
    await quiet();
    expect(server.fake.calls.slice(before)).toEqual([]);
  });

  it('is queued with a mark that says "only what changed", and no request carries the mark', async () => {
    await openApp();
    await goOffline();
    act('cmSetRoundPercent', { value: 'whole' });
    act('cmSetGradingSystem', { value: 'letter' });
    await settle();
    expect(window.v2Queue.queued('update_course').map(e => e.payload.p_patch)).toEqual([
      { round_percent: true, _changed_only: true },
      { grading_system: 'letter', _changed_only: true },
    ]);
    await goOnline();
    expect(server.patches()).toEqual([{ round_percent: true }, { grading_system: 'letter' }]);
  });

  it('every save in Class Settings sends the key it changed and nothing else', async () => {
    await openApp();
    for (const s of SETTINGS.filter(x => x.set)) {
      server.sent.length = 0;
      // A value the class does not already have, so there is a change to send.
      s.set(JSON.stringify(s.held()) === JSON.stringify(s.now) ? s.was : s.now);
      await quiet();
      const keys = [].concat(...server.patches().map(Object.keys));
      expect(
        keys.filter(k => k !== s.col),
        s.name,
      ).toEqual([]);
      expect(keys, s.name).toContain(s.col);
    }
  });

  it('a write the server refused keeps what a later save did not set, and loses what it did', async () => {
    await openApp();
    server.rejects = (name, params) =>
      name === 'update_course' && params.p_patch.calc_method === 'bogus'
        ? { message: 'calc_method is not one this class can use', code: '22023' }
        : null;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'bogus', roundPercent: true }));
    await quiet();
    expect(window.v2Queue.deadLetter().map(e => e.payload.p_patch)).toEqual([
      { calc_method: 'bogus', round_percent: true, _changed_only: true },
    ]);
    act('cmSetRoundPercent', { value: 'decimal' });
    await quiet();
    expect(server.course.round_percent).toBe(false);
    // The newer Round to a Whole % landed: the refused one no longer sets it.
    expect(window.v2Queue.deadLetter().map(e => e.payload.p_patch)).toEqual([
      { calc_method: 'bogus', _changed_only: true },
    ]);
  });
});

/* ── Lists: categories and reporting terms ──────────────────────────────── */

describe('lists saved whole', () => {
  it('Save Categories from a list opened before a category was added at school does not delete it', async () => {
    await openApp(); // Class Settings holds the two categories it read
    server.fromAnotherDevice('save_categories', {
      p_course_id: CID,
      p_categories: [
        { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 50 },
        { id: CAT_TESTS, name: 'Tests', weight: 30 },
        { name: 'Projects', weight: 20 },
      ],
    });
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    // On the laptop: rename one category, nothing else.
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await quiet();
    expect(server.categories.map(c => c.name)).toContain('Projects');
  });

  it('Save Categories from an old list does not put back weights changed at school', async () => {
    await openApp();
    server.fromAnotherDevice('save_categories', {
      p_course_id: CID,
      p_categories: [
        { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 30 },
        { id: CAT_TESTS, name: 'Tests', weight: 70 },
      ],
    });
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await quiet();
    expect(server.categories.map(c => c.weight)).toEqual([30, 70]);
  });

  it('Save Terms from dates opened before they changed at school is one setting: the later save wins, whole', async () => {
    // Not a failure of this fix: two devices changing the SAME setting. The
    // terms are one value on the course row; the last save is what stays.
    const terms = byName('Reporting Terms');
    await openApp();
    await laptopHolds(terms);
    schoolSets(terms);
    input('cmTermLive', { idx: '0', field: 'label' }, 'First Half');
    act('cmTermSave');
    await quiet();
    expect(server.course.reporting_terms.map(t => t.label)).toEqual(['First Half', 'Term 2']);
    expect(server.course.reporting_terms[0].ends_on).toBe(TERMS_A[0].ends_on);
  });
});

describe('categories: the server’s list is read before the whole list is saved', () => {
  const CHANGED = 'The categories changed on another device, so nothing was saved. These are the current ones.';
  const CHANGED_TYPED = CHANGED + ' What you typed is below.';
  const OFFLINE =
    'Categories need a connection to save. Your changes are kept on this computer. Save again when you are online.';
  const OFFLINE_ORDER = 'Categories need a connection to save. Nothing was saved. Try again when you are online.';
  const KEPT = 'Your unsaved category changes were kept on this computer. Save Categories to send them.';
  const SRC = 'e0000000-0000-4000-8000-0000000000b3';
  const kept = () => JSON.parse(localStorage.getItem('gb-category-draft-' + CID));
  const schoolAddsProjects = () =>
    server.fromAnotherDevice('save_categories', {
      p_course_id: CID,
      p_categories: [
        { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 50 },
        { id: CAT_TESTS, name: 'Tests', weight: 30 },
        { name: 'Projects', weight: 20 },
      ],
    });
  const sentNames = () => server.sent.map(s => s.name);
  const listed = () => server.fake.calls.filter(c => c.name === 'list_categories').length;
  const draft = () => DashClassManager.categoriesDraft();
  const gradingTabHtml = () => {
    const main = { innerHTML: '' };
    const real = document.getElementById;
    document.getElementById = id => (id === 'main' ? main : real(id));
    try {
      act('cmSetTab', { tab: 'grading' });
    } finally {
      document.getElementById = real;
    }
    return main.innerHTML;
  };

  it('Save Categories on a list that changed: nothing is saved, one line says so, and the current ones show', async () => {
    await openApp();
    schoolAddsProjects();
    server.sent.length = 0;
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await quiet();

    expect(sentNames()).toEqual([]);
    expect(draft().notice).toBe(CHANGED_TYPED);
    expect(draft().dirty).toBe(false);
    expect(draft().rows.map(r => [r.name, r.weight])).toEqual([
      ['Assignments', 50],
      ['Tests', 30],
      ['Projects', 20],
    ]);
    // Grades follow the current list at once.
    expect(getCategories(CID).map(c => c.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    // The line is on the page once, above the categories.
    const html = gradingTabHtml();
    expect(html.split(CHANGED_TYPED).length - 1).toBe(1);
    expect(html.indexOf(CHANGED_TYPED)).toBeLessThan(html.indexOf('class="cm-cat-list"'));
    // What the teacher had typed is not lost: it is listed under the line.
    expect(draft().typed).toEqual(['Assignments · 60% · Total Points', 'Quizzes · 40% · Total Points']);
    expect(html).toContain('What You Typed');
    expect(html).toContain('<li>Quizzes · 40% · Total Points</li>');
    expect(draft().action).toBe('Dismiss');

    // Edited again on the current list: saved, and the line goes.
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await quiet();
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Quizzes', 'Projects']);
    expect(draft().notice).toBe(null);
    expect(gradingTabHtml()).not.toContain('cm-cat-notice');
    expect(kept()).toBe(null);
  });

  it('what was typed stays through a closed tab, until it is dismissed', async () => {
    await openApp();
    schoolAddsProjects();
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await quiet();
    await openApp();
    expect(draft().notice).toBe(CHANGED_TYPED);
    expect(draft().typed).toEqual(['Assignments · 60% · Total Points', 'Quizzes · 40% · Total Points']);
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    act('cmCatNoticeDone');
    expect(draft().notice).toBe(null);
    expect(kept()).toBe(null);
    expect(gradingTabHtml()).not.toContain('cm-cat-notice');
  });

  it('Save Categories on a list nobody else changed: one read, then the save', async () => {
    await openApp();
    const before = listed();
    server.fake.calls.length = 0;
    input('cmCatWeightLive', { idx: '0' }, 70);
    input('cmCatWeightLive', { idx: '1' }, 30);
    act('cmCatSave');
    await quiet();
    expect(before).toBe(1); // the form's own read when it opened
    expect(server.fake.calls.map(c => c.name)).toEqual(['list_categories', 'save_categories']);
    expect(server.categories.map(c => c.weight)).toEqual([70, 30]);
    expect(draft().notice).toBe(null);

    // A second save in the same sitting is checked against what the first left.
    server.fake.calls.length = 0;
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await quiet();
    expect(server.fake.calls.map(c => c.name)).toEqual(['list_categories', 'save_categories']);
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Quizzes']);
  });

  it('with no connection: nothing is saved or queued, the line says so, and the typing stays', async () => {
    await openApp();
    await goOffline();
    server.sent.length = 0;
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await settle();
    expect(window.v2Queue.stats().queued).toBe(0);
    expect(draft().notice).toBe(OFFLINE);
    expect(draft().action).toBe('Discard My Changes');
    expect(draft().dirty).toBe(true);
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Quizzes']);
    expect(gradingTabHtml()).toContain(OFFLINE);

    await goOnline();
    expect(sentNames()).toEqual([]); // nothing waited to go
    act('cmCatSave');
    await quiet();
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Quizzes']);
    expect(draft().notice).toBe(null);
    expect(kept()).toBe(null);
  });

  it('with no connection, then the tab is closed: the changes are still there the next time, and save', async () => {
    await openApp();
    await goOffline();
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await settle();
    // More typing after the line: kept too.
    input('cmCatWeightLive', { idx: '0' }, 70);
    input('cmCatWeightLive', { idx: '1' }, 30);
    expect(kept().rows.map(r => [r.name, r.weight])).toEqual([
      ['Assignments', 70],
      ['Quizzes', 30],
    ]);

    server.sent.length = 0;
    await openApp(); // the next day, online
    expect(sentNames()).toEqual([]);
    expect(draft().notice).toBe(KEPT);
    expect(draft().dirty).toBe(true);
    expect(draft().rows.map(r => [r.name, r.weight])).toEqual([
      ['Assignments', 70],
      ['Quizzes', 30],
    ]);
    expect(gradingTabHtml()).toContain('Discard My Changes');
    act('cmCatSave');
    await quiet();
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Assignments', 70],
      ['Quizzes', 30],
    ]);
    expect(draft().notice).toBe(null);
    expect(kept()).toBe(null);
  });

  it('changes kept with no connection, and the list changed elsewhere before the next time: the current ones show, with what was typed', async () => {
    await openApp();
    await goOffline();
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await settle();
    schoolAddsProjects();
    server.sent.length = 0;
    await openApp();
    expect(draft().notice).toBe(CHANGED_TYPED);
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    expect(draft().typed).toEqual(['Assignments · 60% · Total Points', 'Quizzes · 40% · Total Points']);
    expect(draft().dirty).toBe(false);
    expect(sentNames()).toEqual([]);
  });

  it('Discard My Changes puts the class’s own list back and keeps nothing', async () => {
    await openApp();
    await goOffline();
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await settle();
    await goOnline();
    act('cmCatNoticeDone');
    await quiet();
    expect(kept()).toBe(null);
    expect(draft().notice).toBe(null);
    expect(draft().dirty).toBe(false);
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests']);
    expect(sentNames()).toEqual([]);
  });

  it('Discard My Changes with nothing sent reads nothing and puts back the opened list, as before', async () => {
    await openApp();
    await goOffline();
    input('cmCatWeightLive', { idx: '0' }, 70);
    input('cmCatWeightLive', { idx: '1' }, 30);
    act('cmCatSave');
    await settle();
    await goOnline();
    server.fake.calls.length = 0;
    act('cmCatNoticeDone');
    await quiet();
    expect(listed()).toBe(0);
    expect(draft().notice).toBe(null);
    expect(draft().rows.map(r => r.weight)).toEqual([60, 40]);
  });

  /* Save Categories of 50/30/20 with a new row: it reaches the server and
     its answer is lost. */
  async function saveWithAnswerLost() {
    const send = server.fake.rpc;
    let lose = true;
    server.fake.rpc = function (name, params) {
      const res = send(name, params);
      if (name !== 'save_categories' || !lose) return res;
      lose = false;
      return Promise.resolve(res).then(() => ({ data: null, error: { message: 'network: failed to fetch' } }));
    };
    act('cmCatAdd');
    input('cmCatNameLive', { idx: '2' }, 'Projects');
    input('cmCatWeightLive', { idx: '0' }, 50);
    input('cmCatWeightLive', { idx: '1' }, 30);
    input('cmCatWeightLive', { idx: '2' }, 20);
    act('cmCatSave');
    await quiet();
    server.fake.rpc = send;
    expect(draft().notice).toBe(OFFLINE);
  }
  const ON_SERVER = [
    ['Assignments', 50],
    ['Tests', 30],
    ['Projects', 20],
  ];
  const LANDED = 'Your earlier save went through after all. These are the saved categories.';
  const formRows = () => draft().rows.map(r => [r.name, r.weight]);

  it('Discard My Changes after a lost answer, online: the form shows the server’s list, and says only what is true', async () => {
    await openApp();
    await saveWithAnswerLost();
    act('cmCatNoticeDone');
    await quiet();
    expect(formRows()).toEqual(ON_SERVER);
    expect(draft().rows.map(r => r.id)).toEqual(server.categories.map(c => c.id));
    expect(draft().notice).toBe(LANDED);
    expect(draft().action).toBe('Dismiss');
    expect(draft().dirty).toBe(false);
    expect(getCategories(CID).map(c => c.weight)).toEqual([50, 30, 20]);
    expect(kept()).toBe(null);
    act('cmCatNoticeDone');
    expect(draft().notice).toBe(null);
  });

  it('Discard My Changes after a lost answer, another device changed the list meanwhile: the current ones, with the approved line', async () => {
    await openApp();
    await saveWithAnswerLost();
    server.fromAnotherDevice('save_categories', {
      p_course_id: CID,
      p_categories: server.categories.map((c, i) => ({ id: c.id, name: c.name, weight: [40, 40, 20][i] })),
    });
    act('cmCatNoticeDone');
    await quiet();
    expect(draft().rows.map(r => r.weight)).toEqual([40, 40, 20]);
    expect(draft().notice).toBe(CHANGED);
  });

  it('Discard My Changes after a lost answer, with no connection: the opened list, then the server’s once it is read', async () => {
    await openApp();
    await saveWithAnswerLost();
    await goOffline();
    act('cmCatNoticeDone');
    await settle();
    expect(formRows()).toEqual([
      ['Assignments', 60],
      ['Tests', 40],
    ]);
    await goOnline();
    gradingTabHtml(); // Class Settings draws again: the categories are read
    await new Promise(r => setTimeout(r, 20));
    await quiet();
    expect(formRows()).toEqual(ON_SERVER);
    expect(draft().notice).toBe(LANDED);
  });

  /* What Class Settings draws while it is watched: the page's mounts are
     empty elements, and what is drawn into them is read back after. */
  function watchPage() {
    const real = document.getElementById;
    const mounts = {};
    ['main', 'sidebar-mount', 'page-toolbar-mount'].forEach(id => (mounts[id] = document.createElement('div')));
    document.getElementById = id => mounts[id] || real.call(document, id);
    return {
      drawn: () =>
        Object.keys(mounts)
          .filter(id => mounts[id].innerHTML !== '')
          .map(id => id + ': ' + mounts[id].innerHTML),
      stop: () => (document.getElementById = real),
    };
  }
  const OTHER = 'e0000000-0000-4000-8000-0000000000c4';
  /* The teacher leaves before the answer comes: Class Settings closed, or
     another class picked in it. */
  const LEAVE = {
    'Class Settings closed': {
      leave: () => DashClassManager.closeClassManager(),
      back: () => DashClassManager.openClassManager(),
    },
    'another class picked': {
      leave: () => {
        COURSES[OTHER] = { id: OTHER, name: 'Law 12', gradeLevel: '12', gradingSystem: 'proficiency' };
        _classLoads[OTHER] = true;
        act('cmSelectClass', { cid: OTHER });
      },
      back: () => act('cmSelectClass', { cid: CID }),
    },
  };
  /* What the teacher starts, and what the class shows once the answer has
     come and the teacher is back. */
  const STARTED = {
    'Discard My Changes after a lost answer': {
      start: async () => {
        await saveWithAnswerLost();
        act('cmCatNoticeDone');
      },
      line: LANDED,
      rows: ON_SERVER,
    },
    'Save Categories': {
      start: async () => {
        schoolAddsProjects();
        input('cmCatWeightLive', { idx: '0' }, 70);
        input('cmCatWeightLive', { idx: '1' }, 30);
        act('cmCatSave');
      },
      line: CHANGED_TYPED,
      rows: ON_SERVER,
    },
    'a drag': {
      start: async () => {
        schoolAddsProjects();
        DashClassManager.reorderCategory(1, 0);
      },
      line: CHANGED,
      rows: ON_SERVER,
    },
  };
  Object.keys(STARTED).forEach(what => {
    Object.keys(LEAVE).forEach(how => {
      it(
        what + ', then ' + how + ' before the answer: nothing is drawn after, and the class shows it when back',
        async () => {
          await openApp();
          await STARTED[what].start();
          LEAVE[how].leave();
          const page = watchPage();
          try {
            await quiet();
            await new Promise(r => setTimeout(r, 20));
            await quiet();
          } finally {
            page.stop();
          }
          const drawn = page.drawn();
          if (how === 'Class Settings closed') expect(drawn).toEqual([]);
          // Nothing drawn says this class's line, on any page.
          expect(drawn.filter(w => w.indexOf('cm-cat-notice') >= 0)).toEqual([]);
          LEAVE[how].back();
          expect(draft().notice).toBe(STARTED[what].line);
          expect(formRows()).toEqual(STARTED[what].rows);
        },
      );
    });
  });

  it('the connection goes between the read and the save: nothing waits to go out later over a change made elsewhere', async () => {
    await openApp();
    const send = server.fake.rpc;
    server.fake.rpc = function (name, params) {
      const res = send(name, params);
      if (name === 'list_categories') server.reachable = false; // answered; then it goes
      return res;
    };
    server.sent.length = 0;
    input('cmCatWeightLive', { idx: '0' }, 70);
    input('cmCatWeightLive', { idx: '1' }, 30);
    act('cmCatSave');
    for (let i = 0; i < 4; i++) await settle();
    server.fake.rpc = send;
    expect(window.v2Queue.stats().queued).toBe(0);
    expect(draft().notice).toBe(OFFLINE);
    expect(draft().rows.map(r => r.weight)).toEqual([70, 30]);
    // At school, an hour later: a category is added.
    schoolAddsProjects();
    await goOnline();
    expect(sentNames()).toEqual([]);
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Assignments', 50],
      ['Tests', 30],
      ['Projects', 20],
    ]);
    // Save again: it is checked again, and says what happened.
    act('cmCatSave');
    await quiet();
    expect(sentNames()).toEqual([]);
    expect(draft().notice).toBe(CHANGED_TYPED);
    expect(draft().typed).toEqual(['Assignments · 70% · Total Points', 'Tests · 30% · Total Points']);
  });

  it('the save reaches the server but its answer never comes: the next Save finds it landed and sends nothing twice', async () => {
    await openApp();
    const send = server.fake.rpc;
    server.fake.rpc = function (name, params) {
      const res = send(name, params);
      if (name !== 'save_categories') return res;
      return res.then(() => ({ data: null, error: { message: 'network: failed to fetch' } })); // saved; the answer is lost
    };
    act('cmCatAdd');
    input('cmCatNameLive', { idx: '2' }, 'Projects');
    input('cmCatWeightLive', { idx: '0' }, 50);
    input('cmCatWeightLive', { idx: '1' }, 30);
    input('cmCatWeightLive', { idx: '2' }, 20);
    act('cmCatSave');
    await quiet();
    server.fake.rpc = send;
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    expect(draft().notice).toBe(OFFLINE);
    server.sent.length = 0;
    act('cmCatSave');
    await quiet();
    expect(sentNames()).toEqual([]);
    expect(draft().notice).toBe(null);
    expect(draft().dirty).toBe(false);
    expect(draft().rows.map(r => r.id)).toEqual(server.categories.map(c => c.id));
    expect(kept()).toBe(null);
  });

  /* The server takes the first write of `which` and its answer is lost on
     the way back. */
  function loseFirstAnswer(which) {
    const send = server.fake.rpc;
    let lose = true;
    server.fake.rpc = function (name, params) {
      const res = send(name, params);
      if (name !== which || !lose) return res;
      lose = false;
      return Promise.resolve(res).then(() => ({ data: null, error: { message: 'network: failed to fetch' } }));
    };
    return () => (server.fake.rpc = send);
  }

  it('the save lands, its answer is lost, more is typed and the tab closed: the next time, the typing is kept and nothing says another device', async () => {
    await openApp();
    const restore = loseFirstAnswer('save_categories');
    act('cmCatAdd');
    input('cmCatNameLive', { idx: '2' }, 'Projects');
    input('cmCatWeightLive', { idx: '0' }, 50);
    input('cmCatWeightLive', { idx: '1' }, 30);
    input('cmCatWeightLive', { idx: '2' }, 20);
    act('cmCatSave');
    await quiet();
    restore();
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Assignments', 50],
      ['Tests', 30],
      ['Projects', 20],
    ]);
    const projects = server.categories[2].id;
    // More typing, then the tab is closed.
    input('cmCatWeightLive', { idx: '0' }, 40);
    input('cmCatWeightLive', { idx: '2' }, 30);
    await settle();
    await openApp();
    // Both halves of "changed on another device, nothing was saved" were
    // false: the save was this computer's own. What is unsaved is the typing.
    expect(draft().notice).toBe(KEPT);
    expect(draft().typed).toBe(null);
    expect(draft().rows.map(r => [r.name, r.weight])).toEqual([
      ['Assignments', 40],
      ['Tests', 30],
      ['Projects', 30],
    ]);
    server.sent.length = 0;
    act('cmCatSave');
    await quiet();
    expect(sentNames()).toEqual(['save_categories']);
    expect(draft().notice).toBe(null);
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Assignments', 40],
      ['Tests', 30],
      ['Projects', 30],
    ]);
    // The row the first save made is the same row: not deleted and made again.
    expect(server.categories[2].id).toBe(projects);
    expect(kept()).toBe(null);
  });

  it('the save lands, its answer is lost, the tab is closed with nothing more typed: the next time, nothing is unsaved', async () => {
    await openApp();
    const restore = loseFirstAnswer('save_categories');
    input('cmCatWeightLive', { idx: '0' }, 70);
    input('cmCatWeightLive', { idx: '1' }, 30);
    act('cmCatSave');
    await quiet();
    restore();
    await openApp();
    expect(draft().notice).toBe(null);
    expect(draft().dirty).toBe(false);
    expect(kept()).toBe(null);
  });

  it('a drag lands and its answer is lost: the row stays where it was put, nothing untrue is said, and the next Save goes once', async () => {
    await openApp();
    const restore = loseFirstAnswer('reorder_categories');
    await DashClassManager.reorderCategory(1, 0);
    await quiet();
    restore();
    expect(server.categories.map(c => c.name)).toEqual(['Tests', 'Assignments']);
    // Not "Nothing was saved", and the row does not go back: this computer
    // cannot tell whether the order arrived, so it keeps it as unsaved.
    expect(draft().notice).toBe(OFFLINE);
    expect(draft().rows.map(r => r.name)).toEqual(['Tests', 'Assignments']);
    input('cmCatWeightLive', { idx: '0' }, 30);
    input('cmCatWeightLive', { idx: '1' }, 70);
    server.sent.length = 0;
    act('cmCatSave');
    await quiet();
    // Not refused as "changed on another device": the order it found was its own.
    expect(draft().notice).toBe(null);
    expect(draft().typed).toBe(null);
    expect(sentNames()).toEqual(['save_categories']);
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Tests', 30],
      ['Assignments', 70],
    ]);
  });

  it('a drag lands and its answer is lost, then the tab is closed: the next time, nothing is unsaved', async () => {
    await openApp();
    const restore = loseFirstAnswer('reorder_categories');
    await DashClassManager.reorderCategory(1, 0);
    await quiet();
    restore();
    await openApp();
    expect(draft().notice).toBe(null);
    expect(draft().rows.map(r => r.name)).toEqual(['Tests', 'Assignments']);
    expect(kept()).toBe(null);
  });

  it('a drag sent with no answer that never arrived: the next Save sends the order on screen', async () => {
    await openApp();
    const send = server.fake.rpc;
    let drop = true;
    server.fake.rpc = function (name, params) {
      if (name === 'reorder_categories' && drop) {
        drop = false;
        return Promise.resolve({ data: null, error: { message: 'network: failed to fetch' } });
      }
      return send(name, params);
    };
    await DashClassManager.reorderCategory(1, 0);
    await quiet();
    server.fake.rpc = send;
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Tests']);
    expect(draft().notice).toBe(OFFLINE);
    act('cmCatSave');
    await quiet();
    expect(draft().notice).toBe(null);
    expect(server.categories.map(c => c.name)).toEqual(['Tests', 'Assignments']);
  });

  /* Another write from this computer is still waiting to go (the server
     answers it with a dropped connection), while the category reads work. */
  async function anotherWriteWaits() {
    const send = server.fake.rpc;
    server.fake.rpc = function (name, params) {
      if (name === 'update_course')
        return Promise.resolve({ data: null, error: { message: 'network: failed to fetch' } });
      return send(name, params);
    };
    act('cmSetRoundPercent', { value: 'whole' });
    await settle();
    const wait = CATEGORY_WRITE_WAIT_MS;
    CATEGORY_WRITE_WAIT_MS = 200;
    return async () => {
      CATEGORY_WRITE_WAIT_MS = wait;
      server.fake.rpc = send;
      await goOnline();
    };
  }
  const WAITING =
    'Other changes from this computer are still being sent, so nothing was saved. Your changes are kept on this computer. Save again in a moment.';
  const WAITING_ORDER =
    'Other changes from this computer are still being sent, so nothing was saved. Try again in a moment.';

  it('Save Categories while another write from this computer waits: it does not blame the connection', async () => {
    await openApp();
    const done = await anotherWriteWaits();
    input('cmCatWeightLive', { idx: '0' }, 70);
    input('cmCatWeightLive', { idx: '1' }, 30);
    // The save waits 200 ms for the other write: the clock is moved, not slept through.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    act('cmCatSave');
    await vi.advanceTimersByTimeAsync(700);
    vi.useRealTimers();
    await settle();
    expect(navigator.onLine).toBe(true);
    expect(draft().notice).toBe(WAITING);
    expect(draft().action).toBe('Discard My Changes');
    expect(draft().rows.map(r => r.weight)).toEqual([70, 30]);
    expect(server.categories.map(c => c.weight)).toEqual([60, 40]);
    await done();
    act('cmCatSave');
    await quiet();
    expect(draft().notice).toBe(null);
    expect(server.categories.map(c => c.weight)).toEqual([70, 30]);
  });

  it('a drag while another write from this computer waits: the row goes back, and it does not blame the connection', async () => {
    await openApp();
    const done = await anotherWriteWaits();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const moved = DashClassManager.reorderCategory(1, 0);
    await vi.advanceTimersByTimeAsync(700);
    vi.useRealTimers();
    await moved;
    await settle();
    expect(draft().notice).toBe(WAITING_ORDER);
    expect(draft().action).toBe(null);
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests']);
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Tests']);
    await done();
  });

  it('a connection that answers with an error is no check: nothing is saved', async () => {
    await openApp();
    server.fake.on('list_categories', () => ({ data: null, error: { message: 'permission denied', code: '42501' } }));
    server.sent.length = 0;
    input('cmCatNameLive', { idx: '1' }, 'Quizzes');
    act('cmCatSave');
    await quiet();
    expect(sentNames()).toEqual([]);
    expect(draft().notice).toBe(OFFLINE);
  });

  it('a drag to reorder on a list that changed: the order is not sent, and the current ones show', async () => {
    await openApp();
    schoolAddsProjects();
    server.sent.length = 0;
    await DashClassManager.reorderCategory(0, 1);
    await quiet();
    expect(sentNames()).toEqual([]);
    expect(draft().notice).toBe(CHANGED);
    expect(draft().typed).toBe(null); // a drag: nothing was typed
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests', 'Projects']);
  });

  it('a drag to reorder on a list nobody else changed: one read, then the new order', async () => {
    await openApp();
    server.fake.calls.length = 0;
    await DashClassManager.reorderCategory(0, 1);
    await quiet();
    expect(server.fake.calls.map(c => c.name)).toEqual(['list_categories', 'reorder_categories']);
    expect(server.categories.map(c => c.name)).toEqual(['Tests', 'Assignments']);
    // And a save after it is checked against the new order, not the old.
    input('cmCatWeightLive', { idx: '0' }, 45);
    input('cmCatWeightLive', { idx: '1' }, 55);
    act('cmCatSave');
    await quiet();
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Tests', 45],
      ['Assignments', 55],
    ]);
    expect(draft().notice).toBe(null);
  });

  it('a row deleted on screen, another dragged, then Save: the drag waits for Save, and nothing is taken for a change elsewhere', async () => {
    // reorder_categories numbers only the rows it is sent. Sent without the
    // row deleted on screen, it would leave that row tied with another on
    // the server, in an order this form cannot know.
    server.fromAnotherDevice('save_categories', {
      p_course_id: CID,
      p_categories: [
        { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 50 },
        { id: CAT_TESTS, name: 'Tests', weight: 30 },
        { name: 'Projects', weight: 20 },
      ],
    });
    await openApp();
    server.fake.calls.length = 0;
    act('cmCatDelete', { idx: '1' }); // Tests: no work in it
    await DashClassManager.reorderCategory(1, 0); // Projects above Assignments
    await quiet();
    expect(server.fake.calls.map(c => c.name)).toEqual([]);
    expect(draft().rows.map(r => r.name)).toEqual(['Projects', 'Assignments']);
    expect(draft().dirty).toBe(true);

    input('cmCatWeightLive', { idx: '0' }, 20);
    input('cmCatWeightLive', { idx: '1' }, 80);
    act('cmCatSave');
    await quiet();
    expect(draft().notice).toBe(null);
    expect(server.fake.calls.map(c => c.name)).toEqual(['list_categories', 'save_categories']);
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Projects', 20],
      ['Assignments', 80],
    ]);
  });

  it('a list whose rows tie on the server (an older partial reorder) is not taken for a change elsewhere', async () => {
    server.fromAnotherDevice('save_categories', {
      p_course_id: CID,
      p_categories: [
        { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 50 },
        { id: CAT_TESTS, name: 'Tests', weight: 30 },
        { name: 'Projects', weight: 20 },
      ],
    });
    const projects = server.categories[2].id;
    server.fromAnotherDevice('reorder_categories', { p_ids: [projects, CAT_ASSIGNMENTS] });
    expect(server.categories.map(c => [c.name, c.display_order])).toEqual([
      ['Projects', 0],
      ['Assignments', 1],
      ['Tests', 1],
    ]);
    await openApp();
    input('cmCatNameLive', { idx: '2' }, 'Quizzes');
    act('cmCatSave');
    await quiet();
    expect(draft().notice).toBe(null);
    expect(server.categories.map(c => c.name)).toEqual(['Projects', 'Assignments', 'Quizzes']);
  });

  it('a drag to reorder with no connection: the row goes back, and nothing is queued', async () => {
    await openApp();
    await goOffline();
    await DashClassManager.reorderCategory(0, 1);
    await settle();
    expect(window.v2Queue.stats().queued).toBe(0);
    expect(draft().notice).toBe(OFFLINE_ORDER);
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests']);
    expect(kept()).toBe(null);
  });

  /* Copy Grading Setup replaces the target's whole list with the plan it
     showed the teacher. */
  function anotherClass() {
    COURSES[SRC] = { id: SRC, name: 'History 11', gradeLevel: '11', gradingSystem: 'proficiency' };
    _cache.courseConfigs[SRC] = {};
    _cache.categories[SRC] = [
      { id: 's1', name: 'Assignments', weight: 50, displayOrder: 0 },
      { id: 's2', name: 'Tests', weight: 50, displayOrder: 1 },
    ];
  }

  it('Copy Grading Setup onto a list that changed since the plan: the categories are not copied, and it says so', async () => {
    await openApp();
    anotherClass();
    const plan = GradingSetupCopy.planSetup(SRC, CID, { categories: true });
    expect(plan.changes.map(c => c.key)).toEqual(['categories']);
    schoolAddsProjects();
    server.sent.length = 0;
    await GradingSetupCopy.applySetup(plan, {});
    await quiet();
    expect(sentNames()).toEqual([]);
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    expect(plan.categoriesNotCopied).toBe('changed');
    expect(GradingSetupCopy.copiedMessage([plan])).toBe(
      'The categories in History 12 changed on another device, so they were not copied.',
    );
    expect(getCategories(CID).map(c => c.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    // The message after a copy is gone in seconds. The class says so itself
    // the next time it is opened in Class Settings, even another day.
    await openApp();
    expect(draft().notice).toBe(
      'The categories were not copied from History 11: they changed on another device first. These are the current ones.',
    );
    expect(draft().action).toBe('Dismiss');
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    await openApp();
    expect(gradingTabHtml()).toContain('The categories were not copied from History 11');
    act('cmCatNoticeDone');
    await openApp();
    expect(draft().notice).toBe(null);
  });

  it('Copy Grading Setup onto a list nobody else changed: one read, then the copy', async () => {
    await openApp();
    anotherClass();
    const plan = GradingSetupCopy.planSetup(SRC, CID, { categories: true });
    server.fake.calls.length = 0;
    await GradingSetupCopy.applySetup(plan, {});
    await quiet();
    expect(server.fake.calls.map(c => c.name)).toEqual(['list_categories', 'save_categories']);
    expect(server.categories.map(c => c.weight)).toEqual([50, 50]);
    expect(plan.categoriesNotCopied).toBeUndefined();
    expect(GradingSetupCopy.copiedMessage([plan])).toBe('Copied the grading setup to History 12.');
  });

  it('Copy Grading Setup with no connection: the categories are not copied, the rest is', async () => {
    await openApp();
    anotherClass();
    _cache.courseConfigs[SRC] = { roundPercent: true };
    const plan = GradingSetupCopy.planSetup(SRC, CID, { categories: true, roundPercent: true });
    expect(plan.changes.map(c => c.key)).toEqual(['categories', 'roundPercent']);
    await goOffline();
    await GradingSetupCopy.applySetup(plan, {});
    await settle();
    expect(plan.categoriesNotCopied).toBe('offline');
    expect(GradingSetupCopy.copiedMessage([plan])).toBe(
      'Categories need a connection to copy, so the categories in History 12 were not copied. Everything else was copied.',
    );
    await goOnline();
    expect(server.categories.map(c => c.weight)).toEqual([60, 40]);
    expect(server.course.round_percent).toBe(true);
    await openApp();
    expect(draft().notice).toBe(
      'The categories were not copied from History 11: there was no connection. Everything else was copied.',
    );
  });

  it('a copy not sent, then copied again and saved: the class no longer says it was not copied', async () => {
    await openApp();
    anotherClass();
    const send = server.fake.rpc;
    server.fake.rpc = function (name, params) {
      const res = send(name, params);
      if (name === 'list_categories') server.reachable = false;
      return res;
    };
    const first = GradingSetupCopy.planSetup(SRC, CID, { categories: true });
    const done = GradingSetupCopy.applySetup(first, {});
    for (let i = 0; i < 6; i++) await settle();
    server.fake.rpc = send;
    schoolAddsProjects();
    await goOnline();
    await done.catch(() => {});
    await quiet();
    expect(kept().note).toBeTruthy();
    // The teacher copies again; this time it goes.
    anotherClass();
    const again = GradingSetupCopy.planSetup(SRC, CID, { categories: true });
    await GradingSetupCopy.applySetup(again, {});
    await quiet();
    expect(again.categoriesNotCopied).toBeUndefined();
    expect(server.categories.map(c => [c.name, c.weight])).toEqual([
      ['Assignments', 50],
      ['Tests', 50],
    ]);
    await openApp();
    expect(draft().notice).toBe(null);
    expect(kept()).toBe(null);
  });

  it('Copy Grading Setup whose list had to wait and was then not sent: the class says so when next opened, as when it is not copied at once', async () => {
    await openApp();
    anotherClass();
    _cache.courseConfigs[SRC] = { roundPercent: true };
    const send = server.fake.rpc;
    server.fake.rpc = function (name, params) {
      const res = send(name, params);
      if (name === 'list_categories') server.reachable = false; // the check is answered; then the connection goes
      return res;
    };
    const plan = GradingSetupCopy.planSetup(SRC, CID, { categories: true, roundPercent: true });
    const done = GradingSetupCopy.applySetup(plan, {});
    for (let i = 0; i < 6; i++) await settle();
    server.fake.rpc = send;
    expect(window.v2Queue.queued('save_categories').length).toBe(1);
    // The message after the copy has already said it was copied.
    expect(GradingSetupCopy.copiedMessage([plan])).toBe('Copied the grading setup to History 12.');
    schoolAddsProjects();
    server.sent.length = 0;
    await goOnline();
    await done.catch(() => {});
    await quiet();
    expect(sentNames()).not.toContain('save_categories');
    expect(server.categories.map(c => c.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    expect(getSyncDotState().status).toBe('error'); // as before
    await openApp();
    expect(draft().notice).toBe(
      'The categories were not copied from History 11: they changed on another device first. These are the current ones. Everything else was copied.',
    );
    expect(draft().action).toBe('Dismiss');
    expect(draft().rows.map(r => r.name)).toEqual(['Assignments', 'Tests', 'Projects']);
    act('cmCatNoticeDone');
    await openApp();
    expect(draft().notice).toBe(null);
  });

  it('every whole-list save of categories is one this file knows, and each is behind the check or is a new class', () => {
    const sources = [];
    ['shared', 'teacher', 'teacher-mobile'].forEach(dir =>
      readdirSync(resolve(root, dir))
        .filter(f => f.endsWith('.js'))
        .forEach(f => sources.push(dir + '/' + f)),
    );
    const count = re => {
      const found = {};
      sources.forEach(file => {
        const n = (read(file).match(re) || []).length;
        if (n) found[file] = n;
      });
      return found;
    };
    // The request itself (save_categories, reorder_categories).
    expect(count(/\bv2\.saveCategories\(/g)).toEqual({
      // _persistCategoriesToCanonical, for saveCategories below; and
      // saveCategoriesNow for a class no server holds (Demo Mode)
      'shared/data-categories.js': 2,
    });
    expect(count(/\bv2\.reorderCategories\(/g)).toEqual({
      'shared/data-categories.js': 1, // reorderCategoriesNow for a class no server holds
    });
    // Class Settings saves and reorders through the two that check and send in one moment.
    expect(count(/(?<![.\w])saveCategoriesNow\(/g)).toEqual({
      'shared/data-categories.js': 1,
      'teacher/dash-class-manager.js': 1,
    });
    expect(count(/(?<![.\w])reorderCategoriesNow\(/g)).toEqual({
      'shared/data-categories.js': 1,
      'teacher/dash-class-manager.js': 1,
    });
    // Asked of the server directly, never left in the outbox.
    const data = read('shared/data-categories.js');
    const now = data.slice(
      data.indexOf('async function _categoryWriteNow('),
      data.indexOf('function _noAnswerFromServer('),
    );
    expect(now).toMatch(/_readServerCategories\(cid\)[\s\S]*_callRpcWithAuthGuard\(name, params/);
    expect(now).not.toMatch(/_writeRpc\(|_rpcOrNoop\(|v2Queue|outbox\./i);
    expect(count(/\bv2\.(upsertCategory|deleteCategory)\(/g)).toEqual({});
    // The data layer's whole-list save.
    expect(count(/(?<![.\w])saveCategories\(/g)).toEqual({
      'shared/data-categories.js': 1, // its definition
      'shared/data.js': 1, // a class just made on this device going up
      'shared/seed-data.js': 1, // Demo Mode's sample class
      'teacher/dash-class-manager.js': 1, // Duplicate Class: a new class
      'teacher/grading-setup-copy.js': 1, // Copy Grading Setup: an existing class
    });
    // The three that save over an existing class ask first.
    const body = (file, fn) => {
      const src = read(file);
      const from = src.indexOf('function ' + fn + '(');
      expect(from, fn).toBeGreaterThan(-1);
      return src.slice(from, src.indexOf('\n  }\n', from));
    };
    const asksFirst = (text, ask, save) => {
      expect(text.indexOf(ask), ask).toBeGreaterThan(-1);
      expect(text.indexOf(ask)).toBeLessThan(text.indexOf(save));
    };
    asksFirst(
      body('teacher/grading-setup-copy.js', 'applySetup'),
      '_categoriesCurrent(dstCid, plan.categories)',
      '_applyCategories(dstCid',
    );
  });
});

describe('a list of categories that waited in the outbox is never sent blind', () => {
  const OLD_NOT_SENT = ['An older category save that could not be checked was not sent', 'warning'];
  const WAITED_NOT_SENT = ['A category save that waited was not sent: the list had changed', 'warning'];
  const names = () => server.categories.map(c => [c.name, c.weight]);
  const sentNames = () => server.sent.map(s => s.name);
  const schoolAddsProjects = () =>
    server.fromAnotherDevice('save_categories', {
      p_course_id: CID,
      p_categories: [
        { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 50 },
        { id: CAT_TESTS, name: 'Tests', weight: 30 },
        { name: 'Projects', weight: 20 },
      ],
    });
  /* Save Categories with no connection, as the build before this fix did
     it: the list on this device, and the whole of it left in the outbox. */
  async function oldCodeQueues(rows) {
    await goOffline();
    adoptCategoriesFromServer(
      CID,
      rows.map((r, i) => ({ id: r.id, name: r.name, weight: r.weight, displayOrder: i, calcMode: 'points' })),
    );
    _outbox();
    window.v2Queue.push('save_categories', {
      p_course_id: CID,
      p_categories: rows.map(r => ({ id: r.id, name: r.name, weight: r.weight, calc_mode: 'points' })),
    });
    await settle();
  }
  const REWEIGHTED = [
    { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 70 },
    { id: CAT_TESTS, name: 'Tests', weight: 30 },
  ];
  let told;
  let sentry;
  beforeEach(() => {
    told = [];
    sentry = window.Sentry;
    window.Sentry = { captureMessage: (message, level) => told.push([message, level]), captureException() {} };
    localStorage.setItem('sb-testproject-auth-token', JSON.stringify({ user: { id: TEACHER } }));
  });
  afterEach(() => {
    window.Sentry = sentry;
  });

  it('an older build’s save, and a category was added at school since: it is not sent, and the category stays', async () => {
    await openApp();
    await oldCodeQueues(REWEIGHTED);
    schoolAddsProjects();
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(sentNames()).toEqual([]);
    expect(names()).toEqual([
      ['Assignments', 50],
      ['Tests', 30],
      ['Projects', 20],
    ]);
    expect(getSyncDotState()).toEqual({ status: 'error', title: "Some changes couldn't be saved" });
    expect(told).toEqual([OLD_NOT_SENT]);
    // The class was read again: this device grades with the server's list.
    expect(getCategories(CID).map(c => [c.name, c.weight])).toEqual(names());
    // Red until the class has been read again and the app opened again.
    await openApp();
    expect(getSyncDotState().status).toBe('idle');
    expect(sentNames()).toEqual([]);
  });

  it('an older build’s save, and nobody else changed the list: it is still not sent (what its device had loaded was never kept)', async () => {
    await openApp();
    await oldCodeQueues(REWEIGHTED);
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(sentNames()).toEqual([]);
    expect(names()).toEqual([
      ['Assignments', 60],
      ['Tests', 40],
    ]);
    expect(getSyncDotState().status).toBe('error');
    expect(told).toEqual([OLD_NOT_SENT]);
    expect(getCategories(CID).map(c => c.weight)).toEqual([60, 40]);
  });

  it('an older build’s save of the list the server already holds: dropped, and nothing is wrong', async () => {
    await openApp();
    await oldCodeQueues([
      { id: CAT_ASSIGNMENTS, name: 'Assignments', weight: 60 },
      { id: CAT_TESTS, name: 'Tests', weight: 40 },
    ]);
    server.sent.length = 0;
    await openApp();
    await goOnline();
    expect(sentNames()).toEqual([]);
    expect(window.v2Queue.stats()).toMatchObject({ queued: 0, deadLettered: 0 });
    expect(getSyncDotState().status).toBe('idle');
    expect(told).toEqual([]);
  });

  /* This build's own list can still end up waiting: Copy Grading Setup
     saves through the outbox, and the connection can go as it leaves. */
  async function thisBuildsSaveWaits() {
    await openApp();
    server.reachable = false; // the browser says online; the request fails
    saveCategories(
      CID,
      REWEIGHTED.map((r, i) => ({ id: r.id, name: r.name, weight: r.weight, displayOrder: i, calcMode: 'points' })),
    );
    await settle();
    expect(window.v2Queue.stats().queued).toBe(1);
    server.sent.length = 0;
    server.fake.calls.length = 0;
  }

  it('this build’s save that had to wait goes when the server still holds the list it was made over, after one read', async () => {
    await thisBuildsSaveWaits();
    await goOnline();
    expect(server.fake.calls.filter(c => /categories/.test(c.name)).map(c => c.name)).toEqual([
      'list_categories',
      'save_categories',
    ]);
    expect(names()).toEqual([
      ['Assignments', 70],
      ['Tests', 30],
    ]);
    expect(told).toEqual([]);
    expect(getSyncDotState().status).toBe('idle');
  });

  it('this build’s save that had to wait, and the list changed at school meanwhile: it is not sent', async () => {
    await thisBuildsSaveWaits();
    schoolAddsProjects();
    await goOnline();
    expect(sentNames()).toEqual([]);
    expect(names()).toEqual([
      ['Assignments', 50],
      ['Tests', 30],
      ['Projects', 20],
    ]);
    expect(told).toEqual([WAITED_NOT_SENT]);
    expect(getSyncDotState().status).toBe('error');
    expect(getCategories(CID).map(c => c.name)).toEqual(['Assignments', 'Tests', 'Projects']);
  });

  it('this build’s save that waits through a closed tab is weighed the same way by the next page', async () => {
    await thisBuildsSaveWaits();
    schoolAddsProjects();
    await openApp();
    await goOnline();
    expect(sentNames()).toEqual([]);
    expect(names().length).toBe(3);
    expect(told).toEqual([WAITED_NOT_SENT]);
  });
});

/* ── A class this device makes ──────────────────────────────────────────── */

describe('a class made on this device reaches the server with the settings this device shows', () => {
  // A load now replaces every setting on the device with the server's, and
  // a save sends only what changed. So whatever makes a class must send the
  // server everything the device shows for it: nothing is put right later
  // by the next settings save, as it used to be.
  const everything = cid => {
    const cc = getCourseConfig(cid) || {};
    const c = COURSES[cid] || {};
    return {
      method: cc.calcMethod || c.calcMethod || 'average',
      decay: Number(cc.decayWeight != null ? cc.decayWeight : c.decayWeight || 0.65),
      recent: getRecentScoreLimit(cid) || null,
      folders: getFoldersCountAsOne(cid),
      coursesEqually: getCoursesCountEqually(cid),
      scale: clone(getGradingScale(cid)),
      round: getRoundWholePercent(cid),
      terms: clone(getReportingTerms(cid)),
      levels: levelOrderFor(cid)[0] === 1 ? 'asc' : 'desc',
      style: courseGradeMode(cid),
      timezone: c.timezone || null,
      late: c.lateWorkPolicy || null,
      name: c.name,
      gradeLevel: c.gradeLevel || '',
    };
  };
  // The class's first load from the server: the row the server was sent.
  const firstLoad = (cid, row) => {
    row = Object.assign({ teacher_id: TEACHER }, clone(row));
    _applyBundleCourseConfig(cid, { grading_scale: row.grading_scale, category_weights: row.category_weights }, row);
    _applyBundleCourseRow(cid, row);
  };
  const SETTINGS_IN_A_BACKUP = () => ({
    calcMethod: 'decayingAvg',
    decayWeight: 0.8,
    recentScoreLimit: 4,
    foldersCountAsOne: false,
    coursesCountEqually: true,
    gradingScale: BC_SCALE(),
    roundPercent: true,
    reportingTerms: clone(TERMS_A),
    levelOrder: 'asc',
  });
  const backupOf = (courseInfo, config) => {
    const backup = {
      course: 'e0000000-0000-4000-8000-0000000000aa',
      students: [],
      categories: [],
      assessments: [],
      scores: {},
      config: config || SETTINGS_IN_A_BACKUP(),
    };
    if (courseInfo) backup.courseInfo = courseInfo;
    return backup;
  };
  async function restore(backup) {
    const rows = [];
    server.fake.on('import_json_restore', params => {
      rows.push(clone(params.p_payload.courses[0]));
      return { data: { student_ids: {} }, error: null };
    });
    const made = FVBackupRestore.restoreClassFromBackup(backup, { name: 'Restored' });
    await made.sent;
    await settle();
    return { cid: made.cid, row: rows[0] };
  }

  const BACKUPS = [
    ['a backup from before November 2026 (no class row in it)', undefined],
    [
      'a backup whose class row and settings disagree (made on a computer that had kept its own method)',
      { name: 'Science 9', gradeLevel: '9', gradingSystem: 'letter', calcMethod: 'average', decayWeight: 0.65 },
    ],
    [
      'a backup made on a computer in step with the server',
      { name: 'Science 9', gradeLevel: '9', gradingSystem: 'letter', calcMethod: 'decayingAvg', decayWeight: 0.8 },
    ],
  ];
  it.each(BACKUPS)('Restore Class from Backup, %s: the server is sent the method the device shows', async (_, info) => {
    await openApp();
    const { cid, row } = await restore(backupOf(info));
    expect([everything(cid).method, everything(cid).decay]).toEqual(['decayingAvg', 0.8]);
    expect([row.calc_method, row.decay_weight]).toEqual(['decayingAvg', 0.8]);
  });

  it.each(BACKUPS)(
    'Restore Class from Backup, %s: nothing the device shows changes at the class’s first load',
    async (_, info) => {
      await openApp();
      const { cid, row } = await restore(backupOf(info));
      const shown = everything(cid);
      server.sent.length = 0;
      firstLoad(cid, row);
      await settle();
      expect(everything(cid)).toEqual(shown);
      // And the load had nothing to send up or put right.
      expect(server.fake.calls.filter(c => c.name === 'update_course' && c.params.p_course_id === cid)).toEqual([]);
    },
  );

  it('Restore Class from Backup with no method in its settings: the class row’s method, on the device and on the server', async () => {
    await openApp();
    const config = SETTINGS_IN_A_BACKUP();
    delete config.calcMethod;
    delete config.decayWeight;
    const info = { name: 'Science 9', gradeLevel: '9', gradingSystem: 'both', calcMethod: 'highest', decayWeight: 0.7 };
    const { cid, row } = await restore(backupOf(info, config));
    expect([everything(cid).method, row.calc_method, row.decay_weight]).toEqual(['highest', 'highest', 0.7]);
    const shown = everything(cid);
    firstLoad(cid, row);
    expect(everything(cid)).toEqual(shown);
  });

  /* A class restored by the build before this fix: the device holds the
     backup's method, the server was sent Average 65%, and nothing has sent
     the real one since. As that build left it: this device's saved copy of
     the class with its own method, and a row on the server that has never
     been updated since it was made. */
  async function restoredUnderTheOldBuild() {
    await openApp();
    closeApp();
    const saved = JSON.parse(localStorage.getItem('gb-courseconfig-' + CID));
    Object.assign(saved, { calcMethod: 'decayingAvg', decayWeight: 0.8 });
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(saved));
    const meta = JSON.parse(localStorage.getItem('gb-bundle-meta-' + CID));
    delete meta.settings;
    localStorage.setItem('gb-bundle-meta-' + CID, JSON.stringify(meta));
    expect([server.course.calc_method, server.course.decay_weight]).toEqual(['average', 0.65]);
    expect(server.course.updated_at).toBe(server.course.created_at);
    server.sent.length = 0;
  }

  it('a class restored by the build before this fix keeps its method at the first load: it is sent up once, not overwritten', async () => {
    await restoredUnderTheOldBuild();
    await openApp();
    expect([everything(CID).method, everything(CID).decay]).toEqual(['decayingAvg', 0.8]);
    expect(server.patches()).toEqual([{ calc_method: 'decayingAvg', decay_weight: 0.8 }]);
    expect([server.course.calc_method, server.course.decay_weight]).toEqual(['decayingAvg', 0.8]);
    // Once: the row has been updated now, and the next load has nothing to say.
    server.sent.length = 0;
    await openApp();
    await hearOfChange();
    expect(server.sent).toEqual([]);
    expect([everything(CID).method, everything(CID).decay]).toEqual(['decayingAvg', 0.8]);
  });

  it('but not once any computer has updated the class’s row since: then it cannot be told from an old copy, and the server’s stands', async () => {
    await restoredUnderTheOldBuild();
    // At school: a different setting. The row is no longer as it was made.
    schoolSets(byName('Rubric Levels'));
    await openApp();
    expect(server.patches()).toEqual([]);
    expect([everything(CID).method, everything(CID).decay]).toEqual(['average', 0.65]);
    expect(server.course.calc_method).toBe('average');
  });

  it('Duplicate Class: the copy goes up with the method the device shows for the original', async () => {
    // The original's class row says Average; this device's settings for it
    // say Decaying Average 80% (it is what the device grades with).
    await openApp();
    act('cmSetCalcMethod', { value: 'decayingAvg' });
    input('cmDecaySlider', {}, 80);
    await quiet();
    COURSES[CID].calcMethod = 'average';
    COURSES[CID].decayWeight = 0.65;
    const created = [];
    server.fake.on('create_course', params => {
      created.push(clone(params));
      return { data: 'e0000000-0000-4000-8000-00000000c0de', error: null };
    });
    const sent = [];
    const send = server.fake.rpc;
    server.fake.rpc = function (name, params) {
      if (name === 'update_course' && params.p_course_id !== CID) sent.push(clone(params.p_patch));
      return send(name, params);
    };
    DashClassManager.duplicateCourse(CID, 'C');
    for (let i = 0; i < 40; i++) await settle();
    const copy = Object.keys(COURSES).find(cid => cid !== CID);
    expect(copy).toBe('e0000000-0000-4000-8000-00000000c0de');
    const row = Object.assign({}, ...sent);
    expect([row.calc_method, row.decay_weight]).toEqual(['decayingAvg', 0.8]);
    expect([everything(copy).method, everything(copy).decay]).toEqual(['decayingAvg', 0.8]);
    delete COURSES[copy];
  });

  it('a class made with no connection: every setting chosen for it goes up when the class does', async () => {
    await openApp();
    await goOffline();
    const made = createCourse({ name: 'Made offline', gradeLevel: '8', calcMethod: 'mostRecent', decayWeight: 0.8 });
    const cc = getCourseConfig(made.id);
    Object.assign(cc, {
      calcMethod: 'mostRecent',
      decayWeight: 0.8,
      levelOrder: 'asc',
      foldersCountAsOne: false,
      recentScoreLimit: 3,
      roundPercent: true,
    });
    saveCourseConfig(made.id, cc);
    await settle();
    const created = [];
    server.fake.on('create_course', params => {
      if (!server.reachable) return { data: null, error: { message: 'network: failed to fetch' } };
      created.push(clone(params));
      return { data: 'e0000000-0000-4000-8000-00000000c0df', error: null };
    });
    const sent = [];
    const send = server.fake.rpc;
    server.fake.rpc = function (name, params) {
      if (name === 'update_course' && server.reachable && params.p_course_id !== CID) sent.push(clone(params.p_patch));
      return send(name, params);
    };
    server.reachable = true;
    setOnline(true);
    await window.v2Queue.flush();
    for (let i = 0; i < 40; i++) await settle();
    expect(created.map(p => [p.p_calc_method, p.p_decay_weight])).toEqual([['mostRecent', 0.8]]);
    expect(Object.assign({}, ...sent)).toEqual({
      calc_method: 'mostRecent',
      decay_weight: 0.8,
      level_order: 'asc',
      folders_count_as_one: false,
      recent_score_limit: 3,
      round_percent: true,
    });
    delete COURSES['e0000000-0000-4000-8000-00000000c0df'];
  });
});

/* ── The phone and Demo Mode ────────────────────────────────────────────── */

describe('the phone', () => {
  const phoneScripts = () =>
    readdirSync(resolve(root, 'teacher-mobile'))
      .filter(f => f.endsWith('.js'))
      .map(f => 'teacher-mobile/' + f);

  it('has no screen that saves a class setting', () => {
    // If the phone ever gets one, it must save through the same data-layer
    // functions as the desktop, and this list is where to say so.
    const savers =
      /\b(saveCourseConfig|updateCourse|saveReportingTerms|saveCategories|saveReturnSettings|setStudentPageSwitch)\s*\(|['"`](update_course|save_categories|reorder_categories)['"`]|v2\.(saveCategories|reorderCategories|upsertCategory|deleteCategory)\b/;
    expect(phoneScripts().length).toBeGreaterThan(5);
    phoneScripts().forEach(file => expect(read(file), file).not.toMatch(savers));
  });

  it('loads the class with the same code as the desktop, so what a load replaces is the same there', () => {
    const html = read('teacher-mobile/index.html');
    expect(html).toMatch(/shared\/data\.js/);
    expect(html).toMatch(/shared\/offline-queue\.js/);
    expect(html).toMatch(/shared\/calc\.js/);
  });
});

describe('Demo Mode', () => {
  it('has one device and no server: a settings save stays on the device', async () => {
    await openApp();
    localStorage.setItem('gb-demo-mode', '1');
    server.sent.length = 0;
    act('cmSetRoundPercent', { value: 'whole' });
    await settle();
    expect(getRoundWholePercent(CID)).toBe(true);
    expect(server.sent).toEqual([]);
  });
});
