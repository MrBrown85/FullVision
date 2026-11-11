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

  it('a table taller than a side goes on side by side; anything else taller prints after the report, alone and over', () => {
    const rows = Array.from({ length: 60 }, () => 30); // 1800px of rows
    const r = P([
      [[c('header', 81)], [c('grades', 1860, { rows, chrome: 60 })], [c('legend', 100)]],
      [[c('response', 304)]],
    ]);
    // The Front: the letterhead and as many rows as fit (60 + 28 × 30 =
    // 900, from 93 to 993). The Back: the next 31 (990), then a continued
    // side with the last row, the legend and the Back's own block.
    expect(r.sides.map(s => [s.kind, s.from])).toEqual([
      ['side', 0],
      ['side', 1],
      ['continued', 1],
    ]);
    expect(rowsOf(r.sides[0])).toEqual([
      [0, 81, 'header/row@81'],
      [93, 900, 'grades/row@900'],
    ]);
    const parts = r.sides.map(s => s.rows[s === r.sides[0] ? 1 : 0].cells[0].part);
    expect(parts).toEqual([
      { start: 0, end: 28 },
      { start: 28, end: 59 },
      { start: 59, end: 60 },
    ]);
    expect(rowsOf(r.sides[2])).toEqual([
      [0, 90, 'grades/row@90'],
      [102, 100, 'legend/row@100'],
      [214, 304, 'response/row@304'],
    ]);
    expect(r.after).toEqual([]);
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

/* A long Assignment Grades table starts on the side it is on and goes on
   side by side, so a new report (the name on the Front, the table under
   it, an empty Back) never prints a blank Back with the table on a second
   sheet (PR 1094's "After main moved"). Sides after the Front keep 28 px
   for the line naming the student. Rows are 30 px, the table's title and
   heading 60: after the letterhead the Front holds 28 rows; a side under
   the line holds 30 (60 + 900 ≤ 996 − 28 − 1). */
describe('ReportSheets.pack: a long table goes on side by side', () => {
  const HEAD = 16;
  const TOP = HEAD + 12;
  const PH = (sides, opts) => P(sides, { head: HEAD, ...opts });
  const grades = n => c('grades', 60 + n * 30, { rows: Array.from({ length: n }, () => 30), chrome: 60 });
  const newReport = (n, back = []) => PH([[[c('header', 81)], [grades(n)]], back]);
  const where = r =>
    r.sides.map(s => [
      s.kind,
      s.from,
      s.rows.map(x => x.cells.map(cl => cl.id + (cl.part ? ' ' + cl.part.start + '-' + cl.part.end : '')).join('+')),
    ]);
  /* No side runs past its foot, or into its docked block; the table's parts
     run on from each other with no row lost or doubled; no side is blank. */
  const sound = (r, n) => {
    r.sides.forEach(s => {
      const foot = s.pinned ? s.pinned.y - 12 : H;
      s.rows.forEach(x => expect(x.y + x.h).toBeLessThanOrEqual(foot));
      expect(s.rows.length + (s.pinned ? 1 : 0)).toBeGreaterThan(0);
    });
    const parts = r.sides.flatMap(s =>
      s.rows.flatMap(x => x.cells.filter(cl => cl.id === 'grades').map(cl => cl.part || { start: 0, end: n })),
    );
    parts.forEach((p, i) => expect(p.start).toBe(i ? parts[i - 1].end : 0));
    expect(parts[parts.length - 1].end).toBe(n);
    expect(r.over).toBe(false);
    expect(r.after).toEqual([]);
  };

  it('1 row: whole, under the name', () => {
    const r = newReport(1);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'grades']],
      ['side', 1, []],
    ]);
  });

  it('as many rows as the Front holds after the name: whole, on the Front', () => {
    const r = newReport(28);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'grades']],
      ['side', 1, []],
    ]);
    expect(r.sides[0].rows[1].y + r.sides[0].rows[1].h).toBe(993);
  });

  it('a side’s worth, too long for the room after the name: whole on the Back, not on a side of its own', () => {
    const r = newReport(30);
    expect(where(r)).toEqual([
      ['side', 0, ['header']],
      ['side', 1, ['grades']],
    ]);
    expect(r.sides[1].rows[0].y).toBe(TOP);
    expect(r.sides[1].rows[0].carried).toBe(true);
    expect(r.sides[0].passed).toBe(true);
    sound(r, 30);
  });

  it('a side plus one row: starts under the name and ends on the Back, one sheet', () => {
    const r = newReport(31);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'grades 0-28']],
      ['side', 1, ['grades 28-31']],
    ]);
    expect(r.sides[0].rows[1].y).toBe(93);
    expect(r.sides[1].rows[0].y).toBe(TOP);
    expect(r.continued).toEqual(['grades']);
    sound(r, 31);
  });

  it('two sides plus one row: the Front, the Back, then a new sheet, with no blank side', () => {
    const r = newReport(59);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'grades 0-28']],
      ['side', 1, ['grades 28-58']],
      ['continued', 1, ['grades 58-59']],
    ]);
    expect(r.sides[2].rows[0].y).toBe(TOP);
    sound(r, 59);
  });

  it('after a full Front: starts at the top of the Back', () => {
    const r = PH([[[c('header', 81)], [c('comment', 880)], [grades(40)]], []]);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'comment']],
      ['side', 1, ['grades 0-30']],
      ['continued', 1, ['grades 30-40']],
    ]);
    expect(r.sides[1].rows[0].y).toBe(TOP);
    sound(r, 40);
  });

  it('the rows after the table follow where it ends, then the Back’s own rows', () => {
    const r = PH([[[c('header', 81)], [grades(31)], [c('legend', 100)]], [[c('dims', 200)]]]);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'grades 0-28']],
      ['side', 1, ['grades 28-31', 'legend', 'dims']],
    ]);
    expect(r.sides[1].rows.map(x => [x.y, !!x.carried])).toEqual([
      [TOP, true],
      [TOP + 150 + 12, true],
      [TOP + 150 + 12 + 100 + 12, false],
    ]);
    sound(r, 31);
  });

  it('the Conference Pack: on the Back between its blocks and the docked Parent Response, then on', () => {
    const r = PH(
      [
        [[c('header', 81)], [c('comment', 800)]],
        [[c('dims', 281)], [grades(38)], [c('response', 120)]],
      ],
      { pinned: 'response' },
    );
    // The Back: dims from 28 to 309, the table from 321 to 861 (16 rows),
    // above the response docked at 876.
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'comment']],
      ['side', 1, ['dims', 'grades 0-16']],
      ['continued', 1, ['grades 16-38']],
    ]);
    expect(r.sides[1].pinned).toEqual({ id: 'response', size: 'row', h: 120, y: 876 });
    sound(r, 38);
  });

  it('a table moved to the Back that does not fit above its docked block starts there and goes on', () => {
    const r = PH([[[c('header', 81)], [c('comment', 700)], [grades(20)]], [[c('response', 400)]]], {
      pinned: 'response',
    });
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'comment']],
      ['side', 1, ['grades 0-16']],
      ['continued', 1, ['grades 16-20']],
    ]);
    sound(r, 20);
  });

  it('a table that fits a side still goes whole onto a continued side past the last side', () => {
    const r = PH([[[c('header', 81)], [c('comment', 700)], [grades(20)]]]);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'comment']],
      ['continued', 0, ['grades']],
    ]);
  });

  it('a row taller than a whole side prints alone, over, and the rest goes on', () => {
    const r = PH([[[c('header', 81)], [c('grades', 60 + 30 + 2000, { rows: [30, 2000], chrome: 60 })]]]);
    expect(where(r)).toEqual([
      ['side', 0, ['header', 'grades 0-1']],
      ['continued', 0, ['grades 1-2']],
    ]);
    expect(r.sides[1].rows[0].y + r.sides[1].rows[0].h).toBe(H);
    expect(r.over).toBe(true);
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

describe('ReportSheets.fitText', () => {
  it('says how a comment sits in its lines, and names the second sheet when the report runs to one', () => {
    expect(ReportSheets.fitText(null)).toBe('');
    expect(ReportSheets.fitText({ room: 10, noComment: true })).toBe('No comment yet. The box holds 10 lines.');
    expect(ReportSheets.fitText({ room: 10, commentLines: 4, sheets: 1 })).toBe('Fits. 4 lines; room for 6 more.');
    expect(ReportSheets.fitText({ room: 10, commentLines: 13, sheets: 1 })).toBe(
      '13 lines, 3 past the box; what is under it moves down. Nothing is cut.',
    );
    expect(ReportSheets.fitText({ room: 10, commentLines: 18, sheets: 2 })).toBe(
      '18 lines, 8 past the box; this report runs to 2 sheets. Nothing is cut.',
    );
  });
});

describe('review fixes', () => {
  it('a pair row taller than a side sends only the tall cell after the report; the short partner stays', () => {
    const r = ReportSheets.pack(
      [
        [
          [{ id: 'header', size: 'row', px: 81 }],
          [
            { id: 'tall', size: 'half', px: 1200 },
            { id: 'short', size: 'half', px: 80 },
          ],
        ],
      ],
      { H: 996, gap: 12, pinned: null },
    );
    expect(r.after).toEqual(['tall']);
    expect(r.sides[0].rows.map(row => row.cells.map(c => c.id + '@' + c.h).join('+'))).toEqual([
      'header@81',
      'short@80',
    ]);
  });

  it('pairsWell: the shorter is at least half the taller; unmeasured blocks pair', () => {
    expect(ReportSheets.pairsWell('legend', 'support-home', { legend: 116, 'support-home': 118 })).toBe(true);
    expect(ReportSheets.pairsWell('missing-work', 'legend', { 'missing-work': 44, legend: 116 })).toBe(false);
    expect(ReportSheets.pairsWell('legend', 'support-home', {})).toBe(true);
    expect(ReportSheets.pairsWell('legend', 'parent-response', {})).toBe(false);
  });

  it('Side by Side does not pair blocks of very different heights', () => {
    const f = ReportSheets.setSize(ReportSheets.form(), 'legend', 'half');
    const uneven = ReportSheets.setSize(f, 'proficiency', 'half', { legend: 116, proficiency: 360 });
    expect(uneven.sides[0].rows[1].cells.map(c => c.block)).toEqual(['proficiency']);
    const even = ReportSheets.setSize(f, 'proficiency', 'half', { legend: 200, proficiency: 360 });
    expect(even.sides[0].rows[1].cells.map(c => c.block)).toEqual(['proficiency', 'legend']);
  });
});

describe('calc.js levelChangeAs', () => {
  it('reads the change in levels, or in percent for a letter class', () => {
    COURSES.lc1 = { id: 'lc1', gradingSystem: 'letter' };
    COURSES.lc2 = { id: 'lc2', gradingSystem: 'both' };
    COURSES.lc3 = { id: 'lc3', gradingSystem: 'proficiency' };
    expect(levelChangeAs('lc3', 3.1, 3.3)).toBe('+0.2');
    expect(levelChangeAs('lc2', 3.3, 3.1)).toBe('−0.2');
    expect(levelChangeAs('lc1', 3, 3.33)).toBe('+8%');
    expect(levelChangeAs('lc1', 3, 3)).toBe('0%');
    expect(levelChangeAs('lc1', 0, 3)).toBe('—');
  });
});
