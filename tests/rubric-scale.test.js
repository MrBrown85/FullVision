// A rubric's own level columns (shared/rubric-scale.js): how a column is
// stored and read back, and the editor's insert and remove.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const R = window.RubricScale;

describe('RubricScale', () => {
  it('stores each six-point score as the council mapped it, and reads it back', () => {
    const r = R.fromTemplate('composition');
    const stored = [1, 2, 3, 4, 5, 6].map(k => R.toStored(r, k));
    expect(stored).toEqual([
      { level: 1, mod: 0 },
      { level: 1, mod: 1 },
      { level: 2, mod: 0 },
      { level: 3, mod: 0 },
      { level: 3, mod: 1 },
      { level: 4, mod: 0 },
    ]);
    stored.forEach((s, i) => expect(R.fromStored(r, s.level, s.mod)).toBe(i + 1));
    // A pair set elsewhere reads as the nearest column, ties to the lower.
    expect(R.fromStored(r, 4, -1)).toBe(5);
    expect(R.label(r, 4)).toBe('4 Competent');
  });

  it('a rubric with no columns of its own has the four levels', () => {
    expect(R.has({ criteria: [] })).toBe(false);
    expect(R.keys({}, [4, 3, 2, 1])).toEqual([4, 3, 2, 1]);
  });

  it('adding a top level moves only the old top one step, and descriptors follow their column', () => {
    const d = { criteria: [{ levels: { 1: 'a', 2: 'b', 3: 'c', 4: 'd' }, checks: [{ id: 'x', level: 2 }] }] };
    R.insertLevel(d, 0, 'Not Yet');
    expect(d.scale.map(c => c.name)).toEqual(['Not Yet', 'Emerging', 'Developing', 'Proficient', 'Extending']);
    expect(d.scale.map(c => [c.level, c.mod])).toEqual([
      [1, 0],
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
    expect(d.criteria[0].levels).toEqual({ 2: 'a', 3: 'b', 4: 'c', 5: 'd' });
    expect(d.criteria[0].checks[0].level).toBe(3);
    R.removeLevel(d, 1);
    // Back to the four levels exactly: no columns of its own.
    expect(d.scale).toBe(null);
    expect(d.criteria[0].levels).toEqual({ 1: 'a', 2: 'b', 3: 'c', 4: 'd' });
  });

  it('offers the English 12 guides in every ELA and Social Studies course in the bank', () => {
    const bank = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
    const want = Object.keys(bank)
      .filter(k => ['English Language Arts', 'Social Studies'].includes(bank[k].subject))
      .sort();
    expect([...R.COURSE_TAGS].sort()).toEqual(want);
  });
});
