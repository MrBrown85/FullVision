/**
 * Score, status, flag, and roundtrip tests — shared/data.js
 *
 * Covers local-cache CRUD for scores, statuses, flags, overrides, goals,
 * reflections, and notes. v2 dispatch for the same entities lives in
 * data-scores-v2-dispatch.test.js.
 */

const CID = 'test';

beforeEach(() => {
  _cache.scores[CID] = undefined;
  _cache.flags[CID] = undefined;
  _cache.statuses[CID] = undefined;
  _cache.overrides[CID] = undefined;
  _cache.goals[CID] = undefined;
  _cache.reflections[CID] = undefined;
  _cache.notes[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.learningMaps[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;
  localStorage.clear();
  globalThis.COURSES = {
    test: { id: 'test', name: 'Test', calcMethod: 'mostRecent', decayWeight: 0.65 },
    math7: { id: 'math7', name: 'Math 7', calcMethod: 'highest', decayWeight: 0.65 },
  };
});

describe('getPointsScore', () => {
  it('returns score for matching assessment', () => {
    saveScores(CID, {
      stu1: [{ assessmentId: 'a1', tagId: 't1', score: 85, date: '2025-01-01', type: 'summative' }],
    });
    expect(getPointsScore(CID, 'stu1', 'a1')).toBe(85);
  });

  it('returns 0 when no scores exist for student', () => {
    saveScores(CID, {});
    expect(getPointsScore(CID, 'stu1', 'a1')).toBe(0);
  });

  it('returns 0 for missing student', () => {
    saveScores(CID, {});
    expect(getPointsScore(CID, 'nobody', 'a1')).toBe(0);
  });

  it('returns 0 when score is 0', () => {
    saveScores(CID, {
      stu1: [{ assessmentId: 'a1', tagId: 't1', score: 0, date: '2025-01-01', type: 'summative' }],
    });
    expect(getPointsScore(CID, 'stu1', 'a1')).toBe(0);
  });
});

describe('setPointsScore', () => {
  it('returns score after setting via setPointsScore', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Quiz', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
    saveScores(CID, {});
    setPointsScore(CID, 'stu1', 'a1', 72);
    expect(getPointsScore(CID, 'stu1', 'a1')).toBe(72);
  });

  it('sets score to 0 on existing entry (clear)', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
    saveScores(CID, {
      stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 85, date: '2025-01-15', type: 'summative' }],
    });
    setPointsScore(CID, 'stu1', 'a1', 0);
    expect(getScores(CID)['stu1'][0].score).toBe(0);
  });

  it('creates entries for all tags on a multi-tag assessment', () => {
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

  it('preserves entry id when updating score', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
    saveScores(CID, {
      stu1: [{ id: 'keep-me', assessmentId: 'a1', tagId: 't1', score: 50, date: '2025-01-15', type: 'summative' }],
    });
    setPointsScore(CID, 'stu1', 'a1', 95);
    const entry = getScores(CID)['stu1'][0];
    expect(entry.id).toBe('keep-me');
    expect(entry.score).toBe(95);
  });

  it('no-ops for nonexistent assessment', () => {
    saveAssessments(CID, []);
    saveScores(CID, {});
    setPointsScore(CID, 'stu1', 'nonexistent', 85);
    expect(getScores(CID)['stu1']).toBeUndefined();
  });
});

describe('assignment status', () => {
  it('set + get roundtrips a status value', () => {
    saveAssignmentStatuses(CID, {});
    setAssignmentStatus(CID, 'stu1', 'a1', 'excused');
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBe('excused');
  });

  it('getAssignmentStatus returns stored composite-key value', () => {
    saveAssignmentStatuses(CID, { 'stu1:a1': 'excused' });
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBe('excused');
  });

  it('setAssignmentStatus(null) clears the status', () => {
    saveAssignmentStatuses(CID, { 'stu1:a1': 'excused' });
    setAssignmentStatus(CID, 'stu1', 'a1', null);
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBeNull();
  });

  it('returns null when no status set', () => {
    saveAssignmentStatuses(CID, {});
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBeNull();
  });
});

describe('flags', () => {
  it('isStudentFlagged returns true when flagged', () => {
    saveFlags(CID, { stu1: true });
    expect(isStudentFlagged(CID, 'stu1')).toBe(true);
  });

  it('isStudentFlagged returns false when not flagged', () => {
    saveFlags(CID, {});
    expect(isStudentFlagged(CID, 'stu1')).toBe(false);
  });

  it('toggleFlag flags an unflagged student', () => {
    saveFlags(CID, {});
    toggleFlag(CID, 'stu1');
    expect(isStudentFlagged(CID, 'stu1')).toBe(true);
  });

  it('toggleFlag unflags a flagged student', () => {
    saveFlags(CID, { stu1: true });
    toggleFlag(CID, 'stu1');
    expect(isStudentFlagged(CID, 'stu1')).toBe(false);
  });
});

describe('getActiveCourse', () => {
  it('returns config activeCourse when valid', () => {
    _cache.config = { activeCourse: 'sci8' };
    expect(getActiveCourse()).toBe('sci8');
  });

  it('falls back to first course when activeCourse not in COURSES', () => {
    _cache.config = { activeCourse: 'nonexistent' };
    expect(getActiveCourse()).toBe('sci8');
  });

  it('returns first course when config has no activeCourse', () => {
    _cache.config = {};
    expect(getActiveCourse()).toBe('sci8');
  });
});

describe('getGradingScale', () => {
  it('returns DEFAULT_GRADING_SCALE when no custom scale', () => {
    saveCourseConfig(CID, {});
    const scale = getGradingScale(CID);
    expect(scale.boundaries).toBeDefined();
    expect(scale.boundaries[0].min).toBe(86);
  });
});

describe('overrides / goals / reflections / notes roundtrips', () => {
  it('overrides roundtrip', () => {
    saveOverrides(CID, { stu1: { sec1: { level: 3, reason: 'good', date: '2025-03-01' } } });
    const result = getOverrides(CID);
    expect(result.stu1.sec1.level).toBe(3);
    expect(result.stu1.sec1.reason).toBe('good');
  });

  it('goals roundtrip', () => {
    saveGoals(CID, { stu1: { sec1: 'Improve questioning skills' } });
    expect(getGoals(CID).stu1.sec1).toBe('Improve questioning skills');
  });

  it('reflections roundtrip', () => {
    saveReflections(CID, { stu1: { sec1: 'Student showed growth' } });
    expect(getReflections(CID).stu1.sec1).toBe('Student showed growth');
  });

  it('notes roundtrip', () => {
    saveNotes(CID, { stu1: { general: 'Needs extra support' } });
    expect(getNotes(CID).stu1.general).toBe('Needs extra support');
  });

  it('override takes precedence over calculated section proficiency', () => {
    // Uses 'sci8' because getTagProficiency reads the internal COURSES var (DEFAULT_COURSES)
    const cid = 'sci8';
    _cache.scores[cid] = undefined;
    _cache.assessments[cid] = undefined;
    _cache.overrides[cid] = undefined;
    _cache.courseConfigs[cid] = undefined;
    _cache.learningMaps[cid] = {
      _flatVersion: 2,
      subjects: [{ id: 'SCI', name: 'Science' }],
      sections: [
        {
          id: 'sec1',
          name: 'Questioning',
          color: '#0891b2',
          subject: 'SCI',
          shortName: 'Q',
          tags: [
            { id: 'sec1', label: 'Question', color: '#0891b2', subject: 'SCI', name: 'Questioning', shortName: 'Q' },
          ],
        },
      ],
    };
    saveCourseConfig(cid, { calcMethod: 'mostRecent', decayWeight: 0.65 });
    saveAssessments(cid, [{ id: 'a1', title: 'Quiz', date: '2025-01-15', type: 'summative', tagIds: ['sec1'] }]);
    saveScores(cid, {
      stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 'sec1', score: 2, date: '2025-01-15', type: 'summative' }],
    });
    saveOverrides(cid, { stu1: { sec1: { level: 4, reason: 'portfolio', date: '2025-03-01' } } });
    expect(getSectionProficiency(cid, 'stu1', 'sec1')).toBe(4);
  });
});
