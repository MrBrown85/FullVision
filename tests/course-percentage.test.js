/**
 * Course percentage (getCourseLetterData R). Points-scored work counts as
 * points earned out of points possible within each category; proficiency
 * work keeps the proficiency scale. Reported 2026-10-14: 2.75/6 + 14.25/24
 * (17/30 = 56.7%) showed as 69.5%, because each score went through a level
 * and the level-to-percentage scale.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-pct';
const SID = 'stu-1';
const TAG = 'tag-1';

function seed({ categories, assessments, scores, statuses }) {
  _cache.categories[CID] = categories;
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = statuses || {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

const points = (id, max, categoryId) => ({
  id,
  title: id,
  scoreMode: 'points',
  maxPoints: max,
  tagIds: [TAG],
  categoryId,
  type: 'summative',
});
const complete = (id, categoryId) => ({
  id,
  title: id,
  scoreMode: 'complete',
  maxPoints: 1,
  tagIds: [TAG],
  categoryId,
  type: 'summative',
});
const level = (id, categoryId) => ({ id, title: id, tagIds: [TAG], categoryId, type: 'summative' });
const score = (assessmentId, value) => ({ assessmentId, tagId: TAG, score: value, date: '2026-10-10' });

describe('course percentage', () => {
  beforeEach(() => localStorage.clear());

  const brett = {
    categories: [
      { id: 'form', name: 'Formative', weight: 0 },
      { id: 'summ', name: 'Summative', weight: 100 },
    ],
    assessments: [points('ann', 6, 'summ'), points('qs', 24, 'summ'), complete('goals', 'form')],
    scores: [score('ann', 2.75), score('qs', 14.25), score('goals', 1)],
  };

  it('counts points earned out of points possible', () => {
    seed(brett);
    expect(getCourseLetterData(CID, SID).R).toBe(56.7);
  });

  it('leaves out a category weighted 0%', () => {
    seed({ ...brett, scores: [score('ann', 2.75), score('qs', 14.25), score('goals', 0)] });
    expect(getCourseLetterData(CID, SID).R).toBe(56.7);
  });

  it('weights categories by their percentages', () => {
    seed({
      ...brett,
      categories: [
        { id: 'form', name: 'Formative', weight: 50 },
        { id: 'summ', name: 'Summative', weight: 50 },
      ],
    });
    // (56.67 + 100) / 2
    expect(getCourseLetterData(CID, SID).R).toBe(78.3);
  });

  it('skips excused work and counts not-submitted work as 0', () => {
    seed({ ...brett, statuses: { [SID + ':ann']: 'EXC' } });
    expect(getCourseLetterData(CID, SID).R).toBe(59.4);
    seed({ ...brett, statuses: { [SID + ':ann']: 'NS' } });
    expect(getCourseLetterData(CID, SID).R).toBe(47.5);
  });

  it('keeps the proficiency scale for a class with no points work', () => {
    seed({
      categories: [{ id: 'summ', name: 'Summative', weight: 100 }],
      assessments: [level('a', 'summ'), level('b', 'summ')],
      scores: [score('a', 3), score('b', 2)],
    });
    var data = getCourseLetterData(CID, SID);
    expect(data.Q).toBe(2.5);
    expect(data.R).toBe(Math.round(qToPercentage(2.5) * 10) / 10);
  });

  it('works without categories', () => {
    seed({ ...brett, categories: [], assessments: [points('ann', 6), points('qs', 24)] });
    expect(getCourseLetterData(CID, SID).R).toBe(56.7);
  });
});
