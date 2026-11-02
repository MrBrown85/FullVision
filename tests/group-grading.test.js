/**
 * Group grading — shared/data.js (Group grading section). A grade saved for
 * one member of a pair or group is copied to every member still graded with
 * it; Grade Separately takes a member out; Missing and Excused stay per
 * student and keep the group grade off that member.
 */

const CID = 'test';

function levels(sid, aid) {
  return (getScores(CID)[sid] || [])
    .filter(e => e.assessmentId === aid)
    .map(e => [e.tagId, e.score, e.mod || 0])
    .sort();
}

beforeEach(() => {
  ['assessments', 'scores', 'statuses', 'observations', 'rubricChecks'].forEach(function (field) {
    if (_cache[field]) _cache[field][CID] = undefined;
  });
  localStorage.clear();
  saveAssessments(CID, [
    {
      id: 'grp',
      title: 'Group Lab',
      date: '2026-10-31',
      type: 'summative',
      tagIds: ['t1', 't2'],
      collaboration: 'group',
      groups: [
        ['a', 'b', 'c'],
        ['d', 'e'],
      ],
    },
    {
      id: 'pr',
      title: 'Pair Quiz',
      date: '2026-10-31',
      type: 'summative',
      tagIds: [],
      scoreMode: 'points',
      maxPoints: 10,
      collaboration: 'pair',
      pairs: [['a', 'b']],
    },
    { id: 'solo', title: 'Essay', date: '2026-10-31', type: 'summative', tagIds: ['t1'] },
  ]);
  saveScores(CID, {});
});

describe('graded together', () => {
  it('copies a level and its + / − to the rest of the group only', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '2026-10-31', 'summative', '', 1);
    expect(levels('b', 'grp')).toEqual([['t1', 3, 1]]);
    expect(levels('c', 'grp')).toEqual([['t1', 3, 1]]);
    expect(levels('d', 'grp')).toEqual([]);
  });

  it('copies from whichever member was graded last', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    upsertScore(CID, 'c', 'grp', 't1', 2, '', 'summative', '');
    expect(levels('a', 'grp')).toEqual([['t1', 2, 0]]);
    expect(levels('b', 'grp')).toEqual([['t1', 2, 0]]);
  });

  it('copies the Overall Comment, and clearing it clears it for everyone', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    saveScoreComment(CID, 'b', 'grp', 'Clear procedure.');
    expect(getScoreComment(CID, 'a', 'grp')).toBe('Clear procedure.');
    expect(getScoreComment(CID, 'c', 'grp')).toBe('Clear procedure.');
    saveScoreComment(CID, 'a', 'grp', '');
    expect(getScoreComment(CID, 'b', 'grp')).toBe('');
    expect(getScoreComment(CID, 'c', 'grp')).toBe('');
  });

  it('keeps each member their own Note for the Report', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    saveScoreReportNote(CID, 'b', 'grp', 'Away for two classes.');
    upsertScore(CID, 'a', 'grp', 't2', 4, '', 'summative', '');
    expect(getScoreReportNote(CID, 'b', 'grp')).toBe('Away for two classes.');
    expect(getScoreReportNote(CID, 'a', 'grp')).toBe('');
  });

  it('copies points on pair work, and a clear clears the pair', () => {
    setPointsScore(CID, 'a', 'pr', 8);
    expect(getPointsScore(CID, 'b', 'pr')).toBe(8);
    setPointsScore(CID, 'b', 'pr', null);
    expect(getPointsScore(CID, 'a', 'pr')).toBe(null);
  });

  it('copies a whole-blob save such as a cleared cell', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    var scores = getScores(CID);
    scores.b = scores.b.filter(e => e.assessmentId !== 'grp');
    saveScores(CID, scores);
    expect(levels('a', 'grp')).toEqual([]);
    expect(levels('c', 'grp')).toEqual([]);
  });

  it('leaves individual work alone', () => {
    upsertScore(CID, 'a', 'solo', 't1', 3, '', 'summative', '');
    expect(levels('b', 'solo')).toEqual([]);
  });
});

describe('Grade Separately', () => {
  it('keeps the member their copy and stops later changes reaching them', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    expect(setGradedSeparately(CID, 'grp', 'b', true)).toBe(true);
    expect(isLinkedGroupMember(CID, 'grp', 'b')).toBe(false);
    expect(levels('b', 'grp')).toEqual([['t1', 3, 0]]);
    upsertScore(CID, 'a', 'grp', 't1', 2, '', 'summative', '');
    expect(levels('b', 'grp')).toEqual([['t1', 3, 0]]);
    expect(levels('c', 'grp')).toEqual([['t1', 2, 0]]);
    upsertScore(CID, 'b', 'grp', 't1', 4, '', 'summative', '');
    expect(levels('a', 'grp')).toEqual([['t1', 2, 0]]);
  });

  it('Back to Group Grade replaces their grade with the group’s', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    setGradedSeparately(CID, 'grp', 'b', true);
    upsertScore(CID, 'b', 'grp', 't2', 4, '', 'summative', '');
    saveScoreComment(CID, 'b', 'grp', 'Strong controls.');
    setGradedSeparately(CID, 'grp', 'b', false);
    expect(levels('b', 'grp')).toEqual([['t1', 3, 0]]);
    expect(getScoreComment(CID, 'b', 'grp')).toBe('');
  });

  it('is saved in collab_config and read back', () => {
    setGradedSeparately(CID, 'grp', 'b', true);
    var a = getAssessments(CID).find(x => x.id === 'grp');
    expect(_collabConfigFromAssessment(a).gradedSeparately).toEqual(['b']);
    var back = _assessmentFromDetail(
      {},
      {
        assessment: {
          id: 'grp',
          collab_mode: 'groups',
          collab_config: { groups: [['a', 'b']], gradedSeparately: ['b'] },
        },
      },
    );
    expect(back.gradedSeparately).toEqual(['b']);
  });

  it('refuses students in no group', () => {
    expect(setGradedSeparately(CID, 'grp', 'z', true)).toBe(false);
    expect(setGradedSeparately(CID, 'solo', 'a', true)).toBe(false);
  });
});

describe('Missing, Excused and Late stay per student', () => {
  it('a Missing member gets no group grade', () => {
    setAssignmentStatus(CID, 'c', 'grp', 'NS');
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    expect(levels('b', 'grp')).toEqual([['t1', 3, 0]]);
    expect(levels('c', 'grp')).toEqual([]);
    expect(getAssignmentStatus(CID, 'a', 'grp')).toBe(null);
  });

  it('marking a graded member Excused clears their copy; taking it off copies it back', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    saveScoreComment(CID, 'a', 'grp', 'Good work.');
    expect(canSetAssignmentStatus(CID, 'c', 'grp', 'EXC')).toBe(true);
    setAssignmentStatus(CID, 'c', 'grp', 'EXC');
    expect(getAssignmentStatus(CID, 'c', 'grp')).toBe('EXC');
    expect(levels('c', 'grp')).toEqual([]);
    expect(getScoreComment(CID, 'c', 'grp')).toBe('');
    expect(levels('a', 'grp')).toEqual([['t1', 3, 0]]);
    setAssignmentStatus(CID, 'c', 'grp', null);
    expect(levels('c', 'grp')).toEqual([['t1', 3, 0]]);
    expect(getScoreComment(CID, 'c', 'grp')).toBe('Good work.');
  });

  it('Missing through applyAssignmentStatus never wipes the group', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    applyAssignmentStatus(CID, 'b', 'grp', 'NS');
    expect(levels('a', 'grp')).toEqual([['t1', 3, 0]]);
    expect(levels('c', 'grp')).toEqual([['t1', 3, 0]]);
  });

  it('Late keeps the group grade', () => {
    setAssignmentStatus(CID, 'b', 'grp', 'LATE');
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    expect(levels('b', 'grp')).toEqual([['t1', 3, 0]]);
  });

  it('a member graded separately keeps the old rule', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    setGradedSeparately(CID, 'grp', 'b', true);
    expect(canSetAssignmentStatus(CID, 'b', 'grp', 'NS')).toBe(false);
  });
});

describe('rubric checkboxes', () => {
  it('copies ticks and unticks', () => {
    setRubricCheck(CID, 'a', 'grp', 'k1', true);
    expect(getRubricCheckIds(CID, 'b', 'grp')).toEqual(['k1']);
    setRubricCheck(CID, 'c', 'grp', 'k1', false);
    expect(getRubricCheckIds(CID, 'a', 'grp')).toEqual([]);
  });
});
