/**
 * The layout model behind Page Studio (teacher/report-sheets.js): pages of
 * rows of cells with spans, migration from every earlier shape, and the
 * pure helpers the Studio calls. docs/DECISIONS.md "Report forms".
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const S = ReportSheets;
const rows = pg => pg.rows.map(r => r.cells.map(c => c.block + (c.span !== 12 ? ':' + c.span : '')));
const ids = f => S.onForm(f);

describe('normalizeForm', () => {
  it('is the Report Card when nothing is saved', () => {
    const f = S.normalizeForm(undefined);
    expect(f.v).toBe(4);
    expect(rows(f.pages[0])).toEqual([
      ['header'],
      ['academic-summary'],
      ['teacher-narrative'],
      ['competency-table'],
      ['next-steps'],
    ]);
    expect(rows(f.pages[1])).toEqual([['learner-dimensions'], ['parent-response']]);
    expect(f.pinned).toBe('parent-response');
    expect(S.cellOf(f, 'teacher-narrative')).toMatchObject({ height: 'fixed', lines: 8, whenEmpty: 'box' });
    expect(f.pagesPerStudent).toBe('auto');
    expect(f.type).toBe('standard');
  });

  it('migrates a v3 form: lists become pages, a pair a 6+6 row, room a fixed height, the pin the form’s', () => {
    const f = S.normalizeForm({
      v: 3,
      type: 'compact',
      front: [
        { block: 'header' },
        { block: 'teacher-narrative', room: { lines: 5 }, whenEmpty: 'box' },
        { pair: [{ block: 'competency-table' }, { block: 'attendance' }] },
      ],
      back: [{ block: 'learner-dimensions' }, { block: 'parent-response', pinned: 'bottom' }],
    });
    expect(f.v).toBe(4);
    expect(f.type).toBe('compact');
    expect(rows(f.pages[0])).toEqual([['header'], ['teacher-narrative'], ['competency-table:6', 'attendance:6']]);
    expect(rows(f.pages[1])).toEqual([['learner-dimensions'], ['parent-response']]);
    expect(S.cellOf(f, 'teacher-narrative')).toMatchObject({ height: 'fixed', lines: 5 });
    expect(f.pinned).toBe('parent-response');
  });

  it('drops unknown blocks and duplicates, leads with the letterhead, balances spans, keeps one page at least', () => {
    const f = S.normalizeForm({
      v: 4,
      pages: [
        { rows: [{ cells: [{ block: 'bogus' }, { block: 'legend', span: 5 }] }, { cells: [{ block: 'header' }] }] },
        {
          rows: [{ cells: [{ block: 'legend' }, { block: 'next-steps', span: 9 }, { block: 'attendance', span: 1 }] }],
        },
        { rows: [] },
      ],
      pinned: 'legend',
      perStudent: { s1: { hide: ['legend', 'header', 'nope'] }, s2: { hide: [] } },
    });
    expect(rows(f.pages[0])).toEqual([['header'], ['legend']]);
    expect(rows(f.pages[1])).toEqual([['next-steps:6', 'attendance:6']]);
    expect(f.pages).toHaveLength(2);
    expect(f.pinned).toBeNull();
    expect(f.perStudent).toEqual({ s1: { hide: ['legend'] } });
  });

  it('formFor opens an old Brief class on the Interim Update and anything else on the Report Card', () => {
    expect(S.formFor({ preset: 'brief', blocks: [] }).id).toBe('interim-update');
    expect(S.formFor({ preset: 'detailed', blocks: [] }).id).toBe('report-card');
    expect(S.formFor(null).id).toBe('report-card');
    expect(
      S.formFor({ form: { v: 3, front: [{ block: 'header' }, { block: 'legend' }], back: [] } }).pages[0].rows,
    ).toHaveLength(2);
  });
});

describe('placing and removing', () => {
  const base = () => S.form();

  it('placeBlock with no place appends a full row to the last page', () => {
    const f = S.placeBlock(base(), 'legend');
    expect(rows(f.pages[1]).pop()).toEqual(['legend']);
    expect(S.positionText(f, 'legend')).toBe('Page 2 · row 3');
  });

  it('placeBlock before or after a row makes a new row there', () => {
    let f = S.placeBlock(base(), 'legend', { page: 0, row: 1, side: 'before' });
    expect(rows(f.pages[0])[1]).toEqual(['legend']);
    f = S.placeBlock(base(), 'legend', { page: 0, row: 1, side: 'after' });
    expect(rows(f.pages[0])[2]).toEqual(['legend']);
  });

  it('placeBlock left or right of a row makes a column and balances the spans', () => {
    let f = S.placeBlock(base(), 'attendance', { page: 0, row: 3, side: 'right' });
    expect(rows(f.pages[0])[3]).toEqual(['competency-table:6', 'attendance:6']);
    expect(S.positionText(f, 'attendance')).toBe('Page 1 · row 4 · right');
    f = S.placeBlock(f, 'legend', { page: 0, row: 3, side: 'left' });
    expect(rows(f.pages[0])[3]).toEqual(['legend:4', 'competency-table:4', 'attendance:4']);
    // A fourth cell does not fit a row; it goes after it instead.
    f = S.placeBlock(f, 'observations', { page: 0, row: 3, side: 'right' });
    expect(rows(f.pages[0])[4]).toEqual(['observations']);
  });

  it('placing a block already on the form moves it; the letterhead cannot be placed or removed', () => {
    let f = S.placeBlock(base(), 'next-steps', { page: 0, row: 1, side: 'before' });
    expect(ids(f).filter(id => id === 'next-steps')).toHaveLength(1);
    expect(rows(f.pages[0])[1]).toEqual(['next-steps']);
    expect(S.placeBlock(base(), 'header', { page: 1, row: 0, side: 'after' })).toEqual(base());
    expect(S.removeCell(base(), 'header')).toEqual(base());
  });

  it('placeOnNewPage adds a page', () => {
    const f = S.placeOnNewPage(base(), 'grade-table');
    expect(f.pages).toHaveLength(3);
    expect(rows(f.pages[2])).toEqual([['grade-table']]);
  });

  it('removeCell drops the cell, its empty row, a trailing empty page, and the pin if it was pinned', () => {
    let f = S.removeCell(base(), 'parent-response');
    expect(rows(f.pages[1])).toEqual([['learner-dimensions']]);
    expect(f.pinned).toBeNull();
    f = S.removeCell(f, 'learner-dimensions');
    expect(f.pages).toHaveLength(1);
    f = S.placeBlock(base(), 'attendance', { page: 0, row: 3, side: 'right' });
    f = S.removeCell(f, 'competency-table');
    expect(rows(f.pages[0])[3]).toEqual(['attendance']);
  });
});

describe('cell settings', () => {
  const two = () => S.placeBlock(S.form(), 'attendance', { page: 0, row: 3, side: 'right' });

  it('setSpan on a two-cell row gives the other cell the rest; full width moves the other to its own row', () => {
    let f = S.setSpan(two(), 'competency-table', 8);
    expect(rows(f.pages[0])[3]).toEqual(['competency-table:8', 'attendance:4']);
    f = S.setSpan(f, 'attendance', 8);
    expect(rows(f.pages[0])[3]).toEqual(['competency-table:4', 'attendance:8']);
    f = S.setSpan(f, 'competency-table', 12);
    expect(rows(f.pages[0])[3]).toEqual(['competency-table']);
    expect(rows(f.pages[0])[4]).toEqual(['attendance']);
    expect(S.setSpan(S.form(), 'competency-table', 6)).toEqual(S.form());
  });

  it('setHeight, setWhenEmpty, setOption, setNoEvidence, setPinned, setType, setPagesPerStudent', () => {
    let f = S.setHeight(S.form(), 'teacher-narrative', 'fit');
    expect(S.cellOf(f, 'teacher-narrative').height).toBe('fit');
    f = S.setHeight(f, 'teacher-narrative', 'fixed', 99);
    expect(S.cellOf(f, 'teacher-narrative')).toMatchObject({ height: 'fixed', lines: 20 });
    f = S.setWhenEmpty(f, 'teacher-narrative', 'omit');
    expect(S.cellOf(f, 'teacher-narrative').whenEmpty).toBe('omit');
    f = S.setOption(f, 'competency-table', 'evidence', false);
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
  it('are whole v4 forms', () => {
    expect(S.starters().map(s => s.id)).toEqual(['report-card', 'interim-update', 'conference-pack']);
    const interim = S.starter('interim-update');
    expect(rows(interim.pages[0])).toEqual([
      ['header'],
      ['academic-summary'],
      ['teacher-narrative'],
      ['next-steps'],
      ['legend'],
    ]);
    expect(interim.pages).toHaveLength(1);
    expect(interim.pinned).toBeNull();
    expect(ids(S.starter('conference-pack'))).toContain('grade-table');
    expect(S.starter('nope')).toBeNull();
  });
});
