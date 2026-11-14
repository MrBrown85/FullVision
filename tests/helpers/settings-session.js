/**
 * One teacher, one computer, one sitting in Class Settings: every request the
 * app sends, in order (tests/settings-session-requests.test.js).
 *
 * The fix for a stale device putting old settings back changed what a save
 * sends. For a teacher with one computer nothing may change but this:
 *   - an update_course carries fewer keys (only what the teacher changed);
 *   - a save that changes nothing sends no request;
 *   - a whole-list category save is preceded by one list_categories read.
 * runSession() drives the real data layer, outbox and Class Settings against
 * the stand-in server (class-settings-server.js) and returns the log.
 * compareLogs() walks two logs and sorts every difference into one of those
 * three, or into `notAllowed`.
 *
 * The same session runs on the commit before the fix:
 * scripts/settings-session-main-log.mjs copies this file there and saves
 * what it sent as tests/fixtures/settings-session-main.json. So everything
 * here must run on that commit too: only Class Settings' own actions and
 * the data layer's long-standing functions.
 *
 * Not in the session: a category save made with no connection. The fix
 * stops that one on purpose (it cannot check the server's list), which is a
 * fourth difference with its own tests in stale-settings-revert.test.js.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { settle } from './fake-supabase.js';
import { CID, applyUpdateCourse, classSettingsServer } from './class-settings-server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUEUE_SOURCE = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');
const clone = v => JSON.parse(JSON.stringify(v));
const SRC = 'e0000000-0000-4000-8000-0000000000b2';

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

/* Everything a page holds in memory goes, as on a reload. localStorage (the
   saved classes and the outbox) stays. As in stale-settings-revert.test.js. */
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
  _outboxConfigured = false;
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  clearProfCache();
  DashClassManager.resetState();
}

/* What a request is in the log. Two things would differ from run to run for
   no reason and are named instead: an idempotency key, and the version a
   class load says it already has ("none", "current" when it is the
   server's, "older" when the server has moved on). */
function logged(server, name, params) {
  const p = clone(params || {});
  if ('p_idempotency_key' in p) p.p_idempotency_key = '<key>';
  if (name === 'get_class_bundle') {
    p.p_if_version = p.p_if_version == null ? 'none' : p.p_if_version === server.version ? 'current' : 'older';
  }
  return { name, params: p };
}

export async function runSession() {
  const original = {
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    teacher: _teacherId,
    quiet: _REFRESH_QUIET_MS,
    bundle: globalThis.__FV_CLASS_BUNDLE,
    confirm: globalThis.showConfirm,
    queue: window.v2Queue,
    store: localStorage._store,
  };
  const tabs = [];
  const server = classSettingsServer();
  const start = clone(server.course);
  const log = [];
  const send = server.fake.rpc;
  // Only what reached the server: a request made with no connection is the
  // outbox trying, and how often it tries is a matter of timing.
  server.fake.rpc = function (name, params) {
    if (server.reachable) log.push(logged(server, name, params));
    return send(name, params);
  };
  const step = text => log.push({ step: text });

  _REFRESH_QUIET_MS = 0;
  globalThis.__FV_CLASS_BUNDLE = true;
  globalThis.showConfirm = (title, message, ok, style, onConfirm) => onConfirm();
  localStorage._store = {};
  globalThis.getSupabase = () => server.fake;
  setOnline(true);

  /* Class Settings asks for the categories a timer tick after a draw
     (_cmCatPrepare). settle() turns over only setImmediate rounds, which can
     all run before a setTimeout(0) is due, so a timer of our own goes first:
     timers fire in the order they were set, so the draw's has run by then. */
  async function quiet() {
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 0));
      await settle();
      const refresh = _refreshState[CID];
      if (!(refresh && refresh.running) && !_hasUnsentWrites()) return;
      await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('the session never went quiet');
  }
  async function openApp() {
    forgetPage();
    setOnline(false);
    runInThisContext(QUEUE_SOURCE, { filename: 'shared/offline-queue.js' });
    tabs.push(window.v2Queue);
    setOnline(true);
    server.reachable = true;
    await initAllCourses();
    await initData(CID);
    await quiet();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    DashClassManager.handleAction('cmTermCancel', { dataset: {} });
    await settle();
    await quiet();
  }
  const act = (action, dataset) => DashClassManager.handleAction(action, { dataset: dataset || {} });
  const input = (action, dataset, value) =>
    DashClassManager.handleInput({ dataset: Object.assign({ actionInput: action }, dataset), value: String(value) });
  const change = (action, props) =>
    DashClassManager.handleChange(Object.assign({ dataset: { actionChange: action } }, props));
  const blur = (action, value) =>
    DashClassManager.handleBlur({ dataset: { actionBlur: action }, value: value, style: {} });
  const terms = rows => {
    act('cmTermPreset', { value: 'semesters' });
    rows.forEach((r, i) =>
      ['label', 'starts_on', 'ends_on'].forEach(f => input('cmTermLive', { idx: String(i), field: f }, r[f])),
    );
    act('cmTermSave');
  };
  const each = async actions => {
    for (const [what, run] of actions) {
      step(what);
      await run();
      await quiet();
    }
  };

  try {
    step('Open the app');
    await openApp();

    await each([
      ['Calculation Method: Most Recent', () => act('cmSetCalcMethod', { value: 'mostRecent' })],
      ['Calculation Method: Decaying Average', () => act('cmSetCalcMethod', { value: 'decayingAvg' })],
      // The slider saves when it is let go (its change event), as a drag ends.
      [
        'Decay Weight: 70%',
        () => {
          input('cmDecaySlider', {}, 70);
          change('cmDecayCommit', { value: '70' });
        },
      ],
      ['Count Only the Most Recent: 3', () => change('cmRecentLimit', { value: '3' })],
      ['Folders Count as One: off', () => change('cmFoldersCountAsOne', { checked: false })],
      ['Each Course Counts Equally: on', () => change('cmCoursesCountEqually', { checked: true })],
      ['Grading Scale: BC Letter Bands', () => act('cmPointsScaleBc')],
      ['Round to a Whole %: whole', () => act('cmSetRoundPercent', { value: 'whole' })],
      ['Grading Style: Letter', () => act('cmSetGradingSystem', { value: 'letter' })],
      [
        'Reporting Terms: two semesters',
        () =>
          terms([
            { label: 'Semester 1', starts_on: '2026-09-08', ends_on: '2027-01-22' },
            { label: 'Semester 2', starts_on: '2027-01-25', ends_on: '2027-06-29' },
          ]),
      ],
      ['Rubric Levels: Emerging First', () => act('cmSetLevelOrder', { value: 'asc' })],
      ['Late Work Policy', () => blur('cmLateWorkPolicy', 'Two days of grace.')],
      ['Class Name', () => blur('cmUpdateName', 'History 12 (Block C)')],
    ]);

    await each([
      ['Choose what is already chosen: Emerging First', () => act('cmSetLevelOrder', { value: 'asc' })],
      ['Choose what is already chosen: whole %', () => act('cmSetRoundPercent', { value: 'whole' })],
      ['Choose what is already chosen: BC Letter Bands', () => act('cmPointsScaleBc')],
    ]);

    await each([
      [
        'Save Categories: new weights',
        () => {
          input('cmCatWeightLive', { idx: '0' }, 70);
          input('cmCatWeightLive', { idx: '1' }, 30);
          act('cmCatSave');
        },
      ],
      [
        'Save Categories: a rename and a new category',
        () => {
          act('cmCatAdd');
          input('cmCatNameLive', { idx: '1' }, 'Quizzes');
          input('cmCatNameLive', { idx: '2' }, 'Projects');
          input('cmCatWeightLive', { idx: '0' }, 50);
          input('cmCatWeightLive', { idx: '1' }, 30);
          input('cmCatWeightLive', { idx: '2' }, 20);
          act('cmCatSave');
        },
      ],
      [
        'Copy Grading Setup from another class: Course %, Rubric Levels and categories',
        async () => {
          COURSES[SRC] = { id: SRC, name: 'History 11', gradeLevel: '9', gradingSystem: 'proficiency' };
          _cache.courseConfigs[SRC] = { roundPercent: false, levelOrder: 'desc' };
          _cache.categories[SRC] = [
            { id: 's1', name: 'Assignments', weight: 40, displayOrder: 0 },
            { id: 's2', name: 'Quizzes', weight: 40, displayOrder: 1 },
            { id: 's3', name: 'Projects', weight: 20, displayOrder: 2 },
          ];
          const plan = GradingSetupCopy.planSetup(SRC, CID, { roundPercent: true, levelOrder: true, categories: true });
          await GradingSetupCopy.applySetup(plan, {});
          delete COURSES[SRC];
          delete _cache.courseConfigs[SRC];
          delete _cache.categories[SRC];
        },
      ],
    ]);

    step('No connection: four settings changed, then the connection comes back');
    setOnline(false);
    server.reachable = false;
    act('cmSetRoundPercent', { value: 'whole' });
    act('cmSetLevelOrder', { value: 'asc' });
    act('cmSetCalcMethod', { value: 'highest' });
    blur('cmLateWorkPolicy', 'No late work after the unit test.');
    await settle();
    server.reachable = true;
    setOnline(true);
    await window.v2Queue.flush();
    await quiet();

    step('The class is read again');
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();

    step('Close the app and open it again');
    await openApp();

    await each([
      ['After reopening, Count Only the Most Recent: All Scores', () => change('cmRecentLimit', { value: '' })],
      [
        'After reopening, Save Categories: new weights',
        () => {
          input('cmCatWeightLive', { idx: '0' }, 45);
          input('cmCatWeightLive', { idx: '1' }, 35);
          act('cmCatSave');
        },
      ],
      [
        'After reopening, choose what is already chosen: Emerging First',
        () => act('cmSetLevelOrder', { value: 'asc' }),
      ],
    ]);

    const course = clone(server.course);
    delete course.updated_at;
    return { start, log, final: { course, categories: clone(server.categories) } };
  } finally {
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
  }
}

/* Walk the log from before the fix (`before`) beside the one from this code
   (`after`). `start` is the class's row on the server when the session
   began: the walk keeps a copy up to date with every update_course `before`
   sent, so it can tell a key that changed the row from one that only
   repeated it.

   Each difference lands in exactly one list:
     fewerKeys      an update_course both sent, where `after` left out keys
                    that repeated what the server already held
     notSent        an update_course only `before` sent, every key of which
                    repeated what the server already held
     categoryRead   a list_categories only `after` sent, right before its
                    save_categories or reorder_categories
     notAllowed     anything else */
export function compareLogs(before, after, start) {
  const row = clone(start);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rowAfter = patch => {
    const next = clone(row);
    applyUpdateCourse(next, patch);
    delete next.updated_at;
    return next;
  };
  const rowNow = () => {
    const now = clone(row);
    delete now.updated_at;
    return now;
  };
  const repeats = patch => same(rowAfter(patch), rowNow());
  const applied = entry => {
    if (entry && entry.name === 'update_course') applyUpdateCourse(row, entry.params.p_patch);
  };
  const out = {
    requests: { before: 0, after: 0 },
    same: 0,
    fewerKeys: [],
    notSent: [],
    categoryRead: [],
    notAllowed: [],
  };
  out.requests.before = before.filter(e => e.name).length;
  out.requests.after = after.filter(e => e.name).length;
  let i = 0;
  let j = 0;
  let at = '';
  while (i < before.length || j < after.length) {
    const b = before[i];
    const a = after[j];
    if (b && a && same(b, a)) {
      if (b.step) at = b.step;
      else out.same += 1;
      applied(b);
      i += 1;
      j += 1;
      continue;
    }
    const bothUpdate =
      b &&
      a &&
      b.name === 'update_course' &&
      a.name === 'update_course' &&
      b.params.p_course_id === a.params.p_course_id;
    if (bothUpdate) {
      const kept = Object.keys(a.params.p_patch);
      const dropped = {};
      Object.keys(b.params.p_patch).forEach(k => {
        if (kept.indexOf(k) < 0) dropped[k] = b.params.p_patch[k];
      });
      const subset = kept.length > 0 && kept.every(k => same(a.params.p_patch[k], b.params.p_patch[k]));
      if (subset && Object.keys(dropped).length && repeats(dropped)) {
        out.fewerKeys.push({ step: at, sent: kept, leftOut: Object.keys(dropped) });
        applied(b);
        i += 1;
        j += 1;
        continue;
      }
    }
    if (b && b.name === 'update_course' && repeats(b.params.p_patch)) {
      out.notSent.push({ step: at, keys: Object.keys(b.params.p_patch) });
      i += 1;
      continue;
    }
    const next = after[j + 1];
    if (a && a.name === 'list_categories' && next && /^(save|reorder)_categories$/.test(next.name)) {
      out.categoryRead.push({ step: at, before: next.name });
      j += 1;
      continue;
    }
    out.notAllowed.push({ step: at, before: b || null, after: a || null });
    applied(b);
    if (b) i += 1;
    if (a) j += 1;
  }
  return out;
}
