/**
 * ReportSheets.pack: blocks keep their order, the first that does not fit
 * moves to the next side with everything after it, the pinned block
 * reserves room on the back, and overrun goes to Continued sides.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const kinds = sides => sides.map(s => s.kind);
const items = side => side.items.map(i => i.from + i.i);

describe('ReportSheets.pack', () => {
  it('fills the front, then the back above the pinned block', () => {
    const sides = ReportSheets.pack([100, 200, 300], [150, 150], 120, 700);
    expect(kinds(sides)).toEqual(['front', 'back']);
    expect(items(sides[0])).toEqual(['front0', 'front1', 'front2']);
    expect(sides[1].cap).toBe(580);
    expect(items(sides[1])).toEqual(['back0', 'back1']);
  });

  it('a front block that does not fit carries to the back ahead of the back blocks', () => {
    const sides = ReportSheets.pack([400, 400], [100], 0, 700);
    expect(items(sides[0])).toEqual(['front0']);
    expect(items(sides[1])).toEqual(['front1', 'back0']);
  });

  it('overrun from the back goes to Continued sides, in order', () => {
    const sides = ReportSheets.pack([600], [300, 300, 300], 200, 700);
    expect(kinds(sides)).toEqual(['front', 'back', 'continued']);
    expect(items(sides[1])).toEqual(['back0']);
    expect(items(sides[2])).toEqual(['back1', 'back2']);
  });

  it('a block taller than a side gets its own side and is flagged, never dropped', () => {
    const sides = ReportSheets.pack([900, 100], [], 0, 700);
    expect(items(sides[0])).toEqual(['front0']);
    expect(sides[0].over).toBe(true);
    expect(items(sides[1])).toEqual(['front1']);
    expect(sides[1].over).toBe(false);
  });

  it('an empty form is one front and one back', () => {
    expect(kinds(ReportSheets.pack([], [], 0, 700))).toEqual(['front', 'back']);
  });
});

describe('ReportSheets.reasonText', () => {
  it('is empty when everything sits where the form puts it', () => {
    expect(ReportSheets.reasonText({ commentLines: 6, room: 8, moved: [], continued: [], noComment: false })).toBe('');
  });

  it('names the comment, what moved to the back, and what went to a second sheet', () => {
    const text = ReportSheets.reasonText({
      commentLines: 12,
      room: 8,
      moved: ['Growth and Next Steps'],
      continued: ['Learning Dispositions'],
      noComment: false,
    });
    expect(text).toBe(
      'Comment is 12 lines; the form keeps 8 on the front. Growth and Next Steps moved to the back. Learning Dispositions on a second sheet.',
    );
  });

  it('says when there is no comment yet', () => {
    expect(ReportSheets.reasonText({ commentLines: 0, room: 8, moved: [], continued: [], noComment: true })).toBe(
      'No comment yet; the box prints with lines.',
    );
  });
});

describe('ReportSheets.fitText', () => {
  it('says the comment fits and how much room is left', () => {
    expect(ReportSheets.fitText({ room: 8, commentLines: 6, moved: [], continued: [] })).toBe(
      'Fits the front. 6 lines; room for 2 more before anything moves.',
    );
    expect(ReportSheets.fitText({ room: 8, commentLines: 8, moved: [], continued: [] })).toBe(
      'Fits the front. 8 lines; the front is full.',
    );
  });

  it('says what a long comment moves, and that nothing is cut', () => {
    expect(
      ReportSheets.fitText({
        room: 8,
        commentLines: 12,
        moved: ['Growth and Next Steps'],
        continued: ['Learning Dispositions'],
      }),
    ).toBe(
      '12 lines, 4 past the front’s room. Growth and Next Steps moves to the back. Learning Dispositions on a second sheet. Nothing is cut.',
    );
  });

  it('explains the empty box', () => {
    expect(ReportSheets.fitText({ room: 8, commentLines: 0, noComment: true })).toBe(
      'No comment yet. The form keeps 8 lines on the front; an empty box prints with lines.',
    );
  });
});

describe('ReportSheets.pack splits a table block at its rows', () => {
  const rows = (n, h) => Array(n).fill(h);
  const parts = sides => sides.map(sd => sd.items.map(it => [it.i, it.h, it.rowStart, it.rowEnd]));

  it('keeps the rows that fit on the current side and carries the rest on, in order', () => {
    const sides = ReportSheets.pack([100, 1500], [], 0, 700, [null, { rows: rows(15, 100), chrome: 0 }]);
    expect(parts(sides)).toEqual([
      [
        [0, 100, undefined, undefined],
        [1, 600, 0, 6],
      ],
      [[1, 700, 6, 13]],
      [[1, 200, 13, 15]],
    ]);
    expect(sides.map(sd => sd.over)).toEqual([false, false, false]);
  });

  it('counts the block chrome in every part', () => {
    const sides = ReportSheets.pack([1050], [], 0, 700, [{ rows: rows(10, 100), chrome: 50 }]);
    expect(parts(sides)).toEqual([[[0, 650, 0, 6]], [[0, 450, 6, 10]]]);
  });

  it('a row taller than the side goes alone and over, never dropped', () => {
    const sides = ReportSheets.pack([900], [], 0, 700, [{ rows: [800, 100], chrome: 0 }]);
    expect(parts(sides)).toEqual([[[0, 800, 0, 1]], [[0, 100, 1, 2]]]);
    expect(sides[0].over).toBe(true);
  });

  it('a block with no rows still moves whole to the next side', () => {
    const sides = ReportSheets.pack([400, 400], [], 0, 700, [null, null]);
    expect(parts(sides)).toEqual([[[0, 400, undefined, undefined]], [[1, 400, undefined, undefined]]]);
  });

  it('the back keeps room for the pinned block when cutting', () => {
    const sides = ReportSheets.pack([650, 1000], [], 200, 700, [null, { rows: rows(10, 100), chrome: 0 }]);
    expect(sides[1].kind).toBe('back');
    expect(parts(sides)[1]).toEqual([[1, 500, 0, 5]]);
    expect(parts(sides)[2]).toEqual([[1, 500, 5, 10]]);
  });
});
