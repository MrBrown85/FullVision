/**
 * A points assessment's level follows the class's Points to Proficiency
 * table everywhere (Colin, 2026-11-01). A 72% test showed 2.9 (Proficient's
 * colour) as a student page grade, while its competency and its gradebook
 * cell said Developing from the table. The % is unchanged.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'points-level';
const SID = 'stu-1';
const test72 = { id: 'p', title: 'Unit Test', scoreMode: 'points', maxPoints: 100, tagIds: ['t1'] };

function seed(system, config) {
  COURSES[CID] = { id: CID, gradingSystem: system, gradeLevel: '8' };
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec', name: 'S', tags: [{ id: 't1' }] }],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [test72];
  _cache.scores[CID] = { [SID]: [{ assessmentId: 'p', tagId: 't1', score: 72, date: '2026-10-01' }] };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.courseConfigs[CID] = Object.assign({ calcMethod: 'average' }, config);
  clearProfCache();
}

describe('points work level', () => {
  afterEach(() => delete COURSES[CID]);

  it('reads the same level as its competency and its cell', () => {
    seed('proficiency');
    const g = assessmentGroupGrade(CID, SID, [test72]);
    expect(g).toMatchObject({ text: '2.0', level: 2 });
    expect(assessmentCellValue(CID, SID, test72).level).toBe(2);
    expect(getTagProficiency(CID, SID, 't1')).toBe(2);
    expect(levelWord(CID, g.prof)).toBe('Developing');
    expect(columnCountedValue(CID, SID, { assessment: test72, measure: 'level' })).toEqual({ value: 2 });
  });

  it("follows the class's own table, however it was saved", () => {
    const boundaries = [
      { min: 0, proficiency: 1 },
      { min: 50, proficiency: 2 },
      { min: 70, proficiency: 3 },
      { min: 90, proficiency: 4 },
    ];
    seed('proficiency', { gradingScale: { boundaries } });
    expect(getAssessmentOverallScore(CID, SID, 'p')).toBe(3);
    expect(getTagProficiency(CID, SID, 't1')).toBe(3);
  });

  it('leaves the % alone', () => {
    seed('both');
    expect(assessmentGroupGrade(CID, SID, [test72]).text).toBe('2.0 · C+ 72%');
    expect(getCourseLetterData(CID, SID).R).toBe(72);
  });
});
