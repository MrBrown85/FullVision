/**
 * A tab that is behind catches up before it saves (docs/plans/stale-tab-plan.md).
 *
 * Two or three tabs share one browser storage, one outbox and one server.
 * Each tab has its own memory: the harness below swaps every tab's memory
 * (cache, server baselines, settings read) in and out of the data layer's
 * globals, keeping each object's identity, so a tab "loads" the class from
 * the saved copy exactly as the app does and then works from its own copy.
 *
 * Before this change a tab that had not reloaded saved from its old copy:
 * its mark was blocked (F1), its old work list took another tab's new work
 * and marks out of the saved copy (F2), and any list it saved overwrote the
 * other tab's newer one (F3).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '22222222-2222-4222-8222-222222222222';
const id = (p, i) => p + '0000000-0000-4000-8000-' + String(i).padStart(12, '0');
const SIDS = Array.from({ length: 10 }, (_, i) => id('e', i + 1));
const T = [id('7', 1), id('7', 2), id('7', 3)];
const QUIZ = id('a', 1); // proficiency, one tag
const PTS = id('a', 2); // points, out of 10
const FILL = id('a', 3); // proficiency, three tags
const PAIR = id('a', 4); // points, pair work S0 + S1
const NEWW = id('a', 9); // work tab A adds

const work = {
  [QUIZ]: { id: QUIZ, title: 'Quiz', date: '2026-11-01', type: 'summative', tagIds: [T[0]] },
  [PTS]: {
    id: PTS,
    title: 'Test',
    date: '2026-11-01',
    type: 'summative',
    tagIds: [T[0]],
    scoreMode: 'points',
    maxPoints: 10,
  },
  [FILL]: { id: FILL, title: 'Lab', date: '2026-11-01', type: 'summative', tagIds: T },
  [PAIR]: {
    id: PAIR,
    title: 'Pair Task',
    date: '2026-11-01',
    type: 'summative',
    tagIds: [T[0]],
    scoreMode: 'points',
    maxPoints: 10,
    collaboration: 'pair',
    pairs: [[SIDS[0], SIDS[1]]],
  },
  [NEWW]: { id: NEWW, title: 'New Lab', date: '2026-11-02', type: 'summative', tagIds: T },
};

const key = field => 'gb-' + _DATA_KEYS[field] + '-' + CID;
const savedOf = field => JSON.parse(localStorage.getItem(key(field)) || 'null');
const saved = () => savedOf('scores') || {};
const count = blob => Object.values(blob || {}).reduce((n, l) => n + (l || []).length, 0);
const marksOn = (blob, aid) =>
  Object.values(blob || {})
    .flat()
    .filter(e => e && e.assessmentId === aid);
const has = (blob, sid, aid, score) =>
  (blob[sid] || []).some(e => e.assessmentId === aid && (score === undefined || e.score === score));
function entry(sid, aid, tid, score) {
  return {
    id: sid + ':' + aid + ':' + tid,
    assessmentId: aid,
    tagId: tid,
    score,
    date: '2026-11-01',
    type: 'summative',
    note: '',
  };
}
function student(sid, i) {
  return { id: sid, personId: id('f', i + 1), firstName: 'S' + i, lastName: 'L' + i, designations: [] };
}
// Every score write sent: [rpc, student, work, value].
function scoreWrites() {
  return fake.calls
    .filter(c => /score/.test(c.name))
    .map(c => [
      c.name,
      c.params.p_enrollment_id,
      c.params.p_assessment_id,
      'p_value' in c.params ? c.params.p_value : c.params.p_score,
    ]);
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

const TAB_FIELDS = () => Object.keys(_cache).filter(f => f !== 'courses' && f !== 'config');
let current = null;
function stash() {
  if (!current) return;
  TAB_FIELDS().forEach(f => (current.cache[f] = _cache[f][CID]));
  Object.keys(_serverState).forEach(f => (current.server[f] = _serverState[f] && _serverState[f][CID]));
  current.settingsRead = _settingsRead[CID];
}
function use(tab) {
  stash();
  TAB_FIELDS().forEach(f => {
    if (tab.cache[f] === undefined) delete _cache[f][CID];
    else _cache[f][CID] = tab.cache[f];
  });
  Object.keys(_serverState).forEach(f => delete _serverState[f][CID]);
  Object.keys(tab.server).forEach(f => {
    if (tab.server[f] === undefined) return;
    if (!_serverState[f]) _serverState[f] = {};
    _serverState[f][CID] = tab.server[f];
  });
  if (tab.settingsRead) _settingsRead[CID] = tab.settingsRead;
  else delete _settingsRead[CID];
  current = tab;
  return tab;
}
// A tab opens the class: memory from the saved copy and, signed in, the
// server baselines from it too (the server has what was saved).
function openTab() {
  var tab = use({ cache: {}, server: {}, settingsRead: undefined });
  TAB_FIELDS().forEach(f => delete _cache[f][CID]);
  _loadCourseFromLS(CID);
  if (_writesEnabled())
    Object.keys(_SERVER_STATE_FIELDS).forEach(f => {
      if (_cache[f][CID] !== undefined) _rememberServerState(f, CID, _cache[f][CID]);
    });
  return tab;
}

function seedClass(assessments, scores, extra) {
  localStorage.setItem(key('students'), JSON.stringify(SIDS.map(student)));
  localStorage.setItem(key('assessments'), JSON.stringify(assessments));
  localStorage.setItem(key('scores'), JSON.stringify(scores || {}));
  Object.keys(extra || {}).forEach(f => localStorage.setItem(key(f), JSON.stringify(extra[f])));
}
function quizScores() {
  var s = {};
  SIDS.forEach(sid => (s[sid] = [entry(sid, QUIZ, T[0], 2)]));
  return s;
}
// Set Everyone To on Lab, three keys, one cell at a time: 30 marks.
function fillLab(level) {
  SIDS.forEach(sid => T.forEach(tid => upsertScore(CID, sid, FILL, tid, level, '2026-11-01', 'summative', '')));
}

var fake, toasts, guardLogs, saved0;
var originalGetSupabase, originalUseSupabase, originalToast, originalError;

function signIn() {
  fake = makeFakeSupabase();
  globalThis.getSupabase = () => fake;
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-uuid';
  localStorage.removeItem('gb-demo-mode');
}
function demoMode() {
  fake = makeFakeSupabase();
  globalThis.getSupabase = () => fake;
  _useSupabase = false;
  _supabaseDegraded = false;
  localStorage.setItem('gb-demo-mode', '1');
}
const MODES = { 'signed in': signIn, 'Demo Mode': demoMode };
function expectNoBlock() {
  expect(guardLogs).toEqual([]);
  expect(toasts.filter(t => /blocked/i.test(t))).toEqual([]);
}
function setOnline(on) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

beforeEach(() => {
  localStorage.clear();
  Object.keys(_cache).forEach(function (field) {
    if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
      _cache[field] = {};
    }
  });
  _serverState = {};
  _idRekeys = {};
  current = null;
  originalGetSupabase = globalThis.getSupabase;
  originalUseSupabase = _useSupabase;
  originalToast = globalThis.showSyncToast;
  originalError = console.error;
  toasts = [];
  guardLogs = [];
  globalThis.showSyncToast = (message, kind) => toasts.push(message + ' ' + kind);
  console.error = function () {
    var text = Array.prototype.join.call(arguments, ' ');
    if (text.indexOf('[GUARD]') >= 0) guardLogs.push(text.slice(0, 120));
    else originalError.apply(console, arguments);
  };
  setOnline(true);
  window.v2Queue.clear();
});

afterEach(() => {
  globalThis.getSupabase = originalGetSupabase;
  _useSupabase = originalUseSupabase;
  globalThis.showSyncToast = originalToast;
  console.error = originalError;
  localStorage.removeItem('gb-demo-mode');
  window.v2Queue.clear();
  current = null;
});

/* ── F1 ───────────────────────────────────────────────────────────────── */

describe('F1: a mark typed in a tab behind another tab’s fill', () => {
  for (const mode of Object.keys(MODES))
    it(mode + ': both the fill and the mark are kept, and the stale tab sends only its mark', async () => {
      MODES[mode]();
      seedClass([work[QUIZ], work[PTS], work[FILL]], {});
      var a = openTab();
      var b = openTab();
      setPointsScore(CID, SIDS[0], PTS, 5); // B saved a moment ago
      use(a);
      fillLab(3);
      await settle();
      expect(marksOn(saved(), FILL)).toHaveLength(30);
      fake.calls.length = 0;

      use(b);
      expect(marksOn(getScores(CID), FILL)).toHaveLength(0); // B has not reloaded
      expect(setPointsScore(CID, SIDS[7], PTS, 9)).not.toBe(false);
      await settle();

      expectNoBlock();
      expect(marksOn(saved(), FILL)).toHaveLength(30);
      expect(has(saved(), SIDS[7], PTS, 9)).toBe(true);
      expect(has(saved(), SIDS[0], PTS, 5)).toBe(true);
      expect(count(saved())).toBe(30 + 2);
      expect(marksOn(getScores(CID), FILL)).toHaveLength(30); // B's memory caught up
      if (mode === 'signed in') expect(scoreWrites()).toEqual([['upsert_score', SIDS[7], PTS, 9]]);
      else expect(fake.calls).toEqual([]);
    });

  it('signed in: a level typed in the stale tab (no guard on levels) keeps the fill too', async () => {
    signIn();
    seedClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    var a = openTab();
    var b = openTab();
    use(a);
    fillLab(3);
    await settle();
    fake.calls.length = 0;
    use(b);
    upsertScore(CID, SIDS[4], QUIZ, T[0], 4, '2026-11-01', 'summative', '');
    await settle();
    expect(marksOn(saved(), FILL)).toHaveLength(30);
    expect(has(saved(), SIDS[4], QUIZ, 4)).toBe(true);
    expect(scoreWrites()).toHaveLength(1);
  });
});

/* ── F2 ───────────────────────────────────────────────────────────────── */

describe('F2: a stale tab’s work list and mark after another tab added work', () => {
  for (const mode of Object.keys(MODES))
    it(mode + ': the new work and its 30 marks survive a title edit and a mark', async () => {
      MODES[mode]();
      seedClass([work[QUIZ], work[PTS]], quizScores());
      var a = openTab();
      var b = openTab();
      use(a);
      saveAssessments(CID, getAssessments(CID).concat([structuredClone(work[NEWW])]));
      SIDS.forEach(sid => T.forEach(tid => upsertScore(CID, sid, NEWW, tid, 3, '2026-11-02', 'summative', '')));
      await settle();
      expect(marksOn(saved(), NEWW)).toHaveLength(30);
      fake.calls.length = 0;

      use(b);
      var list = getAssessments(CID);
      expect(list.map(x => x.id)).toEqual([QUIZ, PTS]); // B has not reloaded
      list.find(x => x.id === QUIZ).title = 'Quiz One';
      saveAssessments(CID, list);
      setPointsScore(CID, SIDS[7], PTS, 9);
      await settle();

      expectNoBlock();
      var listNow = savedOf('assessments');
      expect(listNow.map(x => x.id).sort()).toEqual([QUIZ, PTS, NEWW].sort());
      expect(listNow.find(x => x.id === QUIZ).title).toBe('Quiz One');
      expect(marksOn(saved(), NEWW)).toHaveLength(30);
      expect(has(saved(), SIDS[7], PTS, 9)).toBe(true);
      expect(getAssessments(CID).map(x => x.id)).toContain(NEWW);
      if (mode === 'signed in') {
        var names = fake.calls.map(c => c.name);
        expect(names.filter(n => /delete|clear/.test(n))).toEqual([]);
        expect(names.filter(n => n === 'create_assessment')).toEqual([]);
        expect(scoreWrites()).toEqual([['upsert_score', SIDS[7], PTS, 9]]);
        var upd = fake.calls.filter(c => c.name === 'update_assessment');
        expect(upd).toHaveLength(1);
        expect(JSON.stringify(upd[0].params)).toContain('Quiz One');
      } else expect(fake.calls).toEqual([]);
    });
});

/* ── Undo in a stale tab ──────────────────────────────────────────────── */

describe('Undo of a fill in a stale tab after the other tab retyped cells', () => {
  for (const mode of Object.keys(MODES))
    it(mode + ': the other tab’s values stay; Undo takes back only cells still holding the fill', async () => {
      MODES[mode]();
      seedClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
      var b = openTab();
      var beforeFill = structuredClone(getScores(CID));
      SIDS.forEach(sid => setPointsScore(CID, sid, PTS, 8));
      var filled = structuredClone(getScores(CID));
      await settle();
      var a = openTab(); // A opens after B's fill
      SIDS.slice(0, 5).forEach(sid => setPointsScore(CID, sid, PTS, 10));
      fillLab(4);
      await settle();
      fake.calls.length = 0;

      use(b);
      restoreScoreCells(CID, beforeFill, filled);
      await settle();

      expectNoBlock();
      SIDS.slice(0, 5).forEach(sid => expect(has(saved(), sid, PTS, 10)).toBe(true));
      SIDS.slice(5).forEach(sid => expect(has(saved(), sid, PTS)).toBe(false));
      expect(marksOn(saved(), FILL)).toHaveLength(30);
      expect(count(saved())).toBe(10 + 5 + 30);
      if (mode === 'signed in') {
        var writes = scoreWrites();
        expect(writes.every(w => w[2] === PTS && SIDS.slice(5).includes(w[1]))).toBe(true);
        expect(new Set(writes.map(w => w[1])).size).toBe(5);
        expect(writes.every(w => w[3] === null)).toBe(true); // a cleared points cell
      }
      void a;
    });
});

/* ── Pair and group work ──────────────────────────────────────────────── */

describe('pair work in a stale tab', () => {
  it('signed in: a mark the other tab cleared is not copied to the partner or sent', async () => {
    signIn();
    var start = quizScores();
    start[SIDS[0]].push(entry(SIDS[0], PAIR, T[0], 9)); // pair set up after S0 was marked
    seedClass([work[QUIZ], work[PTS], work[PAIR], work[FILL]], start);
    var a = openTab();
    var b = openTab();
    use(a);
    var mine = getScores(CID);
    mine[SIDS[0]] = mine[SIDS[0]].filter(e => e.assessmentId !== PAIR);
    saveScores(CID, mine); // Clear Score on S0
    fillLab(3);
    await settle();
    fake.calls.length = 0;

    use(b);
    setPointsScore(CID, SIDS[5], PTS, 6);
    await settle();

    expectNoBlock();
    expect(marksOn(saved(), PAIR)).toEqual([]);
    expect(marksOn(getScores(CID), PAIR)).toEqual([]);
    expect(marksOn(saved(), FILL)).toHaveLength(30);
    expect(scoreWrites()).toEqual([['upsert_score', SIDS[5], PTS, 6]]);
  });

  it('Demo Mode: a pair mark typed in the stale tab reaches the partner, and the other tab’s fill stays', async () => {
    demoMode();
    seedClass([work[QUIZ], work[PTS], work[PAIR], work[FILL]], quizScores());
    var a = openTab();
    var b = openTab();
    use(a);
    fillLab(3);
    use(b);
    setPointsScore(CID, SIDS[0], PAIR, 7);
    await settle();
    expectNoBlock();
    expect(has(saved(), SIDS[0], PAIR, 7)).toBe(true);
    expect(has(saved(), SIDS[1], PAIR, 7)).toBe(true);
    expect(marksOn(saved(), FILL)).toHaveLength(30);
  });
});

/* ── Ten marks changed ────────────────────────────────────────────────── */

describe('ten marks changed in a stale tab', () => {
  it('signed in: the ten changes are kept and sent, the other tab’s fill stays', async () => {
    signIn();
    var start = quizScores();
    SIDS.forEach(sid => start[sid].push(entry(sid, PTS, T[0], 9)));
    seedClass([work[QUIZ], work[PTS], work[FILL]], start);
    var a = openTab();
    var b = openTab();
    use(a);
    fillLab(3);
    await settle();
    fake.calls.length = 0;

    use(b);
    var mem = getScores(CID);
    SIDS.forEach(sid => mem[sid].forEach(e => e.assessmentId === PTS && (e.score = 0)));
    expect(saveScores(CID, mem)).not.toBe(false);
    await settle();

    expectNoBlock();
    SIDS.forEach(sid => expect(has(saved(), sid, PTS, 0)).toBe(true));
    expect(marksOn(saved(), FILL)).toHaveLength(30);
    var writes = scoreWrites();
    expect(writes).toHaveLength(10);
    expect(writes.every(w => w[2] === PTS && w[3] === 0)).toBe(true);
  });
});

/* ── Roster ───────────────────────────────────────────────────────────── */

describe('a stale tab behind a roster change', () => {
  for (const mode of Object.keys(MODES))
    it(mode + ': a student withdrawn in the other tab stays withdrawn, with their marks put aside', async () => {
      MODES[mode]();
      seedClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
      var a = openTab();
      var b = openTab();
      use(a);
      withdrawStudent(CID, SIDS[3]);
      await settle();
      expect(savedOf('students').map(s => s.id)).not.toContain(SIDS[3]);
      fake.calls.length = 0;

      use(b);
      expect(getStudents(CID).map(s => s.id)).toContain(SIDS[3]); // B has not reloaded
      setPointsScore(CID, SIDS[5], PTS, 6);
      withdrawStudent(CID, SIDS[4]);
      await settle();

      expectNoBlock();
      var roster = savedOf('students').map(s => s.id);
      expect(roster).not.toContain(SIDS[3]);
      expect(roster).not.toContain(SIDS[4]);
      expect(roster).toHaveLength(8);
      expect(saved()[SIDS[3]]).toBeUndefined();
      expect(has(saved(), SIDS[5], PTS, 6)).toBe(true);
      var gone = savedOf('withdrawn').map(w => w.student.id);
      expect(gone.sort()).toEqual([SIDS[3], SIDS[4]].sort());
      var s3 = savedOf('withdrawn').find(w => w.student.id === SIDS[3]);
      expect(s3.records.scores).toHaveLength(1); // still there to re-enrol
      if (mode === 'signed in') {
        expect(fake.calls.filter(c => c.name === 'withdraw_student')).toHaveLength(1);
        expect(fake.calls.filter(c => /enrol/.test(c.name) && c.name !== 'withdraw_student')).toEqual([]);
        expect(scoreWrites()).toEqual([['upsert_score', SIDS[5], PTS, 6]]);
      }
    });
});

/* ── Delete Assessment ────────────────────────────────────────────────── */

describe('a stale tab behind a Delete Assessment', () => {
  for (const mode of Object.keys(MODES))
    it(mode + ': the deleted work and its marks do not come back', async () => {
      MODES[mode]();
      var start = quizScores();
      SIDS.forEach(sid => start[sid].push(...T.map(tid => entry(sid, FILL, tid, 3))));
      seedClass([work[QUIZ], work[PTS], work[FILL]], start);
      var a = openTab();
      var b = openTab();
      use(a);
      saveAssessments(
        CID,
        getAssessments(CID).filter(x => x.id !== FILL),
      );
      var mine = getScores(CID);
      Object.keys(mine).forEach(sid => (mine[sid] = mine[sid].filter(e => e.assessmentId !== FILL)));
      saveScores(CID, mine);
      await settle();
      expect(marksOn(saved(), FILL)).toEqual([]);
      fake.calls.length = 0;

      use(b);
      // B's screen still shows the work: a level typed onto it is not kept,
      // since the work is gone, and does not bring its marks back.
      upsertScore(CID, SIDS[2], FILL, T[0], 2, '2026-11-01', 'summative', '');
      setPointsScore(CID, SIDS[2], PTS, 4);
      var list = getAssessments(CID);
      list.find(x => x.id === QUIZ).title = 'Quiz Two';
      saveAssessments(CID, list);
      await settle();

      expectNoBlock();
      expect(savedOf('assessments').map(x => x.id)).not.toContain(FILL);
      expect(savedOf('assessments').find(x => x.id === QUIZ).title).toBe('Quiz Two');
      expect(marksOn(saved(), FILL)).toEqual([]);
      expect(has(saved(), SIDS[2], PTS, 4)).toBe(true);
      expect(count(saved())).toBe(10 + 1);
      if (mode === 'signed in') {
        expect(fake.calls.filter(c => c.name === 'create_assessment')).toEqual([]);
        expect(scoreWrites().filter(w => w[2] === FILL)).toEqual([]);
      }
    });
});

/* ── Offline, then online ─────────────────────────────────────────────── */

describe('both tabs offline, then online', () => {
  it('signed in: each tab’s writes go once, and the saved copy has both', async () => {
    signIn();
    seedClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    var a = openTab();
    var b = openTab();
    setOnline(false);
    use(a);
    fillLab(3);
    use(b);
    setPointsScore(CID, SIDS[7], PTS, 9);
    setPointsScore(CID, SIDS[8], PTS, 8);
    await settle();
    expect(fake.calls).toEqual([]);
    expect(marksOn(saved(), FILL)).toHaveLength(30);
    expect(marksOn(saved(), PTS)).toHaveLength(2);

    setOnline(true);
    await window.v2Queue.flush();
    await settle();
    expectNoBlock();
    var writes = scoreWrites();
    expect(writes.filter(w => w[2] === FILL)).toHaveLength(30);
    expect(writes.filter(w => w[2] === PTS)).toEqual([
      ['upsert_score', SIDS[7], PTS, 9],
      ['upsert_score', SIDS[8], PTS, 8],
    ]);
    expect(writes).toHaveLength(32);
  });
});

/* ── Three tabs ───────────────────────────────────────────────────────── */

describe('three tabs', () => {
  for (const mode of Object.keys(MODES))
    it(mode + ': a tab behind two others keeps both of their changes and its own', async () => {
      MODES[mode]();
      seedClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
      var a = openTab();
      var b = openTab();
      var c = openTab();
      use(a);
      fillLab(3);
      use(c);
      saveAssessments(CID, getAssessments(CID).concat([structuredClone(work[NEWW])]));
      upsertScore(CID, SIDS[0], NEWW, T[0], 4, '2026-11-02', 'summative', '');
      use(b);
      setPointsScore(CID, SIDS[9], PTS, 7);
      var list = getAssessments(CID);
      list.find(x => x.id === PTS).title = 'Unit Test';
      saveAssessments(CID, list);
      use(a);
      setPointsScore(CID, SIDS[1], PTS, 3);
      await settle();

      expectNoBlock();
      expect(marksOn(saved(), FILL)).toHaveLength(30);
      expect(has(saved(), SIDS[0], NEWW, 4)).toBe(true);
      expect(has(saved(), SIDS[9], PTS, 7)).toBe(true);
      expect(has(saved(), SIDS[1], PTS, 3)).toBe(true);
      var listNow = savedOf('assessments');
      expect(listNow.map(x => x.id)).toContain(NEWW);
      expect(listNow.find(x => x.id === PTS).title).toBe('Unit Test');
    });
});

/* ── Other lists (F3) ─────────────────────────────────────────────────── */

describe('F3: other lists a stale tab saves', () => {
  for (const mode of Object.keys(MODES))
    it(mode + ': statuses, settings and categories keep the other tab’s change', async () => {
      MODES[mode]();
      seedClass([work[QUIZ], work[PTS]], quizScores(), {
        categories: [{ id: id('c', 1), name: 'Tests', weight: 50 }],
        courseConfigs: { calcMethod: 'mostRecent', decayWeight: 0.65 },
      });
      var a = openTab();
      var b = openTab();
      use(a);
      setAssignmentStatus(CID, SIDS[1], PTS, 'NS');
      saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { decayWeight: 0.8 }));
      saveCategories(CID, getCategories(CID).concat([{ id: id('c', 2), name: 'Labs', weight: 50 }]));
      await settle();
      fake.calls.length = 0;

      use(b);
      setAssignmentStatus(CID, SIDS[2], PTS, 'EXC');
      saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { calcMethod: 'average' }));
      var cats = getCategories(CID).map(x => Object.assign({}, x));
      cats[0].name = 'Unit Tests';
      saveCategories(CID, cats);
      await settle();

      var st = savedOf('statuses');
      expect(st[SIDS[1] + ':' + PTS]).toBe('NS');
      expect(st[SIDS[2] + ':' + PTS]).toBe('EXC');
      var cfg = savedOf('courseConfigs');
      expect(cfg.decayWeight).toBe(0.8);
      expect(cfg.calcMethod).toBe('average');
      var catsNow = savedOf('categories');
      expect(catsNow.map(x => x.name).sort()).toEqual(['Labs', 'Unit Tests']);
      if (mode === 'signed in') {
        var upd = fake.calls.filter(c => c.name === 'update_course');
        expect(upd).toHaveLength(1);
        expect(Object.keys(upd[0].params.p_patch).filter(k => k[0] !== '_' && !/^fv/i.test(k))).toEqual([
          'calc_method',
        ]);
        var statusWrites = fake.calls.filter(c => /status/.test(c.name));
        expect(statusWrites).toHaveLength(1);
        expect(statusWrites[0].params.p_enrollment_id).toBe(SIDS[2]);
      }
    });
});

/* ── What must not change ─────────────────────────────────────────────── */

describe('the guard still blocks a stale tab’s mass loss', () => {
  async function staleAfterFill() {
    signIn();
    var start = quizScores();
    SIDS.forEach(sid => start[sid].push(entry(sid, PTS, T[0], 9)));
    seedClass([work[QUIZ], work[PTS], work[FILL]], start);
    var a = openTab();
    var b = openTab();
    use(a);
    fillLab(3);
    await settle();
    fake.calls.length = 0;
    use(b);
    saved0 = saved();
  }
  function expectBlocked() {
    expect(guardLogs.length).toBeGreaterThan(0);
    expect(saved()).toEqual(saved0);
    expect(scoreWrites()).toEqual([]);
  }

  it('an empty marks object', async () => {
    await staleAfterFill();
    expect(saveScores(CID, {})).toBe(false);
    await settle();
    expectBlocked();
  });

  it('only one student’s marks passed in', async () => {
    await staleAfterFill();
    expect(saveScores(CID, { [SIDS[0]]: structuredClone(getScores(CID)[SIDS[0]]) })).toBe(false);
    await settle();
    expectBlocked();
  });

  it('memory emptied in place, then one points mark', async () => {
    await staleAfterFill();
    var mem = getScores(CID);
    Object.keys(mem).forEach(sid => delete mem[sid]);
    setPointsScore(CID, SIDS[0], PTS, 7);
    await settle();
    expectBlocked();
  });

  it('memory replaced by an empty object, then one points mark', async () => {
    await staleAfterFill();
    _cache.scores[CID] = {};
    setPointsScore(CID, SIDS[0], PTS, 7);
    await settle();
    expectBlocked();
  });
});

describe('storage full in the stale tab', () => {
  it('a field whose last write failed here is not caught up, so the mark that failed is not dropped', async () => {
    demoMode();
    seedClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    var a = openTab();
    var b = openTab();
    var realSet = localStorage.setItem;
    localStorage.setItem = function (k, v) {
      if (k === key('scores')) {
        var e = new Error('The quota has been exceeded.');
        e.name = 'QuotaExceededError';
        throw e;
      }
      return realSet.call(this, k, v);
    };
    try {
      setPointsScore(CID, SIDS[0], PTS, 5); // kept in B's memory only
    } finally {
      localStorage.setItem = realSet;
    }
    expect(_storageFullKeys.has(key('scores'))).toBe(true);
    var full = new Set(_storageFullKeys);
    use(a);
    _storageFullKeys.clear();
    setPointsScore(CID, SIDS[1], PTS, 6);
    use(b);
    full.forEach(k => _storageFullKeys.add(k));
    setPointsScore(CID, SIDS[7], PTS, 9);
    await settle();
    expect(has(getScores(CID), SIDS[0], PTS, 5)).toBe(true);
    expect(has(saved(), SIDS[0], PTS, 5)).toBe(true);
    expect(has(saved(), SIDS[7], PTS, 9)).toBe(true);
    _storageFullKeys.clear();
  });
});

describe('a tab that is not behind saves as before', () => {
  it('signed in: one mark is saved and sent once, nothing else is read back', async () => {
    signIn();
    seedClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    openTab();
    var mem = getScores(CID);
    setPointsScore(CID, SIDS[3], PTS, 6);
    await settle();
    expectNoBlock();
    expect(getScores(CID)).toBe(mem);
    expect(scoreWrites()).toEqual([['upsert_score', SIDS[3], PTS, 6]]);
  });
});
