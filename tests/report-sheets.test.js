/**
 * ReportSheets.pack: the rows engine as a pure function over measured
 * heights. A row takes the taller of its cells and sits a gap under the
 * row before it; the pinned block docks to the bottom of its side; a row
 * past the limit, and the rest of its side, continues on a side of its
 * own; a row taller than a whole side prints after the report, a table
 * cut at its rows.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const H = 996;
const P = (sides, opts) => ReportSheets.pack(sides, { H, gap: 12, pinned: null, ...opts });
const c = (id, px, more) => ({ id, size: 'row', px, ...more });
const h = (id, px, more) => ({ id, size: 'half', px, ...more });
const rowsOf = side => side.rows.map(r => [r.y, r.h, r.cells.map(x => x.id + '/' + x.size + '@' + x.h).join('+')]);

describe('ReportSheets.pack', () => {
  it('stacks rows down a side with the gap between them; a pair takes the taller cell', () => {
    const r = P([[[c('header', 81)], [c('table', 246)], [h('att', 44), h('miss', 80)]]]);
    expect(r.sides).toHaveLength(1);
    expect(r.sides[0].kind).toBe('side');
    expect(rowsOf(r.sides[0])).toEqual([
      [0, 81, 'header/row@81'],
      [93, 246, 'table/row@246'],
      [351, 80, 'att/half@80+miss/half@80'],
    ]);
    expect(r.continued).toEqual([]);
    expect(r.after).toEqual([]);
    expect(r.over).toBe(false);
  });

  it('docks the pinned block to the bottom of its side and keeps the rows above its gap', () => {
    const r = P([[[c('dims', 281)], [c('response', 304)]]], { pinned: 'response' });
    expect(r.sides[0].pinned).toEqual({ id: 'response', size: 'row', h: 304, y: H - 304 });
    expect(rowsOf(r.sides[0])).toEqual([[0, 281, 'dims/row@281']]);
    // A row that would reach into the docked block continues instead.
    const tight = P([[[c('a', 400)], [c('b', 300)], [c('response', 304)]]], { pinned: 'response' });
    expect(tight.sides.map(s => s.kind)).toEqual(['side', 'continued']);
    expect(rowsOf(tight.sides[0])).toEqual([[0, 400, 'a/row@400']]);
    expect(rowsOf(tight.sides[1])).toEqual([[0, 300, 'b/row@300']]);
    expect(tight.continued).toEqual(['b']);
  });

  it('a row past the side, and every row after it, continues on a side inserted after it', () => {
    const r = P([[[c('header', 81)], [c('comment', 700)], [c('steps', 300)], [c('legend', 100)]], [[c('dims', 281)]]]);
    expect(r.sides.map(s => [s.kind, s.from])).toEqual([
      ['side', 0],
      ['continued', 0],
      ['side', 1],
    ]);
    expect(rowsOf(r.sides[0])).toEqual([
      [0, 81, 'header/row@81'],
      [93, 700, 'comment/row@700'],
    ]);
    expect(rowsOf(r.sides[1])).toEqual([
      [0, 300, 'steps/row@300'],
      [312, 100, 'legend/row@100'],
    ]);
    expect(r.continued).toEqual(['steps', 'legend']);
    expect(r.over).toBe(false);
  });

  it('a cell that prints nothing takes no room; a pair with one empty cell prints the other alone; an empty row keeps its place at no height', () => {
    const r = P([
      [
        [c('header', 81)],
        [h('att', 0, { empty: true }), h('miss', 60)],
        [c('gone', 0, { empty: true })],
        [c('legend', 100)],
      ],
    ]);
    expect(rowsOf(r.sides[0])).toEqual([
      [0, 81, 'header/row@81'],
      [93, 60, 'miss/half@60'],
      [165, 0, 'gone/row@0'],
      [165, 100, 'legend/row@100'],
    ]);
    expect(r.sides[0].rows[2].empty).toBe(true);
    expect(r.sides[0].rows[3].empty).toBeUndefined();
  });

  it('a block taller than a side prints after the report: a table cut at its rows, anything else alone and over', () => {
    const rows = Array.from({ length: 60 }, () => 30); // 1800px of rows
    const r = P([
      [[c('header', 81)], [c('grades', 1860, { rows, chrome: 60 })], [c('legend', 100)]],
      [[c('response', 304)]],
    ]);
    expect(r.sides.map(s => s.kind)).toEqual(['side', 'side', 'after', 'after']);
    expect(rowsOf(r.sides[0])).toEqual([
      [0, 81, 'header/row@81'],
      [93, 100, 'legend/row@100'],
    ]);
    const parts = r.sides.slice(2).map(s => s.rows[0].cells[0].part);
    expect(parts[0]).toEqual({ start: 0, end: 31 }); // 60 + 31 × 30 = 990 ≤ 995
    expect(parts[1]).toEqual({ start: 31, end: 60 });
    expect(r.sides[2].rows[0].h).toBe(990);
    expect(r.after).toEqual(['grades']);
    expect(r.over).toBe(false);
    const tall = P([[[c('reflection', 1200)]]]);
    expect(tall.sides.map(s => s.kind)).toEqual(['side', 'after']);
    expect(tall.sides[1].rows[0].h).toBe(H);
    expect(tall.over).toBe(true);
  });

  it('a pinned block taller than a side is docked at the top and flagged', () => {
    const r = P([[[c('response', 1100)]]], { pinned: 'response' });
    expect(r.sides[0].pinned).toEqual({ id: 'response', size: 'row', h: H, y: 0 });
    expect(r.over).toBe(true);
  });

  it('an empty side stays an empty side', () => {
    const r = P([[[c('header', 81)]], []]);
    expect(r.sides.map(s => [s.kind, s.rows.length])).toEqual([
      ['side', 1],
      ['side', 0],
    ]);
  });
});

describe('ReportSheets sizes', () => {
  it('a side is the paper less the sheet padding; cells are 720 or 354 wide', () => {
    expect(ReportSheets.sideHeight('letter')).toBe(11 * 96 - 60);
    expect(ReportSheets.sideHeight('legal')).toBe(14 * 96 - 60);
    expect(ReportSheets.cellWidth('row')).toBe(720);
    expect(ReportSheets.cellWidth('half')).toBe(354);
    expect(ReportSheets.sideLabel({ kind: 'side', from: 0 })).toBe('Front');
    expect(ReportSheets.sideLabel({ kind: 'side', from: 1 })).toBe('Back');
    expect(ReportSheets.sideLabel({ kind: 'side', from: 2 })).toBe('Page 3');
    expect(ReportSheets.sideLabel({ kind: 'continued', from: 0 })).toBe('Continued');
    expect(ReportSheets.sideLabel({ kind: 'after' })).toBe('After the Report');
    expect(ReportSheets.sideLabel(null)).toBe('Blank');
  });
});
