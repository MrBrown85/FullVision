/**
 * Score entry edge cases — gb-data.js
 * Tests score clearing, excused status, multi-tag scoring, overrides, goals,
 * reflections, notes, and getPointsScore edge cases.
 */

const CID = 'test';

beforeEach(() => {
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.statuses[CID] = undefined;
  _cache.overrides[CID] = undefined;
  _cache.goals[CID] = undefined;
  _cache.reflections[CID] = undefined;
  _cache.notes[CID] = undefined;
  _cache.learningMaps[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;
  localStorage.clear();
  globalThis.COURSES = {
    test: { id: 'test', name: 'Test', calcMethod: 'mostRecent', decayWeight: 0.65 },
  };
});

describe('score of 0 clears existing entry', () => {
  it('sets score to 0 on existing entry via setPointsScore', () => {
    saveAssessments(CID, [
      { id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] },
    ]);
    saveScores(CID, {
      stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 85, date: '2025-01-15', type: 'summative' }],
    });

    setPointsScore(CID, 'stu1', 'a1', 0);

    const scores = getScores(CID);
    // The entry still exists but score is 0
    expect(scores['stu1'][0].score).toBe(0);
  });
});

describe('excused status', () => {
  it('setAssignmentStatus stores and getAssignmentStatus retrieves excused', () => {
    saveAssignmentStatuses(CID, {});
    setAssignmentStatus(CID, 'stu1', 'a1', 'excused');
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBe('excused');
  });

  it('clearing status with null removes it', () => {
    saveAssignmentStatuses(CID, { 'stu1:a1': 'excused' });
    setAssignmentStatus(CID, 'stu1', 'a1', null);
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBeNull();
  });
});

describe('multiple tags on same assessment', () => {
  it('setPointsScore creates entries for all tags', () => {
    saveAssessments(CID, [
      { id: 'a1', title: 'Multi', date: '2025-02-01', type: 'summative', tagIds: ['t1', 't2', 't3'] },
    ]);
    saveScores(CID, {});

    setPointsScore(CID, 'stu1', 'a1', 90);

    const entries = getScores(CID)['stu1'];
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.tagId).sort()).toEqual(['t1', 't2', 't3']);
    entries.forEach(e => expect(e.score).toBe(90));
  });
});

describe('score update preserves entry ID', () => {
  it('keeps the same entry id when score is updated', () => {
    saveAssessments(CID, [
      { id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] },
    ]);
    saveScores(CID, {
      stu1: [{ id: 'keep-me', assessmentId: 'a1', tagId: 't1', score: 50, date: '2025-01-15', type: 'summative' }],
    });

    setPointsScore(CID, 'stu1', 'a1', 95);

    const entry = getScores(CID)['stu1'][0];
    expect(entry.id).toBe('keep-me');
    expect(entry.score).toBe(95);
  });
});

describe('score with missing assessment', () => {
  it('does nothing for nonexistent assessment ID', () => {
    saveAssessments(CID, []);
    saveScores(CID, {});

    setPointsScore(CID, 'stu1', 'nonexistent', 85);

    const scores = getScores(CID);
    expect(scores['stu1']).toBeUndefined();
  });
});

describe('overrides roundtrip', () => {
  it('saveOverrides and getOverrides persist data', () => {
    saveOverrides(CID, { stu1: { sec1: { level: 3, reason: 'good', date: '2025-03-01' } } });
    const result = getOverrides(CID);
    expect(result.stu1.sec1.level).toBe(3);
    expect(result.stu1.sec1.reason).toBe('good');
  });
});

describe('override affects getSectionProficiency', () => {
  it('returns override level instead of calculated', () => {
    // Use 'sci8' course ID since getTagProficiency reads the internal COURSES let variable
    // which only contains DEFAULT_COURSES (sci8)
    const cid = 'sci8';
    _cache.scores[cid] = undefined;
    _cache.assessments[cid] = undefined;
    _cache.overrides[cid] = undefined;
    _cache.courseConfigs[cid] = undefined;
    // Set up a learning map with a section
    _cache.learningMaps[cid] = {
      _flatVersion: 2,
      subjects: [{ id: 'SCI', name: 'Science' }],
      sections: [
        {
          id: 'sec1', name: 'Questioning', color: '#0891b2', subject: 'SCI', shortName: 'Q',
          tags: [{ id: 'sec1', label: 'Question', color: '#0891b2', subject: 'SCI', name: 'Questioning', shortName: 'Q' }],
        },
      ],
    };
    saveCourseConfig(cid, { calcMethod: 'mostRecent', decayWeight: 0.65 });
    // Save a score that would calculate to 2
    saveAssessments(cid, [
      { id: 'a1', title: 'Quiz', date: '2025-01-15', type: 'summative', tagIds: ['sec1'] },
    ]);
    saveScores(cid, {
      stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 'sec1', score: 2, date: '2025-01-15', type: 'summative' }],
    });
    // Set override to 4
    saveOverrides(cid, { stu1: { sec1: { level: 4, reason: 'portfolio', date: '2025-03-01' } } });

    const prof = getSectionProficiency(cid, 'stu1', 'sec1');
    expect(prof).toBe(4);
  });
});

describe('goals roundtrip', () => {
  it('saveGoals and getGoals persist data', () => {
    saveGoals(CID, { stu1: { sec1: 'Improve questioning skills' } });
    expect(getGoals(CID).stu1.sec1).toBe('Improve questioning skills');
  });
});

describe('reflections roundtrip', () => {
  it('saveReflections and getReflections persist data', () => {
    saveReflections(CID, { stu1: { sec1: 'Student showed growth' } });
    expect(getReflections(CID).stu1.sec1).toBe('Student showed growth');
  });
});

describe('notes roundtrip', () => {
  it('saveNotes and getNotes persist data', () => {
    saveNotes(CID, { stu1: { general: 'Needs extra support' } });
    expect(getNotes(CID).stu1.general).toBe('Needs extra support');
  });
});

describe('getPointsScore edge cases', () => {
  it('returns 0 for missing student', () => {
    saveScores(CID, {});
    expect(getPointsScore(CID, 'nobody', 'a1')).toBe(0);
  });

  it('returns correct value after setting', () => {
    saveAssessments(CID, [
      { id: 'a1', title: 'Quiz', date: '2025-01-15', type: 'summative', tagIds: ['t1'] },
    ]);
    saveScores(CID, {});
    setPointsScore(CID, 'stu1', 'a1', 72);
    expect(getPointsScore(CID, 'stu1', 'a1')).toBe(72);
  });
});
