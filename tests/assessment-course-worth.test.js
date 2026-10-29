/**
 * What one assessment is worth in the course % (assessmentCourseWorth), for
 * the "Counts as 20 points in Current Events" line in the assignment form
 * and the grader. A rubric is worth its criteria's top points, so a
 * 5-criterion rubric is 20 and a 2-criterion one 8; in an Average of
 * Percentages category every assessment counts once.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-worth';
const crit = id => ({ id, name: id, tagIds: [], levels: { 4: '', 3: '', 2: '', 1: '' }, weight: 1 });

function seed({ mode, categories, gradingSystem }) {
  _cache.rubrics[CID] = [
    { id: 'r5', name: 'Five', criteria: ['a', 'b', 'c', 'd', 'e'].map(crit) },
    { id: 'r2', name: 'Two', criteria: ['a', 'b'].map(crit) },
  ];
  _cache.categories[CID] = categories || [
    { id: 'k1', name: 'Current Events', weight: 100, displayOrder: 0, calcMode: mode },
  ];
  _cache.courseConfigs[CID] = {};
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: gradingSystem || 'letter' };
  clearProfCache();
}

describe('assessmentCourseWorth', () => {
  beforeEach(() => localStorage.clear());

  it("gives a rubric its criteria's points", () => {
    seed({});
    expect(assessmentCourseWorth(CID, { rubricId: 'r5', categoryId: 'k1' })).toEqual({
      kind: 'points',
      points: 20,
      base: 20,
      criteria: 5,
      factor: 1,
      category: 'Current Events',
    });
    expect(assessmentCourseWorth(CID, { rubricId: 'r2', categoryId: 'k1', weight: 2 })).toMatchObject({
      points: 16,
      base: 8,
      criteria: 2,
      factor: 2,
    });
  });

  it('gives points work its maximum and other proficiency work 4', () => {
    seed({});
    expect(assessmentCourseWorth(CID, { scoreMode: 'points', maxPoints: 36, categoryId: 'k1' })).toMatchObject({
      points: 36,
      criteria: null,
    });
    expect(assessmentCourseWorth(CID, { scoreMode: 'complete', categoryId: 'k1' })).toMatchObject({ points: 1 });
    expect(assessmentCourseWorth(CID, { categoryId: 'k1' })).toMatchObject({ points: 4 });
  });

  it('counts once in an Average of Percentages category', () => {
    seed({ mode: 'percent' });
    expect(assessmentCourseWorth(CID, { rubricId: 'r5', categoryId: 'k1' })).toEqual({
      kind: 'percent',
      factor: 1,
      category: 'Current Events',
    });
  });

  it('names work that counts toward no %', () => {
    seed({});
    expect(assessmentCourseWorth(CID, { rubricId: 'r5', categoryId: '' })).toEqual({ kind: 'uncategorized' });
    seed({ categories: [{ id: 'k1', name: 'Practice', weight: 0, displayOrder: 0 }] });
    expect(assessmentCourseWorth(CID, { categoryId: 'k1' })).toEqual({ kind: 'zero', category: 'Practice' });
    expect(assessmentCourseWorth(CID, { scoreMode: 'dibels', categoryId: 'k1' })).toBe(null);
  });

  it('counts toward the whole % in a class with no categories, and is null with no % shown', () => {
    seed({ categories: [] });
    expect(assessmentCourseWorth(CID, { rubricId: 'r2' })).toMatchObject({ kind: 'points', points: 8, category: null });
    seed({ gradingSystem: 'proficiency' });
    expect(assessmentCourseWorth(CID, { rubricId: 'r2', categoryId: 'k1' })).toBe(null);
  });
});
