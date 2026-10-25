/**
 * Every assessment has a Factor, as in Schoology (docs/DECISIONS.md,
 * Assessment Factor, 2026-10-25; supersedes D2). Its points earned and
 * possible are multiplied in the course %, and its scores count that many
 * times toward competencies and level averages.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-factor';
const SID = 'stu-1';
const TAG = 'tag-1';

describe('getAssessmentWeight', () => {
  it('uses the Factor on every kind of scoring', () => {
    expect(getAssessmentWeight({ weight: 2 })).toBe(2);
    expect(getAssessmentWeight({ scoreMode: 'proficiency', weight: 0.5 })).toBe(0.5);
    expect(getAssessmentWeight({ scoreMode: 'points', maxPoints: 6, weight: 4 })).toBe(4);
    expect(getAssessmentWeight({ score_mode: 'complete', weight: '1.5' })).toBe(1.5);
  });

  it('is 1 when unset, 0 or not a number', () => {
    expect(getAssessmentWeight({ scoreMode: 'proficiency' })).toBe(1);
    expect(getAssessmentWeight({ weight: 0 })).toBe(1);
    expect(getAssessmentWeight({ weight: 'x' })).toBe(1);
    expect(getAssessmentWeight(null)).toBe(1);
  });
});

function seedCourse(assessments, scores, categories) {
  saveCourses({ [CID]: { id: CID, name: 'English 12', calcMethod: 'mode', gradingSystem: 'letter' } });
  _cache.courseConfigs[CID] = { calcMethod: 'mode' };
  _cache.categories[CID] = categories || [];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  clearProfCache();
}

describe('Factor in the course %', () => {
  beforeEach(() => localStorage.clear());

  const iliad = factor => [
    { id: 'ann', title: 'Annotations', scoreMode: 'points', maxPoints: 6, weight: factor, tagIds: [TAG] },
    { id: 'qs', title: 'Questions', scoreMode: 'points', maxPoints: 24, tagIds: [TAG] },
  ];
  const scores = [
    { assessmentId: 'ann', tagId: TAG, score: 3, date: '2026-10-01' },
    { assessmentId: 'qs', tagId: TAG, score: 24, date: '2026-10-02' },
  ];

  it('multiplies points earned and possible', () => {
    // 3/6 at 4x is 12/24; with 24/24 that is 36/48 = 75%.
    seedCourse(iliad(4), scores);
    expect(getCourseLetterData(CID, SID).R).toBe(75);
  });

  it('counts once at 1', () => {
    // 27/30 = 90%.
    seedCourse(iliad(1), scores);
    expect(getCourseLetterData(CID, SID).R).toBe(90);
  });

  it('multiplies a proficiency level the same way', () => {
    seedCourse(
      [
        { id: 'essay', title: 'Essay', tagIds: [TAG], weight: 3 },
        { id: 'quiz', title: 'Quiz', scoreMode: 'points', maxPoints: 4, tagIds: [TAG] },
      ],
      [
        { assessmentId: 'essay', tagId: TAG, score: 2, date: '2026-10-01' },
        { assessmentId: 'quiz', tagId: TAG, score: 4, date: '2026-10-02' },
      ],
    );
    // 2/4 three times and 4/4: 10/16 = 62.5%.
    expect(getAssessmentGroupPercentage(CID, SID, _cache.assessments[CID]).pct).toBe(62.5);
  });

  it('applies inside a category', () => {
    seedCourse(
      iliad(4).map(a => ({ ...a, categoryId: 'sum' })),
      scores,
      [{ id: 'sum', name: 'Summative', weight: 100 }],
    );
    expect(getCourseLetterData(CID, SID).R).toBe(75);
  });
});

describe('Factor toward a competency level', () => {
  beforeEach(() => localStorage.clear());

  function level(levelFactor, pointsFactor) {
    seedCourse(
      [
        { id: 'lvl', title: 'Essay', tagIds: [TAG], type: 'summative', weight: levelFactor },
        {
          id: 'pts',
          title: 'Quiz',
          scoreMode: 'points',
          maxPoints: 10,
          tagIds: [TAG],
          type: 'summative',
          weight: pointsFactor,
        },
      ],
      [
        { assessmentId: 'lvl', tagId: TAG, score: 4, date: '2026-10-01', type: 'summative' },
        { assessmentId: 'pts', tagId: TAG, score: 5, date: '2026-10-02', type: 'summative' },
      ],
    );
    return getTagProficiency(CID, SID, TAG);
  }

  // Mode: the Essay's 4 and the Quiz's 2 (5/10) each count their Factor;
  // a tie goes to the most recent, the Quiz.
  it('counts proficiency work its Factor times', () => {
    expect(level(1, undefined)).toBe(2);
    expect(level(2, undefined)).toBe(4);
  });

  it('counts points work its Factor times', () => {
    expect(level(2, 3)).toBe(2);
  });

  it('weights a category average', () => {
    level(3, 1);
    // (3 × 4 + 1 × 2) / 4 = 3.5.
    expect(_factoredMeanLevel(CID, SID, _cache.assessments[CID]).mean).toBe(3.5);
    expect(assessmentGroupGrade(CID, SID, _cache.assessments[CID]).prof).toBe(3.5);
  });
});
