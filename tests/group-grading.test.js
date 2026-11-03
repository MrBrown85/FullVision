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

describe('review fixes (Nov 1 2026)', () => {
  it('moves a member with a grade of their own to Graded Separately instead of writing over it', () => {
    // b and c were graded before the groups were made: b differs from a.
    saveScores(CID, {
      a: [{ assessmentId: 'grp', tagId: 't1', score: 3, type: 'summative', date: '2026-10-31' }],
      b: [{ assessmentId: 'grp', tagId: 't1', score: 1, type: 'summative', date: '2026-10-31' }],
      c: [{ assessmentId: 'grp', tagId: 't1', score: 3, type: 'summative', date: '2026-10-31' }],
    });
    upsertScore(CID, 'a', 'grp', 't2', 4, '', 'summative', '');
    expect(levels('b', 'grp')).toEqual([['t1', 1, 0]]);
    expect(isLinkedGroupMember(CID, 'grp', 'b')).toBe(false);
    expect(levels('c', 'grp')).toEqual([
      ['t1', 3, 0],
      ['t2', 4, 0],
    ]);
  });

  it('a status taken off through a bulk save copies the group grade back', () => {
    var st = getAssignmentStatuses(CID);
    st['c:grp'] = 'NS';
    saveAssignmentStatuses(CID, st);
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    expect(levels('c', 'grp')).toEqual([]);
    st = getAssignmentStatuses(CID);
    delete st['c:grp'];
    saveAssignmentStatuses(CID, st);
    expect(levels('c', 'grp')).toEqual([['t1', 3, 0]]);
  });

  it('a bulk Missing on a graded member clears their copy', () => {
    upsertScore(CID, 'a', 'grp', 't1', 3, '', 'summative', '');
    var st = getAssignmentStatuses(CID);
    st['b:grp'] = 'EXC';
    saveAssignmentStatuses(CID, st);
    expect(levels('b', 'grp')).toEqual([]);
    expect(levels('c', 'grp')).toEqual([['t1', 3, 0]]);
  });

  it('old rubric keys in storage are not read as changed grades', () => {
    var list = getAssessments(CID);
    var rub = list.find(x => x.id === 'grp');
    rub.rubricId = 'r1';
    rub.tagIds = ['t1'];
    saveAssessments(CID, list);
    saveRubrics(CID, [{ id: 'r1', name: 'R', criteria: [{ id: 'c1', name: 'C', tagIds: ['t1'], levels: {} }] }]);
    // Stored before criteria had their own keys; a and b already differ.
    _cache.scores[CID] = undefined;
    localStorage.setItem(
      'gb-scores-' + CID,
      JSON.stringify({
        a: [{ assessmentId: 'grp', tagId: 't1', score: 3, type: 'summative', date: '2026-10-31' }],
        b: [{ assessmentId: 'grp', tagId: 't1', score: 2, type: 'summative', date: '2026-10-31' }],
      }),
    );
    var scores = getScores(CID);
    scores.d = [{ assessmentId: 'solo', tagId: 't1', score: 3, type: 'summative', date: '2026-10-31' }];
    saveScores(CID, scores);
    expect(isLinkedGroupMember(CID, 'grp', 'b')).toBe(true);
    expect(levels('b', 'grp')).toEqual([['c1', 2, 0]]);
  });

  it('never grades DIBELS work by group, and keeps its Missing rule', () => {
    var list = getAssessments(CID);
    list.push({
      id: 'dib',
      title: 'DIBELS',
      date: '2026-10-31',
      type: 'summative',
      tagIds: [],
      scoreMode: 'dibels',
      collaboration: 'group',
      groups: [['a', 'b']],
    });
    saveAssessments(CID, list);
    expect(getCollabGroupOf(list[list.length - 1], 'a')).toBe(null);
    saveDibelsScore(CID, 'a', 'dib', 'boy', { orfWrc: 120 });
    expect(canSetAssignmentStatus(CID, 'a', 'dib', 'NS')).toBe(false);
  });

  it('Back to Group Grade has nobody to copy from when the rest are Excused', () => {
    setGradedSeparately(CID, 'pr', 'b', true);
    setAssignmentStatus(CID, 'a', 'pr', 'EXC');
    expect(backToGroupGradeSource(CID, 'pr', 'b')).toBe(null);
    setAssignmentStatus(CID, 'a', 'pr', null);
    expect(backToGroupGradeSource(CID, 'pr', 'b')).toBe('a');
  });

  it('groupGradingUnits lists groups, then separated members, then the rest', () => {
    setGradedSeparately(CID, 'grp', 'b', true);
    var a = getAssessments(CID).find(x => x.id === 'grp');
    var units = groupGradingUnits(CID, a, ['a', 'b', 'c', 'd', 'e', 'z']);
    expect(units.map(u => (u.linked ? 'G' + (u.group.index + 1) + ':' + u.source : u.sid))).toEqual([
      'G1:a',
      'b',
      'G2:d',
      'z',
    ]);
    expect(
      groupGradingUnits(
        CID,
        getAssessments(CID).find(x => x.id === 'solo'),
        ['a'],
      ),
    ).toBe(null);
  });
});

describe('a status sets the group grade aside (Nov 3 2026 sweep)', () => {
  it('marking every member Missing keeps the grade and comment, and taking a status off brings them back', () => {
    upsertScore(CID, 'd', 'grp', 't1', 3, '', 'summative', '');
    saveScoreComment(CID, 'd', 'grp', 'Great lab');
    applyAssignmentStatus(CID, 'd', 'grp', 'NS');
    expect(canSetAssignmentStatus(CID, 'e', 'grp', 'EXC')).toBe(true);
    applyAssignmentStatus(CID, 'e', 'grp', 'EXC');
    expect(levels('e', 'grp')).toEqual([]);
    expect(getAssessments(CID).find(x => x.id === 'grp').groupGradeAside).toBeTruthy();
    expect(_collabConfigFromAssessment(getAssessments(CID).find(x => x.id === 'grp')).groupGradeAside).toBeTruthy();
    setAssignmentStatus(CID, 'd', 'grp', null);
    expect(levels('d', 'grp')).toEqual([['t1', 3, 0]]);
    expect(getScoreComment(CID, 'd', 'grp')).toBe('Great lab');
    expect(getAssessments(CID).find(x => x.id === 'grp').groupGradeAside).toBeUndefined();
    setAssignmentStatus(CID, 'e', 'grp', null);
    expect(levels('e', 'grp')).toEqual([['t1', 3, 0]]);
    expect(getScoreComment(CID, 'e', 'grp')).toBe('Great lab');
  });

  it('a points pair keeps its points when both are Excused and both come off at once', () => {
    setPointsScore(CID, 'a', 'pr', 8);
    setAssignmentStatus(CID, 'a', 'pr', 'EXC');
    setAssignmentStatus(CID, 'b', 'pr', 'EXC');
    expect(getPointsScore(CID, 'b', 'pr')).toBe(null);
    var st = getAssignmentStatuses(CID);
    delete st['a:pr'];
    delete st['b:pr'];
    saveAssignmentStatuses(CID, st);
    expect(getPointsScore(CID, 'a', 'pr')).toBe(8);
    expect(getPointsScore(CID, 'b', 'pr')).toBe(8);
  });

  it('a member whose grade is their own is not marked Missing, and keeps it', () => {
    // Graded one by one, then made Group work: e is still linked.
    var list = getAssessments(CID);
    list.find(x => x.id === 'grp').collaboration = 'individual';
    saveAssessments(CID, list);
    saveScores(CID, {
      d: [{ assessmentId: 'grp', tagId: 't1', score: 3, type: 'summative', date: '2026-10-31' }],
      e: [{ assessmentId: 'grp', tagId: 't1', score: 2, type: 'summative', date: '2026-10-31', note: 'Own comment' }],
    });
    list = getAssessments(CID);
    list.find(x => x.id === 'grp').collaboration = 'group';
    saveAssessments(CID, list);
    expect(isLinkedGroupMember(CID, 'grp', 'e')).toBe(true);
    expect(canSetAssignmentStatus(CID, 'e', 'grp', 'NS')).toBe(false);
    expect(applyAssignmentStatus(CID, 'e', 'grp', 'NS')).toBe(false);
    expect(levels('e', 'grp')).toEqual([['t1', 2, 0]]);
    expect(getScoreComment(CID, 'e', 'grp')).toBe('Own comment');
    expect(canSetAssignmentStatus(CID, 'd', 'grp', 'NS')).toBe(false);
  });
});
