/**
 * Undo on Set Everyone To, row and column fills, Set Unmarked to Complete
 * and Set Unmarked to points (teacher/page-assignments.js) put back a copy
 * of the whole class's scores, so a score typed on any work while the toast
 * was up was undone too. restoreScoreCells (shared/data.js) puts back only
 * the cells the fill changed that still hold what it wrote.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const CID = 'test';

// A proficiency cell's level, or null when unscored (no entry, or 0).
function level(sid, aid, tid) {
  const e = (getScores(CID)[sid] || []).find(x => x.assessmentId === aid && x.tagId === tid);
  return e && e.score ? e.score : null;
}

beforeEach(() => {
  ['assessments', 'scores', 'statuses'].forEach(function (field) {
    if (_cache[field]) _cache[field][CID] = undefined;
  });
  localStorage.clear();
  saveAssessments(CID, [
    { id: 'lab', title: 'Lab', date: '2026-10-31', type: 'summative', tagIds: ['t1', 't2'] },
    { id: 'quiz', title: 'Quiz', date: '2026-10-31', type: 'summative', tagIds: ['t1'] },
    {
      id: 'pts',
      title: 'Test',
      date: '2026-10-31',
      type: 'summative',
      tagIds: ['t1'],
      scoreMode: 'points',
      maxPoints: 20,
    },
    { id: 'hw', title: 'Homework', date: '2026-10-31', type: 'summative', tagIds: ['t1'], scoreMode: 'complete' },
  ]);
  saveScores(CID, {});
  upsertScore(CID, 'a', 'lab', 't1', 2, '2026-10-31', 'summative');
  upsertScore(CID, 'a', 'quiz', 't1', 1, '2026-10-31', 'summative');
});

describe('restoreScoreCells', () => {
  it('undoes the fill and keeps a score typed on other work since', () => {
    const before = structuredClone(getScores(CID));
    ['a', 'b'].forEach(sid => upsertScore(CID, sid, 'lab', 't1', 3, '2026-10-31', 'summative'));
    const filled = structuredClone(getScores(CID));
    // While the Undo toast is up the teacher scores the quiz.
    upsertScore(CID, 'a', 'quiz', 't1', 4, '2026-10-31', 'summative');
    upsertScore(CID, 'b', 'quiz', 't1', 2, '2026-10-31', 'summative');

    restoreScoreCells(CID, before, filled);

    expect(level('a', 'lab', 't1')).toBe(2);
    expect(level('b', 'lab', 't1')).toBe(null);
    expect(level('a', 'quiz', 't1')).toBe(4);
    expect(level('b', 'quiz', 't1')).toBe(2);
  });

  it('keeps a filled cell the teacher changed again since, and cells the fill left alone', () => {
    upsertScore(CID, 'a', 'lab', 't2', 1, '2026-10-31', 'summative');
    const before = structuredClone(getScores(CID));
    ['a', 'b', 'c'].forEach(sid => upsertScore(CID, sid, 'lab', 't1', 3, '2026-10-31', 'summative'));
    const filled = structuredClone(getScores(CID));
    upsertScore(CID, 'b', 'lab', 't1', 1, '2026-10-31', 'summative');

    restoreScoreCells(CID, before, filled);

    expect(level('a', 'lab', 't1')).toBe(2);
    expect(level('b', 'lab', 't1')).toBe(1);
    expect(level('c', 'lab', 't1')).toBe(null);
    expect(level('a', 'lab', 't2')).toBe(1);
  });

  it('undoes the fill after a refresh from the server rebuilt its entries', () => {
    const before = structuredClone(getScores(CID));
    ['a', 'b'].forEach(sid => upsertScore(CID, sid, 'lab', 't1', 3, '2026-10-31', 'summative'));
    const filled = structuredClone(getScores(CID));
    // A realtime refresh a few seconds later: the same scores, in the
    // server's shape (its id and dates, not the ones made on this device).
    const refreshed = structuredClone(getScores(CID));
    Object.values(refreshed).forEach(list =>
      list.forEach(e => {
        e.id = e.assessmentId + ':' + e.tagId;
        e.created = '2026-10-31';
      }),
    );
    _cache.scores[CID] = refreshed;

    restoreScoreCells(CID, before, filled);

    expect(level('a', 'lab', 't1')).toBe(2);
    expect(level('b', 'lab', 't1')).toBe(null);
    expect(level('a', 'quiz', 't1')).toBe(1);
  });

  it("undoes a fill that made most of the class's scores", () => {
    const sids = ['b', 'c', 'd', 'e', 'f', 'g'];
    const before = structuredClone(getScores(CID));
    sids.forEach(sid => ['t1', 't2'].forEach(t => upsertScore(CID, sid, 'lab', t, 3, '2026-10-31', 'summative')));
    const filled = structuredClone(getScores(CID));

    restoreScoreCells(CID, before, filled);

    sids.forEach(sid => {
      expect(level(sid, 'lab', 't1')).toBe(null);
      expect(level(sid, 'lab', 't2')).toBe(null);
    });
    expect(level('a', 'lab', 't1')).toBe(2);
  });

  it('undoes a row Clear after a refresh dropped its 0 entries', () => {
    upsertScore(CID, 'a', 'lab', 't2', 3, '2026-10-31', 'summative');
    const before = structuredClone(getScores(CID));
    // Clear on the row writes 0 to each competency.
    ['t1', 't2'].forEach(t => upsertScore(CID, 'a', 'lab', t, 0, '2026-10-31', 'summative'));
    const filled = structuredClone(getScores(CID));
    // The server deletes a proficiency 0, so the refresh has no entry.
    const refreshed = structuredClone(getScores(CID));
    refreshed.a = refreshed.a.filter(e => e.score !== 0);
    _cache.scores[CID] = refreshed;

    restoreScoreCells(CID, before, filled);

    expect(level('a', 'lab', 't1')).toBe(2);
    expect(level('a', 'lab', 't2')).toBe(3);
  });

  it("undoes Set Unmarked to Complete and points that made most of the class's scores", () => {
    const sids = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
    let before = structuredClone(getScores(CID));
    sids.forEach(sid => setCompletionMark(CID, sid, 'hw', 'complete'));
    let filled = structuredClone(getScores(CID));
    restoreScoreCells(CID, before, filled);
    sids.forEach(sid => expect(getCompletionMark(CID, sid, 'hw')).toBe(null));

    before = structuredClone(getScores(CID));
    sids.forEach(sid => setPointsScore(CID, sid, 'pts', 20));
    filled = structuredClone(getScores(CID));
    restoreScoreCells(CID, before, filled);
    sids.forEach(sid => expect(getPointsScore(CID, sid, 'pts')).toBe(null));
    expect(level('a', 'lab', 't1')).toBe(2);
  });

  it('still refuses a save that loses scores the fill did not add', () => {
    const sids = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
    sids.forEach(sid => setPointsScore(CID, sid, 'pts', 12));
    const scores = structuredClone(getScores(CID));
    sids.forEach(sid => (scores[sid] = []));
    // One entry may go as the fill's own; the other nine may not.
    const toast = globalThis.showSyncToast;
    globalThis.showSyncToast = () => {};
    try {
      expect(saveScores(CID, scores, 1)).toBe(false);
    } finally {
      globalThis.showSyncToast = toast;
    }
    expect(getPointsScore(CID, 'b', 'pts')).toBe(12);
  });

  it('undoes Set Unmarked to points and keeps a points score typed since', () => {
    setPointsScore(CID, 'a', 'pts', 12);
    const before = structuredClone(getScores(CID));
    ['b', 'c'].forEach(sid => setPointsScore(CID, sid, 'pts', 20));
    const filled = structuredClone(getScores(CID));
    setPointsScore(CID, 'a', 'pts', 15);

    restoreScoreCells(CID, before, filled);

    expect(getPointsScore(CID, 'a', 'pts')).toBe(15);
    expect(getPointsScore(CID, 'b', 'pts')).toBe(null);
    expect(getPointsScore(CID, 'c', 'pts')).toBe(null);
  });
});

describe('the fills undo through restoreScoreCells', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf-8');

  // Through Grader.undo since S1-T3; tests/grader.test.js holds that undo
  // calls restoreScoreCells with the same arguments.
  it('no Undo puts back a whole copy of the class', () => {
    expect(src).not.toContain('saveScores(cid, prevScores)');
    expect(src.split('Grader.undo(cid, prevScores, filled)').length - 1).toBe(4);
  });
});
