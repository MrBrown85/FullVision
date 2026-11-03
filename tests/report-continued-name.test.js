/**
 * A Continued side starts with a line naming the student and the class,
 * so a sheet printed single-sided can be matched to its student (Nov 3
 * bug sweep, step 4 group 1 #5). The engine keeps room for the line.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const H = 996;
const c = (id, px) => ({ id, size: 'row', px });
const NORA = { id: 'st-nora', firstName: 'Eleanor', preferred: 'Nora', lastName: 'Kim' };

describe('ReportSheets.pack: the continued line', () => {
  it('keeps room for the line at the top of a continued side only', () => {
    const r = ReportSheets.pack([[[c('header', 600)], [c('a', 300)], [c('b', 300)]]], {
      H,
      gap: 12,
      pinned: null,
      head: 16,
    });
    expect(r.sides.map(s => s.kind)).toEqual(['side', 'continued']);
    expect(r.sides[0].rows.map(x => x.y)).toEqual([0, 612]);
    expect(r.sides[1].rows.map(x => x.y)).toEqual([28]);
  });

  it('never leaves a continued side empty for a row that fits below the line', () => {
    const r = ReportSheets.pack([[[c('header', 100)], [c('a', 950)]]], { H, gap: 12, pinned: null, head: 16 });
    expect(r.sides.map(s => s.kind)).toEqual(['side', 'continued']);
    expect(r.sides[1].rows).toHaveLength(1);
  });
});

describe('ReportBlocks.renderContinuedLine', () => {
  afterEach(() => {
    delete COURSES['c-cont'];
  });
  it('names the student as the letterhead does, then the class and block', () => {
    COURSES['c-cont'] = { id: 'c-cont', name: 'Science 8', block: 'A' };
    expect(ReportBlocks.renderContinuedLine('c-cont', NORA, { name: 'preferred' })).toBe(
      '<div class="sheet-continued">Nora Kim · Science 8 · Block A (continued)</div>',
    );
    expect(ReportBlocks.renderContinuedLine('c-cont', NORA, { name: 'first' })).toContain('Eleanor Kim');
  });
});

describe('ReportSheets.layoutStudent: a Continued side names its student', () => {
  let origDoc;
  afterEach(() => {
    globalThis.document = origDoc;
    delete COURSES['c-cont'];
  });
  it('prints the line at the top of the Continued side and nowhere else', () => {
    COURSES['c-cont'] = { id: 'c-cont', name: 'Science 8', block: 'A' };
    const dom = parseHTML('<!doctype html><html><body></body></html>');
    origDoc = globalThis.document;
    globalThis.document = dom.document;
    // linkedom has no layout: a cell is 600px tall, the line 16px.
    Object.defineProperty(dom.HTMLElement.prototype, 'offsetHeight', {
      get() {
        return this.classList.contains('sheet-continued') ? 16 : 600;
      },
    });
    const form = ReportSheets.normalizeForm({
      v: 6,
      sides: [
        {
          rows: [
            { cells: [{ block: 'header', size: 'row' }] },
            {
              cells: [{ block: 'text-block', size: 'row', options: { title: 'Notes', text: 'Field trip on Friday.' } }],
            },
          ],
        },
      ],
      pinned: null,
    });
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const r = ReportSheets.layoutStudent(
      'c-cont',
      NORA,
      {},
      { form, paper: 'letter', stage, probe: { linePx: 22, boxChromePx: 40 } },
    );
    stage.remove();
    const host = document.createElement('div');
    host.innerHTML = r.html;
    const sides = [...host.querySelectorAll('.report-sheet')];
    expect(sides.map(s => s.dataset.kind || 'blank')).toEqual(['side', 'continued']);
    const lines = host.querySelectorAll('.sheet-continued');
    expect(lines).toHaveLength(1);
    expect(sides[1].querySelector('.sheet-body').firstElementChild.textContent).toBe(
      'Nora Kim · Science 8 · Block A (continued)',
    );
  });
});
