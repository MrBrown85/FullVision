/**
 * An Overall Comment on points or Complete/Incomplete work before any score:
 * the entry that carries it has no score, and no reader turns it into a 0.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'c1111111-1111-4111-8111-111111111111';
const SID = 'c3333333-3333-4333-8333-333333333333';
const TAG = 'c8888888-8888-4888-8888-888888888881';
const PTS = 'c2222222-2222-4222-8222-222222222221';
const CMP = 'c2222222-2222-4222-8222-222222222222';

function entry(aid, score, note) {
  return {
    id: aid + ':' + TAG,
    assessmentId: aid,
    tagId: TAG,
    score: score,
    note: note || '',
    date: '2026-10-03',
    type: 'summative',
  };
}
function fresh() {
  if (typeof clearProfCache === 'function') clearProfCache();
}

describe('a comment-only entry on points work', () => {
  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'students'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    fresh();
    saveStudents(CID, [{ id: SID, firstName: 'Ada', lastName: 'Lovelace' }]);
    saveAssessments(CID, [
      {
        id: PTS,
        title: 'Quiz',
        date: '2026-10-03',
        type: 'summative',
        tagIds: [TAG],
        scoreMode: 'points',
        maxPoints: 10,
      },
      { id: CMP, title: 'Exit Slip', date: '2026-10-04', type: 'summative', tagIds: [TAG], scoreMode: 'complete' },
    ]);
  });

  it('is not a 0 in the competency roll-up; a typed 0 is', () => {
    saveScores(CID, { [SID]: [entry(PTS, null, 'Hello')] });
    fresh();
    expect(getTagScores(CID, SID, TAG)).toEqual([]);
    saveScores(CID, { [SID]: [entry(PTS, 0, 'Hello')] });
    fresh();
    expect(getTagScores(CID, SID, TAG)).toHaveLength(1);
  });

  it('is no points score and no Complete/Incomplete mark', () => {
    saveScores(CID, { [SID]: [entry(PTS, null, 'Hello'), entry(CMP, null, 'Hello')] });
    expect(getPointsScore(CID, SID, PTS)).toBeNull();
    expect(getCompletionMark(CID, SID, CMP)).toBeNull();
    expect(getScoreComment(CID, SID, PTS)).toBe('Hello');
    expect(getScoreComment(CID, SID, CMP)).toBe('Hello');
  });

  it('keeps the comment once a score is typed', () => {
    saveScoreComment(CID, SID, PTS, 'Hello');
    setPointsScore(CID, SID, PTS, 7);
    expect(getPointsScore(CID, SID, PTS)).toBe(7);
    expect(getScoreComment(CID, SID, PTS)).toBe('Hello');
  });
});
