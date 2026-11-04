/**
 * Missing points work in a Proficiency class (Colin, 2026-11-03; Nov 3 bug
 * sweep, step 4 group 2 #11): it is no evidence, so it stays out of
 * competency proficiency, as Missing proficiency work does (#634); its
 * column's Class Average still counts it as 0. Sofia's Missing Unit 1 Quiz
 * left her at 3.0 while the column averaged it as 0, which is the rule. The
 * M mark's tooltip said "counts as 0", which it doesn't in her grade. Missing
 * follows the class's grading style (Colin, 2026-11-03): 0 in a Letter
 * class, 0 in the course % and no evidence in levels in a Both class.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'missing-points-prof';
const SOFIA = { id: 'sofia', firstName: 'Sofia', lastName: 'Ruiz' };
const LIAM = { id: 'liam', firstName: 'Liam', lastName: 'Park' };
const lab = { id: 'lab', title: 'Pendulum Lab', date: '2026-10-01', tagIds: ['t1'] };
const quiz = {
  id: 'quiz',
  title: 'Unit 1 Quiz',
  date: '2026-10-02',
  scoreMode: 'points',
  maxPoints: 20,
  tagIds: ['t1'],
};

function seed() {
  COURSES[CID] = { id: CID, gradingSystem: 'proficiency', gradeLevel: '8' };
  _cache.students[CID] = [SOFIA, LIAM];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec', name: 'Questioning', tags: [{ id: 't1', label: 'PA5' }] }],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [lab, quiz];
  _cache.scores[CID] = {
    sofia: [{ assessmentId: 'lab', tagId: 't1', score: 3, date: '2026-10-01' }],
    liam: [
      { assessmentId: 'lab', tagId: 't1', score: 3, date: '2026-10-01' },
      { assessmentId: 'quiz', tagId: 't1', score: 9, date: '2026-10-02' },
    ],
  };
  _cache.statuses[CID] = { 'sofia:quiz': 'NS' };
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}

describe('Missing points work in a Proficiency class', () => {
  afterEach(() => delete COURSES[CID]);

  it('is no evidence for proficiency, while a low score is', () => {
    seed();
    expect(getTagProficiency(CID, 'sofia', 't1')).toBe(3);
    expect(getOverallProficiency(CID, 'sofia')).toBe(3);
    // Liam's 9/20 is a score, so it lowers his.
    expect(getTagProficiency(CID, 'liam', 't1')).toBeLessThan(3);
  });

  it('counts as 0 in its column’s Class Average', () => {
    seed();
    expect(getClassPointsAverage(CID, [SOFIA, LIAM], quiz)).toMatchObject({ avg: 4.5, pct: 22.5, count: 2 });
  });

  it('its M says how it counts in each grading style', () => {
    seed();
    expect(scoreStatusMarker('NS', CID, quiz)).toContain('title="Missing: no evidence yet, 0 in the Class Average"');
    expect(scoreStatusMarker('NS', CID, quiz)).not.toContain('counts as 0');
    COURSES[CID].gradingSystem = 'letter';
    expect(scoreStatusMarker('NS', CID, quiz)).toContain('title="Missing: counts as 0"');
    COURSES[CID].gradingSystem = 'both';
    expect(scoreStatusMarker('NS', CID, quiz)).toContain(
      'title="Missing: 0 in the course %, not counted in proficiency"',
    );
  });
});
