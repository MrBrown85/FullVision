/**
 * Extra credit (docs/grading-compliance-plan.md D4). Points work can be
 * scored above its maximum, up to twice it, as Schoology allows; the course
 * % can then pass 100. The input marks a score above the maximum "bonus".
 * Complete/Incomplete work stays 0 or 1.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-extra';
const SID = 'stu-1';
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
const score = (assessmentId, value) => ({ assessmentId, tagId: TAG, score: value, date: '2026-10-10' });

function seed({ categories = [], assessments, scores }) {
  _cache.categories[CID] = categories;
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { [SID]: scores };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

describe('extra credit on points work', () => {
  beforeEach(() => localStorage.clear());

  it('accepts a typed score up to twice the maximum', () => {
    expect(parsePointsInput('12', 10)).toBe(12);
    expect(parsePointsInput('20', 10)).toBe(20);
    expect(parsePointsInput('25', 10)).toBe(20);
  });

  it('counts the bonus points in the course %', () => {
    seed({ assessments: [points('a', 10), points('b', 10)], scores: [score('a', 12), score('b', 7)] });
    // 19 / 20
    expect(getCourseLetterData(CID, SID).R).toBe(95);
  });

  it('lets the course % pass 100', () => {
    seed({ assessments: [points('a', 10)], scores: [score('a', 11)] });
    var data = getCourseLetterData(CID, SID);
    expect(data.R).toBe(110);
    expect(data.S).toBe('A');
  });

  it('weights a category with bonus points like any other', () => {
    seed({
      categories: [
        { id: 'tests', name: 'Tests', weight: 50 },
        { id: 'hw', name: 'Homework', weight: 50 },
      ],
      assessments: [points('t', 20, 'tests'), points('h', 10, 'hw')],
      scores: [score('t', 22), score('h', 5)],
    });
    // (110 + 50) / 2
    expect(getCourseLetterData(CID, SID).R).toBe(80);
  });

  it('holds a stored score at twice the maximum', () => {
    seed({ assessments: [points('a', 10)], scores: [score('a', 35)] });
    expect(getCourseLetterData(CID, SID).R).toBe(200);
  });

  it('keeps Complete/Incomplete at 0 or 1', () => {
    seed({
      assessments: [{ id: 'c', title: 'c', scoreMode: 'complete', maxPoints: 1, tagIds: [TAG], type: 'summative' }],
      scores: [score('c', 2)],
    });
    expect(getCourseLetterData(CID, SID).R).toBe(100);
  });
});

describe('pointsPctHtml', () => {
  it('shows the % beside a points input', () => {
    expect(pointsPctHtml(8, 10, 0)).toBe('80%');
    expect(pointsPctHtml(171.9, 200, 1)).toBe('86.0%');
    expect(pointsPctHtml(0, 10, 0)).toBe('0%');
  });

  it('marks a score above the maximum as bonus', () => {
    expect(pointsPctHtml(12, 10, 0)).toBe('120%<span class="gb-pts-bonus">bonus</span>');
    expect(pointsPctHtml(10, 10, 0)).toBe('100%');
  });

  it('is empty with no score', () => {
    expect(pointsPctHtml(null, 10, 0)).toBe('');
    expect(pointsPctHtml(5, 0, 0)).toBe('');
  });
});
