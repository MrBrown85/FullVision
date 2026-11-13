/**
 * Draft and Returned for a signed-in teacher (S0-W1,
 * docs/plans/student-page-build-plan.md 1.2; the server's side is
 * migrations/2026110902_grade_return.sql).
 *
 * - The class's two settings are the server's: they come on the course row
 *   with the class, and go up in saveCourseConfig's update_course.
 * - Its Draft and Returned rows are the server's: list_course_grade_returns,
 *   read when the class loads, when another device changes it, and once
 *   this device's own writes have landed. A save here shows at once, by the
 *   rule in shared/grade-state.js, and is never overwritten by rows read
 *   from before it.
 * - Return goes to the server through the outbox: one call for each
 *   student, after that cell's score writes, with an idempotency key, never
 *   with an id made on this device. A failure shows on the sync dot only.
 * - Leaving When I Return Them sends the setting and no return: the server
 *   returns what waits by a trigger, and this device does the same.
 * - A class whose student page is off is sent nothing new.
 *
 * The server here is tests/helpers/fake-supabase.js with a small
 * stand-in for the rows: `rows` is what list_course_grade_returns sends.
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

describe('the class’s two settings come from the server with the class', () => {
  it('a class whose student page is on, set to When I Return Them', async () => {
    await openClass();
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(getCourseConfig(CID)).toMatchObject({ student_page_enabled: true, return_grades: 'on_return' });
    expect(JSON.parse(localStorage.getItem('gb-courseconfig-' + CID))).toMatchObject({
      student_page_enabled: true,
      return_grades: 'on_return',
    });
  });

  it.each([
    ['no choice made', null, null],
    ['As Soon As I Save', 'on_save', 'on_save'],
    ['When I Return Them', 'on_return', 'on_return'],
    ['a value this code does not know', 'sometimes', null],
  ])(
    'a class whose student page is off, with %s: off, and the choice kept as the server holds it',
    async (_, sent, kept) => {
      course = { student_page_enabled: false, return_grades: sent };
      await openClass();
      expect(getReturnSettings(CID)).toEqual({ student_page: false, return_grades: kept });
      // The key is there, null included: this device knows the server's choice.
      expect(Object.prototype.hasOwnProperty.call(getCourseConfig(CID), 'return_grades')).toBe(true);
      expect(getCourseConfig(CID).return_grades).toBe(kept);
      expect('student_page_enabled' in getCourseConfig(CID)).toBe(false);
      // And nothing was asked about its rows.
      expect(names()).toEqual(['get_class_bundle']);
    },
  );

  it('a server from before the two columns: neither is written, and the class reads off', async () => {
    course = null;
    await openClass();
    expect(getReturnSettings(CID)).toEqual({ student_page: false, return_grades: null });
    expect('return_grades' in getCourseConfig(CID)).toBe(false);
    expect('student_page_enabled' in getCourseConfig(CID)).toBe(false);
    expect(names()).toEqual(['get_class_bundle']);
  });

  it('turned on from another device: this one learns of it with the class, and reads its rows', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(callsTo('list_course_grade_returns')).toEqual([]);
    // The other device turns it on and grades a piece: the class's version moves.
    course = { student_page_enabled: true, return_grades: 'on_return' };
    rows = { [CAUSES]: { [NOOR]: { is_draft: true } } };
    version = 2;
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();
    expect(getReturnSettings(CID).student_page).toBe(true);
    expect(callsTo('list_course_grade_returns')).toEqual([{ p_course_id: CID }]);
    expect(state(NOOR, CAUSES)).toBe('draft');
  });

  it('the first time a class’s rows are in this session, the page on screen is drawn again (S2)', async () => {
    await openClass();
    const drawn = [];
    const was = Router.getCurrentPage;
    Router.getCurrentPage = () => ({ render: () => drawn.push('render') });
    try {
      // As at the start of a session: the class's rows not yet read.
      delete _gradeReturnsLoadedFor[CID];
      delete _gradeReturnsReadThisSession[CID];
      expect(ReportScores.ready(CID)).toBe(false);
      await _loadServerGradeReturns(CID, true);
      expect(ReportScores.ready(CID)).toBe(true);
      expect(drawn.length).toBe(1);
      // Read again, nothing changed: no redraw.
      await _loadServerGradeReturns(CID, true);
      expect(drawn.length).toBe(1);
    } finally {
      Router.getCurrentPage = was;
    }
  });

  it('turned off from another device: the class reads off again and its rows are no longer read', async () => {
    await openClass();
    expect(callsTo('list_course_grade_returns').length).toBe(1);
    course = { student_page_enabled: false, return_grades: 'on_return' };
    version = 2;
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(callsTo('list_course_grade_returns').length).toBe(1);
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    expect(state(NOOR, CAUSES)).toBe('returned');
    expect(callsTo('list_course_grade_returns').length).toBe(1);
  });
});

/* The two settings: who sends them, and when the device changes
   (PR 999 review, findings 2 to 6). */
const draftCount = n => fake.on('course_draft_count', () => ({ data: n, error: null }));
const serverTakesSettings = () =>
  fake.on('update_course', p => {
    Object.assign(course, p.p_patch);
    version += 1;
    return { data: null, error: null };
  });
const neither = p => {
  expect('student_page_enabled' in p, JSON.stringify(p)).toBe(false);
  expect('return_grades' in p, JSON.stringify(p)).toBe(false);
};

describe('a device holding an old copy of a class’s settings cannot send it', () => {
  // Review finding 2: the home laptop loaded the class while it was As Soon
  // As I Save; at school it became When I Return Them and thirty grades
  // were saved as drafts; at home any other setting is changed.
  it.each([
    ['As Soon As I Save', { student_page_enabled: true, return_grades: 'on_save' }],
    ['no choice made', { student_page_enabled: true, return_grades: null }],
  ])('held as %s: saving another setting sends neither of the two, so nothing is returned', async (_, old) => {
    course = old;
    await openClass();
    // Elsewhere the class becomes When I Return Them. This device has not heard.
    course = { student_page_enabled: true, return_grades: 'on_return' };
    fake.calls.length = 0;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'mostRecent' }));
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { roundPercent: true }));
    await quiet();
    expect(patches().length).toBe(2);
    patches().forEach(neither);
    expect(patches()[0].calc_method).toBe('mostRecent');
    expect(patches()[1].round_percent).toBe(true);
  });

  it('held with the switch on after it was turned off elsewhere: the switch is not turned back on', async () => {
    await openClass();
    course = { student_page_enabled: false, return_grades: 'on_return' };
    fake.calls.length = 0;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { roundPercent: true }));
    await quiet();
    expect(patches().length).toBe(1);
    neither(patches()[0]);
  });

  it('a caller that hands saveCourseConfig other values for the two changes neither, here or on the server', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    fake.calls.length = 0;
    const cfg = Object.assign({}, getCourseConfig(CID), { calcMethod: 'mostRecent', return_grades: 'on_save' });
    delete cfg.student_page_enabled;
    saveCourseConfig(CID, cfg);
    // The class still holds its grades, and the draft still waits.
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(getCourseConfig(CID).calcMethod).toBe('mostRecent');
    expect(state(NOOR, CAUSES)).toBe('draft');
    await quiet();
    expect(patches().length).toBe(1);
    neither(patches()[0]);
    expect(callsTo('return_grades')).toEqual([]);
  });

  it('an update_course queued by an earlier build, with a setting beside the two, goes without them', async () => {
    await openClass();
    fake.calls.length = 0;
    setOnline(false);
    _outbox();
    window.v2Queue.push('update_course', {
      p_course_id: CID,
      p_patch: { calc_method: 'mostRecent', student_page_enabled: true, return_grades: 'on_save' },
    });
    await sendAll();
    await quiet();
    expect(patches()).toEqual([{ calc_method: 'mostRecent' }]);
  });
});

describe('every caller of saveCourseConfig and update_course', () => {
  const read = file => readFileSync(resolve(root, file), 'utf-8');
  const sources = () => {
    const out = [];
    ['shared', 'teacher', 'teacher-mobile'].forEach(dir =>
      readdirSync(resolve(root, dir))
        .filter(f => f.endsWith('.js'))
        .forEach(f => out.push(dir + '/' + f)),
    );
    out.push('login-auth.js');
    return out;
  };

  it('saveCourseConfig is called from the places this test knows, and no others', () => {
    const found = {};
    sources().forEach(file => {
      const n = (read(file).match(/\bsaveCourseConfig\(/g) || []).length;
      if (n) found[file] = n;
    });
    // A new caller changes a number here. It may hand saveCourseConfig any
    // copy of a class's settings: the tests below hold that neither of the
    // two is sent or changed whatever that copy says, so add it and move on.
    expect(found).toEqual({
      // the class move's replay; Demo Mode's switch and the two settings' own writer
      'shared/data.js': 3,
      'shared/data-config-settings.js': 1, // its definition
      'shared/data-courses-terms.js': 1, // the report-terms save
      // Reflect on Feedback's and Show My Learning's switches (S10, S13-W2: setCourseFeedbackOptions, Demo Mode only)
      'shared/data-reflect.js': 1,
      'shared/seed-data.js': 1,
      'teacher/dash-class-manager.js': 10,
      'teacher/grading-setup-copy.js': 1,
    });
  });

  it('update_course is sent from the places this test knows, and no others', () => {
    // The class's settings (saveCourseConfig) moved to shared/data-config-settings.js, and
    // updateCourse to shared/data-courses-terms.js; the other senders are in shared/data.js.
    // The three files are read, in the order they load.
    const SENDERS = ['shared/data.js', 'shared/data-config-settings.js', 'shared/data-courses-terms.js'];
    const lines = SENDERS.map(read).join('\n').split('\n');
    const callers = [];
    let fn = null;
    lines.forEach(line => {
      const m = /^(?:async )?function (\w+)\(|^window\.(?:v2\.)?(\w+) = function/.exec(line);
      if (m) fn = m[1] || m[2];
      if (
        /'update_course'/.test(line) &&
        /_writeRpc\(|_callRpcWithAuthGuard\(|_rpcOrNoop\(|^\s*'update_course',$/.test(line)
      ) {
        callers.push(fn);
      }
    });
    expect(callers).toEqual([
      '_applyBundleCourseConfig', // a setting only this device has, sent up once
      '_sendUpCurriculumTags', // the BC Curriculum Link
      'saveReturnSettings', // the two settings, when they stop the class holding
      '_startHolding', // the two settings, when they start it
      'saveCourseConfig', // every other class setting (shared/data-config-settings.js)
      'updateCourse', // name, block, grade and the like (shared/data-courses-terms.js)
    ]);
    sources()
      .filter(file => !SENDERS.includes(file))
      .forEach(file => expect(read(file), file).not.toMatch(/['"`]update_course['"`]/));
  });

  /* Stale settings (tests/stale-settings-revert.test.js): a class-settings
     write carries only what the teacher changed, and says so with a mark
     kept with the queued write (FV_SETTINGS_CHANGED_ONLY), so an unmarked
     one naming a whole-copy setting is known to be from an earlier build
     and is weighed against the server first. A new sender of update_course
     goes in this list with the answer to "does it mark its write?". */
  it('each sender of class settings marks its write as only what changed; the two settings’ own writers do not', () => {
    const src =
      read('shared/data.js') +
      '\n' +
      read('shared/data-config-settings.js') +
      '\n' +
      read('shared/data-courses-terms.js');
    const body = fn => {
      const from = src.search(new RegExp('^(?:async )?function ' + fn + '\\(', 'm'));
      expect(from, fn).toBeGreaterThan(-1);
      const rest = src.slice(from + 1);
      const to = rest.search(/^(?:async )?function \w+\(|^window\./m);
      return rest.slice(0, to);
    };
    const marks = fn => /FV_SETTINGS_CHANGED_ONLY|_changedOnly\(/.test(body(fn));
    expect({
      _applyBundleCourseConfig: marks('_applyBundleCourseConfig'),
      _sendUpCurriculumTags: marks('_sendUpCurriculumTags'),
      updateCourse: marks('updateCourse'),
      saveCourseConfig: marks('saveCourseConfig'),
      saveReturnSettings: marks('saveReturnSettings'),
      _startHolding: marks('_startHolding'),
    }).toEqual({
      _applyBundleCourseConfig: true,
      _sendUpCurriculumTags: false, // one column, never part of a whole copy
      updateCourse: true,
      saveCourseConfig: true,
      saveReturnSettings: false, // the two settings: their own rules
      _startHolding: false,
    });
    // The mark comes out in the one place every update_course passes.
    expect(body('_callRpcWithAuthGuard')).toMatch(/_sendableCoursePatch\(params, options\)/);
  });

  it('what each sender sends is what it changed, never the mark, and an unchanged copy sends nothing', async () => {
    await openClass();
    fake.calls.length = 0;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { roundPercent: true }));
    updateCourse(CID, { name: 'History 12 A' });
    await quiet();
    expect(patches()).toEqual([{ round_percent: true }, { name: 'History 12 A' }]);
    fake.calls.length = 0;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID)));
    await quiet();
    expect(patches()).toEqual([]);
  });

  // What each of those sends of the two settings, for a class in every state.
  const CLASSES = [
    ['its student page on, When I Return Them', { student_page_enabled: true, return_grades: 'on_return' }],
    ['its student page on, As Soon As I Save', { student_page_enabled: true, return_grades: 'on_save' }],
    ['its student page off', { student_page_enabled: false, return_grades: 'on_return' }],
    ['no choice made', { student_page_enabled: false, return_grades: null }],
  ];
  const HANDED = [
    {},
    { student_page_enabled: true },
    { student_page_enabled: false, return_grades: 'on_save' },
    { student_page_enabled: true, return_grades: 'on_return' },
    { return_grades: null },
    { return_grades: 'on_save' },
  ];

  it.each(CLASSES)('saveCourseConfig, for a class with %s: neither, whatever it is handed', async (_, onServer) => {
    course = onServer;
    await openClass();
    const before = getReturnSettings(CID);
    fake.calls.length = 0;
    HANDED.forEach((handed, i) => {
      const cfg = Object.assign({}, getCourseConfig(CID), { recentScoreLimit: i + 1 }, handed);
      if (!('student_page_enabled' in handed)) delete cfg.student_page_enabled;
      saveCourseConfig(CID, cfg);
      expect(getReturnSettings(CID)).toEqual(before);
    });
    await quiet();
    expect(patches().length).toBe(HANDED.length);
    patches().forEach(neither);
    expect(names().filter(n => /return_grades|course_draft_count/.test(n))).toEqual([]);
  });

  it('updateCourse: neither, even when handed them', async () => {
    await openClass();
    fake.calls.length = 0;
    updateCourse(CID, { name: 'History 12 A', student_page_enabled: false, return_grades: 'on_save' });
    await quiet();
    expect(patches()).toEqual([{ name: 'History 12 A' }]);
  });

  it('a setting only this device has, sent up when the class loads: that setting and neither of the two', async () => {
    await openClass();
    // This device holds a grading scale the server never saved, and the two settings.
    const cfg = Object.assign({}, getCourseConfig(CID), { gradingScale: { boundaries: [50, 60, 73, 86] } });
    _cache.courseConfigs[CID] = cfg;
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(cfg));
    fake.calls.length = 0;
    version = 2;
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();
    expect(patches().length).toBe(1);
    expect(Object.keys(patches()[0])).toEqual(['grading_scale']);
  });

  it('the BC Curriculum Link sent up at boot names that one column', () => {
    expect(read('shared/data.js')).toMatch(
      /_writeRpc\('update_course', \{ p_course_id: r\.id, p_patch: \{ curriculum_tags: mine\.slice\(\) \} \}\)/,
    );
  });

  it('the two settings’ own writer sends the key it changes and nothing else', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    serverTakesSettings();
    fake.calls.length = 0;
    expect((await saveReturnSettings(CID, { return_grades: 'on_return' })).ok).toBe(true);
    await quiet();
    saveReturnSettings(CID, { return_grades: 'on_save' });
    await quiet();
    saveReturnSettings(CID, { student_page_enabled: false });
    await quiet();
    expect(patches()).toEqual([
      { return_grades: 'on_return' },
      { return_grades: 'on_save' },
      { student_page_enabled: false },
    ]);
  });

  it('whoever asks, an update_course never leaves with either beside another setting', async () => {
    await openClass();
    fake.calls.length = 0;
    // Writes of this build say they carry only what changed (_changed_only):
    // since Nov 10 one that does not, naming a setting only a whole copy
    // ever carried, is an older build's and is never sent when anything in
    // it differs from the server (tests/stale-settings-revert.test.js). So
    // the two here carry the mark; they carried none before.
    await _callRpcWithAuthGuard('update_course', {
      p_course_id: CID,
      p_patch: { level_order: 'asc', return_grades: 'on_save', student_page_enabled: false, _changed_only: true },
    });
    await _writeRpc('update_course', {
      p_course_id: CID,
      p_patch: { round_percent: true, return_grades: null, _changed_only: true },
    });
    expect(patches()).toEqual([{ level_order: 'asc' }, { round_percent: true }]);
  });

  it('Duplicate Class: the copy goes up with the original’s choice, once, and never the switch', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    fake.calls.length = 0;
    COURSES[CID].gradingSystem = 'letter';
    DashClassManager.duplicateCourse(CID, 'C');
    await quiet();
    const made = fake.committed.filter(c => c.name === 'create_course');
    expect(made.length).toBe(1);
    const copy = Object.keys(COURSES).find(cid => cid !== CID);
    expect(copy).toMatch(UUID);
    const sent = callsTo('update_course').filter(p => p.p_course_id === copy);
    const carrying = sent.filter(p => 'return_grades' in p.p_patch || 'student_page_enabled' in p.p_patch);
    expect(carrying.map(p => p.p_patch)).toEqual([{ return_grades: 'on_save' }]);
    expect(getReturnSettings(copy)).toEqual({ student_page: false, return_grades: 'on_save' });
    // And nothing was sent about the original.
    callsTo('update_course')
      .filter(p => p.p_course_id === CID)
      .forEach(p => neither(p.p_patch));
    delete COURSES[copy];
    Object.keys(_DATA_KEYS).forEach(field => delete _cache[field][copy]);
  });
});

describe('the device’s own stored value alone turns nothing on', () => {
  // What the rewritten tests of this PR dropped ("a signed-in teacher's
  // switch reads off whatever this device holds"): the settings object can
  // be copied by a backup, a duplicate or any save. Only the server's word
  // turns the page on.
  beforeEach(() => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
  });
  const onThisDeviceOnly = () => {
    const cfg = Object.assign({}, getCourseConfig(CID), { student_page_enabled: true, return_grades: 'on_return' });
    _cache.courseConfigs[CID] = cfg;
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(cfg));
  };

  it('reads off, shows no tab, keeps no row, and sends and reads nothing new', async () => {
    await openClass();
    onThisDeviceOnly();
    fake.calls.length = 0;
    expect(getCourseConfig(CID).student_page_enabled).toBe(true);
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(CmStudentPage.isShown(CID)).toBe(false);
    expect(CmStudentPage.render(CID)).toBe('');
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect(state(NOOR, CAUSES)).toBe('returned');
    expect(getGradeReturns(CID)).toEqual({});
    expect(Grader.returnGrades(CID, CAUSES, [NOOR]).returned).toBe(0);
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'mostRecent' }));
    expect((await listStudentCards(CID)).data).toBe(null);
    await quiet();
    expect(names().filter(n => NEW_RPCS.test(n))).toEqual([]);
    patches().forEach(neither);
    // And the save took the stray switch off this device's copy.
    expect('student_page_enabled' in getCourseConfig(CID)).toBe(false);
  });

  it('a new session, the class unchanged on the server: still off', async () => {
    await openClass();
    onThisDeviceOnly();
    forgetMemory();
    fake.calls.length = 0;
    await initData(CID);
    await quiet();
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(names().filter(n => NEW_RPCS.test(n))).toEqual([]);
  });

  it('the server’s word is kept across sessions for a class it did turn on', async () => {
    course = { student_page_enabled: true, return_grades: 'on_return' };
    await openClass();
    forgetMemory();
    delete _serverStudentPage[CID];
    fake.calls.length = 0;
    // The saved copy opens, and the server answers that nothing has changed.
    await initData(CID);
    expect(getReturnSettings(CID).student_page).toBe(true);
    await quiet();
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([1]);
    expect(callsTo('list_course_grade_returns').length).toBe(1);
  });
});

describe('starting to hold grades waits for the server’s word', () => {
  // Review finding 3. What the server would do with each grade as it lands.
  let serverCell;
  const serverJudges = () => {
    serverCell = {};
    fake.on('upsert_tag_score', p => {
      serverCell[p.p_enrollment_id] =
        course.student_page_enabled && course.return_grades === 'on_return' ? 'draft' : 'returned';
      return { data: null, error: null };
    });
  };

  it('When I Return Them: the device changes only once the server has answered; a grade made then waits on both', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    rows = null;
    serverJudges();
    let answer;
    fake.on(
      'update_course',
      p =>
        new Promise(r => {
          answer = () => {
            Object.assign(course, p.p_patch);
            version += 1;
            r({ data: null, error: null });
          };
        }),
    );
    fake.calls.length = 0;
    const asked = saveReturnSettings(CID, { return_grades: 'on_return' });
    expect(asked.now).toBeUndefined();
    await settle();
    // Asked for directly, not left in the outbox to go when it can.
    expect(patches()).toEqual([{ return_grades: 'on_return' }]);
    expect(window.v2Queue.stats().queued).toBe(0);
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    answer();
    expect(await asked).toEqual({ ok: true });
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect(state(NOOR, CAUSES)).toBe('draft');
    await quiet();
    expect(serverCell[NOOR]).toBe('draft');
    expect(state(NOOR, CAUSES)).toBe('draft');
  });

  it('offline: not made, nothing waits to be sent, and a grade made then is returned on both (reviewer’s case A)', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    rows = null;
    serverJudges();
    fake.calls.length = 0;
    setOnline(false);
    const out = await saveReturnSettings(CID, { return_grades: 'on_return' });
    expect(out.ok).toBe(false);
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    expect(JSON.parse(localStorage.getItem('gb-courseconfig-' + CID)).return_grades).toBe('on_save');
    expect(window.v2Queue.stats().queued).toBe(0);
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect(state(NOOR, CAUSES)).toBe('returned');
    await sendAll();
    await quiet();
    expect(patches()).toEqual([]);
    expect(serverCell[NOOR]).toBe('returned');
    expect(state(NOOR, CAUSES)).toBe('returned');
  });

  it('a dropped connection: not made and not retried behind the teacher’s back (reviewer’s case B)', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    rows = null;
    serverJudges();
    fake.on('update_course', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    fake.calls.length = 0;
    const out = await saveReturnSettings(CID, { return_grades: 'on_return' });
    expect(out.ok).toBe(false);
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    expect(window.v2Queue.stats().queued).toBe(0);
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect(state(NOOR, CAUSES)).toBe('returned');
    await quiet();
    expect(serverCell[NOOR]).toBe('returned');
    // Past the outbox's first backoff: it was asked once, and never again.
    await new Promise(r => setTimeout(r, 1200));
    expect(callsTo('update_course').length).toBe(1);
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
  });

  describe('when the server’s answer is lost or never comes', () => {
    // Verify pass on PR 999, finding 2. The server makes the change; the
    // device is told "could not change this"; without a read of the class
    // it would stay on As Soon As I Save while the server holds every grade.
    const lost = () =>
      fake.on('update_course', p => {
        Object.assign(course, p.p_patch);
        version += 1;
        return { data: null, error: { message: 'network: failed to fetch' } };
      });

    it('lost: the class is read again whole, and the device ends where the server is (reviewer’s case B2)', async () => {
      course = { student_page_enabled: true, return_grades: 'on_save' };
      await openClass();
      rows = null;
      serverJudges();
      lost();
      fake.calls.length = 0;
      const out = await saveReturnSettings(CID, { return_grades: 'on_return' });
      expect(out.ok).toBe(false);
      await quiet();
      // Not "has it changed?": the class itself, then its rows.
      expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
      expect(callsTo('list_course_grade_returns').length).toBe(1);
      expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
      // A grade saved next is a draft on both.
      level(NOOR, CAUSES, SIGNIFICANCE, 2);
      expect(state(NOOR, CAUSES)).toBe('draft');
      await quiet();
      expect(serverCell[NOOR]).toBe('draft');
    });

    it('lost, and the read of the class fails too: it is retried like any failed load, until the device agrees', async () => {
      course = { student_page_enabled: true, return_grades: 'on_save' };
      await openClass();
      lost();
      let loads = 0;
      fake.on('get_class_bundle', () => {
        loads += 1;
        return loads < 3
          ? { data: null, error: { message: 'network: failed to fetch' } }
          : { data: serverClass(), error: null };
      });
      expect((await saveReturnSettings(CID, { return_grades: 'on_return' })).ok).toBe(false);
      await quiet();
      expect(courseLoadFailed(CID)).toBe(true);
      expect(getSyncDotState().status).toBe('error');
      expect(toasts).toEqual([]);
      expect(getReturnSettings(CID).return_grades).toBe('on_save');
      await retryActiveCourseLoad();
      await quiet();
      await retryActiveCourseLoad();
      await quiet();
      expect(loads).toBe(3);
      expect(courseLoadFailed(CID)).toBe(false);
      expect(getReturnSettings(CID).return_grades).toBe('on_return');
    });

    it('lost, and the page closed: the saved copy is not trusted the next time the class opens', async () => {
      course = { student_page_enabled: true, return_grades: 'on_save' };
      await openClass();
      lost();
      fake.on('get_class_bundle', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
      await saveReturnSettings(CID, { return_grades: 'on_return' });
      await quiet();
      // A new session, the connection back.
      forgetMemory();
      fake.on('get_class_bundle', p =>
        p.p_if_version === version
          ? { data: { not_modified: true, version }, error: null }
          : { data: serverClass(), error: null },
      );
      fake.calls.length = 0;
      await initData(CID);
      await quiet();
      expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
      expect(getReturnSettings(CID).return_grades).toBe('on_return');
    });

    it('the switch, lost: the page comes on here once the class has been read', async () => {
      course = { student_page_enabled: false, return_grades: 'on_return' };
      await openClass();
      lost();
      expect((await setStudentPageSwitch(CID, true)).ok).toBe(false);
      await quiet();
      expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
      expect(callsTo('list_course_grade_returns').length).toBe(1);
    });

    it('never answered: it gives up, says it could not be changed, and reads the class again', async () => {
      course = { student_page_enabled: true, return_grades: 'on_save' };
      await openClass();
      const wait = RETURN_SETTINGS_ASK_MS;
      RETURN_SETTINGS_ASK_MS = 60;
      try {
        fake.on('update_course', p => {
          Object.assign(course, p.p_patch);
          version += 1;
          return new Promise(() => {}); // committed; the answer never comes
        });
        fake.calls.length = 0;
        const out = await saveReturnSettings(CID, { return_grades: 'on_return' });
        expect(out.ok).toBe(false);
        await quiet();
        expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
        expect(getReturnSettings(CID).return_grades).toBe('on_return');
      } finally {
        RETURN_SETTINGS_ASK_MS = wait;
      }
    });

    it('realtime’s word of a change asked for directly is not taken for this page’s own echo', async () => {
      course = { student_page_enabled: true, return_grades: 'on_save' };
      await openClass();
      const mine = window.__fvClientId;
      window.__fvClientId = 'this-page';
      try {
        const before = _classVersion[CID];
        _echoNeedsReload = false; // as after a load: nothing sent since
        // A write this page made and already holds: its echo needs no reload.
        expect(_isOwnChangeEcho(CID, { last_client: 'this-page' }, before + 1)).toBe(true);
        let answer;
        fake.on('update_course', () => new Promise(r => (answer = () => r({ data: null, error: null }))));
        const asked = saveReturnSettings(CID, { return_grades: 'on_return' });
        await settle();
        // The server has made the change this page asked for and has not
        // yet made itself: the class is read, not waved through.
        expect(_isOwnChangeEcho(CID, { last_client: 'this-page' }, before + 1)).toBe(false);
        answer();
        await asked;
        await quiet();
      } finally {
        window.__fvClientId = mine;
      }
    });

    it('refused outright (nothing changed on the server): the read finds the class as it was', async () => {
      course = { student_page_enabled: true, return_grades: 'on_save' };
      await openClass();
      fake.on('update_course', () => ({ data: null, error: { code: '22023', message: 'invalid' } }));
      fake.calls.length = 0;
      expect((await saveReturnSettings(CID, { return_grades: 'on_return' })).ok).toBe(false);
      await quiet();
      expect(callsTo('get_class_bundle').length).toBe(1);
      expect(getReturnSettings(CID).return_grades).toBe('on_save');
      expect(courseLoadFailed(CID)).toBe(false);
    });

    it('offline, or with writes that will not go, nothing was asked, so nothing is read', async () => {
      course = { student_page_enabled: true, return_grades: 'on_save' };
      await openClass();
      fake.calls.length = 0;
      setOnline(false);
      expect((await saveReturnSettings(CID, { return_grades: 'on_return' })).ok).toBe(false);
      await settle();
      expect(fake.calls).toEqual([]);
      expect(courseLoadFailed(CID)).toBe(false);
    });
  });

  it('the switch, for a class already on When I Return Them, offline: not made (reviewer’s case A2)', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    serverJudges();
    fake.calls.length = 0;
    setOnline(false);
    const out = await setStudentPageSwitch(CID, true);
    expect(out.ok).toBe(false);
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(window.v2Queue.stats().queued).toBe(0);
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect(state(NOOR, CAUSES)).toBe('returned');
    await sendAll();
    await quiet();
    expect(serverCell[NOOR]).toBe('returned');
    expect(patches()).toEqual([]);
  });

  it('the switch turned on: only the switch is sent; then the class, the server’s own choice and its rows are read', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    // This device's copy of the choice is old: it must not be what is sent.
    const cfg = Object.assign({}, getCourseConfig(CID), { return_grades: 'on_save' });
    _cache.courseConfigs[CID] = cfg;
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(cfg));
    localStorage.setItem('gb-grade-returns-' + CID, JSON.stringify({ [CAUSES]: { [MATEO]: { is_draft: true } } }));
    rows = { [CAUSES]: { [NOOR]: { is_draft: false, returned_at: '2026-11-01T17:00:00+00:00' } } };
    serverTakesSettings();
    fake.calls.length = 0;
    expect(await setStudentPageSwitch(CID, true)).toEqual({ ok: true });
    await quiet();
    expect(patches()).toEqual([{ student_page_enabled: true }]);
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(callsTo('list_course_grade_returns')).toEqual([{ p_course_id: CID }]);
    expect(getGradeReturn(CID, NOOR, CAUSES)).toEqual({ is_draft: false, returned_at: '2026-11-01T17:00:00+00:00' });
    expect(getGradeReturn(CID, MATEO, CAUSES)).toBe(null);
  });

  it('a grade still on its way goes first', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    rows = null;
    const arrivals = [];
    fake.on(
      'upsert_tag_score',
      () =>
        new Promise(r =>
          setTimeout(() => {
            arrivals.push('grade');
            r({ data: null, error: null });
          }, 60),
        ),
    );
    fake.on('update_course', p => {
      arrivals.push('setting');
      Object.assign(course, p.p_patch);
      return { data: null, error: null };
    });
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect((await saveReturnSettings(CID, { return_grades: 'on_return' })).ok).toBe(true);
    expect(arrivals).toEqual(['grade', 'setting']);
    await quiet();
  });

  it('with a change that will not send, it is not made', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    rows = null;
    const wait = START_HOLDING_WAIT_MS;
    START_HOLDING_WAIT_MS = 250;
    try {
      fake.on('upsert_tag_score', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
      level(NOOR, CAUSES, SIGNIFICANCE, 2);
      fake.calls.length = 0;
      const out = await saveReturnSettings(CID, { return_grades: 'on_return' });
      expect(out.ok).toBe(false);
      expect(patches()).toEqual([]);
      expect(getReturnSettings(CID).return_grades).toBe('on_save');
    } finally {
      START_HOLDING_WAIT_MS = wait;
      fake.on('upsert_tag_score', () => ({ data: null, error: null }));
      await sendAll();
      await quiet();
    }
  });

  it('stopping is made here at once and queued, offline too: both sides end the same', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    fake.calls.length = 0;
    setOnline(false);
    const asked = saveReturnSettings(CID, { return_grades: 'on_save' });
    expect(asked.now).toEqual({ ok: true });
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    expect(state(NOOR, CAUSES)).toBe('returned');
    expect(window.v2Queue.stats().queued).toBe(1);
    await sendAll();
    await quiet();
    expect(patches()).toEqual([{ return_grades: 'on_save' }]);
    expect(callsTo('return_grades')).toEqual([]);
  });

  it('in Demo Mode every change is made at once, on the device', async () => {
    localStorage.setItem('gb-demo-mode', '1');
    try {
      fake.calls.length = 0;
      COURSES['c-demo'] = { id: 'c-demo', name: 'Science 8' };
      expect(saveReturnSettings('c-demo', { student_page_enabled: true }).now).toEqual({ ok: true });
      expect(saveReturnSettings('c-demo', { return_grades: 'on_return' }).now).toEqual({ ok: true });
      expect(getReturnSettings('c-demo')).toEqual({ student_page: true, return_grades: 'on_return' });
      expect(saveReturnSettings('c-demo', { student_page_enabled: false }).now).toEqual({ ok: true });
      expect(getReturnSettings('c-demo').student_page).toBe(false);
      await settle();
      expect(fake.calls).toEqual([]);
    } finally {
      localStorage.removeItem('gb-demo-mode');
      delete COURSES['c-demo'];
      delete _cache.courseConfigs['c-demo'];
    }
  });
});

describe('how many grades wait, for the question before a class stops holding them', () => {
  // Review finding 4.
  it('is the server’s count: a class this device has not read this session, a withdrawn student, a Missing piece', async () => {
    await openClass();
    forgetMemory();
    // Three drafts on the server; this device's rows know none of them.
    rows = { [CAUSES]: { [NOOR]: { is_draft: true }, [MATEO]: { is_draft: true }, [PRIYA]: { is_draft: true } } };
    _loadSavedCopy(CID);
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    draftCount(3);
    fake.calls.length = 0;
    expect(await draftsWaitingToReturn(CID)).toEqual({ count: 3 });
    expect(callsTo('course_draft_count')).toEqual([{ p_course_id: CID }]);
  });

  it('counts a draft made a moment ago: what is still to be sent goes first', async () => {
    await openClass();
    rows = null;
    const order = [];
    fake.on('upsert_tag_score', () => (order.push('grade'), { data: null, error: null }));
    fake.on('course_draft_count', () => (order.push('count'), { data: 1, error: null }));
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect(await draftsWaitingToReturn(CID)).toEqual({ count: 1 });
    expect(order).toEqual(['grade', 'count']);
    await quiet();
  });

  it.each([
    ['offline', () => setOnline(false)],
    [
      'the server does not answer',
      () => fake.on('course_draft_count', () => ({ data: null, error: { message: 'network: failed to fetch' } })),
    ],
    ['the answer is not a number', () => fake.on('course_draft_count', () => ({ data: null, error: null }))],
  ])('cannot be known when %s', async (_, arrange) => {
    await openClass();
    arrange();
    expect(await draftsWaitingToReturn(CID)).toEqual({ count: null });
  });

  it('a count that was asked for and not answered: the class is read again, as after any failed ask', async () => {
    await openClass();
    fake.on('course_draft_count', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    fake.calls.length = 0;
    expect(await draftsWaitingToReturn(CID)).toEqual({ count: null });
    await quiet();
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
    // Offline nothing is asked, and nothing is read.
    fake.calls.length = 0;
    setOnline(false);
    expect(await draftsWaitingToReturn(CID)).toEqual({ count: null });
    await settle();
    expect(fake.calls).toEqual([]);
  });

  it('a count that never comes gives up', async () => {
    await openClass();
    const wait = RETURN_SETTINGS_ASK_MS;
    RETURN_SETTINGS_ASK_MS = 60;
    try {
      fake.on('course_draft_count', () => new Promise(() => {}));
      expect(await draftsWaitingToReturn(CID)).toEqual({ count: null });
    } finally {
      RETURN_SETTINGS_ASK_MS = wait;
      await quiet();
    }
  });

  it('in Demo Mode it is the device’s own count, at once', () => {
    localStorage.setItem('gb-demo-mode', '1');
    try {
      expect(draftsWaitingToReturn(CID).now).toEqual({ count: 0 });
    } finally {
      localStorage.removeItem('gb-demo-mode');
    }
  });
});

describe('a refused write does not leave this device and the server apart', () => {
  // Review finding 6.
  it('a refused Return, then a read of the rows that fails: the grade shows as the draft it still is (reviewer’s case E)', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    expect(state(NOOR, CAUSES)).toBe('draft');
    fake.on('return_grades', () => ({ data: null, error: { code: 'P0002', message: 'assessment not found' } }));
    rows = { [CAUSES]: { [NOOR]: { is_draft: true } } };
    let reads = 0;
    fake.on('list_course_grade_returns', () => {
      reads += 1;
      return reads < 3
        ? { data: null, error: { message: 'network: failed to fetch' } }
        : { data: structuredClone(rows), error: null };
    });
    Grader.returnGrades(CID, CAUSES, [NOOR]);
    expect(state(NOOR, CAUSES)).toBe('returned');
    await quiet();
    // Refused: a draft again at once, whatever the read did.
    expect(state(NOOR, CAUSES)).toBe('draft');
    expect(toasts).toEqual([]);
    expect(getSyncDotState().status).toBe('error');
    // The read failed: it is owed, and the class counts as not loaded.
    expect(courseLoadFailed(CID)).toBe(true);
    expect(reads).toBeGreaterThan(0);
    // The retry (the dot's click does the same) reads until it works.
    await retryActiveCourseLoad();
    await quiet();
    await retryActiveCourseLoad();
    await quiet();
    expect(reads).toBe(3);
    expect(courseLoadFailed(CID)).toBe(false);
    expect(state(NOOR, CAUSES)).toBe('draft');
  });

  it('a refused change away from When I Return Them: the settings and the Draft marks come back from the server', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    const held = structuredClone(getGradeReturns(CID));
    // The server refuses the change, so it still holds the class's grades.
    fake.on('update_course', () => ({ data: null, error: { code: '22023', message: 'invalid' } }));
    fake.calls.length = 0;
    saveReturnSettings(CID, { return_grades: 'on_save' });
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    expect(state(NOOR, CAUSES)).toBe('returned');
    rows = held;
    await quiet();
    // Read again whole (not "has it changed?"), and its rows after.
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(state(NOOR, CAUSES)).toBe('draft');
    expect(toasts).toEqual([]);
    expect(getSyncDotState()).toEqual({ status: 'error', title: "Some changes couldn't be saved" });
  });

  it('a refused switch-off: the page comes back on, with its drafts', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    const held = structuredClone(getGradeReturns(CID));
    fake.on('update_course', () => ({ data: null, error: { code: 'P0002', message: 'course not found' } }));
    saveReturnSettings(CID, { student_page_enabled: false });
    expect(getReturnSettings(CID).student_page).toBe(false);
    rows = held;
    await quiet();
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(state(NOOR, CAUSES)).toBe('draft');
  });

  it('refused after the class was closed: its saved copy is not trusted the next time it opens', async () => {
    await openClass();
    expect(_classMeta(CID).dirty).toBe(false);
    _onReturnWriteRefused('update_course', { p_course_id: CID, p_patch: { return_grades: 'on_save' } });
    await quiet();
    forgetMemory();
    fake.calls.length = 0;
    _onReturnWriteRefused('update_course', { p_course_id: CID, p_patch: { return_grades: 'on_save' } });
    expect(_classMeta(CID).dirty).toBe(true);
    expect(fake.calls).toEqual([]);
    await initData(CID);
    await quiet();
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
  });

  it('a refused update_course that carried neither setting is no business of this', async () => {
    await openClass();
    fake.calls.length = 0;
    _onReturnWriteRefused('update_course', { p_course_id: CID, p_patch: { calc_method: 'mostRecent' } });
    await quiet();
    expect(fake.calls).toEqual([]);
  });
});

describe('the class’s rows are the server’s', () => {
  it('are read after the class itself, and kept in the form this device keeps rows', async () => {
    // As the server sends them: nulls left out, inside the copies too.
    rows = {
      [CAUSES]: {
        [NOOR]: {
          is_draft: true,
          returned_at: '2026-11-03T17:00:00+00:00',
          returned_copy: {
            v: 1,
            modifier: 0,
            tags: { [SIGNIFICANCE]: { value: 3, modifier: 0 } },
            criteria: {},
            checks: [],
          },
        },
        [MATEO]: { is_draft: false, returned_at: '2026-11-03T17:00:00+00:00' },
      },
      [WEEK1]: { [PRIYA]: { is_draft: true } },
    };
    await openClass();
    expect(names()).toEqual(['get_class_bundle', 'list_course_grade_returns']);
    expect(callsTo('list_course_grade_returns')).toEqual([{ p_course_id: CID }]);
    expect(_gradeReturnsLoadedFor[CID]).toBe(true);
    expect(getGradeReturn(CID, NOOR, CAUSES)).toEqual({
      is_draft: true,
      returned_at: '2026-11-03T17:00:00+00:00',
      returned_copy: {
        v: 1,
        value: null,
        modifier: 0,
        comment: null,
        tags: { [SIGNIFICANCE]: { value: 3, modifier: 0, comment: null } },
        criteria: {},
        checks: [],
      },
    });
    expect(state(NOOR, CAUSES)).toBe('draft');
    expect(state(MATEO, CAUSES)).toBe('returned');
    expect(state(PRIYA, WEEK1)).toBe('draft');
    expect(GradeState.draftsWaiting(CID)).toBe(2);
    // Returned-only grade math reads them: Noor keeps the 3 she was given, Priya has nothing on Week 1.
    const returned = getReturnedScores(CID);
    expect(returned[NOOR].filter(e => e.assessmentId === CAUSES && e.tagId === SIGNIFICANCE)[0].score).toBe(3);
    expect(returned[PRIYA].filter(e => e.assessmentId === WEEK1)).toEqual([]);
    // And they are on this device for the next time it opens.
    expect(JSON.parse(localStorage.getItem('gb-grade-returns-' + CID))[WEEK1][PRIYA]).toEqual({ is_draft: true });
  });

  it('a read that fails is a load that failed: the dot says so, and no draft is counted as returned', async () => {
    fake.on('list_course_grade_returns', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    await openClass();
    expect(courseLoadFailed(CID)).toBe(true);
    expect(getSyncDotState().status).toBe('error');
    expect(_gradeReturnsLoadedFor[CID]).toBeUndefined();
    expect(() => getReturnedScores(CID)).toThrow(/has not loaded/);
    expect(toasts).toEqual([]);
    // Tried again, it loads.
    fake.on('list_course_grade_returns', () => ({ data: structuredClone(rows), error: null }));
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();
    expect(courseLoadFailed(CID)).toBe(false);
    expect(getReturnedScores(CID)).toBe(getScores(CID));
  });

  it('a read that keeps failing is retried at the class load’s own pace: 15 s, 30 s, 1 min, then every 2 min', async () => {
    await openClass();
    fake.on('list_course_grade_returns', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    _gradeReturnsStale[CID] = true;
    const waits = [];
    const realTimeout = globalThis.setTimeout;
    // The retry timer as it is set, fired at once in place of the wait.
    const fire = async () => {
      expect(_loadRetryTimer).not.toBe(null);
      clearTimeout(_loadRetryTimer);
      _loadRetryTimer = null;
      await _handleExternalCourseUpdate(CID, 'gradebook');
      await quiet();
    };
    globalThis.setTimeout = function (fn, ms) {
      if (ms >= 15000) waits.push(ms);
      return realTimeout.apply(this, arguments);
    };
    try {
      await _handleExternalCourseUpdate(CID, 'gradebook');
      await quiet();
      for (let i = 0; i < 4; i++) await fire();
      // The class itself answers each time; only its rows fail. The pace
      // is still the failed load's, not 15 s for ever.
      expect(waits).toEqual([15000, 30000, 60000, 120000, 120000]);
      expect(courseLoadFailed(CID)).toBe(true);
      fake.on('list_course_grade_returns', () => ({ data: structuredClone(serverRows()), error: null }));
      await fire();
      expect(courseLoadFailed(CID)).toBe(false);
      expect(_loadRetryTimer).toBe(null);
    } finally {
      globalThis.setTimeout = realTimeout;
    }
  });

  it('an unchanged class is not asked for its rows twice in a session, but is on the first check of a new one', async () => {
    await openClass();
    expect(callsTo('list_course_grade_returns').length).toBe(1);
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null, 1]);
    expect(callsTo('list_course_grade_returns').length).toBe(1);
    // The page is opened again: the saved copy shows, and the rows it kept
    // are not trusted until the server's have been read.
    forgetMemory();
    rows = { [CAUSES]: { [NOOR]: { is_draft: true } } };
    await initData(CID);
    await quiet();
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null, 1, 1]);
    expect(callsTo('list_course_grade_returns').length).toBe(2);
    expect(state(NOOR, CAUSES)).toBe('draft');
  });

  it('a change from another device has them read again', async () => {
    await openClass();
    expect(state(NOOR, CAUSES)).toBe('returned');
    rows = { [CAUSES]: { [NOOR]: { is_draft: true, returned_at: '2026-11-03T17:00:00+00:00' } } };
    version = 2;
    await _handleExternalCourseUpdate(CID, 'gradebook');
    await quiet();
    expect(callsTo('list_course_grade_returns').length).toBe(2);
    expect(state(NOOR, CAUSES)).toBe('draft');
  });
});

describe('a save made on this device', () => {
  it('is a draft here at once, by the rule, and the server’s rows are read once the write has landed', async () => {
    rows = { [CAUSES]: { [NOOR]: { is_draft: false, returned_at: '2026-11-03T17:00:00+00:00' } } };
    await openClass();
    fake.calls.length = 0;
    _REFRESH_QUIET_MS = 30; // the pause the app waits for after the last change (2 s when it runs)
    fake.hold();
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    // Before the server has heard of it.
    expect(state(NOOR, CAUSES)).toBe('draft');
    expect(getGradeReturn(CID, NOOR, CAUSES).returned_copy.tags[SIGNIFICANCE].value).toBe(4);
    expect(callsTo('list_course_grade_returns')).toEqual([]);
    // The write lands; the server's trigger has made the same row.
    rows = {
      [CAUSES]: {
        [NOOR]: {
          is_draft: true,
          returned_at: '2026-11-03T17:00:00+00:00',
          returned_copy: getGradeReturn(CID, NOOR, CAUSES).returned_copy,
        },
      },
    };
    await fake.release();
    await quiet();
    expect(names().filter(n => n !== 'upsert_score')).toEqual(['upsert_tag_score', 'list_course_grade_returns']);
    expect(state(NOOR, CAUSES)).toBe('draft');
    expect(getGradeReturn(CID, NOOR, CAUSES).returned_at).toBe('2026-11-03T17:00:00+00:00');
  });

  it('a burst of grading is one read, after the last write', async () => {
    await openClass();
    rows = null;
    fake.calls.length = 0;
    // The pause the app waits for after the last change (2 s when it runs).
    _REFRESH_QUIET_MS = 30;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    level(MATEO, CAUSES, SIGNIFICANCE, 2);
    level(PRIYA, CAUSES, SIGNIFICANCE, 4);
    await quiet();
    const sent = names();
    expect(sent.filter(n => n === 'list_course_grade_returns').length).toBe(1);
    expect(sent[sent.length - 1]).toBe('list_course_grade_returns');
  });

  it('rows read from before a newer save here are left out, and read again', async () => {
    await openClass();
    rows = null;
    fake.calls.length = 0;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    // The read goes out, and before it answers the teacher grades again.
    let answer;
    let asked = 0;
    fake.on('list_course_grade_returns', () => {
      asked += 1;
      if (asked > 1) return { data: structuredClone(serverRows()), error: null };
      return new Promise(r => (answer = () => r({ data: { [CAUSES]: { [NOOR]: { is_draft: true } } }, error: null })));
    });
    for (let i = 0; i < 20 && !answer; i++) await new Promise(r => setTimeout(r, 50));
    expect(typeof answer).toBe('function');
    level(MATEO, CAUSES, SIGNIFICANCE, 2);
    answer();
    await settle();
    // The stale answer knew nothing of Mateo's draft: it was not put over it.
    expect(state(MATEO, CAUSES)).toBe('draft');
    rows = { [CAUSES]: { [NOOR]: { is_draft: true }, [MATEO]: { is_draft: true } } };
    await quiet();
    expect(asked).toBe(2);
    expect(state(MATEO, CAUSES)).toBe('draft');
    expect(state(NOOR, CAUSES)).toBe('draft');
  });

  it('with the student page off no row is kept and nothing is read', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    fake.calls.length = 0;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    expect(Grader.returnGrades(CID, CAUSES, [NOOR]).returned).toBe(0);
    await quiet();
    expect(getGradeReturns(CID)).toEqual({});
    expect(localStorage.getItem('gb-grade-returns-' + CID)).toBe(null);
    expect(names().filter(n => NEW_RPCS.test(n))).toEqual([]);
    expect(names().filter(n => !/^upsert_(tag_)?score$/.test(n))).toEqual([]);
  });
});

describe('Return goes to the server', () => {
  beforeEach(() => {
    fake.on('return_grades', p => ({
      data: {
        returned: p.p_enrollment_ids.length,
        enrollment_ids: p.p_enrollment_ids,
        returned_at: '2026-11-10T19:00:00+00:00',
      },
      error: null,
    }));
  });

  it('one call for each student returned, with the work, the student and a key', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    level(MATEO, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    fake.calls.length = 0;
    // Priya's grade is not a draft: she is passed over, here and in what is sent.
    const out = Grader.returnGrades(CID, CAUSES, [NOOR, MATEO, PRIYA]);
    expect(out.returned).toBe(2);
    expect(out.enrollment_ids).toEqual([NOOR, MATEO]);
    // Returned on this device at once.
    expect(state(NOOR, CAUSES)).toBe('returned');
    expect(state(MATEO, CAUSES)).toBe('returned');
    rows = {
      [CAUSES]: {
        [NOOR]: { is_draft: false, returned_at: '2026-11-10T19:00:00+00:00' },
        [MATEO]: { is_draft: false, returned_at: '2026-11-10T19:00:00+00:00' },
      },
    };
    await quiet();
    const sent = callsTo('return_grades');
    expect(sent.length).toBe(2);
    expect(sent.map(p => p.p_enrollment_ids)).toEqual([[NOOR], [MATEO]]);
    sent.forEach(p => {
      expect(Object.keys(p).sort()).toEqual(['p_assessment_id', 'p_enrollment_ids', 'p_idempotency_key']);
      expect(p.p_assessment_id).toBe(CAUSES);
      expect(p.p_idempotency_key).toMatch(UUID);
    });
    expect(sent[0].p_idempotency_key).not.toBe(sent[1].p_idempotency_key);
    // Then the rows are the server's, with its time.
    expect(names()[names().length - 1]).toBe('list_course_grade_returns');
    expect(getGradeReturn(CID, NOOR, CAUSES).returned_at).toBe('2026-11-10T19:00:00+00:00');
    expect(toasts).toEqual([]);
  });

  it('is filed under the cell: after that cell’s score writes, before a later one, and never merged with either', async () => {
    await openClass();
    fake.calls.length = 0;
    setOnline(false);
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    Grader.returnGrades(CID, CAUSES, [NOOR]);
    level(NOOR, CAUSES, SIGNIFICANCE, 3); // a new draft, after the return
    await settle();
    expect(state(NOOR, CAUSES)).toBe('draft');
    const queued = JSON.parse(localStorage.getItem('fv-sync-queue-v1')).entries.filter(e => /^cell:/.test(e.key || ''));
    expect(queued.map(e => e.endpoint)).toEqual(['upsert_tag_score', 'return_grades', 'upsert_tag_score']);
    expect(queued.map(e => e.key)).toEqual(Array(3).fill('cell:' + NOOR + ':' + CAUSES));
    await sendAll();
    const cell = fake.calls.filter(c => c.name === 'upsert_tag_score' || c.name === 'return_grades');
    expect(cell.map(c => c.name)).toEqual(['upsert_tag_score', 'return_grades', 'upsert_tag_score']);
    expect(cell[0].params.p_value).toBe(2);
    expect(cell[2].params.p_value).toBe(3);
    await quiet();
  });

  describe('in the outbox, beside writes to the whole student or the whole piece of work', () => {
    // Review finding 3: a Return queued after "clear a student's row" or a
    // rubric move could go out before it.
    let order;
    const slow = name =>
      fake.on(name, () => {
        order.push(name + ' starts');
        return new Promise(r =>
          setTimeout(() => {
            order.push(name + ' done');
            r({ data: null, error: null });
          }, 60),
        );
      });
    const quick = name =>
      fake.on(name, p => {
        order.push(name + (p.p_enrollment_ids ? ' ' + p.p_enrollment_ids[0].slice(-3) : '') + ' starts');
        return { data: null, error: null };
      });
    const giveBack = sid => ({ p_assessment_id: CAUSES, p_enrollment_ids: [sid], p_idempotency_key: _newEntryId() });
    async function queued(entries) {
      order = [];
      setOnline(false);
      _outbox();
      const q = window.v2Queue;
      entries.forEach(e => q['push'](e[0], e[1]));
      await sendAll();
      await new Promise(r => setTimeout(r, 150));
      await quiet();
      return order;
    }
    beforeEach(async () => {
      await openClass();
      fake.calls.length = 0;
    });

    it.each([
      ['every score of the student cleared', 'clear_row_scores', { p_enrollment_id: NOOR, p_course_id: CID }],
      [
        'the work’s scores moved to a copy of its rubric',
        'move_rubric_scores',
        { p_assessment_id: CAUSES, p_rubric_id: id(800), p_criterion_map: {}, p_check_map: {} },
      ],
      ['the work itself edited', 'update_assessment', { p_id: CAUSES, p_patch: { rubric_id: id(800) } }],
      ['the work’s column cleared', 'clear_column_scores', { p_assessment_id: CAUSES }],
    ])('a Return made after %s waits for it', async (_, name, payload) => {
      slow(name);
      quick('return_grades');
      const went = await queued([
        [name, payload],
        ['return_grades', giveBack(NOOR)],
      ]);
      expect(went).toEqual([name + ' starts', name + ' done', 'return_grades ' + NOOR.slice(-3) + ' starts']);
    });

    it.each([
      ['every score of the student cleared', 'clear_row_scores', { p_enrollment_id: NOOR, p_course_id: CID }],
      [
        'the work’s scores moved to a copy of its rubric',
        'move_rubric_scores',
        { p_assessment_id: CAUSES, p_rubric_id: id(800), p_criterion_map: {}, p_check_map: {} },
      ],
    ])('and %s after a Return waits for the Return', async (_, name, payload) => {
      slow('return_grades');
      fake.on(name, () => (order.push(name + ' starts'), { data: null, error: null }));
      const went = await queued([
        ['return_grades', giveBack(NOOR)],
        [name, payload],
      ]);
      expect(went).toEqual(['return_grades starts', 'return_grades done', name + ' starts']);
    });

    it('Returns to other students, and their own score writes, are not held up by it', async () => {
      slow('upsert_tag_score');
      quick('return_grades');
      const went = await queued([
        [
          'upsert_tag_score',
          { p_enrollment_id: MATEO, p_assessment_id: CAUSES, p_tag_id: SIGNIFICANCE, p_value: 2, p_modifier: 0 },
        ],
        ['return_grades', giveBack(NOOR)],
        ['return_grades', giveBack(PRIYA)],
      ]);
      // Both Returns went while Mateo's score was still on its way.
      expect(went.slice(0, 3)).toEqual([
        'upsert_tag_score starts',
        'return_grades ' + NOOR.slice(-3) + ' starts',
        'return_grades ' + PRIYA.slice(-3) + ' starts',
      ]);
    });

    it('a write to another student or another piece of work does not hold a Return', async () => {
      slow('clear_row_scores');
      slow('update_assessment');
      quick('return_grades');
      const went = await queued([
        ['clear_row_scores', { p_enrollment_id: MATEO, p_course_id: CID }],
        ['update_assessment', { p_id: WEEK1, p_patch: { title: 'Week One' } }],
        ['return_grades', giveBack(NOOR)],
      ]);
      expect(went.indexOf('return_grades ' + NOOR.slice(-3) + ' starts')).toBeLessThan(
        went.indexOf('clear_row_scores done'),
      );
    });
  });

  it('a retry after a lost answer carries the same key, so nothing is returned twice', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    fake.calls.length = 0;
    let n = 0;
    fake.on('return_grades', p => {
      n += 1;
      return n === 1
        ? { data: null, error: { message: 'network: failed to fetch' } }
        : {
            data: { returned: 1, enrollment_ids: p.p_enrollment_ids, returned_at: '2026-11-10T19:00:00+00:00' },
            error: null,
          };
    });
    Grader.returnGrades(CID, CAUSES, [NOOR]);
    await settle();
    expect(callsTo('return_grades').length).toBe(1);
    expect(state(NOOR, CAUSES)).toBe('returned');
    await sendAll();
    const sent = callsTo('return_grades');
    expect(sent.length).toBe(2);
    expect(sent[1].p_idempotency_key).toBe(sent[0].p_idempotency_key);
    expect(sent[1].p_enrollment_ids).toEqual([NOOR]);
    await quiet();
  });

  it('a student made on this device is never sent by the id it has here', async () => {
    await openClass();
    fake.calls.length = 0;
    setOnline(false);
    const local = 'slocal-1';
    saveStudents(CID, getStudents(CID).concat([{ id: local, firstName: 'Tessa', lastName: 'Wong' }]));
    level(local, CAUSES, SIGNIFICANCE, 3);
    expect(Grader.returnGrades(CID, CAUSES, [local]).returned).toBe(1);
    expect(state(local, CAUSES)).toBe('returned');
    await settle();
    expect(callsTo('return_grades')).toEqual([]);
    await sendAll();
    await quiet();
    const made = fake.committed.filter(c => c.name === 'create_student_and_enroll');
    expect(made.length).toBe(1);
    const sent = callsTo('return_grades');
    expect(sent.length).toBe(1);
    expect(sent[0].p_enrollment_ids.length).toBe(1);
    expect(sent[0].p_enrollment_ids[0]).toMatch(UUID);
    expect(JSON.stringify(fake.calls.filter(c => c.name !== 'create_student_and_enroll'))).not.toContain(local);
    // After her score, which waited for her server id too.
    const order = names().filter(
      n => n === 'upsert_tag_score' || n === 'return_grades' || n === 'create_student_and_enroll',
    );
    expect(order).toEqual(['create_student_and_enroll', 'upsert_tag_score', 'return_grades']);
    // And the row moved to her server id with her.
    const tessa = getStudents(CID).find(s => s.firstName === 'Tessa');
    expect(tessa.id).toMatch(UUID);
    expect(getGradeReturn(CID, local, CAUSES)).toBe(null);
  });

  it('an id the server will never know is not sent at all', async () => {
    await openClass();
    fake.calls.length = 0;
    _sendReturns(CID, CAUSES, ['not-a-student'], {}, {});
    _sendReturns(CID, 'not-an-assessment', [NOOR], {}, {});
    await settle();
    expect(callsTo('return_grades')).toEqual([]);
  });

  it('a return the server refuses shows on the sync dot only, and the next read of the rows puts the draft back', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    // The server still holds the draft: it refuses the return.
    rows = { [CAUSES]: { [NOOR]: { is_draft: true } } };
    fake.on('return_grades', () => ({ data: null, error: { code: 'P0002', message: 'assessment not found' } }));
    Grader.returnGrades(CID, CAUSES, [NOOR]);
    expect(state(NOOR, CAUSES)).toBe('returned');
    await quiet();
    expect(toasts).toEqual([]);
    expect(getSyncDotState()).toEqual({ status: 'error', title: "Some changes couldn't be saved" });
    expect(state(NOOR, CAUSES)).toBe('draft');
  });

  it('a class that does not hold grades sends no return', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    fake.calls.length = 0;
    expect(Grader.returnGrades(CID, CAUSES, [NOOR]).returned).toBe(0);
    await quiet();
    expect(callsTo('return_grades')).toEqual([]);
  });
});

describe('as the server is since S0-M4b (migrations/2026110905_grade_return_limits.sql)', () => {
  // The server no longer sends when a student opened a piece.
  it('under As Soon As I Save a changed grade is marked Updated by the server, not worked out here', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    rows = { [CAUSES]: { [NOOR]: { is_draft: false, returned_at: '2026-11-03T17:00:00+00:00' } } };
    await openClass();
    expect('seen_at' in getGradeReturn(CID, NOOR, CAUSES)).toBe(false);
    _REFRESH_QUIET_MS = 30;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    // Here: returned again at once, and with no word of the student having
    // looked, not marked Updated.
    expect(state(NOOR, CAUSES)).toBe('returned');
    expect(getGradeReturn(CID, NOOR, CAUSES).updated_at).toBeUndefined();
    // The server knows she had opened it: its row says Updated, with what it was.
    const was = { v: 1, modifier: 0, tags: { [SIGNIFICANCE]: { value: 4, modifier: 0 } }, criteria: {}, checks: [] };
    rows = {
      [CAUSES]: {
        [NOOR]: {
          is_draft: false,
          returned_at: '2026-11-10T19:00:00+00:00',
          updated_at: '2026-11-10T19:00:00+00:00',
          previous_copy: was,
        },
      },
    };
    await quiet();
    expect(getGradeReturn(CID, NOOR, CAUSES)).toMatchObject({
      is_draft: false,
      updated_at: '2026-11-10T19:00:00+00:00',
      previous_copy: { tags: { [SIGNIFICANCE]: { value: 4, modifier: 0, comment: null } } },
    });
  });

  describe('a DIBELS benchmark has no Draft and no Returned', () => {
    const BENCH = id(306); // the class's seventh piece, scored as a benchmark here
    const asBenchmark = () =>
      fake.on('get_class_bundle', p => {
        if (p.p_if_version === version) return { data: { not_modified: true, version }, error: null };
        const bundle = serverClass();
        bundle.gradebook.assessments[6].score_mode = 'dibels';
        return { data: bundle, error: null };
      });

    it('a comment saved on one makes no row, nothing is returned for it, and no return is sent', async () => {
      asBenchmark();
      await openClass();
      expect(isDibelsScored(getAssessments(CID).find(a => a.id === BENCH))).toBe(true);
      rows = null;
      fake.calls.length = 0;
      Grader.setOverallComment(CID, NOOR, BENCH, 'Read with expression.');
      expect(state(NOOR, BENCH)).toBe(null);
      expect(getGradeReturn(CID, NOOR, BENCH)).toBe(null);
      expect(GradeState.draftsWaiting(CID)).toBe(0);
      expect(Grader.returnGrades(CID, BENCH, [NOOR]).returned).toBe(0);
      await quiet();
      expect(callsTo('return_grades')).toEqual([]);
    });

    it('a row the server no longer lists for one is dropped here with the next read', async () => {
      asBenchmark();
      // A row kept from before the piece was a benchmark.
      localStorage.setItem('gb-grade-returns-' + CID, JSON.stringify({ [BENCH]: { [NOOR]: { is_draft: true } } }));
      rows = {};
      await openClass();
      expect(getGradeReturn(CID, NOOR, BENCH)).toBe(null);
      expect(state(NOOR, BENCH)).toBe(null);
    });

    it('its scoring changed back to levels: the server makes its grades drafts, and the rows are read once the change lands', async () => {
      asBenchmark();
      await openClass();
      rows = {};
      fake.calls.length = 0;
      _REFRESH_QUIET_MS = 30;
      // The teacher changes the piece's scoring; on the server every graded cell of it becomes a draft.
      fake.on('update_assessment', () => {
        rows = { [BENCH]: { [NOOR]: { is_draft: true }, [MATEO]: { is_draft: true } } };
        return { data: null, error: null };
      });
      saveAssessments(
        CID,
        getAssessments(CID).map(a => (a.id === BENCH ? Object.assign({}, a, { scoreMode: 'proficiency' }) : a)),
      );
      await quiet();
      expect(callsTo('update_assessment').length).toBe(1);
      expect(callsTo('list_course_grade_returns').length).toBe(1);
      expect(state(NOOR, BENCH)).toBe('draft');
      expect(state(MATEO, BENCH)).toBe('draft');
    });
  });

  it('a change to a piece of work in a class whose student page is off reads nothing', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    fake.calls.length = 0;
    saveAssessments(
      CID,
      getAssessments(CID).map(a => (a.id === CAUSES ? Object.assign({}, a, { title: 'Causes' }) : a)),
    );
    await quiet();
    expect(names().filter(n => NEW_RPCS.test(n))).toEqual([]);
  });
});

describe('the page is redrawn only when the server’s rows would look different', () => {
  let redraws;
  let realRedraw;
  beforeEach(() => {
    redraws = 0;
    realRedraw = globalThis._invalidateAndRerender;
    globalThis._invalidateAndRerender = () => redraws++;
    fake.on('return_grades', p => ({
      data: { returned: 1, enrollment_ids: p.p_enrollment_ids, returned_at: new Date().toISOString() },
      error: null,
    }));
  });
  afterEach(() => {
    globalThis._invalidateAndRerender = realRedraw;
  });

  it('the same rows with the server’s own time on a Return, in another order: no redraw', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    level(PRIYA, WEEK1, CHANGE, 4);
    await quiet();
    Grader.returnGrades(CID, CAUSES, [NOOR]);
    const mine = getGradeReturns(CID);
    // The server's copy: its own clock a moment later, the work listed the other way round.
    const later = new Date(Date.parse(mine[CAUSES][NOOR].returned_at) + 900).toISOString();
    rows = {
      [WEEK1]: structuredClone(mine[WEEK1]),
      [CAUSES]: { [NOOR]: { ...structuredClone(mine[CAUSES][NOOR]), returned_at: later } },
    };
    redraws = 0;
    await quiet();
    expect(callsTo('return_grades').length).toBe(1);
    expect(getGradeReturn(CID, NOOR, CAUSES).returned_at).toBe(later);
    expect(redraws).toBe(0);
  });

  it('a row the server holds differently: one redraw', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    redraws = 0;
    // Another writer returned it (the grade-scans skill's class setting, say).
    rows = { [CAUSES]: { [NOOR]: { is_draft: false, returned_at: '2026-11-10T19:00:00+00:00' } } };
    await _refreshGradeReturnsSoon(CID);
    expect(state(NOOR, CAUSES)).toBe('returned');
    expect(redraws).toBe(1);
  });

  it('_gradeRowsLook ignores order, the time of day and when a student opened a piece; it sees a state or a copy change', () => {
    const copy = {
      v: 1,
      value: null,
      modifier: 0,
      comment: null,
      tags: { t: { value: 3, modifier: 0, comment: null } },
      criteria: {},
      checks: [],
    };
    const a = {
      a1: {
        s1: { is_draft: true, returned_at: '2026-11-03T17:00:00.000Z', returned_copy: copy },
        s2: { is_draft: false },
      },
      a2: { s1: { is_draft: false, returned_at: '2026-11-03T17:00:00.000Z' } },
    };
    const b = {
      a2: { s1: { returned_at: '2026-11-03T17:00:09.500Z', is_draft: false, seen_at: '2026-11-04T17:00:00.000Z' } },
      a1: {
        s2: { is_draft: false },
        s1: {
          returned_copy: { ...copy, tags: { t: { modifier: 0, value: 3 } } },
          is_draft: true,
          returned_at: '2026-11-03T17:00:01.000Z',
        },
      },
    };
    expect(_gradeRowsLook(b)).toBe(_gradeRowsLook(a));
    const draft = structuredClone(a);
    draft.a2.s1.is_draft = true;
    expect(_gradeRowsLook(draft)).not.toBe(_gradeRowsLook(a));
    const changed = structuredClone(a);
    changed.a1.s1.returned_copy.tags.t.value = 4;
    expect(_gradeRowsLook(changed)).not.toBe(_gradeRowsLook(a));
    const nextDay = structuredClone(a);
    nextDay.a2.s1.returned_at = '2026-11-05T17:00:00.000Z';
    expect(_gradeRowsLook(nextDay)).not.toBe(_gradeRowsLook(a));
    expect(_gradeRowsLook(null)).toBe(_gradeRowsLook({}));
  });
});

describe('what the client names', () => {
  const src = [
    'shared/data.js',
    'shared/data-student-work.js',
    'shared/data-feedback-live.js',
    'shared/data-markup.js',
    'shared/data-reflect.js',
    'shared/data-revisions.js',
  ]
    .map(f => readFileSync(resolve(root, f), 'utf-8'))
    .join('\n');

  it('the server’s return and its list of rows, each at one call site the drift check can read', () => {
    expect(src.match(/_writeRpc\('return_grades'/g).length).toBe(1);
    expect(src.match(/_callRpcWithAuthGuard\(\s*'list_course_grade_returns'/g).length).toBe(1);
    // The count asked for before a class stops holding grades.
    expect(src.match(/'course_draft_count'/g).length).toBe(1);
  });

  it('Return is one of the writes this page knows as its own echo, so it does not reload the class', () => {
    expect(_ECHO_SAFE_RPCS.return_grades).toBe(true);
  });
});
