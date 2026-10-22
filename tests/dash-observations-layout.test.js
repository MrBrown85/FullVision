/**
 * The dashboard Observations card's student columns: full week cells while
 * the rule's columns fit, compact cells (23px) when only those fit more
 * columns, so 16–30 students stay in two columns on narrower screens. A
 * compact cell keeps up to 3 marks; past 3 it shows 1 and "+N".
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
const H = DashObservations;
const week = { tab: 'week', n: 22, cells: 8, minCell: 34, fixed: 154 };

describe('Observations card layout', () => {
  it('uses full cells when two columns fit', () => {
    expect(H.obsGridLayout(Object.assign({}, week, { width: 958 }))).toEqual({ cols: 2, minCell: 34, compact: false });
  });

  it('switches to compact cells to keep two columns on a narrower card', () => {
    expect(H.obsGridLayout(Object.assign({}, week, { width: 787 }))).toEqual({ cols: 2, minCell: 23, compact: true });
  });

  it('stays one column with full cells when even compact ones do not fit', () => {
    expect(H.obsGridLayout(Object.assign({}, week, { width: 700 }))).toEqual({ cols: 1, minCell: 34, compact: false });
  });

  it('never goes compact for 15 students or fewer, or By competency', () => {
    expect(H.obsGridLayout(Object.assign({}, week, { n: 15, width: 787 })).compact).toBe(false);
    expect(H.obsGridLayout(Object.assign({}, week, { tab: 'competency', minCell: 44, width: 787 })).compact).toBe(
      false,
    );
  });

  it('a compact cell keeps 3 marks, and past 3 shows 1 and "+N"', () => {
    const obs = n =>
      Array.from({ length: n }, (_, i) => ({ id: 'o' + i, sentiment: 'strength', date: '2026-10-1' + i }));
    expect(H.weekMarks(obs(3), 1).marks).toHaveLength(3);
    const busy = H.weekMarks(obs(7), 1);
    expect(busy.marks).toHaveLength(1);
    expect(busy.moreLabel).toBe('+6');
  });
});
