/**
 * Missing and Excused never go on work with a score or feedback — shared/data.js
 * (hasScoreOrFeedback, canSetAssignmentStatus). Late always can, and a status
 * already on a cell can always be taken off.
 */

const CID = 'test';
const SID = 's1';

function entry(aid, tagId, score, extra) {
  return Object.assign(
    { assessmentId: aid, tagId: tagId, score: score, type: 'summative', date: '2026-03-20' },
    extra || {},
  );
}

beforeEach(() => {
  ['assessments', 'scores', 'statuses', 'observations', 'dibels'].forEach(function (field) {
    _cache[field][CID] = undefined;
  });
  localStorage.clear();
  saveAssessments(CID, [
    { id: 'prof', title: 'Lab', date: '2026-03-20', type: 'summative', tagIds: ['t1', 't2'] },
    { id: 'pts', title: 'Quiz', date: '2026-03-20', type: 'summative', tagIds: [], scoreMode: 'points', maxPoints: 10 },
    { id: 'dib', title: 'DIBELS', date: '2026-03-20', type: 'summative', tagIds: [], scoreMode: 'dibels' },
  ]);
  saveScores(CID, {});
});

describe('canSetAssignmentStatus', () => {
  it('allows every status on work with nothing on it', () => {
    ['NS', 'EXC', 'LATE'].forEach(function (status) {
      expect(canSetAssignmentStatus(CID, SID, 'prof', status)).toBe(true);
    });
    setAssignmentStatus(CID, SID, 'prof', 'NS');
    expect(getAssignmentStatus(CID, SID, 'prof')).toBe('NS');
  });

  it('refuses Missing and Excused on a level, but allows Late', () => {
    saveScores(CID, { [SID]: [entry('prof', 't1', 3)] });
    expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(false);
    expect(canSetAssignmentStatus(CID, SID, 'prof', 'EXC')).toBe(false);
    expect(canSetAssignmentStatus(CID, SID, 'prof', 'LATE')).toBe(true);
    setAssignmentStatus(CID, SID, 'prof', 'EXC');
    expect(getAssignmentStatus(CID, SID, 'prof')).toBe(null);
  });

  it('treats a 0 level as no score, but a 0 in points as a score', () => {
    saveScores(CID, { [SID]: [entry('prof', 't1', 0), entry('pts', 'pts', 0)] });
    expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(true);
    expect(canSetAssignmentStatus(CID, SID, 'pts', 'NS')).toBe(false);
  });

  it('counts a criterion note with no level as feedback', () => {
    saveScores(CID, { [SID]: [entry('prof', 't1', null, { critNote: 'Check your units.' })] });
    expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(false);
  });

  it('counts a comment on the assignment as feedback', () => {
    addQuickOb(CID, SID, 'Good start.', [], 'neutral', null, { assessmentId: 'prof' });
    expect(canSetAssignmentStatus(CID, SID, 'prof', 'EXC')).toBe(false);
  });

  it('counts DIBELS numbers as a score', () => {
    saveDibelsScore(CID, SID, 'dib', 'boy', { orfWrc: 120 });
    expect(canSetAssignmentStatus(CID, SID, 'dib', 'NS')).toBe(false);
  });

  it('always lets a status already on the cell come off', () => {
    setAssignmentStatus(CID, SID, 'prof', 'NS');
    addQuickOb(CID, SID, 'Please hand this in.', [], 'neutral', null, { assessmentId: 'prof' });
    expect(canSetAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(true);
    expect(canSetAssignmentStatus(CID, SID, 'prof', null)).toBe(true);
    setAssignmentStatus(CID, SID, 'prof', null);
    expect(getAssignmentStatus(CID, SID, 'prof')).toBe(null);
  });
});

describe('applyAssignmentStatus', () => {
  it('leaves a scored student as they were when Missing is refused', () => {
    saveScores(CID, { [SID]: [entry('prof', 't1', 3), entry('prof', 't2', 2)] });
    expect(applyAssignmentStatus(CID, SID, 'prof', 'NS')).toBe(false);
    expect(getAssignmentStatus(CID, SID, 'prof')).toBe(null);
    expect(getScores(CID)[SID].map(e => e.score)).toEqual([3, 2]);
  });
});

/* The other half: Missing or Excused work takes no score, whichever view or
   key writes it (Nov 3 bug sweep). The lock is in the shared score writers. */
describe('score writers on Missing and Excused work', () => {
  it('refuse a level on Missing work, so the competency grade has no hidden score', () => {
    setAssignmentStatus(CID, SID, 'prof', 'NS');
    expect(upsertScore(CID, SID, 'prof', 't1', 3, '2026-03-20', 'summative', '')).toBe(false);
    expect((getScores(CID)[SID] || []).filter(e => e.score > 0)).toEqual([]);
    clearProfCache();
    expect(getTagScores(CID, SID, 't1')).toEqual([]);
    expect(hasScoreOrFeedback(CID, SID, 'prof')).toBe(false);
  });

  it('refuse points and Complete/Incomplete marks on Missing or Excused work', () => {
    saveAssessments(CID, [
      {
        id: 'pts',
        title: 'Quiz',
        date: '2026-03-20',
        type: 'summative',
        tagIds: [],
        scoreMode: 'points',
        maxPoints: 10,
      },
      { id: 'cmp', title: 'Check', date: '2026-03-20', type: 'summative', tagIds: [], scoreMode: 'complete' },
    ]);
    setAssignmentStatus(CID, SID, 'pts', 'NS');
    setAssignmentStatus(CID, SID, 'cmp', 'EXC');
    expect(setPointsScore(CID, SID, 'pts', 8)).toBe(false);
    expect(setPointsScore(CID, SID, 'pts', 0)).toBe(false);
    expect(setCompletionMark(CID, SID, 'cmp', 'complete')).toBe(false);
    expect(setCompletionMark(CID, SID, 'cmp', 'incomplete')).toBe(false);
    expect(getPointsScore(CID, SID, 'pts')).toBe(null);
    expect(getCompletionMark(CID, SID, 'cmp')).toBe(null);
  });

  it('still clear a score, and score Late work', () => {
    setAssignmentStatus(CID, SID, 'prof', 'LATE');
    upsertScore(CID, SID, 'prof', 't1', 3, '2026-03-20', 'summative', '');
    expect(getScores(CID)[SID].find(e => e.tagId === 't1').score).toBe(3);
    saveAssignmentStatuses(CID, { [SID + ':prof']: 'NS' });
    upsertScore(CID, SID, 'prof', 't1', 0, '2026-03-20', 'summative', '');
    expect(getScores(CID)[SID].find(e => e.tagId === 't1').score).toBe(0);
  });

  it('score the work again once Missing comes off', () => {
    setAssignmentStatus(CID, SID, 'prof', 'NS');
    setAssignmentStatus(CID, SID, 'prof', null);
    upsertScore(CID, SID, 'prof', 't1', 2, '2026-03-20', 'summative', '');
    expect(getScores(CID)[SID].find(e => e.tagId === 't1').score).toBe(2);
  });
});
