/**
 * The data-loss guard in saveScores (S19-B3). It blocks a save that would
 * drop most of a class's marks against the browser's saved copy.
 *
 * (a) Fixed: Delete Assessment's rewrite of the saved copy failed (storage
 *     full), so the saved copy still held the deleted work's marks, and
 *     every later points or Complete mark was blocked and lost on reload.
 *     Marks of work and students that are gone no longer count.
 * (b) Unchanged from main: a tab behind the saved copy (another tab saved
 *     a fill) is blocked, and nothing is saved or sent.
 * (c) and (d) pin what must not change: real mass losses are still blocked,
 *     and ordinary saves, fills and Undo behave as before.
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

const CID = '11111111-1111-4111-8111-111111111111';
const id = (p, i) => p + '0000000-0000-4000-8000-' + String(i).padStart(12, '0');
const SIDS = Array.from({ length: 10 }, (_, i) => id('e', i + 1));
const T = [id('7', 1), id('7', 2), id('7', 3), id('7', 4)];
const OLD = id('a', 1); // proficiency work, four tags
const PTS = id('a', 2); // points work
const FILL = id('a', 3); // proficiency work, three tags
const QUIZ = id('a', 4); // proficiency work, one tag
const HW = id('a', 5); // Complete/Incomplete work

const KEY = 'gb-scores-' + CID;
const work = {
  [OLD]: { id: OLD, title: 'Old Lab', date: '2026-11-01', type: 'summative', tagIds: T },
  [PTS]: {
    id: PTS,
    title: 'Test',
    date: '2026-11-01',
    type: 'summative',
    tagIds: [T[0]],
    scoreMode: 'points',
    maxPoints: 10,
  },
  [FILL]: { id: FILL, title: 'Lab', date: '2026-11-01', type: 'summative', tagIds: T.slice(0, 3) },
  [QUIZ]: { id: QUIZ, title: 'Quiz', date: '2026-11-01', type: 'summative', tagIds: [T[0]] },
  [HW]: { id: HW, title: 'Homework', date: '2026-11-01', type: 'summative', tagIds: [T[0]], scoreMode: 'complete' },
};

function student(sid, i) {
  return { id: sid, personId: id('f', i + 1), firstName: 'S' + i, lastName: 'L' + i, designations: [] };
}
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
function seed(field, value) {
  _cache[field][CID] = structuredClone(value);
  localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + CID, JSON.stringify(value));
}
function saved() {
  return JSON.parse(localStorage.getItem(KEY) || '{}');
}
function count(blob) {
  return Object.values(blob).reduce((n, l) => n + (l || []).length, 0);
}
function has(blob, sid, aid, tid, score) {
  return (blob[sid] || []).some(e => e.assessmentId === aid && (tid == null || e.tagId === tid) && e.score === score);
}
// Every score RPC the page sent.
function scoreCalls(fake) {
  return fake.calls.filter(c => /score/.test(c.name));
}

var fake, toasts, guardLogs, originalGetSupabase, originalUseSupabase, originalToast, originalError;

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
// What the class load leaves: memory, the saved copy and (signed in) the
// server baseline all hold `scores`.
function loadClass(assessments, scores) {
  seed('students', SIDS.map(student));
  seed('assessments', assessments);
  seed('scores', scores);
  if (_writesEnabled()) _rememberServerState('scores', CID, scores);
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
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  window.v2Queue.clear();
});

afterEach(() => {
  globalThis.getSupabase = originalGetSupabase;
  _useSupabase = originalUseSupabase;
  globalThis.showSyncToast = originalToast;
  console.error = originalError;
  localStorage.removeItem('gb-demo-mode');
  window.v2Queue.clear();
});

// Old Lab scored for every student on four tags: 40 marks.
function oldLabScores() {
  var scores = {};
  SIDS.forEach(sid => (scores[sid] = T.map(tid => entry(sid, OLD, tid, 3))));
  return scores;
}

// Delete Assessment with the saved copy's rewrite failing once: the work
// list becomes `left`, and the saved copy keeps all `kept` marks.
function deleteWithStorageFull(left, kept) {
  var realSet = localStorage.setItem;
  var failed = 0;
  localStorage.setItem = function (k, v) {
    if (k === KEY && !failed) {
      failed++;
      var e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    }
    return realSet.call(this, k, v);
  };
  try {
    saveAssessments(CID, left);
  } finally {
    localStorage.setItem = realSet;
  }
  expect(failed).toBe(1);
  expect(count(saved())).toBe(kept);
}
function deleteOldLabWithStorageFull() {
  deleteWithStorageFull([work[PTS]], 40);
  // Memory lost Old Lab's marks; the saved copy still has all 40.
  expect(count(getScores(CID))).toBe(0);
}

describe('(a) the saved copy kept a deleted work’s marks', () => {
  it('signed in: a points mark on other work is kept, saved and sent', async () => {
    signIn();
    loadClass([work[OLD], work[PTS]], oldLabScores());
    deleteOldLabWithStorageFull();
    await settle();
    fake.calls.length = 0;

    setPointsScore(CID, SIDS[0], PTS, 7);
    setPointsScore(CID, SIDS[1], PTS, 4);
    await settle();

    expect(guardLogs).toEqual([]);
    expect(toasts.filter(t => /blocked/i.test(t))).toEqual([]);
    expect(has(getScores(CID), SIDS[0], PTS, null, 7)).toBe(true);
    expect(has(saved(), SIDS[0], PTS, null, 7)).toBe(true);
    expect(has(saved(), SIDS[1], PTS, null, 4)).toBe(true);
    // The saved copy is rewritten without the deleted work's marks.
    expect(count(saved())).toBe(2);
    expect(
      fake.count('upsert_score', p => p.p_enrollment_id === SIDS[0] && p.p_assessment_id === PTS && p.p_value === 7),
    ).toBe(1);
    expect(
      fake.count('upsert_score', p => p.p_enrollment_id === SIDS[1] && p.p_assessment_id === PTS && p.p_value === 4),
    ).toBe(1);
  });

  it('Demo Mode: a points mark on other work is kept and saved, nothing sent', async () => {
    demoMode();
    loadClass([work[OLD], work[PTS]], oldLabScores());
    deleteOldLabWithStorageFull();

    setPointsScore(CID, SIDS[0], PTS, 7);
    await settle();

    expect(guardLogs).toEqual([]);
    expect(toasts.filter(t => /blocked/i.test(t))).toEqual([]);
    expect(has(saved(), SIDS[0], PTS, null, 7)).toBe(true);
    expect(count(saved())).toBe(1);
    expect(fake.calls).toEqual([]);
  });

  it('signed in: a Complete mark on other work is kept, saved and sent once', async () => {
    signIn();
    loadClass([work[OLD], work[HW]], oldLabScores());
    deleteWithStorageFull([work[HW]], 40);
    await settle();
    fake.calls.length = 0;

    setCompletionMark(CID, SIDS[0], HW, 'complete');
    await settle();

    expect(guardLogs).toEqual([]);
    expect(
      Object.values(saved())
        .flat()
        .filter(e => e.assessmentId === HW),
    ).toHaveLength(1);
    expect(count(saved())).toBe(1);
    expect(fake.count('upsert_score', p => p.p_enrollment_id === SIDS[0] && p.p_assessment_id === HW)).toBe(1);
  });

  ['signed in', 'Demo Mode'].forEach(mode => {
    it(mode + ': two failed deletes in a row, then a points mark', async () => {
      if (mode === 'signed in') signIn();
      else demoMode();
      var scores = oldLabScores();
      SIDS.forEach(sid => scores[sid].push(entry(sid, QUIZ, T[0], 2)));
      loadClass([work[OLD], work[QUIZ], work[PTS]], scores);
      deleteWithStorageFull([work[QUIZ], work[PTS]], 50);
      deleteWithStorageFull([work[PTS]], 50);
      await settle();
      fake.calls.length = 0;

      setPointsScore(CID, SIDS[0], PTS, 7);
      await settle();

      expect(guardLogs).toEqual([]);
      expect(has(saved(), SIDS[0], PTS, null, 7)).toBe(true);
      expect(count(saved())).toBe(1);
      expect(scoreCalls(fake).map(c => [c.name, c.params.p_enrollment_id, c.params.p_value])).toEqual(
        mode === 'signed in' ? [['upsert_score', SIDS[0], 7]] : [],
      );
    });
  });

  // No app path leaves gone work's marks in this tab's baseline
  // (_cleanOrphanedScores takes them out of it too), but if one did, the
  // save must not send them as clears.
  it('gone work’s marks still in the baseline are not sent as clears', async () => {
    signIn();
    var scores = oldLabScores();
    SIDS.forEach(sid => scores[sid].push(entry(sid, QUIZ, T[0], 2)));
    loadClass([work[QUIZ], work[PTS]], scores);
    var mem = {};
    SIDS.forEach(sid => (mem[sid] = [entry(sid, QUIZ, T[0], 2)]));
    mem[SIDS[0]].push(entry(SIDS[0], PTS, T[0], 5));
    _cache.scores[CID] = mem;
    saveScores(CID, mem);
    await settle();

    expect(guardLogs).toEqual([]);
    expect(has(saved(), SIDS[0], PTS, null, 5)).toBe(true);
    expect(scoreCalls(fake).map(c => [c.name, c.params.p_enrollment_id, c.params.p_assessment_id])).toEqual([
      ['upsert_score', SIDS[0], PTS],
    ]);
  });
});

// Quiz scored for six students: 6 marks. The other tab's fill: Lab on three
// tags for all ten students, 30 marks.
function quizScores() {
  var scores = {};
  SIDS.slice(0, 6).forEach(sid => (scores[sid] = [entry(sid, QUIZ, T[0], 2)]));
  return scores;
}
function withFill(base, aids) {
  var next = structuredClone(base);
  SIDS.forEach(sid => {
    (aids || [FILL]).forEach(aid => {
      next[sid] = (next[sid] || [])
        .filter(e => e.assessmentId !== aid)
        .concat(work[aid].tagIds.map(tid => entry(sid, aid, tid, 4)));
    });
  });
  return next;
}
function otherTabFills(base) {
  localStorage.setItem(KEY, JSON.stringify(withFill(base)));
}

/* (b) Two tabs: tab B has not reloaded since tab A saved a fill, so the
   saved copy holds marks tab B lacks. This stays exactly as on main: the
   save is blocked with the red message, nothing is saved and nothing is
   sent, so tab A's marks are never overwritten. An earlier version of this
   PR merged the two copies; two reviews each found a way that merge sent
   clears or marks it should not, so it was taken out. These tests pass on
   main too. Here the other tab's saves are written straight into storage,
   so this tab never read their text and saves as on main; where this tab
   wrote the saved copy itself (R1) it now catches up first instead
   (docs/plans/stale-tab-plan.md, tests/stale-tab-catches-up.test.js). */
describe('(b) a tab behind the saved copy is blocked as on main', () => {
  function expectBlocked(before) {
    expect(guardLogs.length).toBeGreaterThan(0);
    expect(toasts.filter(t => /blocked/i.test(t)).length).toBeGreaterThan(0);
    expect(saved()).toEqual(before);
    expect(scoreCalls(fake)).toEqual([]);
  }
  // Tab B loads Old Lab's 40 marks; tab A fills Lab, so the saved copy has 70.
  function staleAfterFill() {
    signIn();
    loadClass([work[OLD], work[PTS], work[FILL]], oldLabScores());
    otherTabFills(oldLabScores());
    expect(count(saved())).toBe(70);
    return saved();
  }

  it('one points mark after the other tab’s fill', async () => {
    signIn();
    loadClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    otherTabFills(quizScores());
    var before = saved();
    setPointsScore(CID, SIDS[7], PTS, 9);
    await settle();
    expectBlocked(before);
  });

  it('an empty marks object', async () => {
    var before = staleAfterFill();
    expect(saveScores(CID, {})).toBe(false);
    await settle();
    expectBlocked(before);
  });

  it('only one student’s marks passed in', async () => {
    var before = staleAfterFill();
    expect(saveScores(CID, { [SIDS[0]]: structuredClone(getScores(CID)[SIDS[0]]) })).toBe(false);
    await settle();
    expectBlocked(before);
  });

  it('memory emptied with the baseline intact, then one points mark', async () => {
    var before = staleAfterFill();
    _cache.scores[CID] = {};
    setPointsScore(CID, SIDS[0], PTS, 7);
    await settle();
    expectBlocked(before);
  });

  it('a save that drops most of this tab’s own marks while adding one', async () => {
    var before = staleAfterFill();
    var next = { [SIDS[0]]: [entry(SIDS[0], PTS, T[0], 5)] };
    SIDS.slice(1, 3).forEach(sid => (next[sid] = structuredClone(getScores(CID)[sid])));
    expect(saveScores(CID, next)).toBe(false);
    await settle();
    expectBlocked(before);
  });

  it('one tab whose baseline holds only 2 of 10 students, then an empty save', async () => {
    signIn();
    loadClass([work[OLD], work[PTS]], oldLabScores());
    var part = {};
    SIDS.slice(0, 2).forEach(sid => (part[sid] = structuredClone(oldLabScores()[sid])));
    _rememberServerState('scores', CID, part);
    var before = saved();
    expect(saveScores(CID, {})).toBe(false);
    await settle();
    expectBlocked(before);
  });

  it('an empty save over an empty baseline', async () => {
    signIn();
    loadClass([work[OLD], work[PTS]], oldLabScores());
    _rememberServerState('scores', CID, {});
    var before = saved();
    expect(saveScores(CID, {})).toBe(false);
    await settle();
    expectBlocked(before);
  });

  it('one mark and two of this tab’s own cells cleared', async () => {
    signIn();
    loadClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    otherTabFills(quizScores());
    var before = saved();
    var scores = getScores(CID);
    scores[SIDS[0]] = [];
    scores[SIDS[1]] = [];
    setPointsScore(CID, SIDS[7], PTS, 9);
    await settle();
    expectBlocked(before);
  });

  it('a cell this tab holds with only a different date leaves the other tab’s newer value', async () => {
    signIn();
    loadClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    var theirs = quizScores();
    theirs[SIDS[0]][0].score = 4;
    otherTabFills(theirs);
    var before = saved();
    getScores(CID)[SIDS[0]][0].date = '2026-11-05';
    setPointsScore(CID, SIDS[7], PTS, 9);
    await settle();
    expectBlocked(before);
    expect(has(saved(), SIDS[0], QUIZ, T[0], 4)).toBe(true);
  });

  it('ten points marks changed to 0', async () => {
    signIn();
    var mine = {};
    SIDS.forEach(sid => (mine[sid] = [entry(sid, QUIZ, T[0], 2), entry(sid, PTS, T[0], 9)]));
    loadClass([work[QUIZ], work[PTS], work[FILL], work[OLD]], mine);
    localStorage.setItem(KEY, JSON.stringify(withFill(mine, [FILL, OLD])));
    var before = saved();
    var mem = getScores(CID);
    SIDS.forEach(sid => mem[sid].forEach(e => e.assessmentId === PTS && (e.score = 0)));
    expect(saveScores(CID, mem)).toBe(false);
    await settle();
    expectBlocked(before);
  });

  // Replaced in the stale-tab PR (docs/plans/stale-tab-plan.md): this tab
  // wrote the fill itself, so it knows the saved copy's text and is no longer
  // stale when it undoes. It catches up first, then puts back only the cells
  // that still hold what its fill wrote. Main blocked the Undo.
  it('Undo of this tab’s fill after the other tab retyped five of its cells (R1): those five stay', async () => {
    signIn();
    var mine = {};
    SIDS.forEach(sid => (mine[sid] = [entry(sid, QUIZ, T[0], 2)]));
    loadClass([work[QUIZ], work[PTS], work[FILL], work[OLD]], mine);
    var beforeFill = structuredClone(getScores(CID));
    SIDS.forEach(sid => setPointsScore(CID, sid, PTS, 8));
    var filled = structuredClone(getScores(CID));
    await settle();
    var theirs = structuredClone(saved());
    SIDS.slice(0, 5).forEach(sid => theirs[sid].forEach(e => e.assessmentId === PTS && (e.score = 10)));
    localStorage.setItem(KEY, JSON.stringify(withFill(theirs, [FILL, OLD])));
    fake.calls.length = 0;
    restoreScoreCells(CID, beforeFill, filled);
    await settle();
    expect(guardLogs).toEqual([]);
    SIDS.slice(0, 5).forEach(sid => expect(has(saved(), sid, PTS, null, 10)).toBe(true));
    SIDS.slice(5).forEach(sid => expect((saved()[sid] || []).some(e => e.assessmentId === PTS)).toBe(false));
    expect(count(saved())).toBe(10 + 5 + 70);
    var sent = scoreCalls(fake);
    expect(sent.length).toBeGreaterThan(0);
    sent.forEach(c => {
      expect(c.params.p_assessment_id).toBe(PTS);
      expect(SIDS.slice(5)).toContain(c.params.p_enrollment_id);
      expect(c.params.p_value).toBe(null);
    });
  });

  it('pair work: a mark the other tab cleared is not copied to the partner (R9)', async () => {
    signIn();
    var pair = Object.assign({}, work[PTS], { collaboration: 'pair', pairs: [[SIDS[0], SIDS[1]]] });
    var mine = {};
    SIDS.forEach(sid => (mine[sid] = [entry(sid, QUIZ, T[0], 2)]));
    mine[SIDS[0]].push(entry(SIDS[0], PTS, T[0], 9));
    loadClass([work[QUIZ], pair, work[FILL], work[OLD]], mine);
    var theirs = structuredClone(mine);
    theirs[SIDS[0]] = theirs[SIDS[0]].filter(e => e.assessmentId !== PTS);
    localStorage.setItem(KEY, JSON.stringify(withFill(theirs, [FILL, OLD])));
    var before = saved();
    var mem = getScores(CID);
    mem[SIDS[5]].push(entry(SIDS[5], PTS, T[0], 6));
    expect(saveScores(CID, mem)).toBe(false);
    await settle();
    expectBlocked(before);
  });
});

describe('(c) the guard still blocks a real mass loss', () => {
  function expectBlocked(before) {
    expect(guardLogs.length).toBeGreaterThan(0);
    expect(toasts.filter(t => /blocked/i.test(t)).length).toBeGreaterThan(0);
    expect(saved()).toEqual(before);
    expect(scoreCalls(fake)).toEqual([]);
  }
  function fullClass() {
    var scores = oldLabScores();
    SIDS.forEach(sid => scores[sid].push(entry(sid, QUIZ, T[0], 2)));
    return scores;
  }

  ['signed in', 'Demo Mode'].forEach(mode => {
    describe(mode, () => {
      beforeEach(() => (mode === 'signed in' ? signIn() : demoMode()));

      it('an empty marks object', async () => {
        loadClass([work[OLD], work[QUIZ]], fullClass());
        var before = saved();
        expect(saveScores(CID, {})).toBe(false);
        await settle();
        expectBlocked(before);
      });

      it('marks missing most students, on work and students that still exist', async () => {
        loadClass([work[OLD], work[QUIZ]], fullClass());
        var before = saved();
        var part = {};
        SIDS.slice(0, 2).forEach(sid => (part[sid] = structuredClone(before[sid])));
        expect(saveScores(CID, part)).toBe(false);
        await settle();
        expectBlocked(before);
      });

      it('a mark entered from an empty memory copy, on work and students that still exist', async () => {
        loadClass([work[OLD], work[QUIZ]], fullClass());
        var before = saved();
        _cache.scores[CID] = {};
        if (mode === 'signed in') _rememberServerState('scores', CID, {});
        var next = { [SIDS[0]]: [entry(SIDS[0], QUIZ, T[0], 4)] };
        saveScores(CID, next);
        await settle();
        // Nothing of the saved copy is lost, whatever happens to the mark.
        Object.keys(before).forEach(sid =>
          before[sid].forEach(e => {
            if (!(sid === SIDS[0] && e.assessmentId === QUIZ))
              expect(has(saved(), sid, e.assessmentId, e.tagId, e.score)).toBe(true);
          }),
        );
        expect(scoreCalls(fake).filter(c => c.params.p_enrollment_id !== SIDS[0])).toEqual([]);
      });

      it('any big drop while the work list is empty', async () => {
        loadClass([], fullClass());
        var before = saved();
        expect(saveScores(CID, { [SIDS[0]]: [entry(SIDS[0], PTS, T[0], 5)] })).toBe(false);
        await settle();
        expectBlocked(before);
      });

      it('any big drop while the work list is missing', async () => {
        loadClass([work[OLD], work[QUIZ]], fullClass());
        delete _cache.assessments[CID];
        localStorage.removeItem('gb-assessments-' + CID);
        var before = saved();
        expect(saveScores(CID, { [SIDS[0]]: [entry(SIDS[0], PTS, T[0], 5)] })).toBe(false);
        await settle();
        expectBlocked(before);
      });

      it('any big drop while the roster is empty', async () => {
        loadClass([work[OLD], work[QUIZ]], fullClass());
        seed('students', []);
        var before = saved();
        expect(saveScores(CID, { [SIDS[0]]: [entry(SIDS[0], QUIZ, T[0], 4)] })).toBe(false);
        await settle();
        expectBlocked(before);
      });

      it('a drop on work this tab’s list lacks but the saved list still has', async () => {
        loadClass([work[OLD], work[QUIZ]], fullClass());
        _cache.assessments[CID] = [work[QUIZ]];
        var before = saved();
        expect(saveScores(CID, { [SIDS[0]]: [entry(SIDS[0], QUIZ, T[0], 4)] })).toBe(false);
        await settle();
        expectBlocked(before);
      });
    });
  });
});

describe('(d) ordinary saves behave as before', () => {
  it('a single points mark is saved and sent once', async () => {
    signIn();
    loadClass([work[QUIZ], work[PTS]], quizScores());
    setPointsScore(CID, SIDS[0], PTS, 6);
    await settle();
    expect(has(saved(), SIDS[0], PTS, null, 6)).toBe(true);
    expect(count(saved())).toBe(7);
    expect(scoreCalls(fake).map(c => [c.name, c.params.p_enrollment_id, c.params.p_value])).toEqual([
      ['upsert_score', SIDS[0], 6],
    ]);
    expect(guardLogs).toEqual([]);
  });

  it('a fill, then Undo of the fill, keeps the marks from before', async () => {
    signIn();
    loadClass([work[QUIZ], work[PTS]], {});
    var before = structuredClone(getScores(CID));
    SIDS.forEach(sid => setPointsScore(CID, sid, PTS, 8));
    var filled = structuredClone(getScores(CID));
    expect(count(saved())).toBe(10);
    await settle();
    expect(fake.count('upsert_score', p => p.p_value === 8)).toBe(10);

    restoreScoreCells(CID, before, filled);
    await settle();
    expect(count(saved())).toBe(0);
    expect(count(getScores(CID))).toBe(0);
    expect(fake.count('upsert_score', p => p.p_value === null)).toBeGreaterThanOrEqual(10);
    expect(guardLogs).toEqual([]);
  });

  it('Demo Mode: a fill of 30 marks and its Undo', async () => {
    demoMode();
    loadClass([work[QUIZ], work[FILL]], quizScores());
    var before = structuredClone(getScores(CID));
    var scores = getScores(CID);
    SIDS.forEach(sid => {
      scores[sid] = (scores[sid] || []).concat(T.slice(0, 3).map(tid => entry(sid, FILL, tid, 4)));
    });
    saveScores(CID, scores);
    var filled = structuredClone(getScores(CID));
    expect(count(saved())).toBe(36);
    restoreScoreCells(CID, before, filled);
    // Proficiency work the fill scored goes back to 0, unscored.
    expect(
      Object.values(saved())
        .flat()
        .filter(e => e.assessmentId === FILL && e.score),
    ).toEqual([]);
    SIDS.slice(0, 6).forEach(sid => expect(has(saved(), sid, QUIZ, T[0], 2)).toBe(true));
    expect(guardLogs).toEqual([]);
  });
});
