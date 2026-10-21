/**
 * ReportSheets.resolve: the page grid as a pure function over measured
 * heights. A block takes the larger of its room and its content and sits
 * below what is above it in its columns (the shove, which chains); a block
 * past the last row moves whole to the next page; a table is cut at its
 * rows and continues; the pinned block docks to the bottom; a Pages cap
 * drops what is past it and names it.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const R = (pages, opts) => ReportSheets.resolve(pages, { rows: 46, pinned: null, cap: null, ...opts });
const it_ = (id, x, y, w, h, need, more) => ({ id, x, y, w, h, need, ...more });
const at = page => page.items.map(i => [i.id, i.x, i.y, i.w, i.h]);

describe('ReportSheets.resolve', () => {
  it('places blocks at their rectangles when the content fits the room', () => {
    const r = R([[it_('a', 0, 0, 12, 4, 3), it_('b', 0, 4, 6, 10, 8), it_('c', 6, 4, 6, 10, 10)]]);
    expect(at(r.pages[0])).toEqual([
      ['a', 0, 0, 12, 4],
      ['b', 0, 4, 6, 10],
      ['c', 6, 4, 6, 10],
    ]);
    expect(r.pushed).toEqual([]);
    expect(r.over).toBe(false);
    expect(r.positions).toEqual({ a: { page: 0, y: 0 }, b: { page: 0, y: 4 }, c: { page: 0, y: 4 } });
  });

  it('a block that grows shoves the blocks under it in its columns, and the shove chains', () => {
    const r = R([
      [
        it_('comment', 0, 0, 6, 8, 14),
        it_('side', 6, 0, 6, 8, 8),
        it_('under', 0, 8, 6, 4, 4),
        it_('wide', 0, 12, 12, 4, 4),
      ],
    ]);
    expect(at(r.pages[0])).toEqual([
      ['comment', 0, 0, 6, 14],
      ['side', 6, 0, 6, 8],
      ['under', 0, 14, 6, 4],
      ['wide', 0, 18, 12, 4],
    ]);
    expect(r.pushed).toEqual([]);
  });

  it('a block past the last row moves whole to the top of the next page, in its columns, pushing that page down', () => {
    const r = R([
      [it_('head', 0, 0, 12, 4, 4), it_('comment', 0, 4, 12, 8, 36), it_('steps', 0, 12, 12, 8, 8)],
      [it_('dims', 0, 0, 12, 10, 10)],
    ]);
    expect(at(r.pages[0])).toEqual([
      ['head', 0, 0, 12, 4],
      ['comment', 0, 4, 12, 36],
    ]);
    expect(at(r.pages[1])).toEqual([
      ['steps', 0, 0, 12, 8],
      ['dims', 0, 8, 12, 10],
    ]);
    expect(r.pushed).toEqual(['steps']);
    expect(r.positions.steps).toEqual({ page: 1, y: 0 });
  });

  it('blocks beside a moved block stay on their page', () => {
    const r = R([[it_('big', 0, 30, 6, 10, 20), it_('beside', 6, 30, 6, 10, 10), it_('after', 0, 40, 6, 4, 4)]]);
    expect(at(r.pages[0])).toEqual([['beside', 6, 30, 6, 10]]);
    expect(at(r.pages[1])).toEqual([
      ['big', 0, 0, 6, 20],
      ['after', 0, 20, 6, 4],
    ]);
    expect(r.pushed).toEqual(['big', 'after']);
  });

  it('room that runs past the page ends there when the content fits', () => {
    const r = R([[it_('a', 0, 0, 12, 36, 6), it_('b', 0, 36, 12, 20, 4)]]);
    expect(at(r.pages[0])).toEqual([
      ['a', 0, 0, 12, 36],
      ['b', 0, 36, 12, 10],
    ]);
    expect(r.pushed).toEqual([]);
  });

  it('an empty block keeps its room when it fits and takes none when it does not', () => {
    const r = R([[it_('a', 0, 0, 12, 40, 44), it_('none', 0, 40, 12, 6, 0, { empty: true })]]);
    expect(at(r.pages[0])).toEqual([['a', 0, 0, 12, 44]]);
    expect(r.pages).toHaveLength(1);
    const s = R([[it_('none', 0, 10, 12, 6, 0, { empty: true })]]);
    expect(at(s.pages[0])).toEqual([['none', 0, 10, 12, 6]]);
  });

  it('a table cuts at the rows that fit and continues at the top of the next page', () => {
    const rows = Array(20).fill(40); // 800 px of rows, 40 px of title and head
    const r = R([
      [
        it_('head', 0, 0, 12, 4, 4),
        it_('grades', 0, 30, 12, 10, 42, { rows, chrome: 40 }),
        it_('legend', 0, 40, 12, 4, 4),
      ],
    ]);
    // 16 rows of room = 320 px − 40 px chrome = 7 rows of the table.
    expect(r.pages[0].items[1]).toMatchObject({ id: 'grades', y: 30, h: 16, part: { start: 0, end: 7 } });
    expect(r.pages[1].items[0]).toMatchObject({ id: 'grades', y: 0, h: 28, part: { start: 7, end: 20 } });
    // What came after it in its columns follows it.
    expect(at(r.pages[1])[1]).toEqual(['legend', 0, 28, 12, 4]);
    expect(r.pushed).toEqual(['grades', 'legend']);
    expect(r.positions.grades).toEqual({ page: 0, y: 30 });
  });

  it('a table that cannot fit one row moves whole; a row taller than a page goes alone and over', () => {
    const r = R([[it_('grades', 0, 44, 12, 4, 10, { rows: [60, 60, 60], chrome: 40 })]]);
    expect(at(r.pages[0])).toEqual([]);
    expect(r.pages[1].items[0]).toMatchObject({ id: 'grades', y: 0, h: 10 });
    expect(r.pages[1].items[0].part).toBeUndefined();
    const s = R([[it_('grades', 0, 0, 12, 4, 60, { rows: [1000, 100], chrome: 40 })]], { rows: 46 });
    expect(s.pages[0].items[0]).toMatchObject({ part: { start: 0, end: 1 } });
    expect(s.over).toBe(true);
  });

  it('a block taller than a whole page stays at the top, flagged', () => {
    const r = R([[it_('huge', 0, 0, 12, 4, 60)]]);
    expect(at(r.pages[0])).toEqual([['huge', 0, 0, 12, 60]]);
    expect(r.pages).toHaveLength(1);
    expect(r.over).toBe(true);
  });

  it('the pinned block docks to the bottom of its page and the row above it is the page’s limit', () => {
    const r = R(
      [
        [it_('head', 0, 0, 12, 4, 4)],
        [it_('dims', 0, 0, 12, 10, 10), it_('steps', 0, 10, 12, 8, 14), it_('resp', 0, 12, 12, 16, 16)],
      ],
      { pinned: 'resp' },
    );
    expect(r.pages[1].items[0]).toMatchObject({ id: 'resp', y: 30, h: 16, pinned: true });
    expect(at(r.pages[1]).slice(1)).toEqual([
      ['dims', 0, 0, 12, 10],
      ['steps', 0, 10, 12, 14],
    ]);
    // Past the limit, a block goes to a continued page.
    const s = R([[it_('dims', 0, 0, 12, 10, 10), it_('steps', 0, 10, 12, 8, 24), it_('resp', 0, 12, 12, 16, 16)]], {
      pinned: 'resp',
    });
    expect(at(s.pages[1])).toEqual([['steps', 0, 0, 12, 24]]);
    expect(s.pushed).toEqual(['steps']);
  });

  it('every page of the form is a page, empty or not', () => {
    const r = R([[it_('a', 0, 0, 12, 4, 4)], [], []]);
    expect(r.pages).toHaveLength(3);
  });

  it('a Pages cap drops the pages past it and names what was on them', () => {
    const pages = [[it_('a', 0, 0, 12, 40, 40), it_('b', 0, 40, 12, 10, 10)], [it_('c', 0, 0, 12, 4, 4)]];
    const r = R(pages, { cap: 1 });
    expect(r.pages).toHaveLength(1);
    expect(r.cut).toEqual(['b', 'c']);
    expect(r.pages[0].capped).toEqual(['b', 'c']);
    expect(R(pages, { cap: 2 }).cut).toEqual([]);
    expect(R(pages, { cap: 2 }).pages).toHaveLength(2);
  });
});

describe('ReportSheets.fitText', () => {
  it('says the comment fits and how much room is left', () => {
    expect(ReportSheets.fitText({ room: 8, commentLines: 6 })).toBe('Fits. 6 lines; room for 2 more.');
    expect(ReportSheets.fitText({ room: 8, commentLines: 1 })).toBe('Fits. 1 line; room for 7 more.');
  });

  it('says how far a long comment runs past its box, and that nothing is cut', () => {
    expect(ReportSheets.fitText({ room: 8, commentLines: 12 })).toBe(
      '12 lines, 4 past the box; what is under it moves down. Nothing is cut.',
    );
  });

  it('says when there is no comment yet, and nothing when the form has no comment box', () => {
    expect(ReportSheets.fitText({ room: 8, commentLines: 0, noComment: true })).toBe(
      'No comment yet. The box holds 8 lines.',
    );
    expect(ReportSheets.fitText({ room: 0 })).toBe('');
  });
});
