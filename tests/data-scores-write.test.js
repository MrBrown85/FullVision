/**
 * Score write operations and rubric cascade tests — gb-data.js
 */

const CID = 'test';

beforeEach(() => {
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.rubrics[CID] = undefined;
  localStorage.clear();
});

/* ── setPointsScore ───────────────────────────────────────── */
describe('setPointsScore', () => {
  it('creates score entries for each tag in the assessment', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1', 't2'] }]);
    saveScores(CID, {});

    setPointsScore(CID, 'stu1', 'a1', 85);

    const scores = getScores(CID);
    const stu1Scores = scores['stu1'];
    expect(stu1Scores).toHaveLength(2);
    expect(stu1Scores[0].score).toBe(85);
    expect(stu1Scores[0].tagId).toBe('t1');
    expect(stu1Scores[1].tagId).toBe('t2');
  });

  it('updates existing score entries', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
    saveScores(CID, {
      stu1: [{ id: 'existing', assessmentId: 'a1', tagId: 't1', score: 50, date: '2025-01-15', type: 'summative' }],
    });

    setPointsScore(CID, 'stu1', 'a1', 90);

    const scores = getScores(CID);
    expect(scores['stu1']).toHaveLength(1);
    expect(scores['stu1'][0].score).toBe(90);
    expect(scores['stu1'][0].id).toBe('existing'); // same entry, updated
  });

  it('does nothing for nonexistent assessment', () => {
    saveAssessments(CID, []);
    saveScores(CID, {});

    setPointsScore(CID, 'stu1', 'nonexistent', 85);

    const scores = getScores(CID);
    expect(scores['stu1']).toBeUndefined();
  });

  it('does not create entries for score of 0', () => {
    saveAssessments(CID, [{ id: 'a1', title: 'Test', date: '2025-01-15', type: 'summative', tagIds: ['t1'] }]);
    saveScores(CID, {});

    setPointsScore(CID, 'stu1', 'a1', 0);

    const scores = getScores(CID);
    // Score 0 creates entries (rawScore >= 0) so teachers can record zero scores
    expect(scores['stu1']).toHaveLength(1);
    expect(scores['stu1'][0].score).toBe(0);
  });

  it('uses assessment date and type for new entries', () => {
    saveAssessments(CID, [
      { id: 'a1', title: 'Formative Quiz', date: '2025-03-20', type: 'formative', tagIds: ['t1'] },
    ]);
    saveScores(CID, {});

    setPointsScore(CID, 'stu1', 'a1', 75);

    const entry = getScores(CID)['stu1'][0];
    expect(entry.date).toBe('2025-03-20');
    expect(entry.type).toBe('formative');
  });
});

describe('upsertScore durability', () => {
  afterEach(() => {
    _useSupabase = false;
    _teacherId = null;
  });

  it('persists local backup data even when Supabase mode is enabled', () => {
    _useSupabase = true;
    _teacherId = 'teacher-1';
    saveScores(CID, {});

    upsertScore(CID, 'stu1', 'a1', 't1', 4, '2025-03-20', 'summative');

    const stored = JSON.parse(localStorage.getItem('gb-scores-' + CID));
    expect(stored.stu1).toHaveLength(1);
    expect(stored.stu1[0].assessmentId).toBe('a1');
    expect(stored.stu1[0].tagId).toBe('t1');
    expect(stored.stu1[0].score).toBe(4);
  });

  it('arms the gradebook echo guard so realtime cursor events do not race in-flight writes', () => {
    _useSupabase = true;
    _teacherId = 'teacher-1';
    delete _echoGuard['gradebook:' + CID];
    expect(_isEchoGuarded('gradebook', CID)).toBe(false);

    upsertScore(CID, 'stu1', 'a1', 't1', 4, '2025-03-20', 'summative');

    expect(_isEchoGuarded('gradebook', CID)).toBe(true);
  });
});

/* ── deleteRubric ─────────────────────────────────────────── */
describe('deleteRubric', () => {
  it('removes rubric from rubrics list', () => {
    saveRubrics(CID, [
      { id: 'r1', title: 'Rubric A' },
      { id: 'r2', title: 'Rubric B' },
    ]);
    saveAssessments(CID, []);

    deleteRubric(CID, 'r1');

    const rubrics = getRubrics(CID);
    expect(rubrics).toHaveLength(1);
    expect(rubrics[0].id).toBe('r2');
  });

  it('clears rubricId from assessments that reference it', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'Rubric A' }]);
    saveAssessments(CID, [
      { id: 'a1', title: 'Uses rubric', rubricId: 'r1', tagIds: ['t1'] },
      { id: 'a2', title: 'No rubric', tagIds: ['t1'] },
      { id: 'a3', title: 'Also uses rubric', rubricId: 'r1', tagIds: ['t2'] },
    ]);

    deleteRubric(CID, 'r1');

    const assessments = getAssessments(CID);
    expect(assessments[0].rubricId).toBeUndefined();
    expect(assessments[1].rubricId).toBeUndefined(); // was already undefined
    expect(assessments[2].rubricId).toBeUndefined();
  });

  it('does not affect assessments with different rubricId', () => {
    saveRubrics(CID, [
      { id: 'r1', title: 'A' },
      { id: 'r2', title: 'B' },
    ]);
    saveAssessments(CID, [{ id: 'a1', title: 'Uses r2', rubricId: 'r2', tagIds: ['t1'] }]);

    deleteRubric(CID, 'r1');

    expect(getAssessments(CID)[0].rubricId).toBe('r2'); // preserved
  });

  it('handles no assessments referencing the rubric', () => {
    saveRubrics(CID, [{ id: 'r1', title: 'A' }]);
    saveAssessments(CID, [{ id: 'a1', title: 'No rubric', tagIds: ['t1'] }]);

    deleteRubric(CID, 'r1');

    expect(getRubrics(CID)).toHaveLength(0);
    expect(getAssessments(CID)).toHaveLength(1); // untouched
  });
});
