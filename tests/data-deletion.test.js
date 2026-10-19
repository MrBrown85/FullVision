/**
 * Deletion and cascade tests — gb-data.js
 * Tests withdrawStudent taking a student out of the class, deleteRubric on
 * nonexistent,
 * and clearing data via save with empty values.
 */

const CID = 'test';

beforeEach(() => {
  _cache.students[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.scores[CID] = undefined;
  _cache.rubrics[CID] = undefined;
  _cache.goals[CID] = undefined;
  _cache.reflections[CID] = undefined;
  _cache.notes[CID] = undefined;
  _cache.flags[CID] = undefined;
  _cache.statuses[CID] = undefined;
  _cache.observations[CID] = undefined;
  _cache.termRatings[CID] = undefined;
  _cache.overrides[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;
  _cache.withdrawn[CID] = undefined;
  localStorage.clear();
  globalThis.COURSES = {
    test: { id: 'test', name: 'Test', calcMethod: 'mostRecent', decayWeight: 0.65 },
  };
});

describe('withdrawStudent', () => {
  it('removes student from getStudents', () => {
    saveStudents(CID, [
      { id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' },
      { id: 's2', firstName: 'Bob', lastName: 'B', designations: [], sortName: 'B Bob' },
    ]);
    saveScores(CID, {});
    saveGoals(CID, {});
    saveReflections(CID, {});
    saveNotes(CID, {});
    saveFlags(CID, {});
    saveAssignmentStatuses(CID, {});
    saveQuickObs(CID, {});

    withdrawStudent(CID, 's1');

    const students = getStudents(CID);
    expect(students).toHaveLength(1);
    expect(students[0].id).toBe('s2');
  });

  it("takes the withdrawn student's scores out of getScores and keeps them", () => {
    saveStudents(CID, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
    saveScores(CID, {
      s1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }],
    });
    saveGoals(CID, {});
    saveReflections(CID, {});
    saveNotes(CID, {});
    saveFlags(CID, {});
    saveAssignmentStatuses(CID, {});
    saveQuickObs(CID, {});

    withdrawStudent(CID, 's1');

    const scores = getScores(CID);
    expect(scores['s1']).toBeUndefined();
    expect(getWithdrawnStudents(CID)[0].records.scores).toHaveLength(1);
  });
});

describe('deleteRubric on nonexistent ID', () => {
  it('does not crash when deleting a nonexistent rubric', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'Real Rubric' }]);
    saveAssessments(CID, []);

    expect(() => deleteRubric(CID, 'nonexistent')).not.toThrow();
    expect(getRubrics(CID)).toHaveLength(1);
  });
});

describe('orphaned score cleanup on assessment removal', () => {
  it('scores for removed assessments are cleaned up by saveAssessments', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Quiz', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
    saveScores(CID, {
      stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 85, date: '2025-01-15', type: 'summative' }],
    });

    // Remove the assessment — orphaned scores should be cleaned
    saveAssessments(CID, []);

    const scores = getScores(CID);
    expect(scores['stu1']).toHaveLength(0);
  });

  it('only cleans scores for the removed assessment', () => {
    saveAssessments(CID, [
      { id: 'a1', title: 'Quiz 1', date: '2025-01-15', type: 'summative', tagIds: ['t1'] },
      { id: 'a2', title: 'Quiz 2', date: '2025-01-20', type: 'summative', tagIds: ['t1'] },
    ]);
    saveScores(CID, {
      stu1: [
        { id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-15', type: 'summative' },
        { id: 'e2', assessmentId: 'a2', tagId: 't1', score: 4, date: '2025-01-20', type: 'summative' },
      ],
    });

    // Remove only a1 — a2 scores should remain
    saveAssessments(CID, [{ id: 'a2', title: 'Quiz 2', date: '2025-01-20', type: 'summative', tagIds: ['t1'] }]);

    const scores = getScores(CID);
    expect(scores['stu1']).toHaveLength(1);
    expect(scores['stu1'][0].assessmentId).toBe('a2');
  });
});

describe('clearing data with empty values', () => {
  it('saveCourses with empty object clears all courses', () => {
    saveCourses({ test: { id: 'test', name: 'Test' } });
    saveCourses({});
    const courses = loadCourses();
    expect(Object.keys(courses)).toHaveLength(0);
  });

  it('saveStudents with empty array clears roster', () => {
    saveStudents(CID, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
    saveStudents(CID, []);
    expect(getStudents(CID)).toEqual([]);
  });

  it('saveScores with empty object clears all scores', () => {
    saveScores(CID, {
      s1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }],
    });
    saveScores(CID, {});
    expect(getScores(CID)).toEqual({});
  });

  it('saveAssessments with empty array clears assessments', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Quiz', tagIds: ['t1'] }]);
    saveAssessments(CID, []);
    expect(getAssessments(CID)).toEqual([]);
  });
});
