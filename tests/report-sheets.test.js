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
