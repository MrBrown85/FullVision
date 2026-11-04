/**
 * Missing proficiency work in level averages (2026-11-01). A student page
 * group grade or a single assignment's pill in a Proficiency class counted
 * a Missing level as 0: a 3 and a Missing showed 1.5, and the Missing work
 * alone showed "0.0", while the competency said 3. Missing proficiency
 * work is no evidence there, as in competency proficiency and Class
 * Averages (docs/DECISIONS.md, "Class Averages and statuses"); it still
 * counts 0 in the % (D7). In a Proficiency class Missing points work is no
 * evidence there too (Colin, 2026-11-03); its Class Average still counts it
 * as 0.
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

describe('Missing proficiency work in level averages', () => {
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

  it('Missing work is a 0 level in a Letter class, points and proficiency alike', () => {
    seed('letter', [x, quiz], [three], { [SID + ':q']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, quiz]).prof).toBe(1.5);
    seed('letter', [x, y], [three], { [SID + ':y']: 'NS' });
    expect(assessmentGroupGrade(CID, SID, [x, y]).prof).toBe(1.5);
  });
});
