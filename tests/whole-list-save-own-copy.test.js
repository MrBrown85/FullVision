/**
 * A whole-list save compares with this tab's own copy (one-mark-save design,
 * Part A, step 4; faults 4 and 7).
 *
 * Two tabs of one browser share the saved copy (gb-scores-<class>,
 * gb-statuses-<class>). A tab with no baseline (it opened the class from
 * the saved copy while something waited in the outbox, or offline) worked
 * out what it changed by comparing its memory with the saved copy as it is
 * now. Marks the other tab had saved there since looked like marks this tab
 * removed, and a clear went to the server for each.
 *
 * Each tab now keeps the text of its own scores and statuses as it last
 * read or wrote them, and compares with that. The save guard still compares
 * with the saved copy. With nothing kept, the save is main's.
 *
 * The other tab is a direct write of the saved copy, as in
 * tests/score-guard-keeps-mark.test.js. This tab loads the class through
 * _loadCourseFromLS (no baseline) or _persistLoadedField (a server load).
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
const CID2 = '22222222-2222-4222-8222-222222222222';
const id = (p, i) => p + '0000000-0000-4000-8000-' + String(i).padStart(12, '0');
const SIDS = Array.from({ length: 10 }, (_, i) => id('e', i + 1));
const T = [id('7', 1), id('7', 2), id('7', 3), id('7', 4)];
const OLD = id('a', 1); // proficiency work, four tags
const PTS = id('a', 2); // points work
const QUIZ = id('a', 4); // proficiency work, one tag
const HW = id('a', 5); // Complete/Incomplete work
const PAIR = id('a', 6); // pair work, one tag
const LOCAL_TAG = 'tag-local-1';

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
  [QUIZ]: { id: QUIZ, title: 'Quiz', date: '2026-11-01', type: 'summative', tagIds: [T[0]] },
  [HW]: { id: HW, title: 'Homework', date: '2026-11-01', type: 'summative', tagIds: [T[0]], scoreMode: 'complete' },
  [PAIR]: {
    id: PAIR,
    title: 'Pair Lab',
    date: '2026-11-01',
    type: 'summative',
    tagIds: [T[1]],
    collaboration: 'pair',
    pairs: [[SIDS[0], SIDS[1]]],
  },
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
const scoresKey = cid => 'gb-scores-' + cid;
const statusesKey = cid => 'gb-statuses-' + cid;
function saved(cid) {
  return JSON.parse(localStorage.getItem(scoresKey(cid || CID)) || '{}');
}
// Old Lab scored for every student on four tags: 40 marks.
function oldLabScores() {
  var scores = {};
  SIDS.forEach(sid => (scores[sid] = T.map(tid => entry(sid, OLD, tid, 3))));
  return scores;
}
// The other tab's write of the shared saved copy.
function otherTabWrites(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
// The other tab marks the Quiz for every student: 10 marks.
function otherTabMarksQuiz(cid, base) {
  var next = structuredClone(base);
  SIDS.forEach(sid => (next[sid] = (next[sid] || []).concat([entry(sid, QUIZ, T[0], 4)])));
  otherTabWrites(scoresKey(cid || CID), next);
}
function scoreCalls(fake) {
  return fake.calls.filter(c => /score/.test(c.name) && c.name !== 'set_score_status');
}
function statusCalls(fake) {
  return fake.calls.filter(c => c.name === 'set_score_status');
}
const brief = c => [c.name, c.params.p_enrollment_id, c.params.p_assessment_id];

var fake, originalGetSupabase, originalUseSupabase, originalToast;

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
// The saved copy as a tab finds it when it opens the class.
function savedCopy(cid, assessments, scores, statuses) {
  localStorage.setItem('gb-students-' + cid, JSON.stringify(SIDS.map(student)));
  localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
  localStorage.setItem(scoresKey(cid), JSON.stringify(scores));
  if (statuses) localStorage.setItem(statusesKey(cid), JSON.stringify(statuses));
}
// This tab opens the class from the saved copy, with no baseline: the
// class check waits while anything is in the outbox, or there is no
// connection.
function openFromSavedCopy(cid, assessments, scores, statuses) {
  savedCopy(cid, assessments, scores, statuses);
  _loadCourseFromLS(cid);
  expect(_hasServerState('scores', cid)).toBe(false);
}
// This tab loads the class from the server: a baseline, and the saved copy
// rewritten (or found unchanged) by _persistLoadedField.
function loadFromServer(cid, assessments, scores, statuses) {
  savedCopy(cid, assessments, scores, statuses);
  _loadCourseFromLS(cid);
  _persistLoadedField(cid, 'scores', structuredClone(scores));
  _persistLoadedField(cid, 'statuses', structuredClone(statuses || {}));
  expect(_hasServerState('scores', cid)).toBe(true);
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
  // Forget anything a tab kept for these classes in an earlier test.
  _forgetServerState(CID);
  _forgetServerState(CID2);
  originalGetSupabase = globalThis.getSupabase;
  originalUseSupabase = _useSupabase;
  originalToast = globalThis.showSyncToast;
  globalThis.showSyncToast = () => {};
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  window.v2Queue.clear();
});

afterEach(() => {
  globalThis.getSupabase = originalGetSupabase;
  _useSupabase = originalUseSupabase;
  globalThis.showSyncToast = originalToast;
  localStorage.removeItem('gb-demo-mode');
  window.v2Queue.clear();
});

describe('a tab with no baseline sends only its own change', () => {
  it('1. the other tab marks 10 cells; a points mark here sends one call', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[PTS], work[QUIZ]], oldLabScores());
    otherTabMarksQuiz(CID, oldLabScores());

    setPointsScore(CID, SIDS[3], PTS, 7);
    await settle();

    // Main sends a clear for each of the other tab's 10 Quiz marks.
    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[3], PTS]]);
  });

  it('1. the same for a Complete mark', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[HW], work[QUIZ]], oldLabScores());
    otherTabMarksQuiz(CID, oldLabScores());

    setCompletionMark(CID, SIDS[3], HW, 'complete');
    await settle();

    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[3], HW]]);
  });

  it('2. the other tab changes a mark; a points mark elsewhere does not send the old value back', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[PTS]], oldLabScores());
    var theirs = oldLabScores();
    theirs[SIDS[0]][0].score = 4;
    otherTabWrites(scoresKey(CID), theirs);

    setPointsScore(CID, SIDS[5], PTS, 7);
    await settle();

    // Main sends Old Lab's 3 for SIDS[0] again, over the other tab's 4.
    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[5], PTS]]);
  });

  it('3. the other tab sets Missing on three cells; Late here sends one call', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[QUIZ]], oldLabScores(), {});
    otherTabWrites(statusesKey(CID), {
      [SIDS[0] + ':' + QUIZ]: 'NS',
      [SIDS[1] + ':' + QUIZ]: 'NS',
      [SIDS[2] + ':' + QUIZ]: 'NS',
    });

    expect(setAssignmentStatus(CID, SIDS[5], QUIZ, 'LATE')).toBe(true);
    await settle();

    // Main takes the other tab's three Missing off on the server.
    expect(statusCalls(fake).map(c => [c.params.p_enrollment_id, c.params.p_status])).toEqual([[SIDS[5], 'LATE']]);
  });

  it('3. Excused and Late from the other tab are left alone too', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[QUIZ]], oldLabScores(), {});
    otherTabWrites(statusesKey(CID), { [SIDS[0] + ':' + QUIZ]: 'EXC', [SIDS[1] + ':' + QUIZ]: 'LATE' });

    expect(setAssignmentStatus(CID, SIDS[5], QUIZ, 'NS')).toBe(true);
    await settle();

    expect(statusCalls(fake).map(c => [c.params.p_enrollment_id, c.params.p_status])).toEqual([[SIDS[5], 'NS']]);
  });
});

/* Pair work: SIDS[0] and SIDS[1] are linked. In this tab only SIDS[0] holds
   the grade (the partner has none of their own), so a group copy, if one
   ran, would write SIDS[1] and send it. */
function pairScores() {
  var scores = oldLabScores();
  scores[SIDS[0]].push(entry(SIDS[0], PAIR, T[1], 3));
  return scores;
}
function partnerHasCopy(scores) {
  return (scores[SIDS[1]] || []).some(e => e.assessmentId === PAIR);
}

describe('the group check starts from this tab’s own copy', () => {
  it('4. with a baseline: the other tab clears a pair member; a save of another cell copies nothing', async () => {
    signIn();
    loadFromServer(CID, [work[OLD], work[PTS], work[PAIR]], pairScores());
    var theirs = pairScores();
    theirs[SIDS[0]] = theirs[SIDS[0]].filter(e => e.assessmentId !== PAIR);
    otherTabWrites(scoresKey(CID), theirs);

    var mine = getScores(CID);
    mine[SIDS[5]].push(entry(SIDS[5], PTS, T[0], 6));
    saveScores(CID, mine);
    await settle();

    expect(partnerHasCopy(getScores(CID))).toBe(false);
    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[5], PTS]]);
  });

  it('5. a status the other tab changed on a pair member makes no group copy here', async () => {
    signIn();
    loadFromServer(CID, [work[OLD], work[QUIZ], work[PAIR]], pairScores(), {});
    otherTabWrites(statusesKey(CID), { [SIDS[1] + ':' + PAIR]: 'EXC' });

    expect(setAssignmentStatus(CID, SIDS[5], QUIZ, 'LATE')).toBe(true);
    await settle();

    // Main reads Excused as taken off the partner here and copies the
    // group's grade to them.
    expect(partnerHasCopy(getScores(CID))).toBe(false);
    expect(scoreCalls(fake)).toEqual([]);
    expect(statusCalls(fake).map(c => [c.params.p_enrollment_id, c.params.p_status])).toEqual([[SIDS[5], 'LATE']]);
  });

  it('Demo Mode: the other tab clears a pair member; a save of another cell copies nothing', async () => {
    demoMode();
    openFromSavedCopy(CID, [work[OLD], work[PTS], work[PAIR]], pairScores());
    var theirs = pairScores();
    theirs[SIDS[0]] = theirs[SIDS[0]].filter(e => e.assessmentId !== PAIR);
    otherTabWrites(scoresKey(CID), theirs);

    var mine = getScores(CID);
    mine[SIDS[5]].push(entry(SIDS[5], PTS, T[0], 6));
    saveScores(CID, mine);
    await settle();

    expect(partnerHasCopy(getScores(CID))).toBe(false);
    expect(partnerHasCopy(saved())).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe('re-keys, loads and other classes', () => {
  // Quiz's competency still has a local id in this tab's copy.
  function localTagScores() {
    var scores = oldLabScores();
    SIDS.slice(0, 4).forEach(sid => scores[sid].push(entry(sid, QUIZ, LOCAL_TAG, 2)));
    return scores;
  }
  function rekeyed(scores) {
    var next = structuredClone(scores);
    Object.keys(next).forEach(sid =>
      next[sid].forEach(e => {
        if (e.tagId === LOCAL_TAG) e.tagId = T[0];
      }),
    );
    return next;
  }

  it('6. a re-key from another tab, then a points mark: nothing for the re-keyed rows or the other tab’s marks', async () => {
    signIn();
    var quiz = Object.assign({}, work[QUIZ], { tagIds: [LOCAL_TAG] });
    openFromSavedCopy(CID, [work[OLD], work[PTS], quiz], localTagScores());
    // The other tab gets the competency's server id: it rewrites the saved
    // copy and tells this tab, which changes only its memory.
    var theirs = rekeyed(localTagScores());
    theirs[SIDS[6]].push(entry(SIDS[6], QUIZ, T[0], 4));
    otherTabWrites(scoresKey(CID), theirs);
    _applyRemoteRekey({ cid: CID, kind: 'tag', localId: LOCAL_TAG, serverId: T[0] });
    expect(getScores(CID)[SIDS[0]].some(e => e.tagId === T[0] && e.assessmentId === QUIZ)).toBe(true);

    setPointsScore(CID, SIDS[3], PTS, 7);
    await settle();

    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[3], PTS]]);
  });

  it('a class load from the server replaces memory: the next save compares with what it loaded', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[PTS], work[QUIZ]], oldLabScores());
    // The server's copy, with a Quiz mark another device made.
    var server = oldLabScores();
    server[SIDS[2]].push(entry(SIDS[2], QUIZ, T[0], 4));
    _persistLoadedField(CID, 'scores', structuredClone(server));
    otherTabMarksQuiz(CID, server);

    setPointsScore(CID, SIDS[3], PTS, 7);
    await settle();

    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[3], PTS]]);
    expect(saved()[SIDS[2]].some(e => e.assessmentId === QUIZ)).toBe(true);
  });

  it('a second class in the same tab keeps its own copy', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[PTS], work[QUIZ]], oldLabScores());
    openFromSavedCopy(CID2, [work[OLD], work[PTS], work[QUIZ]], oldLabScores());
    otherTabMarksQuiz(CID, oldLabScores());

    setPointsScore(CID2, SIDS[4], PTS, 8);
    setPointsScore(CID, SIDS[3], PTS, 7);
    await settle();

    expect(scoreCalls(fake).map(brief)).toEqual([
      ['upsert_score', SIDS[4], PTS],
      ['upsert_score', SIDS[3], PTS],
    ]);
  });

  it('nothing kept (the class was never read through the load): the save is main’s', async () => {
    signIn();
    // Memory and the saved copy seeded directly, as older tests do.
    savedCopy(CID, [work[OLD], work[PTS], work[QUIZ]], oldLabScores());
    _cache.students[CID] = SIDS.map(student);
    _cache.assessments[CID] = [work[OLD], work[PTS], work[QUIZ]];
    _cache.scores[CID] = oldLabScores();
    otherTabMarksQuiz(CID, oldLabScores());

    setPointsScore(CID, SIDS[3], PTS, 7);
    await settle();

    // Main's fallback: the saved copy, so a clear for each Quiz mark.
    var calls = scoreCalls(fake);
    expect(calls.filter(c => c.params.p_assessment_id === PTS)).toHaveLength(1);
    expect(calls.filter(c => c.params.p_assessment_id === QUIZ)).toHaveLength(10);
  });
});

/* Lines the review's mutation check found unpinned. Each passes on main as
   well; each fails with its one line of the change taken out. */
describe('the kept copy is read in the same key space as the save', () => {
  const LOCAL = 'local-quiz-1';
  const SERVER = id('a', 7);
  // Quiz under its local id, scored for three students.
  function localQuiz() {
    return Object.assign({}, work[QUIZ], { id: LOCAL });
  }
  function localQuizScores() {
    var scores = oldLabScores();
    SIDS.slice(0, 3).forEach(sid => scores[sid].push(entry(sid, LOCAL, T[0], 2)));
    return scores;
  }
  // This tab's own save re-keyed the Quiz; then an older copy (another
  // tab's, written before it heard) went back into storage, and this tab
  // read the class again from it. Its kept text holds the local id again.
  function rekeyedHereThenReadBack(statuses) {
    openFromSavedCopy(CID, [work[OLD], work[PTS], localQuiz()], localQuizScores(), statuses);
    _rekey(CID, 'assessment', LOCAL, SERVER);
    expect(_idRekeys[CID][LOCAL]).toBe(SERVER);
    otherTabWrites(scoresKey(CID), localQuizScores());
    if (statuses) otherTabWrites(statusesKey(CID), statuses);
    _loadCourseFromLS(CID);
  }

  it('scores: a local id this tab re-keyed is read as the server id in the kept copy', async () => {
    signIn();
    rekeyedHereThenReadBack();
    setPointsScore(CID, SIDS[5], PTS, 7);
    await settle();
    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[5], PTS]]);
  });

  it('statuses: a local id this tab re-keyed is read as the server id in the kept copy', async () => {
    signIn();
    rekeyedHereThenReadBack({ [SIDS[0] + ':' + LOCAL]: 'LATE', [SIDS[1] + ':' + LOCAL]: 'NS' });
    expect(setAssignmentStatus(CID, SIDS[5], OLD, 'LATE')).toBe(true);
    await settle();
    expect(statusCalls(fake).map(c => [c.params.p_enrollment_id, c.params.p_assessment_id, c.params.p_status])).toEqual(
      [[SIDS[5], OLD, 'LATE']],
    );
  });

  // The fallback reads the kept copy under criteria in any case; the group
  // check needs it read so too, or the pair member looks changed.
  it('rubric pair work: a kept copy with marks under competencies is read under criteria', async () => {
    signIn();
    const RUB = id('b', 1);
    const CRIT = [id('c', 1), id('c', 2)];
    const rubricWork = {
      id: id('a', 8),
      title: 'Rubric Lab',
      date: '2026-11-01',
      type: 'summative',
      tagIds: [T[0], T[1]],
      rubricId: RUB,
      collaboration: 'pair',
      pairs: [[SIDS[0], SIDS[1]]],
    };
    localStorage.setItem(
      'gb-rubrics-' + CID,
      JSON.stringify([
        {
          id: RUB,
          name: 'Lab Rubric',
          criteria: [
            { id: CRIT[0], name: 'Plan', tagIds: [T[0]], levels: {} },
            { id: CRIT[1], name: 'Write', tagIds: [T[1]], levels: {} },
          ],
        },
      ]),
    );
    // Marked before the work had a rubric: under its competencies, and only
    // SIDS[0] holds the pair's grade.
    var scores = oldLabScores();
    scores[SIDS[0]].push(entry(SIDS[0], rubricWork.id, T[0], 3), entry(SIDS[0], rubricWork.id, T[1], 2));
    openFromSavedCopy(CID, [work[OLD], work[PTS], rubricWork], scores);
    expect(_keptText[scoresKey(CID)]).toContain('"tagId":"' + T[0] + '"');

    var mine = getScores(CID);
    mine[SIDS[5]].push(entry(SIDS[5], PTS, T[0], 6));
    saveScores(CID, mine);
    await settle();
    expect((getScores(CID)[SIDS[1]] || []).some(e => e.assessmentId === rubricWork.id)).toBe(false);
    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[5], PTS]]);
  });

  it('a class whose baseline is forgotten forgets its kept copy too', async () => {
    signIn();
    openFromSavedCopy(CID, [work[OLD], work[PTS], work[QUIZ]], oldLabScores());
    otherTabMarksQuiz(CID, oldLabScores());
    _forgetServerState(CID);

    setPointsScore(CID, SIDS[3], PTS, 7);
    await settle();

    // Nothing kept: main's fallback, a clear for each Quiz mark.
    expect(scoreCalls(fake).filter(c => c.params.p_assessment_id === QUIZ)).toHaveLength(10);
  });

  it('a server load that finds the saved copy unchanged keeps its text', async () => {
    signIn();
    // Memory and the saved copy seeded directly: nothing kept yet.
    savedCopy(CID, [work[OLD], work[PTS], work[PAIR]], pairScores());
    _cache.students[CID] = SIDS.map(student);
    _cache.assessments[CID] = [work[OLD], work[PTS], work[PAIR]];
    expect(_keptText[scoresKey(CID)]).toBeUndefined();
    _persistLoadedField(CID, 'scores', pairScores());
    expect(_keptText[scoresKey(CID)]).toBe(localStorage.getItem(scoresKey(CID)));
    var theirs = pairScores();
    theirs[SIDS[0]] = theirs[SIDS[0]].filter(e => e.assessmentId !== PAIR);
    otherTabWrites(scoresKey(CID), theirs);

    var mine = getScores(CID);
    mine[SIDS[5]].push(entry(SIDS[5], PTS, T[0], 6));
    saveScores(CID, mine);
    await settle();

    expect(partnerHasCopy(getScores(CID))).toBe(false);
    expect(scoreCalls(fake).map(brief)).toEqual([['upsert_score', SIDS[5], PTS]]);
  });
});
