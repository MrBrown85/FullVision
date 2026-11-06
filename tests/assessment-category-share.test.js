/**
 * An assessment's share of its category (assessmentCategoryShare), for the
 * share bar under the assessment form's scoring. A CSL-expert teacher asked
 * to set an exact Factor ("I often use 70% and 30%"); the bar shows what a
 * Factor means. The share must be what the course % does: a student with
 * full marks on this one and nothing on the rest gets exactly its share.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-share';
const SID = 'stu-1';

function seed({ mode, assessments, categories, scores, gradingSystem }) {
  COURSES[CID] = { id: CID, name: 'Chemistry 11', gradingSystem: gradingSystem || 'letter' };
  _cache.courseConfigs[CID] = { roundPercent: false };
  _cache.categories[CID] = categories || [
    { id: 'k-tests', name: 'Unit Tests', weight: 80, displayOrder: 0, calcMode: mode },
    { id: 'k-hw', name: 'Homework', weight: 20, displayOrder: 1 },
  ];
  _cache.rubrics[CID] = [];
  _cache.assessments[CID] = assessments || [];
  _cache.scores[CID] = { [SID]: scores || [] };
  _cache.statuses[CID] = {};
  clearProfCache();
}

const test1 = factor => ({
  id: 'a1',
  title: 'Unit Test 1',
  scoreMode: 'points',
  maxPoints: 50,
  weight: factor,
  categoryId: 'k-tests',
});
const test2 = { id: 'a2', title: 'Unit Test 2', scoreMode: 'points', maxPoints: 50, categoryId: 'k-tests' };
const hw = { id: 'h1', title: 'Homework 1', scoreMode: 'points', maxPoints: 10, categoryId: 'k-hw' };

// Full marks on a1, nothing on a2: the category's % is a1's share.
const fullOnFirst = [
  { assessmentId: 'a1', tagId: 'a1', score: 50, date: '2026-10-01' },
  { assessmentId: 'a2', tagId: 'a2', score: 0, date: '2026-10-02' },
];

describe('assessmentCategoryShare', () => {
  beforeEach(() => localStorage.clear());

  it('is points × Factor over the category in a Total Points category', () => {
    seed({ assessments: [test1(2.3), test2, hw] });
    const info = assessmentCategoryShare(CID, test1(2.3));
    expect(info.kind).toBe('share');
    expect(info.mode).toBe('points');
    expect(info.category).toBe('Unit Tests');
    // 115 / (115 + 50)
    expect(info.share).toBeCloseTo(115 / 165, 10);
    expect(formatShare(info.share, true)).toBe('≈ 70%');
    expect(info.parts.map(p => [p.title, p.self, Math.round(p.share * 100)])).toEqual([
      ['Unit Test 1', true, 70],
      ['Unit Test 2', false, 30],
    ]);
  });

  it('matches the course % for two assessments in a Total Points category', () => {
    seed({
      assessments: [test1(2.3), test2],
      categories: [{ id: 'k-tests', name: 'Unit Tests', weight: 100, displayOrder: 0 }],
      scores: fullOnFirst,
    });
    const share = assessmentCategoryShare(CID, test1(2.3)).share;
    expect(getCourseLetterData(CID, SID).R).toBeCloseTo(share * 100, 1);
  });

  it('is Factor over the sum of Factors in an Average of Percentages category', () => {
    seed({
      mode: 'percent',
      assessments: [test1(2.3), { ...test2, maxPoints: 10 }, hw],
    });
    const info = assessmentCategoryShare(CID, test1(2.3));
    expect(info.mode).toBe('percent');
    // Points don't matter here: 2.3 / (2.3 + 1)
    expect(info.share).toBeCloseTo(2.3 / 3.3, 10);
    expect(formatShare(info.share, true)).toBe('≈ 70%');
  });

  it('matches the course % for two assessments in an Average of Percentages category', () => {
    seed({
      mode: 'percent',
      assessments: [test1(2.3), { ...test2, maxPoints: 20 }],
      categories: [{ id: 'k-tests', name: 'Unit Tests', weight: 100, displayOrder: 0, calcMode: 'percent' }],
      scores: [
        { assessmentId: 'a1', tagId: 'a1', score: 50, date: '2026-10-01' },
        { assessmentId: 'a2', tagId: 'a2', score: 0, date: '2026-10-02' },
      ],
    });
    const share = assessmentCategoryShare(CID, test1(2.3)).share;
    expect(getCourseLetterData(CID, SID).R).toBeCloseTo(share * 100, 1);
  });

  it("uses the form's live values in place of the saved assessment", () => {
    seed({ assessments: [test1(1), test2] });
    // Saved at 1 (50%); the form now says 3 and 100 points.
    const info = assessmentCategoryShare(CID, { ...test1(3), maxPoints: 100 });
    expect(info.share).toBeCloseTo(300 / 350, 10);
    expect(info.parts).toHaveLength(2);
  });

  it('counts a new assessment beside every one in its category', () => {
    seed({ assessments: [test1(1), test2, hw] });
    const info = assessmentCategoryShare(CID, {
      title: 'Unit Test 3',
      scoreMode: 'points',
      maxPoints: 50,
      weight: 1,
      categoryId: 'k-tests',
    });
    expect(info.share).toBeCloseTo(1 / 3, 10);
    expect(info.parts.map(p => p.title)).toEqual(['Unit Test 3', 'Unit Test 1', 'Unit Test 2']);
  });

  it('is all of a category it is alone in', () => {
    seed({ assessments: [hw] });
    const info = assessmentCategoryShare(CID, test1(2.3));
    expect(info.share).toBe(1);
    expect(formatShare(info.share, true)).toBe('100%');
  });

  it('covers the whole course % in a class with no categories', () => {
    seed({ assessments: [test1(1), test2], categories: [] });
    const info = assessmentCategoryShare(CID, test1(1));
    expect(info.category).toBe(null);
    expect(info.share).toBe(0.5);
  });

  it('leaves DIBELS work out of the others', () => {
    seed({ assessments: [test1(1), { id: 'd1', title: 'DIBELS', scoreMode: 'dibels', categoryId: 'k-tests' }] });
    expect(assessmentCategoryShare(CID, test1(1)).parts).toHaveLength(1);
  });

  it('names work with no category or in a 0% category, and is null with no % shown', () => {
    seed({ assessments: [test2] });
    expect(assessmentCategoryShare(CID, { ...test1(2), categoryId: '' })).toEqual({ kind: 'uncategorized' });
    seed({
      assessments: [test2],
      categories: [
        { id: 'k-tests', name: 'Practice', weight: 0, displayOrder: 0 },
        { id: 'k-hw', name: 'Homework', weight: 100, displayOrder: 1 },
      ],
    });
    expect(assessmentCategoryShare(CID, test1(2))).toEqual({ kind: 'zero', category: 'Practice' });
    expect(assessmentCategoryShare(CID, { ...test1(2), scoreMode: 'dibels' })).toBe(null);
    seed({ assessments: [test2], gradingSystem: 'proficiency' });
    expect(assessmentCategoryShare(CID, test1(2))).toBe(null);
  });
});

describe('formatShare and formatFactor', () => {
  it('writes a share as a whole percent, ≈ only when it rounds', () => {
    expect(formatShare(0.5, true)).toBe('50%');
    expect(formatShare(0.697, true)).toBe('≈ 70%');
    expect(formatShare(0.697, false)).toBe('70%');
    expect(formatShare(0.003, true)).toBe('< 1%');
    expect(formatShare(0, true)).toBe('0%');
  });

  it('writes any Factor cleanly', () => {
    expect(formatFactor(2.3)).toBe('2.3×');
    expect(formatFactor(1)).toBe('1×');
    expect(formatFactor(0.5)).toBe('0.5×');
    expect(formatFactor(0.1 + 0.2)).toBe('0.3×');
    expect(formatFactor('1.25')).toBe('1.25×');
    expect(formatFactor(0)).toBe('1×');
  });
});
