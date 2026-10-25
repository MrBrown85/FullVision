/**
 * A student's grade on a group of assessments (a category, module,
 * assignment type or rubric), as the student page's Grade Breakdown tab and
 * the Assessments tab's Group By show it. The % is points earned out of
 * points possible, as the course % counts each category; the level is the
 * mean of the assessments' overall levels, as a category's average is.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-groups';
const A = 'stu-a';
const B = 'stu-b';
const TAG = 'tag-1';

const points = (id, max, categoryId) => ({
  id,
  title: id,
  scoreMode: 'points',
  maxPoints: max,
  tagIds: [TAG],
  categoryId,
  type: 'summative',
});
const level = (id, categoryId, extra) =>
  Object.assign({ id, title: id, tagIds: [TAG], categoryId, type: 'summative' }, extra);
const score = (assessmentId, value, mod) => ({
  assessmentId,
  tagId: TAG,
  score: value,
  mod: mod || 0,
  date: '2026-10-10',
});

function seed({ gradingSystem, categories, assessments, scores, rubrics, statuses }) {
  COURSES[CID] = { id: CID, name: 'Philosophy 12', gradingSystem: gradingSystem || 'letter' };
  _cache.categories[CID] = categories || [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = scores;
  _cache.statuses[CID] = statuses || {};
  _cache.rubrics[CID] = rubrics || [];
  _cache.courseConfigs[CID] = { roundPercent: false };
  clearProfCache();
}

describe('assessment group grades', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    delete COURSES[CID];
  });

  const cats = [
    { id: 'tests', name: 'Tests', weight: 60 },
    { id: 'labs', name: 'Labs', weight: 40 },
  ];
  const work = [points('t1', 20, 'tests'), points('t2', 30, 'tests'), points('l1', 10, 'labs')];

  it('counts points earned out of possible and shows the letter in a Letter class', () => {
    seed({
      categories: cats,
      assessments: work,
      scores: { [A]: [score('t1', 15), score('t2', 18), score('l1', 9)] },
    });
    const g = assessmentGroupGrade(CID, A, work.slice(0, 2));
    // 33 of 50
    expect(g.pct).toBeCloseTo(66, 5);
    expect(g.text).toBe('C 66%');
    expect(g.level).toBe(2);
  });

  it('shows the level in a Proficiency class and both in a Both class', () => {
    const lv = [level('x', 'tests'), level('y', 'tests')];
    seed({ gradingSystem: 'proficiency', assessments: lv, scores: { [A]: [score('x', 3), score('y', 2)] } });
    expect(assessmentGroupGrade(CID, A, lv).text).toBe('2.5');
    seed({ gradingSystem: 'both', assessments: lv, scores: { [A]: [score('x', 3), score('y', 2)] } });
    // 5 of 8 points
    expect(assessmentGroupGrade(CID, A, lv).text).toBe('2.5 · C 62.5%');
  });

  it('is null when nothing in the group is scored', () => {
    seed({ assessments: work, scores: { [A]: [] } });
    expect(assessmentGroupGrade(CID, A, work)).toBeNull();
  });

  it('averages the class and says how a student sits against it', () => {
    seed({
      categories: cats,
      assessments: work,
      scores: { [A]: [score('t1', 10)], [B]: [score('t1', 20)] },
    });
    const list = [work[0]];
    const mine = assessmentGroupGrade(CID, A, list);
    const cls = classAssessmentGroupGrade(CID, [A, B], list);
    expect(cls.pct).toBeCloseTo(75, 5);
    expect(groupGradeGap(CID, mine, cls).text).toBe('25.0% below class');
    expect(groupGradeGap(CID, cls, cls).text).toBe('Same as class');
  });

  it("splits the course % into each category's share", () => {
    seed({
      categories: cats,
      assessments: work,
      scores: { [A]: [score('t1', 15), score('t2', 18), score('l1', 9)] },
    });
    const shares = categoryCourseShares(CID, A);
    // 60% × 66% and 40% × 90%
    expect(shares.tests.text).toBe('39.6');
    expect(shares.labs.text).toBe('36.0');
    expect(shares.tests.points + shares.labs.points).toBeCloseTo(getCourseLetterData(CID, A).R, 5);
  });

  it('reads one rubric criterion on one assessment, skipping excused work', () => {
    const rubric = {
      id: 'r1',
      name: 'Lab rubric',
      criteria: [{ id: 'c1', name: 'Inquiry', tagIds: [TAG], levels: { 4: '', 3: '', 2: '', 1: '' }, weight: 1 }],
    };
    const labs = [level('a1', 'labs', { rubricId: 'r1' }), level('a2', 'labs', { rubricId: 'r1' })];
    seed({
      assessments: labs,
      rubrics: [rubric],
      scores: { [A]: [score('a1', 3, 1), score('a2', 2)] },
      statuses: { [A + ':a2']: 'EXC' },
    });
    expect(rubricCriterionLevel(CID, A, labs[0], rubric.criteria[0])).toBeCloseTo(3 + 1 / 3, 5);
    expect(rubricCriterionLevel(CID, A, labs[1], rubric.criteria[0])).toBeNull();
  });

  it('compares a group with all of the student’s work and places it on the 0–4 scale', () => {
    seed({
      categories: cats,
      assessments: work,
      scores: { [A]: [score('t1', 15), score('t2', 18), score('l1', 9)] },
    });
    const all = assessmentGroupGrade(CID, A, work);
    const labs = assessmentGroupGrade(CID, A, [work[2]]);
    // 42 of 60 = 70%; labs 90%
    expect(groupGradeDiff(CID, labs, all)).toEqual({ value: 20, text: '+20.0%', dir: 1 });
    expect(groupGradeDiff(CID, all, labs).text).toBe('−20.0%');
    expect(groupGradeValue(CID, labs)).toBeCloseTo(3.6, 5);
    const lv = [level('x', 'tests'), level('y', 'tests')];
    seed({ gradingSystem: 'proficiency', assessments: lv, scores: { [A]: [score('x', 3), score('y', 2)] } });
    const g = assessmentGroupGrade(CID, A, lv);
    expect(groupGradeValue(CID, g)).toBe(2.5);
    expect(groupGradeDiff(CID, assessmentGroupGrade(CID, A, [lv[0]]), g).text).toBe('+0.5');
  });

  it('names a value by the nearest level a teacher can enter', () => {
    expect(nearestScoreLevel(3 + 1 / 3)).toEqual({ level: 3, text: '3+' });
    expect(nearestScoreLevel(2 + 2 / 3)).toEqual({ level: 3, text: '3−' });
    expect(nearestScoreLevel(2)).toEqual({ level: 2, text: '2' });
    expect(nearestScoreLevel(0).text).toBe('');
  });
});
