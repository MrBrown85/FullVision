/**
 * Missing work follows the class's grading style (Colin, 2026-11-03;
 * docs/DECISIONS.md, "Class Averages and statuses" 7):
 * - Letter: 0 in the %, a 0 level in level averages, 0 in every column's Class Average.
 * - Proficiency: no evidence in level averages; only points columns count it 0.
 * - Both: 0 in the course %, no evidence in level averages; only points columns count it 0.
 * Competency proficiency and folder levels leave it out in every class.
 * Before (2026-11-01, #634), a 3 and a Missing showed 1.5 in a Proficiency
 * class while the competency said 3.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'missing-level';
const SID = 'stu-1';
const x = { id: 'x', title: 'X', tagIds: ['t1'] };
const y = { id: 'y', title: 'Y', tagIds: ['t1'] };
const quiz = { id: 'q', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] };

function seed(gradingSystem, assessments, scores, statuses) {
  COURSES[CID] = { id: CID, gradingSystem, gradeLevel: '8' };
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec', name: 'S', tags: [{ id: 't1' }] }],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = statuses;
  _cache.rubrics[CID] = [];
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const three = { assessmentId: 'x', tagId: 't1', score: 3, date: '2026-10-01' };

describe('Missing work in level averages', () => {
  afterEach(() => delete COURSES[CID]);

  it('is left out of a group level, as the competency leaves it out', () => {
    seed('proficiency', [x, y], [three], { [SID + ':y']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, y])).toMatchObject({ text: '3.0', prof: 3 });
    expect(getTagProficiency(CID, SID, 't1')).toBe(3);
  });

  it('alone shows no level, not 0.0', () => {
    seed('proficiency', [x, y], [three], { [SID + ':y']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [y])).toBeNull();
  });

  it('still counts 0 in the %', () => {
    seed('both', [x, y], [three], { [SID + ':y']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, y]).text).toBe('3.0 · IE 37.5%');
    expect(getCourseLetterData(CID, SID).R).toBe(37.5);
  });

  // Colin, 2026-11-03: "Yes, no evidence there too." and "0 in the %, no
  // evidence in levels".
  it('Missing points work is no evidence in a Proficiency class; its Class Average still counts it as 0', () => {
    seed('proficiency', [x, quiz], [three], { [SID + ':q']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, quiz])).toMatchObject({ text: '3.0', prof: 3 });
    expect(assessmentGroupGrade(CID, SID, [quiz])).toBeNull();
    expect(getTagProficiency(CID, SID, 't1')).toBe(3);
    expect(classColumnAverage(CID, [{ id: SID }], { assessment: quiz, measure: 'level' })).toMatchObject({ avg: 0 });
    expect(getClassPointsAverage(CID, [{ id: SID }], quiz)).toMatchObject({ avg: 0, pct: 0 });
  });

  it('Missing points work is no evidence in a Both class too, and 0 in its %', () => {
    seed('both', [x, quiz], [three], { [SID + ':q']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, quiz])).toMatchObject({ prof: 3 });
    expect(assessmentGroupGrade(CID, SID, [x, quiz]).text).toMatch(/^3\.0 · /);
    expect(getAssessmentGroupPercentage(CID, SID, [x, quiz]).pct).toBeCloseTo(75 / 3.5, 9);
  });

  it('Missing work is a 0 level in a Letter class, points, proficiency and rubric alike', () => {
    seed('letter', [x, quiz], [three], { [SID + ':q']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, quiz]).prof).toBe(1.5);
    seed('letter', [x, y], [three], { [SID + ':y']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, y]).prof).toBe(1.5);
    const essay = { id: 'r', title: 'Essay', tagIds: ['t1'], rubricId: 'rub' };
    seed('letter', [x, essay], [three], { [SID + ':r']: 'NS' });
    _cache.rubrics[CID] = [{ id: 'rub', name: 'Essay', criteria: [{ id: 'crit', name: 'Thesis', tagIds: ['t1'] }] }];
    clearProfCache();
    expect(assessmentGroupGrade(CID, SID, [x, essay]).prof).toBe(1.5);
  });

  it('column Class Averages follow the grading style', () => {
    const essay = { id: 'r', title: 'Essay', tagIds: ['t1'], rubricId: 'rub' };
    const avg = a => classColumnAverage(CID, [{ id: SID }], { assessment: a });
    ['letter', 'proficiency', 'both'].forEach(mode => {
      seed(mode, [y, quiz, essay], [], { [SID + ':y']: 'NS', [SID + ':q']: 'NS', [SID + ':r']: 'NS' });
      _cache.rubrics[CID] = [{ id: 'rub', name: 'Essay', criteria: [{ id: 'crit', name: 'Thesis', tagIds: ['t1'] }] }];
      clearProfCache();
      // Points columns count Missing as 0 in every class.
      expect(avg(quiz), mode).toMatchObject({ avg: 0, pct: 0, count: 1 });
      if (mode === 'letter') {
        expect(avg(y)).toEqual({ avg: 0, count: 1 });
        expect(avg(essay)).toEqual({ avg: 0, count: 1 });
      } else {
        expect(avg(y), mode).toBeNull();
        expect(avg(essay), mode).toBeNull();
      }
    });
  });

  it('a Letter class counts it 0 in the category level, while the competency leaves it out', () => {
    const cx = { ...x, categoryId: 'cat' };
    const cy = { ...y, categoryId: 'cat' };
    seed('letter', [cx, cy], [three], { [SID + ':y']: 'NS' });
    _cache.categories[CID] = [{ id: 'cat', name: 'Labs', weight: 100 }];
    clearProfCache();
    expect(getCategoryAverage(CID, SID, 'cat')).toBe(1.5);
    expect(getTagProficiency(CID, SID, 't1')).toBe(3);
    ['proficiency', 'both'].forEach(mode => {
      COURSES[CID].gradingSystem = mode;
      clearProfCache();
      expect(getCategoryAverage(CID, SID, 'cat')).toBe(3);
    });
  });
});
