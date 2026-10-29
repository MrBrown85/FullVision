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
