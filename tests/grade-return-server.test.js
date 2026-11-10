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
import { readFileSync } from 'fs';
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

describe('saving the two settings', () => {
  it('Return Grades goes up in update_course, with the switch, like any class setting', async () => {
    await openClass();
    fake.calls.length = 0;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { return_grades: 'on_save' }));
    await quiet();
    expect(patches().length).toBe(1);
    expect(patches()[0]).toMatchObject({ student_page_enabled: true, return_grades: 'on_save' });
    // Through the outbox, which has nothing left to send.
    expect(window.v2Queue.stats().queued).toBe(0);
    expect(getSyncDotState().status).toBe('idle');
  });

  it('offline it waits in the outbox and goes when the connection is back', async () => {
    await openClass();
    fake.calls.length = 0;
    setOnline(false);
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { return_grades: 'on_save' }));
    await settle();
    expect(patches()).toEqual([]);
    expect(window.v2Queue.stats().queued).toBe(1);
    // The choice holds on this device meanwhile.
    expect(getReturnSettings(CID).return_grades).toBe('on_save');
    await sendAll();
    expect(patches().length).toBe(1);
    expect(patches()[0]).toMatchObject({ return_grades: 'on_save' });
    await quiet();
  });

  it('a class whose student page is off sends neither, whatever is saved', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    fake.calls.length = 0;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'mostRecent' }));
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { roundPercent: true }));
    await quiet();
    expect(patches().length).toBe(2);
    patches().forEach(p => {
      expect('student_page_enabled' in p).toBe(false);
      expect('return_grades' in p).toBe(false);
    });
    expect(names().filter(n => NEW_RPCS.test(n))).toEqual([]);
  });

  it('the switch turned on: sent once with the choice the class holds, then the class and its rows are read', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    // Rows this device kept from an earlier time the page was on.
    localStorage.setItem('gb-grade-returns-' + CID, JSON.stringify({ [CAUSES]: { [MATEO]: { is_draft: true } } }));
    fake.calls.length = 0;
    rows = { [CAUSES]: { [NOOR]: { is_draft: false, returned_at: '2026-11-01T17:00:00+00:00' } } };
    fake.on('update_course', p => {
      Object.assign(course, p.p_patch);
      version += 1;
      return { data: null, error: null };
    });
    expect(setStudentPageSwitch(CID, true)).toBe(true);
    // At once on this device: on, the old rows gone, the class's rows not loaded.
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(getGradeReturns(CID)).toEqual({});
    expect(localStorage.getItem('gb-grade-returns-' + CID)).toBe(null);
    expect(() => getReturnedScores(CID)).toThrow(/has not loaded/);
    await quiet();
    expect(patches()).toEqual([{ ...patches()[0], student_page_enabled: true, return_grades: 'on_return' }]);
    expect(callsTo('list_course_grade_returns')).toEqual([{ p_course_id: CID }]);
    expect(getGradeReturn(CID, NOOR, CAUSES)).toEqual({ is_draft: false, returned_at: '2026-11-01T17:00:00+00:00' });
    expect(getGradeReturn(CID, MATEO, CAUSES)).toBe(null);
    expect(getReturnedScores(CID)).toBe(getScores(CID));
  });

  it('turned on from a saved copy that never heard of Return Grades: the choice is not sent, and the class is read in full', async () => {
    course = { student_page_enabled: false, return_grades: 'on_return' };
    await openClass();
    // As a copy saved by the code before S0-W1 holds the class: no key.
    const before = Object.assign({}, getCourseConfig(CID));
    delete before.return_grades;
    _cache.courseConfigs[CID] = before;
    localStorage.setItem('gb-courseconfig-' + CID, JSON.stringify(before));
    expect(getReturnSettings(CID).return_grades).toBe(null);
    fake.calls.length = 0;
    fake.on('update_course', p => {
      Object.assign(course, p.p_patch);
      version += 1;
      return { data: null, error: null };
    });
    setStudentPageSwitch(CID, true);
    await quiet();
    expect(patches().length).toBe(1);
    expect(patches()[0].student_page_enabled).toBe(true);
    // Not sent: this device does not know it, and must not overwrite the server's.
    expect('return_grades' in patches()[0]).toBe(false);
    // The class is asked for whole, not "has it changed?", so its choice arrives.
    expect(callsTo('get_class_bundle').map(p => p.p_if_version)).toEqual([null]);
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(callsTo('list_course_grade_returns').length).toBe(1);
  });

  it('the switch turned off: sent once, the waiting drafts returned here, no return sent, and nothing after', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    level(MATEO, CAUSES, SIGNIFICANCE, 4);
    await quiet();
    expect(GradeState.draftsWaiting(CID)).toBe(2);
    fake.calls.length = 0;
    setStudentPageSwitch(CID, false);
    expect(getReturnSettings(CID).student_page).toBe(false);
    expect(getGradeReturn(CID, NOOR, CAUSES).is_draft).toBe(false);
    expect(getGradeReturn(CID, MATEO, CAUSES).is_draft).toBe(false);
    await quiet();
    expect(patches().length).toBe(1);
    expect(patches()[0]).toMatchObject({ student_page_enabled: false });
    // The server returns them itself, in that update_course.
    expect(callsTo('return_grades')).toEqual([]);
    expect(callsTo('list_course_grade_returns')).toEqual([]);
    // From here the class is one with its page off: neither key goes again.
    fake.calls.length = 0;
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'mostRecent' }));
    level(PRIYA, CAUSES, SIGNIFICANCE, 3);
    await quiet();
    expect('student_page_enabled' in patches()[0]).toBe(false);
    expect('return_grades' in patches()[0]).toBe(false);
    expect(names().filter(n => NEW_RPCS.test(n))).toEqual([]);
  });

  it('leaving When I Return Them: the choice goes up, the drafts are returned here, and no return is sent', async () => {
    await openClass();
    rows = null;
    level(NOOR, CAUSES, SIGNIFICANCE, 2);
    await quiet();
    expect(state(NOOR, CAUSES)).toBe('draft');
    fake.calls.length = 0;
    // The server's trigger returns the draft in the same call.
    fake.on('update_course', () => {
      rows = { [CAUSES]: { [NOOR]: { is_draft: false, returned_at: '2026-11-10T19:00:00+00:00' } } };
      return { data: null, error: null };
    });
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { return_grades: 'on_save' }));
    expect(state(NOOR, CAUSES)).toBe('returned');
    await quiet();
    expect(patches().length).toBe(1);
    expect(patches()[0]).toMatchObject({ student_page_enabled: true, return_grades: 'on_save' });
    expect(callsTo('return_grades')).toEqual([]);
    // And the rows are the server's afterwards, with its time.
    expect(getGradeReturn(CID, NOOR, CAUSES)).toEqual({ is_draft: false, returned_at: '2026-11-10T19:00:00+00:00' });
  });

  it('Duplicate Class: the copy’s Return Grades choice goes up once it has its server id, its page off', async () => {
    course = { student_page_enabled: true, return_grades: 'on_save' };
    await openClass();
    const COPY = 'e0000000-0000-4000-8000-000000000009';
    COURSES[COPY] = { id: COPY, name: 'History 12 (Copy)' };
    fake.calls.length = 0;
    // What Duplicate Class saves for the copy: the original's settings, the switch taken out.
    const cc = structuredClone(getCourseConfig(CID));
    delete cc.student_page_enabled;
    delete cc.reportingTerms;
    saveCourseConfig(COPY, cc);
    await settle();
    const sent = callsTo('update_course').filter(p => p.p_course_id === COPY);
    expect(sent.length).toBe(1);
    expect(sent[0].p_patch.return_grades).toBe('on_save');
    expect('student_page_enabled' in sent[0].p_patch).toBe(false);
    delete COURSES[COPY];
    delete _cache.courseConfigs[COPY];
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
  const src = readFileSync(resolve(root, 'shared/data.js'), 'utf-8');

  it('the server’s return and its list of rows, each at one call site the drift check can read', () => {
    expect(src.match(/_writeRpc\('return_grades'/g).length).toBe(1);
    expect(src.match(/_callRpcWithAuthGuard\(\s*'list_course_grade_returns'/g).length).toBe(1);
    // The screens count drafts from the rows the class holds.
    expect(src).not.toMatch(/'course_draft_count'/);
  });

  it('Return is one of the writes this page knows as its own echo, so it does not reload the class', () => {
    expect(_ECHO_SAFE_RPCS.return_grades).toBe(true);
  });
});
