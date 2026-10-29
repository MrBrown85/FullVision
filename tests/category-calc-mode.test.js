/**
 * A category's Calculation (category.calc_mode, migrations/
 * 20261029_category_calc_mode.sql): 'points' pools points earned and
 * possible, 'percent' averages each assessment's percent. This is the data
 * half; the course % reads it in the next change. Unset is 'points'.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const CID = 'course-calc-mode';

describe('category calc mode in the cache', () => {
  it('reads calc_mode from the class bundle, points when the server sends none', () => {
    _v2GradebookToCache(CID, {
      course: { id: CID },
      students: [],
      assessments: [],
      categories: [
        { id: 'k1', name: 'Tests', weight: 60, display_order: 0, calc_mode: 'percent' },
        { id: 'k2', name: 'Labs', weight: 40, display_order: 1 },
      ],
      modules: [],
      cells: {},
    });
    expect(getCategories(CID).map(c => [c.name, c.calcMode])).toEqual([
      ['Tests', 'percent'],
      ['Labs', 'points'],
    ]);
  });

  it('names anything but percent as points', () => {
    expect(categoryCalcMode({ calcMode: 'percent' })).toBe('percent');
    expect(categoryCalcMode({ calc_mode: 'percent' })).toBe('percent');
    expect(categoryCalcMode({ calcMode: 'median' })).toBe('points');
    expect(categoryCalcMode({})).toBe('points');
    expect(categoryCalcMode(null)).toBe('points');
  });
});
