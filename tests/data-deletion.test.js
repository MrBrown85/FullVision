/**
 * Deletion and cascade tests — gb-data.js
 * Tests deleteStudent cascade, deleteRubric on nonexistent,
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
  localStorage.clear();
  globalThis.COURSES = {
    test: { id: 'test', name: 'Test', calcMethod: 'mostRecent', decayWeight: 0.65 },
  };
});

describe('deleteStudent', () => {
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

    deleteStudent(CID, 's1');

    const students = getStudents(CID);
    expect(students).toHaveLength(1);
    expect(students[0].id).toBe('s2');
  });

  it('removes deleted student scores from getScores', () => {
    saveStudents(CID, [
      { id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' },
    ]);
    saveScores(CID, {
      s1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }],
    });
    saveGoals(CID, {});
    saveReflections(CID, {});
    saveNotes(CID, {});
    saveFlags(CID, {});
    saveAssignmentStatuses(CID, {});
    saveQuickObs(CID, {});

    deleteStudent(CID, 's1');

    const scores = getScores(CID);
    expect(scores['s1']).toBeUndefined();
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

describe('removing an assessment does not auto-clean scores', () => {
  it('scores remain after assessment is removed from saveAssessments', () => {
    saveAssessments(CID, [
      { id: 'a1', title: 'Quiz', date: '2025-01-15', type: 'summative', tagIds: ['t1'] },
    ]);
    saveScores(CID, {
      stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 85, date: '2025-01-15', type: 'summative' }],
    });

    // Remove the assessment but keep scores — documenting this behavior
    saveAssessments(CID, []);

    const scores = getScores(CID);
    expect(scores['stu1']).toHaveLength(1);
    expect(scores['stu1'][0].assessmentId).toBe('a1');
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
