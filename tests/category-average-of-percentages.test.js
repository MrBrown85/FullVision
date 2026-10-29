/**
 * A category set to Average of Percentages (category.calc_mode 'percent',
 * docs/DECISIONS.md "Category calculation"): each assessment becomes its
 * own percent, and the percents are averaged, each counted its Factor
 * times. Total Points (the default) pools points earned and possible, so a
 * 5-criterion rubric (20 points) outweighs a 2-criterion one (8 points).
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-avg-pct';
const SID = 'stu-1';

const crit = (id, tagId) => ({ id, name: id, tagIds: [tagId], levels: { 4: '', 3: '', 2: '', 1: '' }, weight: 1 });
const RUBRICS = [
  { id: 'r-small', name: 'Two criteria', criteria: [crit('s1', 't1'), crit('s2', 't2')] },
  {
    id: 'r-big',
    name: 'Five criteria',
    criteria: [crit('b1', 't1'), crit('b2', 't2'), crit('b3', 't3'), crit('b4', 't4'), crit('b5', 't5')],
  },
];
const small = { id: 'a-small', title: 'Assignment', rubricId: 'r-small', categoryId: 'k1', tagIds: ['t1', 't2'] };
const big = {
  id: 'a-big',
  title: 'Current Events',
  rubricId: 'r-big',
  categoryId: 'k1',
  tagIds: ['t1', 't2', 't3', 't4', 't5'],
};
const quiz = { id: 'a-quiz', title: 'Quiz', scoreMode: 'points', maxPoints: 10, categoryId: 'k1', tagIds: [] };
const test = { id: 'a-test', title: 'Unit Test', scoreMode: 'points', maxPoints: 36, categoryId: 'k1', tagIds: [] };
const s = (aid, tagId, value) => ({ assessmentId: aid, tagId, score: value, mod: 0, date: '2026-10-10' });
// Small rubric: 3 and 3 (6 of 8, 75%). Big rubric: five 2s (10 of 20, 50%).
const RUBRIC_SCORES = [
  s('a-small', 't1', 3),
  s('a-small', 't2', 3),
  ...['t1', 't2', 't3', 't4', 't5'].map(t => s('a-big', t, 2)),
];

function seed({ mode, assessments, scores, statuses, categories }) {
  _cache.rubrics[CID] = RUBRICS;
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = statuses || {};
  _cache.categories[CID] = categories || [
    { id: 'k1', name: 'Assignments', weight: 100, displayOrder: 0, calcMode: mode },
  ];
  _cache.courseConfigs[CID] = { gradingSystem: 'letter', roundPercent: false };
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter' };
  clearProfCache();
}
const R = () => getCourseLetterData(CID, SID).R;

describe('Average of Percentages', () => {
  beforeEach(() => localStorage.clear());

  it('pools points under Total Points, so the bigger rubric weighs more', () => {
    seed({ mode: 'points', assessments: [small, big], scores: RUBRIC_SCORES });
    // (6 + 10) / (8 + 20)
    expect(R()).toBe(57.1);
  });

  it('counts each assessment once under Average of Percentages', () => {
    seed({ mode: 'percent', assessments: [small, big], scores: RUBRIC_SCORES });
    // (75 + 50) / 2
    expect(R()).toBe(62.5);
  });

  it('treats an unset or unknown mode as Total Points', () => {
    seed({ mode: undefined, assessments: [small, big], scores: RUBRIC_SCORES });
    expect(R()).toBe(57.1);
    seed({ mode: 'median', assessments: [small, big], scores: RUBRIC_SCORES });
    expect(R()).toBe(57.1);
  });

  it('counts an assessment its Factor times', () => {
    seed({ mode: 'percent', assessments: [small, { ...big, weight: 2 }], scores: RUBRIC_SCORES });
    // (75 + 2 × 50) / 3
    expect(R()).toBe(58.3);
  });

  it('flattens points work too', () => {
    const scores = [s('a-quiz', 'a-quiz', 9), s('a-test', 'a-test', 18)];
    seed({ mode: 'points', assessments: [quiz, test], scores });
    // (9 + 18) / (10 + 36)
    expect(R()).toBe(58.7);
    seed({ mode: 'percent', assessments: [quiz, test], scores });
    // (90 + 50) / 2
    expect(R()).toBe(70);
  });

  it('counts Missing as 0% and leaves Excused out', () => {
    seed({
      mode: 'percent',
      assessments: [small, big, quiz],
      scores: RUBRIC_SCORES,
      statuses: { [SID + ':a-quiz']: 'NS' },
    });
    // (75 + 50 + 0) / 3
    expect(R()).toBe(41.7);
    seed({
      mode: 'percent',
      assessments: [small, big, quiz],
      scores: RUBRIC_SCORES,
      statuses: { [SID + ':a-quiz']: 'EXC' },
    });
    expect(R()).toBe(62.5);
  });

  it('weights categories with different modes as before', () => {
    seed({
      assessments: [small, big, { ...quiz, categoryId: 'k2' }],
      scores: [...RUBRIC_SCORES, s('a-quiz', 'a-quiz', 8)],
      categories: [
        { id: 'k1', name: 'Assignments', weight: 60, displayOrder: 0, calcMode: 'percent' },
        { id: 'k2', name: 'Quizzes', weight: 40, displayOrder: 1, calcMode: 'points' },
      ],
    });
    // 0.6 × 62.5 + 0.4 × 80
    expect(R()).toBe(69.5);
    expect(categoryCourseShares(CID, SID)).toEqual({
      k1: { points: 37.5, text: '37.5' },
      k2: { points: 32, text: '32.0' },
    });
  });

  it("grades a category group by the category's mode and other groups by points", () => {
    seed({ mode: 'percent', assessments: [small, big], scores: RUBRIC_SCORES });
    expect(assessmentGroupGrade(CID, SID, [small, big], 'percent').pct).toBeCloseTo(62.5, 5);
    expect(assessmentGroupGrade(CID, SID, [small, big]).pct).toBeCloseTo(57.142857, 5);
  });
});
