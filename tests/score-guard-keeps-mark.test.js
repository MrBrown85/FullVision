/**
 * The data-loss guard in saveScores (S19-B3). It blocks a save that would
 * drop most of a class's marks against the browser's saved copy. Before
 * this fix a block also dropped the mark that set off the save, in two
 * rare cases where the saved copy and memory disagree:
 *
 * (a) Delete Assessment's rewrite of the saved copy failed (storage full),
 *     so the saved copy still held the deleted work's marks. Every later
 *     points mark was blocked and lost on reload.
 * (b) A second tab, not yet reloaded, entered one mark after the first tab
 *     filled a column. The guard rightly refused to overwrite the fill, but
 *     the new mark was lost too.
 *
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

// Delete Assessment with the saved copy's rewrite failing once.
function deleteOldLabWithStorageFull() {
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
    saveAssessments(CID, [work[PTS]]);
  } finally {
    localStorage.setItem = realSet;
  }
  expect(failed).toBe(1);
  // Memory lost Old Lab's marks; the saved copy still has all 40.
  expect(count(getScores(CID))).toBe(0);
  expect(count(saved())).toBe(40);
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
});

// Quiz scored for six students: 6 marks. The other tab's fill: Lab on three
// tags for all ten students, 30 marks.
function quizScores() {
  var scores = {};
  SIDS.slice(0, 6).forEach(sid => (scores[sid] = [entry(sid, QUIZ, T[0], 2)]));
  return scores;
}
function otherTabFills(base) {
  var next = structuredClone(base);
  SIDS.forEach(sid => {
    next[sid] = (next[sid] || []).concat(T.slice(0, 3).map(tid => entry(sid, FILL, tid, 4)));
  });
  localStorage.setItem(KEY, JSON.stringify(next));
}

describe('(b) a tab not yet reloaded after another tab’s fill', () => {
  it('keeps the other tab’s 30 marks and this tab’s one, and sends only the one', async () => {
    signIn();
    loadClass([work[QUIZ], work[PTS], work[FILL]], quizScores());
    otherTabFills(quizScores());
    expect(count(saved())).toBe(36);
    expect(count(getScores(CID))).toBe(6);

    setPointsScore(CID, SIDS[7], PTS, 9);
    await settle();

    expect(guardLogs).toEqual([]);
    expect(toasts.filter(t => /blocked/i.test(t))).toEqual([]);
    [saved(), getScores(CID)].forEach(blob => {
      expect(count(blob)).toBe(37);
      SIDS.forEach(sid => T.slice(0, 3).forEach(tid => expect(has(blob, sid, FILL, tid, 4)).toBe(true)));
      SIDS.slice(0, 6).forEach(sid => expect(has(blob, sid, QUIZ, T[0], 2)).toBe(true));
      expect(has(blob, SIDS[7], PTS, null, 9)).toBe(true);
    });
    expect(
      scoreCalls(fake).map(c => [c.name, c.params.p_enrollment_id, c.params.p_assessment_id, c.params.p_value]),
    ).toEqual([['upsert_score', SIDS[7], PTS, 9]]);
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
