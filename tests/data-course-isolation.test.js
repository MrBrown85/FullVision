/**
 * Multi-course data isolation tests — gb-data.js
 * Verifies that students, assessments, scores, and learning maps
 * for one course do not leak into another.
 */

const A = 'courseA';
const B = 'courseB';

beforeEach(() => {
  _cache.students[A] = undefined;
  _cache.students[B] = undefined;
  _cache.assessments[A] = undefined;
  _cache.assessments[B] = undefined;
  _cache.scores[A] = undefined;
  _cache.scores[B] = undefined;
  _cache.learningMaps[A] = undefined;
  _cache.learningMaps[B] = undefined;
  _cache.config = {};
  localStorage.clear();
  // Use saveCourses to update the internal COURSES variable (let-scoped in gb-data.js)
  saveCourses({
    courseA: { id: 'courseA', name: 'Course A', calcMethod: 'mostRecent', decayWeight: 0.65 },
    courseB: { id: 'courseB', name: 'Course B', calcMethod: 'highest', decayWeight: 0.65 },
  });
});

describe('student isolation', () => {
  it('students saved to course A are not returned by getStudents(courseB)', () => {
    saveStudents(A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
    saveStudents(B, []);
    expect(getStudents(A)).toHaveLength(1);
    expect(getStudents(B)).toHaveLength(0);
  });
});

describe('assessment isolation', () => {
  it('assessments saved to course A are not in getAssessments(courseB)', () => {
    saveAssessments(A, [{ id: 'a1', title: 'Quiz A', tagIds: ['t1'] }]);
    saveAssessments(B, []);
    expect(getAssessments(A)).toHaveLength(1);
    expect(getAssessments(B)).toHaveLength(0);
  });
});

describe('score isolation', () => {
  it('scores saved to course A are not in getScores(courseB)', () => {
    saveScores(A, { stu1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }] });
    saveScores(B, {});
    expect(Object.keys(getScores(A))).toHaveLength(1);
    expect(Object.keys(getScores(B))).toHaveLength(0);
  });
});

describe('setActiveCourse / getActiveCourse', () => {
  // Note: getActiveCourse validates against the internal COURSES object (let-scoped
  // in gb-data.js), which is initialized to DEFAULT_COURSES containing 'sci8'.
  // We test with 'sci8' since it's the only course the internal COURSES knows about.
  it('setActiveCourse changes the active course', () => {
    setActiveCourse('sci8');
    expect(getActiveCourse()).toBe('sci8');
  });

  it('getActiveCourse returns config activeCourse when valid', () => {
    _cache.config = { activeCourse: 'sci8' };
    expect(getActiveCourse()).toBe('sci8');
  });
});

describe('independent course data', () => {
  it('creating data in A then B — both exist independently', () => {
    saveStudents(A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
    saveStudents(B, [{ id: 's2', firstName: 'Bob', lastName: 'B', designations: [], sortName: 'B Bob' }]);
    saveScores(A, { s1: [{ id: 'e1', assessmentId: 'a1', tagId: 't1', score: 3, date: '2025-01-01', type: 'summative' }] });
    saveScores(B, { s2: [{ id: 'e2', assessmentId: 'a2', tagId: 't2', score: 4, date: '2025-02-01', type: 'formative' }] });

    expect(getStudents(A)[0].firstName).toBe('Alice');
    expect(getStudents(B)[0].firstName).toBe('Bob');
    expect(getScores(A)['s1'][0].score).toBe(3);
    expect(getScores(B)['s2'][0].score).toBe(4);
  });

  it('clearing course A data does not affect course B', () => {
    saveStudents(A, [{ id: 's1', firstName: 'Alice', lastName: 'A', designations: [], sortName: 'A Alice' }]);
    saveStudents(B, [{ id: 's2', firstName: 'Bob', lastName: 'B', designations: [], sortName: 'B Bob' }]);

    saveStudents(A, []);
    expect(getStudents(A)).toHaveLength(0);
    expect(getStudents(B)).toHaveLength(1);
    expect(getStudents(B)[0].firstName).toBe('Bob');
  });
});

describe('learning map isolation', () => {
  it('learning map for course A is separate from course B', () => {
    const mapA = { subjects: [{ id: 'S1', name: 'Subject A' }], sections: [], _customized: true, _flatVersion: 2 };
    const mapB = { subjects: [{ id: 'S2', name: 'Subject B' }], sections: [], _customized: true, _flatVersion: 2 };
    saveLearningMap(A, mapA);
    saveLearningMap(B, mapB);

    expect(getLearningMap(A).subjects[0].name).toBe('Subject A');
    expect(getLearningMap(B).subjects[0].name).toBe('Subject B');
  });
});
