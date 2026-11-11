/**
 * Every side after the Front (the Back, a Continued side, an After the
 * Report side) starts with a line naming the student and the class, so a
 * sheet printed single-sided can be matched to its student (Nov 3 bug
 * sweep, step 4 group 1 #5; Colin, Nov 3: "Yes, all three"). The engine
 * keeps room for the line, so nothing runs past the foot of a side.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const H = 996;
const HEAD = 16;
const TOP = HEAD + 12;
const P = (sides, opts) => ReportSheets.pack(sides, { H, gap: 12, pinned: null, head: HEAD, ...opts });
const c = (id, px, more) => ({ id, size: 'row', px, ...more });
const NORA = { id: 'st-nora', firstName: 'Eleanor', preferred: 'Nora', lastName: 'Kim' };
const kinds = r => r.sides.map(s => [s.kind, s.from, !!s.head, s.rows.map(x => x.y)]);

describe('ReportSheets.pack: room for the name line', () => {
  it('the Front starts at the top; the Back and a Continued side start under the line', () => {
    const r = P([[[c('header', 600)], [c('a', 300)], [c('b', 300)]], [[c('dims', 200)]]]);
    expect(kinds(r)).toEqual([
      ['side', 0, false, [0, 612]],
      ['continued', 0, true, [TOP]],
      ['side', 1, true, [TOP]],
    ]);
  });

  it('a row too tall to fit under the line goes after the report instead of running past the foot; a table goes on', () => {
    // H - 10 fits a bare side but not one with the line: it would have been
    // placed at y = 28 on a Continued side and cut off in print.
    const r = P([[[c('header', 81)], [c('reflection', H - 10)]]]);
    expect(kinds(r)).toEqual([
      ['side', 0, false, [0]],
      ['after', null, true, [TOP]],
    ]);
    expect(r.after).toEqual(['reflection']);
    expect(r.sides[1].rows[0].h).toBe(H - TOP);
    expect(r.over).toBe(true);
    // A table that tall starts under the letterhead and goes on under the
    // line on the next side, cut at its rows, and nothing is over.
    const rows = Array.from({ length: 31 }, () => 30);
    const t = P([[[c('header', 81)], [c('grades', 60 + 31 * 30, { rows, chrome: 60 })]]]);
    expect(t.sides.map(s => s.kind)).toEqual(['side', 'continued']);
    expect(t.sides[0].rows[1].cells[0].part).toEqual({ start: 0, end: 28 });
    expect(t.sides[1].rows[0].y).toBe(TOP);
    expect(t.sides[1].rows[0].cells[0].part).toEqual({ start: 28, end: 31 });
    t.sides.forEach(s => s.rows.forEach(r => expect(r.y + r.h).toBeLessThanOrEqual(H)));
    expect(t.over).toBe(false);
  });

  it('a row that tall still fits where it is on the Front', () => {
    const r = P([[[c('reflection', H - 10)]]]);
    expect(kinds(r)).toEqual([['side', 0, false, [0]]]);
  });

  it('never leaves a Continued side empty for a row that fits under the line', () => {
    const r = P([[[c('header', 100)], [c('a', H - TOP)]]]);
    expect(kinds(r)).toEqual([
      ['side', 0, false, [0]],
      ['continued', 0, true, [TOP]],
    ]);
  });

  it('a block docked to the bottom of the Back stays under the line', () => {
    const r = P([[[c('header', 81)]], [[c('response', H)]]], { pinned: 'response' });
    expect(r.sides[1].pinned).toEqual({ id: 'response', size: 'row', h: H - TOP, y: TOP });
    expect(r.over).toBe(true);
  });

  it('without a line (head 0) nothing moves', () => {
    const r = ReportSheets.pack([[[c('header', 600)], [c('a', 500)]], [[c('b', 100)]]], { H, gap: 12, pinned: null });
    expect(r.sides.map(s => s.rows.map(x => x.y))).toEqual([[0], [0], [0]]);
  });
});

describe('ReportBlocks.renderContinuedLine', () => {
  afterEach(() => {
    delete COURSES['c-cont'];
  });
  it('names the student as the letterhead does, then the class and block', () => {
    COURSES['c-cont'] = { id: 'c-cont', name: 'Science 8', block: 'A' };
    expect(ReportBlocks.renderContinuedLine('c-cont', NORA, { name: 'preferred' })).toBe(
      '<div class="sheet-name-line">Nora Kim · Science 8 · Block A (continued)</div>',
    );
    expect(ReportBlocks.renderContinuedLine('c-cont', NORA, { name: 'first' })).toContain('Eleanor Kim');
  });
});

describe('ReportSheets.layoutStudent: every side after the Front names its student', () => {
  const LINE = 'Nora Kim · Science 8 · Block A (continued)';
  let origDoc;
  afterEach(() => {
    globalThis.document = origDoc;
    delete COURSES['c-cont'];
  });
  /* Lays Nora out on `sides` with each block `px` tall, and returns each
     printed side's kind and its first line (or null). */
  const layout = (sides, px) => {
    COURSES['c-cont'] = { id: 'c-cont', name: 'Science 8', block: 'A' };
    const dom = parseHTML('<!doctype html><html><body></body></html>');
    origDoc = globalThis.document;
    globalThis.document = dom.document;
    // linkedom has no layout: each block is `px` tall, the line 16px.
    Object.defineProperty(dom.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return this.classList.contains('sheet-name-line') ? HEAD : px[this.dataset.block] || 0;
      },
    });
    const form = ReportSheets.normalizeForm({ v: 6, sides, pinned: null });
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const probe = { linePx: 22, boxChromePx: 40 };
    const r = ReportSheets.layoutStudent('c-cont', NORA, {}, { form, paper: 'letter', stage, probe });
    stage.remove();
    const host = document.createElement('div');
    host.innerHTML = r.html;
    return [...host.querySelectorAll('.report-sheet')].map(s => {
      const first = s.querySelector('.sheet-body').firstElementChild;
      return [
        s.dataset.kind || 'blank',
        first && first.classList.contains('sheet-name-line') ? first.textContent : null,
        s.querySelectorAll('.sheet-name-line').length,
      ];
    });
  };
  const text = { block: 'text-block', size: 'row', options: { title: 'Notes', text: 'Field trip on Friday.' } };
  const row = cell => ({ cells: [cell] });

  it('prints the line on the Back, a Continued side and an After the Report side, not on the Front', () => {
    const sides = layout(
      [
        { rows: [row({ block: 'header', size: 'row' }), row(text)] },
        { rows: [row({ block: 'teacher-narrative', size: 'row' }), row({ block: 'parent-response', size: 'row' })] },
      ],
      { header: 600, 'text-block': 600, 'teacher-narrative': 300, 'parent-response': H - 10 },
    );
    expect(sides).toEqual([
      ['side', null, 0],
      ['continued', LINE, 1],
      ['side', LINE, 1],
      ['after', LINE, 1],
    ]);
  });

  it('an empty Back prints no line', () => {
    const sides = layout([{ rows: [row({ block: 'header', size: 'row' }), row(text)] }, { rows: [] }], {
      header: 100,
      'text-block': 100,
    });
    expect(sides).toEqual([
      ['side', null, 0],
      ['side', null, 0],
    ]);
  });
});
