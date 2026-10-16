/**
 * The 0.5×–3× assessment weight is a proficiency weight
 * (docs/grading-compliance-plan.md D2). Neither Schoology nor Teams has a
 * per-assessment weight; a teacher changes max points instead. The form now
 * hides the control on points and Complete/Incomplete work, and a weight
 * left on such work from before no longer counts anywhere.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-weight';
const SID = 'stu-1';
const TAG = 'tag-1';

describe('getAssessmentWeight', () => {
  it('uses the weight on proficiency work', () => {
    expect(getAssessmentWeight({ weight: 2 })).toBe(2);
    expect(getAssessmentWeight({ scoreMode: 'proficiency', weight: 0.5 })).toBe(0.5);
    expect(getAssessmentWeight({ scoreMode: 'proficiency' })).toBe(1);
  });

  it('counts points and Complete/Incomplete work once', () => {
    expect(getAssessmentWeight({ scoreMode: 'points', maxPoints: 20, weight: 3 })).toBe(1);
    expect(getAssessmentWeight({ score_mode: 'points', weight: 2 })).toBe(1);
    expect(getAssessmentWeight({ scoreMode: 'complete', weight: 1.5 })).toBe(1);
  });
});

describe('proficiency weight in a competency level', () => {
  beforeEach(() => localStorage.clear());

  function seed(levelWeight, pointsWeight) {
    saveCourses({ [CID]: { id: CID, name: 'English 10', calcMethod: 'mode' } });
    _cache.courseConfigs[CID] = { calcMethod: 'mode' };
    _cache.assessments[CID] = [
      { id: 'lvl', title: 'Essay', tagIds: [TAG], type: 'summative', weight: levelWeight },
      {
        id: 'pts',
        title: 'Quiz',
        scoreMode: 'points',
        maxPoints: 10,
        tagIds: [TAG],
        type: 'summative',
        weight: pointsWeight,
      },
    ];
    _cache.scores[CID] = {
      [SID]: [
        { assessmentId: 'lvl', tagId: TAG, score: 4, date: '2026-10-01', type: 'summative' },
        { assessmentId: 'pts', tagId: TAG, score: 5, date: '2026-10-02', type: 'summative' },
      ],
    };
    _cache.statuses[CID] = {};
    clearProfCache();
    return getTagProficiency(CID, SID, TAG);
  }

  // Mode: the Essay's 4 and the Quiz's 2 (5/10) each count their weight;
  // a tie goes to the most recent, the Quiz.
  it('changes the level when set on proficiency work', () => {
    expect(seed(1, undefined)).toBe(2);
    expect(seed(2, undefined)).toBe(4);
  });

  it('is ignored when left on points work', () => {
    // Counting the Quiz 3 times would make 2 the mode.
    expect(seed(2, 3)).toBe(4);
  });
});
