/**
 * Score, status, and flag utility tests — gb-data.js
 */

const CID = 'test';

beforeEach(() => {
  // Reset caches
  _cache.scores[CID] = undefined;
  _cache.flags[CID] = undefined;
  _cache.statuses[CID] = undefined;
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

  it('returns 0 when all scores are 0', () => {
    saveScores(CID, {
      stu1: [{ assessmentId: 'a1', tagId: 't1', score: 0, date: '2025-01-01', type: 'summative' }],
    });
    expect(getPointsScore(CID, 'stu1', 'a1')).toBe(0);
  });
});

describe('getAssignmentStatus', () => {
  it('returns status for composite key', () => {
    saveAssignmentStatuses(CID, { 'stu1:a1': 'excused' });
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBe('excused');
  });

  it('returns null when no status set', () => {
    saveAssignmentStatuses(CID, {});
    expect(getAssignmentStatus(CID, 'stu1', 'a1')).toBeNull();
  });
});

describe('isStudentFlagged', () => {
  it('returns true when student is flagged', () => {
    saveFlags(CID, { stu1: true });
    expect(isStudentFlagged(CID, 'stu1')).toBe(true);
  });

  it('returns false when student is not flagged', () => {
    saveFlags(CID, {});
    expect(isStudentFlagged(CID, 'stu1')).toBe(false);
  });
});

describe('toggleFlag', () => {
  it('flags an unflagged student', () => {
    saveFlags(CID, {});
    toggleFlag(CID, 'stu1');
    expect(isStudentFlagged(CID, 'stu1')).toBe(true);
  });

  it('unflags a flagged student', () => {
    saveFlags(CID, { stu1: true });
    toggleFlag(CID, 'stu1');
    expect(isStudentFlagged(CID, 'stu1')).toBe(false);
  });
});

describe('getActiveCourse', () => {
  it('returns config activeCourse when valid', () => {
    // COURSES is initialized from DEFAULT_COURSES which has 'sci8'
    _cache.config = { activeCourse: 'sci8' };
    expect(getActiveCourse()).toBe('sci8');
  });

  it('falls back to first course when activeCourse not in COURSES', () => {
    _cache.config = { activeCourse: 'nonexistent' };
    const result = getActiveCourse();
    // Should return first key of COURSES (sci8 from DEFAULT_COURSES)
    expect(result).toBe('sci8');
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
