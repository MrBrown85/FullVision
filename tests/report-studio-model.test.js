/**
 * The layout model behind Page Studio (teacher/report-sheets.js): pages of
 * blocks, each a rectangle on a 12-column grid of 20px rows, migration from
 * every earlier shape, and the pure helpers the Studio calls.
 * docs/DECISIONS.md "Report forms".
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const S = ReportSheets;
const rects = pg => pg.blocks.map(b => [b.block, b.x, b.y, b.w, b.h]);
const ids = f => S.onForm(f);

describe('normalizeForm', () => {
  it('is the Report Card when nothing is saved', () => {
    const f = S.normalizeForm(undefined);
    expect(f.v).toBe(5);
    expect(Object.keys(f)).toEqual(['v', 'id', 'name', 'type', 'pagesPerStudent', 'pages', 'pinned', 'perStudent']);
    expect(f.pages[0].blocks[0]).toEqual({ block: 'header', x: 0, y: 0, w: 12 });
    expect(ids(f)).toEqual([
      'header',
      'academic-summary',
      'teacher-narrative',
      'competency-table',
      'next-steps',
      'learner-dimensions',
      'legend',
      'parent-response',
    ]);
    expect(S.cellOf(f, 'teacher-narrative')).toMatchObject({ x: 0, w: 12, h: 8 });
    expect(f.pinned).toBe('parent-response');
    expect(f.pagesPerStudent).toBe('auto');
    expect(f.type).toBe('standard');
  });

  it('migrates a v4 form: spans become columns, rows stack at their tallest cell, lines become rows', () => {
    const f = S.normalizeForm({
      v: 4,
      id: 'mine',
      name: 'Mine',
      pinned: 'parent-response',
      pagesPerStudent: 2,
      pages: [
        {
          rows: [
            { cells: [{ block: 'header', span: 12, options: { school: false } }] },
            { cells: [{ block: 'teacher-narrative', span: 12, height: 'fixed', lines: 5 }] },
            {
              cells: [
                { block: 'competency-table', span: 8, options: { evidence: false } },
                { block: 'legend', span: 4 },
              ],
            },
            {
              cells: [
                { block: 'next-steps', span: 6 },
                { block: 'observations', span: 6 },
              ],
            },
            {
              cells: [
                { block: 'core-competencies', span: 4 },
                { block: 'grade-table', span: 4 },
                { block: 'section-chart', span: 4 },
              ],
            },
          ],
        },
        { rows: [{ cells: [{ block: 'learner-dimensions' }] }, { cells: [{ block: 'parent-response' }] }] },
      ],
    });
    expect(f.v).toBe(5);
    expect(f.pagesPerStudent).toBe(2);
    expect(f.pinned).toBe('parent-response');
    expect(f.pages[0].blocks[0]).toEqual({ block: 'header', x: 0, y: 0, w: 12, options: { school: false } });
    // header 5 rows; comment 5 lines → ceil((5·22 + 40) / 20) = 8 rows; the 8+4 row is the table's 13.
    expect(rects(f.pages[0]).slice(1)).toEqual([
      ['teacher-narrative', 0, 5, 12, 8],
      ['competency-table', 0, 13, 8, 13],
      ['legend', 8, 13, 4, 6],
      ['next-steps', 0, 26, 6, 8],
      ['observations', 6, 26, 6, 16],
      ['core-competencies', 0, 42, 4, 16],
      ['grade-table', 4, 42, 4, 20],
      ['section-chart', 8, 42, 4, 20],
    ]);
    expect(S.cellOf(f, 'competency-table').options).toEqual({ evidence: false });
    expect(rects(f.pages[1])).toEqual([
      ['learner-dimensions', 0, 0, 12, 15],
      ['parent-response', 0, 15, 12, 15],
    ]);
  });

  it('a v4 comment with no height kept 8 lines; Fit Content takes the block’s default', () => {
    const row = cell => ({ v: 4, pages: [{ rows: [{ cells: [cell] }] }] });
    expect(S.cellOf(S.normalizeForm(row({ block: 'teacher-narrative' })), 'teacher-narrative').h).toBe(11);
    expect(S.cellOf(S.normalizeForm(row({ block: 'teacher-narrative', height: 'fit' })), 'teacher-narrative').h).toBe(
      8,
    );
  });

  it('migrates a v3 form through v4: a pair is two halves, room is rows, the pin is the form’s', () => {
    const f = S.normalizeForm({
      v: 3,
      type: 'compact',
      front: [
        { block: 'header' },
        { block: 'teacher-narrative', room: { lines: 5 }, whenEmpty: 'box' },
        { pair: [{ block: 'competency-table' }, { block: 'legend' }] },
        { pair: [{ block: 'observations' }, { block: 'attendance' }] },
      ],
      back: [{ block: 'learner-dimensions' }, { block: 'parent-response', pinned: 'bottom' }],
    });
    expect(f.v).toBe(5);
    expect(f.type).toBe('compact');
    expect(rects(f.pages[0]).slice(1)).toEqual([
      ['teacher-narrative', 0, 5, 12, 8],
      ['competency-table', 0, 13, 6, 13],
      ['legend', 6, 13, 6, 6],
      // Attendance is no longer a block: the pair falls back to observations alone, full width.
      ['observations', 0, 26, 12, 16],
    ]);
    expect(ids(f)).toContain('parent-response');
    expect(f.pinned).toBe('parent-response');
  });

  it('drops unknown blocks, duplicates and extra fields, clamps rectangles to the grid, keeps empty pages', () => {
    const f = S.normalizeForm({
      v: 5,
      pages: [
        {
          blocks: [
            { block: 'bogus', x: 0, y: 0, w: 12, h: 4 },
            { block: 'legend', x: 11, y: -3, w: 1, h: 0, span: 6, lines: 3, whenEmpty: 'box' },
            { block: 'header', x: 4, y: 9, w: 3, h: 7 },
          ],
        },
        {
          blocks: [
            { block: 'legend', x: 0, y: 0, w: 12, h: 4 },
            { block: 'next-steps', x: 2, y: 5, w: 40 },
          ],
        },
        { blocks: [] },
      ],
      pinned: 'legend',
      perStudent: { s1: { hide: ['legend', 'header', 'nope'] }, s2: { hide: [] } },
    });
    expect(f.pages[0].blocks).toEqual([
      { block: 'header', x: 0, y: 0, w: 12 },
      { block: 'legend', x: 9, y: 0, w: 3, h: 2 },
    ]);
    expect(f.pages[1].blocks).toEqual([{ block: 'next-steps', x: 0, y: 5, w: 12, h: 8 }]);
    expect(f.pages).toHaveLength(3);
    expect(f.pinned).toBeNull();
    expect(f.perStudent).toEqual({ s1: { hide: ['legend'] } });
  });

  it('formFor opens an old Brief class on the Interim Update and anything else on the Report Card', () => {
    expect(S.formFor({ preset: 'brief', blocks: [] }).id).toBe('interim-update');
    expect(S.formFor({ preset: 'detailed', blocks: [] }).id).toBe('report-card');
    expect(S.formFor(null).id).toBe('report-card');
    expect(S.formFor({ form: { v: 3, front: [{ block: 'header' }, { block: 'legend' }], back: [] } }).v).toBe(5);
  });
});

describe('place, move and resize', () => {
  const base = () => S.form();

  it('place puts a new block at a rectangle, clamped to the grid, and pushes what it covers down', () => {
    // The legend over the comment (rows 11–18): the comment and everything under it move down 5.
    const f = S.place(base(), 'legend', { page: 0, x: 0, y: 11, w: 12, h: 5 });
    expect(S.cellOf(f, 'legend')).toEqual({ block: 'legend', x: 0, y: 11, w: 12, h: 5 });
    expect(S.cellOf(f, 'teacher-narrative').y).toBe(16);
    expect(S.cellOf(f, 'competency-table').y).toBe(24);
    expect(S.cellOf(f, 'next-steps').y).toBe(37);
    // Above it, nothing moves.
    expect(S.cellOf(f, 'academic-summary').y).toBe(5);
    const g = S.place(base(), 'legend', { page: 1, x: 11, y: 16, w: 1 });
    expect(S.cellOf(g, 'legend')).toEqual({ block: 'legend', x: 9, y: 16, w: 3, h: 6 });
    // Over the bottom of a block that started above it, it still takes the place.
    const d = S.place(base(), 'legend', { page: 1, x: 0, y: 10, w: 12 });
    expect(S.cellOf(d, 'legend').y).toBe(10);
    expect(S.cellOf(d, 'learner-dimensions').y).toBe(16);
  });

  it('place without a page uses the last; w and h default to full width and the block’s rows', () => {
    const f = S.place(base(), 'observations', { x: 0, y: 15 });
    expect(S.locate(f, 'observations').page).toBe(1);
    expect(S.cellOf(f, 'observations')).toMatchObject({ x: 0, y: 15, w: 12, h: 16 });
  });

  it('a block placed beside another sits beside it; one placed into the letterhead goes under it', () => {
    let f = S.resize(base(), 'competency-table', { w: 6 });
    f = S.place(f, 'legend', { page: 0, x: 6, y: 19, w: 6, h: 5 });
    expect(S.cellOf(f, 'competency-table')).toMatchObject({ x: 0, y: 19, w: 6 });
    expect(S.cellOf(f, 'legend')).toMatchObject({ x: 6, y: 19, w: 6 });
    const g = S.place(base(), 'legend', { page: 0, x: 0, y: 1, w: 12, h: 5 });
    expect(S.cellOf(g, 'legend').y).toBe(5);
  });

  it('move keeps the block’s size, options and pin; the letterhead cannot be placed, moved or removed', () => {
    let f = S.setOption(base(), 'next-steps', 'ican', 1);
    f = S.move(f, 'next-steps', { page: 1, y: 15 });
    expect(S.locate(f, 'next-steps').page).toBe(1);
    expect(S.cellOf(f, 'next-steps')).toEqual({ block: 'next-steps', x: 0, y: 15, w: 12, h: 8, options: { ican: 1 } });
    expect(ids(f).filter(id => id === 'next-steps')).toHaveLength(1);
    const g = S.move(base(), 'parent-response', { page: 0, y: 40 });
    expect(g.pinned).toBe('parent-response');
    expect(S.place(base(), 'header', { page: 1, y: 3 })).toEqual(base());
    expect(S.move(base(), 'header', { y: 3 })).toEqual(base());
    expect(S.removeCell(base(), 'header')).toEqual(base());
  });

  it('resize clamps to 3–12 columns and at least 2 rows, keeps the block on the grid, and pushes what it covers', () => {
    let f = S.move(S.resize(base(), 'competency-table', { w: 6 }), 'competency-table', { x: 6 });
    expect(S.cellOf(f, 'competency-table')).toMatchObject({ x: 6, w: 6 });
    f = S.resize(f, 'competency-table', { w: 12 });
    expect(S.cellOf(f, 'competency-table')).toMatchObject({ x: 0, w: 12 });
    f = S.resize(f, 'competency-table', { w: 1, h: 0 });
    expect(S.cellOf(f, 'competency-table')).toMatchObject({ w: 3, h: 2 });
    // Taller: the block under it moves down.
    f = S.resize(base(), 'teacher-narrative', { h: 12 });
    expect(S.cellOf(f, 'teacher-narrative').h).toBe(12);
    expect(S.cellOf(f, 'competency-table').y).toBe(23);
    expect(S.resize(base(), 'header', { h: 9 })).toEqual(base());
  });
});

describe('settle, pages and free room', () => {
  it('settle stores each block’s row and page where it landed; continued pages and the letterhead stay put', () => {
    const f = S.settle(S.form(), {
      header: { page: 0, y: 3 },
      'competency-table': { page: 0, y: 19 },
      'next-steps': { page: 1, y: 0 },
      'learner-dimensions': { page: 1, y: 8 },
      'parent-response': { page: 2, y: 0 },
    });
    expect(f.pages[0].blocks[0]).toEqual({ block: 'header', x: 0, y: 0, w: 12 });
    expect(S.cellOf(f, 'competency-table').y).toBe(19);
    expect(S.locate(f, 'next-steps').page).toBe(1);
    expect(S.cellOf(f, 'next-steps').y).toBe(0);
    expect(S.cellOf(f, 'learner-dimensions').y).toBe(8);
    expect(S.locate(f, 'parent-response').page).toBe(1);
    expect(S.settle(S.form(), null)).toEqual(S.form());
  });

  it('addPage adds an empty page; removePage removes only an empty page past the second', () => {
    let f = S.addPage(S.form());
    expect(f.pages).toHaveLength(3);
    expect(f.pages[2].blocks).toEqual([]);
    expect(S.removePage(f, 1)).toEqual(f);
    f = S.removePage(f, 2);
    expect(f.pages).toHaveLength(2);
    const g = S.place(S.addPage(S.form()), 'legend', { page: 2, y: 0 });
    expect(S.removePage(g, 2)).toEqual(g);
  });

  it('firstFree finds the first row where a block fits with nothing in the way', () => {
    const f = S.form();
    expect(S.firstFree(S.removeCell(f, 'legend'), 1, 12, 5)).toEqual({ page: 1, x: 0, y: 15 });
    expect(S.firstFree(S.removeCell(f, 'legend'), 1, 12, 7)).toEqual({ page: 1, x: 0, y: 46 });
    expect(S.firstFree(f, 0, 12, 4)).toEqual({ page: 0, x: 0, y: 40 });
    const half = S.resize(f, 'competency-table', { w: 6 });
    expect(S.firstFree(half, 0, 6, 4)).toEqual({ page: 0, x: 6, y: 19 });
    expect(S.firstFree(f, 5, 12, 4)).toBeNull();
  });
});

describe('cell settings', () => {
  it('removeCell drops the block and the pin if it was pinned, and keeps its page', () => {
    let f = S.removeCell(S.form(), 'parent-response');
    expect(ids(f)).not.toContain('parent-response');
    expect(f.pinned).toBeNull();
    f = S.removeCell(S.removeCell(f, 'learner-dimensions'), 'legend');
    expect(f.pages).toHaveLength(2);
    expect(f.pages[1].blocks).toEqual([]);
  });

  it('setOption, setNoEvidence, setPinned, setType, setPagesPerStudent', () => {
    let f = S.setOption(S.form(), 'competency-table', 'evidence', false);
    expect(S.cellOf(f, 'competency-table').options).toEqual({ evidence: false });
    f = S.setNoEvidence(f, 'competency-table', 'hide');
    expect(S.cellOf(f, 'competency-table').noEvidence).toBe('hide');
    f = S.setPinned(f, null);
    expect(f.pinned).toBeNull();
    f = S.setPinned(f, 'parent-response');
    expect(f.pinned).toBe('parent-response');
    expect(S.setPinned(f, 'legend').pinned).toBeNull();
    expect(S.setType(f, 'compact').type).toBe('compact');
    expect(S.setPagesPerStudent(f, 2).pagesPerStudent).toBe(2);
    expect(S.setPagesPerStudent(f, 7).pagesPerStudent).toBe('auto');
  });

  it('hideFor hides a block for one student and leaves the class layout alone', () => {
    let f = S.hideFor(S.form(), 'stu-1', 'next-steps', true);
    expect(S.hiddenFor(f, 'stu-1')).toEqual(['next-steps']);
    expect(S.hiddenFor(f, 'stu-2')).toEqual([]);
    expect(ids(f)).toEqual(ids(S.form()));
    f = S.hideFor(f, 'stu-1', 'next-steps', false);
    expect(f.perStudent).toEqual({});
  });
});

describe('starters', () => {
  it('are whole v5 forms with real rectangles, nothing overlapping', () => {
    expect(S.starters().map(s => s.id)).toEqual(['report-card', 'interim-update', 'conference-pack']);
    S.starters().forEach(({ id }) => {
      const f = S.starter(id);
      expect(f.v, id).toBe(5);
      expect(f).toEqual(S.normalizeForm(f));
      f.pages.forEach(pg => {
        const bs = pg.blocks.map(b => ({ ...b, h: b.h ?? S.BLOCKS[b.block].rows }));
        bs.forEach((a, i) =>
          bs.slice(i + 1).forEach(b => {
            const cols = a.x < b.x + b.w && b.x < a.x + a.w;
            const rows = a.y < b.y + b.h && b.y < a.y + a.h;
            expect(cols && rows, `${id}: ${a.block} and ${b.block}`).toBe(false);
          }),
        );
      });
    });
    const interim = S.starter('interim-update');
    expect(ids(interim)).toEqual(['header', 'academic-summary', 'teacher-narrative', 'next-steps', 'legend']);
    expect(interim.pages).toHaveLength(1);
    expect(interim.pinned).toBeNull();
    expect(ids(S.starter('conference-pack'))).toContain('grade-table');
    expect(S.starter('nope')).toBeNull();
  });
});

describe('block options', () => {
  it('optionsFor fills the registry defaults and adds the no-evidence rule', () => {
    const f = S.form();
    expect(S.optionsFor(S.cellOf(f, 'competency-table'))).toEqual({
      evidence: true,
      ican: false,
      assignments: false,
      noEvidence: 'show',
    });
    const g = S.setNoEvidence(S.setOption(f, 'competency-table', 'evidence', false), 'competency-table', 'hide');
    expect(S.optionsFor(S.cellOf(g, 'competency-table'))).toMatchObject({ evidence: false, noEvidence: 'hide' });
    expect(S.optionsFor(S.cellOf(f, 'next-steps'))).toEqual({ ican: 2 });
    expect(S.optionsFor(S.cellOf(f, 'learner-dimensions'))).toEqual({ descriptions: false, examples: false });
    expect(S.optionsFor(S.cellOf(f, 'teacher-narrative'))).toEqual({});
  });

  it('every option in the registry has a key, a Title Case label and a default', () => {
    Object.entries(S.BLOCKS).forEach(([id, def]) => {
      (def.options || []).forEach(o => {
        expect(typeof o.key, id).toBe('string');
        expect(o.label.charAt(0), id + ' ' + o.key).toMatch(/[A-Z]/);
        expect(o.def, id + ' ' + o.key).not.toBeUndefined();
      });
    });
  });
});

describe('rendering with options', () => {
  it('the text block prints its title and text, and nothing when empty', () => {
    expect(ReportBlocks.renderReportBlock('text-block', 'c1', {}, {}, {})).toBe('');
    const html = ReportBlocks.renderReportBlock(
      'text-block',
      'c1',
      {},
      {},
      {
        title: 'Upcoming',
        text: 'Science fair\non Nov 30 <b>',
      },
    );
    expect(html).toContain('Upcoming');
    expect(html).toContain('Science fair<br>on Nov 30 &lt;b&gt;');
  });
});

describe('the letterhead keeps its options', () => {
  it('through normalizeForm and any later edit', () => {
    let f = ReportSheets.setOption(ReportSheets.form(), 'header', 'studentNumber', false);
    expect(ReportSheets.cellOf(f, 'header').options).toEqual({ studentNumber: false });
    f = ReportSheets.place(f, 'legend', { page: 1, y: 12 });
    expect(ReportSheets.cellOf(f, 'header').options).toEqual({ studentNumber: false });
  });
});
