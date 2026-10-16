/**
 * Rubric assessment overall (getAssessmentOverallScore). Each criterion
 * counts once, at its level's point value, and criteria are combined by
 * their weights (docs/backend-design/read-paths.md §1.1, matching the
 * server's fv_assessment_overall). Reported 2026-10-15: the overall was a
 * plain average of every competency score, so criterion weights and level
 * point values changed nothing, and a criterion linked to two competencies
 * counted twice.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-rubric';
const SID = 'stu-1';

const rubric = criteria => ({ id: 'r1', name: 'Essay rubric', criteria });
const crit = (id, tagIds, weight, levelValues) => ({
  id,
  name: id,
  tagIds,
  levels: { 4: '', 3: '', 2: '', 1: '' },
  weight,
  levelValues: levelValues || null,
});
const assessment = { id: 'a1', title: 'Essay', rubricId: 'r1', tagIds: ['t1', 't2', 't3'], type: 'summative' };
const score = (tagId, value, mod) => ({ assessmentId: 'a1', tagId, score: value, mod: mod || 0, date: '2026-10-10' });

function seed({ criteria, scores, statuses, assessments }) {
  _cache.rubrics[CID] = [rubric(criteria)];
  _cache.assessments[CID] = assessments || [assessment];
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = statuses || {};
  _cache.categories[CID] = [];
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('rubric assessment overall', () => {
  beforeEach(() => localStorage.clear());

  it('weights criteria by their weight', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
      scores: [score('t1', 4), score('t2', 2)],
    });
    // (1 × 4 + 3 × 2) / 4 — a plain average would give 3.
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
  });

  it('counts a criterion linked to two competencies once', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2', 't3'], 1)],
      scores: [score('t1', 4), score('t2', 2), score('t3', 2)],
    });
    // (4 + 2) / 2 — counting B twice would give 2.67.
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(3, 5);
  });

  it("averages a criterion's competency scores when they differ", () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2', 't3'], 1)],
      scores: [score('t1', 4), score('t2', 3), score('t3', 1)],
    });
    // A = 4, B = (3 + 1) / 2 = 2
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(3, 5);
  });

  it("uses a criterion's level point values", () => {
    seed({
      criteria: [crit('A', ['t1'], 1, { 3: 3.5 }), crit('B', ['t2'], 1)],
      scores: [score('t1', 3), score('t2', 2)],
    });
    // A's level 3 is worth 3.5: (3.5 + 2) / 2
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.75, 5);
  });

  it('moves + and − a third of the way to the next level value', () => {
    seed({
      criteria: [crit('A', ['t1'], 1, { 4: 4, 3: 3.5 }), crit('B', ['t2'], 1)],
      scores: [score('t1', 3, 1), score('t2', 3, -1)],
    });
    // A: 3.5 + (4 − 3.5) / 3; B: 3 − 1/3
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo((3.5 + 0.5 / 3 + (3 - 1 / 3)) / 2, 5);
  });

  it('keeps default rubrics on the level scale', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 1)],
      scores: [score('t1', 3, 1), score('t2', 2)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo((10 / 3 + 2) / 2, 5);
  });

  it('keeps the overall on the 0–4 scale when a level is worth more than 4', () => {
    seed({
      criteria: [crit('A', ['t1'], 1, { 4: 6 }), crit('B', ['t2'], 1)],
      scores: [score('t1', 4), score('t2', 4)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(4);
  });

  it('skips criteria that are not scored yet', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
      scores: [score('t1', 4)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(4);
  });

  it('leaves out a criterion weighted 0', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 0)],
      scores: [score('t1', 4), score('t2', 1)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(4);
  });

  it('counts equally when every scored criterion is weighted 0', () => {
    seed({
      criteria: [crit('A', ['t1'], 0), crit('B', ['t2'], 0)],
      scores: [score('t1', 4), score('t2', 2)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(3);
  });

  it('treats a missing weight as 1', () => {
    seed({
      criteria: [crit('A', ['t1'], undefined), crit('B', ['t2'], 3)],
      scores: [score('t1', 4), score('t2', 2)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
  });

  it('finds the score of a criterion with no competencies by its id', () => {
    seed({
      criteria: [crit('A', [], 1), crit('B', ['t2'], 3)],
      scores: [score('A', 4), score('t2', 2)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
  });

  it('returns null when nothing is scored', () => {
    seed({ criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)], scores: [] });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeNull();
  });

  it('keeps excused as null and not submitted as 0', () => {
    const criteria = [crit('A', ['t1'], 1), crit('B', ['t2'], 3)];
    const scores = [score('t1', 4), score('t2', 2)];
    seed({ criteria, scores, statuses: { [SID + ':a1']: 'EXC' } });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeNull();
    seed({ criteria, scores, statuses: { [SID + ':a1']: 'NS' } });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(0);
  });

  it('changes when a criterion weight is saved', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 1)],
      scores: [score('t1', 4), score('t2', 2)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(3);
    saveRubrics(CID, [rubric([crit('A', ['t1'], 1), crit('B', ['t2'], 3)])]);
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBeCloseTo(2.5, 5);
  });

  it('carries the weighting into the course grade', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
      scores: [score('t1', 4), score('t2', 2)],
    });
    const letter = getCourseLetterData(CID, SID);
    expect(letter.Q).toBeCloseTo(2.5, 5);
    expect(letter.R).toBe(62.5);
  });

  it('gives the gradebook and report views the same weighted value', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
      scores: [score('t1', 4), score('t2', 2), { ...score('t1', 1), assessmentId: 'other' }],
    });
    expect(getRubricAssessmentScore(CID, assessment, _cache.scores[CID][SID])).toBeCloseTo(2.5, 5);
    expect(getRubricAssessmentScore(CID, assessment, [])).toBeNull();
    expect(getRubricAssessmentScore(CID, { id: 'a2', tagIds: ['t1'] }, _cache.scores[CID][SID])).toBeUndefined();
  });

  it('leaves non-rubric assessments as a plain average', () => {
    const plain = { id: 'a1', title: 'Quiz', tagIds: ['t1', 't2'], type: 'summative' };
    seed({
      assessments: [plain],
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
      scores: [score('t1', 4), score('t2', 2)],
    });
    expect(getAssessmentOverallScore(CID, SID, 'a1')).toBe(3);
  });

  it('leaves competency proficiency unweighted', () => {
    seed({
      criteria: [crit('A', ['t1'], 1), crit('B', ['t2'], 3)],
      scores: [score('t1', 4), score('t2', 2)],
    });
    expect(getTagScores(CID, SID, 't1').map(s => s.score)).toEqual([4]);
    expect(getTagScores(CID, SID, 't2').map(s => s.score)).toEqual([2]);
  });
});
