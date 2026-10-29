/**
 * Counts As: the percent each proficiency counts as in the course %
 * (grading_scale.percents, docs/DECISIONS.md "Proficiency percents").
 * The default is level ÷ 4; a class can set its own, and + / − sit a third
 * of the way to the next level's percent. Level averages, competencies and
 * the rubric overall stay on the 0–4 scale.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-pct';
const SID = 'stu-1';
const MATCHED = { 4: 98, 3: 84, 2: 62, 1: 50 };

const crit = (id, tagIds, levelValues) => ({
  id,
  name: id,
  tagIds,
  levels: { 4: '', 3: '', 2: '', 1: '' },
  weight: 1,
  levelValues: levelValues || null,
});
const rubricAssessment = { id: 'r-a', title: 'Essay', rubricId: 'r1', tagIds: ['t1', 't2'], type: 'summative' };
const profAssessment = { id: 'p-a', title: 'Quiz', tagIds: ['t3'], type: 'summative' };
const score = (aid, tagId, value, mod) => ({
  assessmentId: aid,
  tagId,
  score: value,
  mod: mod || 0,
  date: '2026-10-10',
});

function seed({ percents, criteria, assessments, scores }) {
  _cache.rubrics[CID] = [
    { id: 'r1', name: 'Essay rubric', criteria: criteria || [crit('A', ['t1']), crit('B', ['t2'])] },
  ];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  _cache.categories[CID] = [];
  _cache.courseConfigs[CID] = {
    gradingSystem: 'letter',
    gradingScale: percents
      ? { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: percents, labels: null }
      : DEFAULT_GRADING_SCALE,
  };
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter' };
  clearProfCache();
}

describe('levelToPercent', () => {
  beforeEach(() => localStorage.clear());

  it('is level ÷ 4 by default, + and − included', () => {
    seed({ assessments: [], scores: [] });
    expect(levelToPercent(CID, 4)).toBe(100);
    expect(levelToPercent(CID, 3)).toBe(75);
    expect(levelToPercent(CID, 3 + 1 / 3)).toBeCloseTo(83.333, 3);
    expect(levelToPercent(CID, 1)).toBe(25);
    expect(levelToPercent(CID, 0)).toBe(0);
    expect(levelToPercent(CID, null)).toBe(null);
  });

  it("uses the class's percents, a third of the way to the next for + and −", () => {
    seed({ percents: MATCHED, assessments: [], scores: [] });
    expect(levelToPercent(CID, 4)).toBe(98);
    expect(levelToPercent(CID, 3)).toBe(84);
    expect(levelToPercent(CID, 3 + 1 / 3)).toBeCloseTo(84 + 14 / 3, 5);
    expect(levelToPercent(CID, 3 - 1 / 3)).toBeCloseTo(84 - 22 / 3, 5);
    expect(levelToPercent(CID, 2.5)).toBeCloseTo(73, 5);
    expect(levelToPercent(CID, 1)).toBe(50);
    expect(levelToPercent(CID, 0.5)).toBeCloseTo(25, 5);
    expect(levelToPercent(CID, 5)).toBe(98);
  });

  it('falls back to the defaults for a scale saved before Counts As', () => {
    seed({ assessments: [], scores: [] });
    _cache.courseConfigs[CID].gradingScale = { boundaries: DEFAULT_GRADING_SCALE.boundaries, labels: null };
    clearProfCache();
    expect(levelToPercent(CID, 3)).toBe(75);
  });
});

describe('Counts As in the course %', () => {
  beforeEach(() => localStorage.clear());

  it('counts proficiency work at its percent', () => {
    seed({ percents: MATCHED, assessments: [profAssessment], scores: [score('p-a', 't3', 3)] });
    expect(getCourseLetterData(CID, SID).R).toBe(84);
    expect(formatLevel(CID, 3)).toBe('84%');
    expect(formatLevelAs(CID, 3, 'percent')).toBe('84%');
  });

  it('counts each standard rubric criterion at its percent', () => {
    seed({
      percents: MATCHED,
      assessments: [rubricAssessment],
      scores: [score('r-a', 't1', 3), score('r-a', 't2', 2)],
    });
    // (84 + 62) / 2
    expect(getCourseLetterData(CID, SID).R).toBe(73);
  });

  it("keeps a criterion's own point values", () => {
    seed({
      percents: MATCHED,
      criteria: [crit('A', ['t1'], { 4: 10, 3: 7, 2: 4, 1: 1 }), crit('B', ['t2'])],
      assessments: [rubricAssessment],
      scores: [score('r-a', 't1', 3), score('r-a', 't2', 3)],
    });
    // A: 7 of 10. B: 84% of 4 = 3.36. (7 + 3.36) / (10 + 4)
    expect(getCourseLetterData(CID, SID).R).toBe(74);
  });

  it('leaves the level scale alone', () => {
    seed({
      percents: MATCHED,
      assessments: [rubricAssessment],
      scores: [score('r-a', 't1', 3), score('r-a', 't2', 2)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'r-a')).toBeCloseTo(2.5, 5);
  });

  it('gives the same course % as before with the default percents', () => {
    seed({
      assessments: [rubricAssessment, profAssessment],
      scores: [score('r-a', 't1', 3, -1), score('r-a', 't2', 2, 1), score('p-a', 't3', 3, 1)],
    });
    // Rubric (2.667 + 2.333) / 8, quiz 3.333 / 4, pooled: 8.333 / 12
    expect(getCourseLetterData(CID, SID).R).toBe(69.4);
  });
});

describe('Counts As by step', () => {
  beforeEach(() => localStorage.clear());

  it('fills a step with no value a third of the way between its levels', () => {
    expect(countsAsStepPercents({ 4: 100, 3: 75, 2: 50, 1: 25 }).map(v => Math.round(v * 10) / 10)).toEqual([
      25, 33.3, 41.7, 50, 58.3, 66.7, 75, 83.3, 91.7, 100,
    ]);
    expect(countsAsStepPercents({ 4: 100, 3: 75, '3+': 86, 2: 50, 1: 25 })[7]).toBe(86);
  });

  it('counts each step on the BC Letter Bands as its own value', () => {
    seed({ percents: BC_LETTER_BAND_PERCENTS, assessments: [], scores: [] });
    expect(levelToPercent(CID, 3 + 1 / 3)).toBeCloseTo(86, 9);
    expect(levelToPercent(CID, 3)).toBe(80);
    expect(levelToPercent(CID, 4 - 1 / 3)).toBeCloseTo(92, 9);
    expect(levelToPercent(CID, 2 - 1 / 3)).toBeCloseTo(55, 9);
    expect(levelToPercent(CID, 1)).toBe(45);
    // Between 2+ (67) and 3− (73): halfway.
    expect(levelToPercent(CID, 2.5)).toBeCloseTo(70, 9);
    expect(formatLevel(CID, 3 + 1 / 3)).toBe('86%');
    expect(percentageToLetter(levelToPercent(CID, 3 + 1 / 3), CID)).toBe('A');
  });

  it('counts a rubric criterion scored 3+ at its step', () => {
    seed({
      percents: BC_LETTER_BAND_PERCENTS,
      assessments: [rubricAssessment],
      scores: [score('r-a', 't1', 3, 1), score('r-a', 't2', 2, -1)],
    });
    // (86 + 55) / 2
    expect(getCourseLetterData(CID, SID).R).toBe(70.5);
  });
});
