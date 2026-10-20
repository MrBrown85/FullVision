/**
 * Print Grades: the class grade sheet (teacher/grades-print.js). The pure
 * parts: titles, columns, summary columns, cells, capacity, pagination,
 * the header and the key. The e2e (e2e/grades-print.spec.js) prints the
 * demo class to PDF and counts the pages.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const GP = window.GradesPrint;
const CID = 'gp-class';

const students = [
  { id: 's1', firstName: 'Ada', lastName: 'Lovelace', studentNumber: '1001' },
  { id: 's2', firstName: 'Alan', lastName: 'Turing', studentNumber: '1002' },
  { id: 's3', firstName: 'Grace', lastName: 'Hopper', studentNumber: '1003' },
];
const categories = [
  { id: 'cat-labs', name: 'Labs', weight: 60, displayOrder: 0 },
  { id: 'cat-quiz', name: 'Quizzes', weight: 40, displayOrder: 1 },
];
const assessments = [
  {
    id: 'q1',
    title: 'Quiz 1',
    date: '2026-09-12',
    scoreMode: 'points',
    maxPoints: 10,
    categoryId: 'cat-quiz',
    tagIds: [],
  },
  {
    id: 'l1',
    title: 'Cell Structure Lab',
    date: '2026-09-09',
    scoreMode: 'proficiency',
    categoryId: 'cat-labs',
    tagIds: ['T1'],
  },
  {
    id: 'l2',
    title: 'Photosynthesis vs Respiration Comparison',
    date: '2026-11-20',
    scoreMode: 'proficiency',
    categoryId: 'cat-labs',
    tagIds: ['T1'],
  },
  { id: 'hw', title: 'Homework', date: '2026-09-15', scoreMode: 'complete', maxPoints: 1, tagIds: [] },
  { id: 'u1', title: 'Undated Reflection', date: '', scoreMode: 'proficiency', categoryId: 'cat-labs', tagIds: ['T1'] },
];
const terms = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-31' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-01', ends_on: '2027-01-31' },
];

function seed(extra = {}) {
  COURSES[CID] = Object.assign({ id: CID, name: 'Science 8', block: 'A', gradingSystem: 'proficiency' }, extra.course);
  _cache.students[CID] = students;
  _cache.assessments[CID] = assessments;
  _cache.categories[CID] = categories;
  _cache.statuses[CID] = extra.statuses || { 's2:l1': 'NS', 's3:q1': 'LATE' };
  _cache.courseConfigs[CID] = { reportingTerms: terms };
  _cache.rubrics[CID] = [];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SCI8', name: 'Science 8', color: '#000' }],
    sections: [
      {
        id: 'SEC1',
        subject: 'SCI8',
        name: 'Questioning',
        shortName: 'Questioning',
        color: '#000',
        tags: [{ id: 'T1', label: 'Question', text: '', color: '#000', subject: 'SCI8', i_can_statements: [] }],
      },
    ],
  };
  _cache.scores[CID] = {
    s1: [
      { assessmentId: 'q1', tagId: 'overall', score: 8 },
      { assessmentId: 'l1', tagId: 'T1', score: 3, mod: 1 },
      { assessmentId: 'hw', tagId: 'overall', score: 1 },
    ],
    s2: [{ assessmentId: 'q1', tagId: 'overall', score: 6 }],
    s3: [
      { assessmentId: 'q1', tagId: 'overall', score: 9 },
      { assessmentId: 'l1', tagId: 'T1', score: 4 },
      { assessmentId: 'hw', tagId: 'overall', score: 0 },
    ],
  };
  clearProfCache();
  setActiveTerm(CID, null);
}

beforeEach(() => {
  localStorage.clear();
  seed();
});

describe('shortTitleLines', () => {
  it('breaks at spaces within the line length', () => {
    expect(GP.shortTitleLines('Cell Structure Lab', 9, 3)).toEqual({ lines: ['Cell', 'Structure', 'Lab'], cut: false });
  });

  it('keeps a number with the word before it', () => {
    expect(GP.shortTitleLines('Unit Quiz 10', 9, 3).lines).toEqual(['Unit', 'Quiz 10']);
  });

  it('ends a word longer than a line with an ellipsis and sends the title to the key', () => {
    expect(GP.shortTitleLines('Cell Microscope Lab', 9, 3)).toEqual({
      lines: ['Cell', 'Microsco\u2026', 'Lab'],
      cut: true,
    });
  });

  it('prints month and day under a column and the full date in the key', () => {
    const col = GP.columnsFor(CID, GP.normalizeOptions({})).find(c => c.id === 'l1');
    expect(col.dateText).toBe('Sep 9');
    expect(col.dateLong).toBe('Sep 9, 2026');
  });

  it('ends a title that runs out of room with an ellipsis', () => {
    const t = GP.shortTitleLines('Photosynthesis vs Respiration Comparison', 9, 3);
    expect(t.cut).toBe(true);
    expect(t.lines).toHaveLength(3);
    expect(t.lines[2].endsWith('…')).toBe(true);
    t.lines.forEach(l => expect(l.length).toBeLessThanOrEqual(9));
  });
});

describe('columnsFor', () => {
  it('groups by category in category order, by date inside, no category last, numbered', () => {
    const cols = GP.columnsFor(CID, GP.normalizeOptions({}));
    expect(cols.map(c => c.id)).toEqual(['l1', 'l2', 'u1', 'q1', 'hw']);
    expect(cols.map(c => c.n)).toEqual([1, 2, 3, 4, 5]);
    expect(cols[3]).toMatchObject({ catName: 'Quizzes', outOf: 10, dateText: expect.any(String) });
    expect(cols[4]).toMatchObject({ catName: 'No Category', complete: true, outOf: null });
  });

  it('keeps a term to its dates and leaves undated work out unless asked', () => {
    const t1 = GP.columnsFor(CID, GP.normalizeOptions({ term: '1' }));
    expect(t1.map(c => c.id)).toEqual(['l1', 'q1', 'hw']);
    const withUndated = GP.columnsFor(CID, GP.normalizeOptions({ term: '1', undated: true }));
    expect(withUndated.map(c => c.id)).toEqual(['l1', 'u1', 'q1', 'hw']);
  });

  it('keeps a custom range to its dates', () => {
    const cols = GP.columnsFor(CID, GP.normalizeOptions({ term: 'custom', from: '2026-09-10', to: '2026-09-30' }));
    expect(cols.map(c => c.id)).toEqual(['q1', 'hw']);
  });

  it('prints only the columns the gradebook shows, or the picked ones', () => {
    expect(GP.columnsFor(CID, GP.normalizeOptions({ assessments: 'shown', shownIds: ['q1'] })).map(c => c.id)).toEqual([
      'q1',
    ]);
    expect(
      GP.columnsFor(CID, GP.normalizeOptions({ assessments: 'pick', picked: ['hw', 'l1'] })).map(c => c.id),
    ).toEqual(['l1', 'hw']);
  });
});

describe('summaryColumnsFor', () => {
  it('has a category average per category and the overall grade', () => {
    const s = GP.summaryColumnsFor(CID, GP.normalizeOptions({}));
    expect(s.map(c => c.label)).toEqual(['Labs', 'Quizzes', 'Overall']);
  });

  it('is empty for a custom range or a blank sheet, and follows the switches', () => {
    expect(
      GP.summaryColumnsFor(CID, GP.normalizeOptions({ term: 'custom', from: '2026-09-01', to: '2026-12-01' })),
    ).toEqual([]);
    expect(GP.summaryColumnsFor(CID, GP.normalizeOptions({ blank: true }))).toEqual([]);
    expect(GP.summaryColumnsFor(CID, GP.normalizeOptions({ categoryAverages: false })).map(c => c.kind)).toEqual([
      'overall',
    ]);
  });

  it('widens the overall column for a class that shows letters', () => {
    const prof = GP.summaryColumnsFor(CID, GP.normalizeOptions({})).pop().w;
    seed({ course: { gradingSystem: 'letter' } });
    const letter = GP.summaryColumnsFor(CID, GP.normalizeOptions({})).pop().w;
    expect(letter).toBeGreaterThan(prof);
  });

  it('prints a class that shows both grades on two-line rows, the level over the %', () => {
    seed({ course: { gradingSystem: 'both' } });
    const model = GP.buildModel(CID, {});
    expect(model.layout.twoLine).toBe(true);
    const html = GP.renderPages(model);
    expect(html).toContain('gp-two-line');
    expect(html).toMatch(/3\.3<div class="gp-sub">83%<\/div>/);
  });
});

describe('cellText', () => {
  const col = id => GP.columnsFor(CID, GP.normalizeOptions({})).find(c => c.id === id);

  it('prints what the Scores view shows', () => {
    const opts = GP.normalizeOptions({});
    expect(GP.cellText(CID, 's1', col('q1'), opts)).toMatchObject({ text: '8', mark: '' });
    expect(GP.cellText(CID, 's1', col('l1'), opts)).toMatchObject({ text: '3.3' });
    expect(GP.cellText(CID, 's2', col('l1'), opts)).toMatchObject({ text: 'NS', mark: 'NS' });
    expect(GP.cellText(CID, 's1', col('hw'), opts)).toMatchObject({ text: '✓', mark: '✓' });
    expect(GP.cellText(CID, 's3', col('hw'), opts)).toMatchObject({ text: '✗', mark: '✗' });
    expect(GP.cellText(CID, 's2', col('hw'), opts)).toMatchObject({ text: '—', mark: '—' });
  });

  it('marks late work only when Late Marks is on', () => {
    expect(GP.cellText(CID, 's3', col('q1'), GP.normalizeOptions({})).late).toBe(true);
    expect(GP.cellText(CID, 's3', col('q1'), GP.normalizeOptions({ late: false })).late).toBeFalsy();
  });

  it('prints points as levels, or both', () => {
    expect(GP.cellText(CID, 's1', col('q1'), GP.normalizeOptions({ scoresAs: 'levels' })).text).toBe(
      formatLevel(CID, 3.2),
    );
    const both = GP.cellText(CID, 's1', col('q1'), GP.normalizeOptions({ scoresAs: 'both' }));
    expect(both).toMatchObject({ text: '8', sub: formatLevel(CID, 3.2) });
  });

  it('prints nothing on a blank sheet', () => {
    expect(GP.cellText(CID, 's1', col('q1'), GP.normalizeOptions({ blank: true })).text).toBe('');
  });

  it('follows a Letter class', () => {
    seed({ course: { gradingSystem: 'letter' } });
    expect(GP.cellText(CID, 's1', col('l1'), GP.normalizeOptions({})).text).toBe('83%');
  });
});

describe('pageCapacity and paginate', () => {
  const summary3 = [{ w: 0.5 }, { w: 0.5 }, { w: 0.5 }, { w: 0.45 }];

  it('fits more columns on Legal than Letter and more at Compact than Normal', () => {
    const letter = GP.pageCapacity(GP.normalizeOptions({}), summary3);
    const legal = GP.pageCapacity(GP.normalizeOptions({ paper: 'legal' }), summary3);
    const compact = GP.pageCapacity(GP.normalizeOptions({ size: 'compact' }), summary3);
    expect(letter).toMatchObject({ full: 15, withSummary: 11 });
    expect(legal).toMatchObject({ full: 21, withSummary: 17 });
    expect(compact.full).toBeGreaterThan(letter.full);
    expect(GP.pageCapacity(GP.normalizeOptions({ studentNumbers: true }), summary3).full).toBeLessThan(letter.full);
  });

  it('fits fewer rows when the key needs more lines and when rows hold two lines', () => {
    const opts = GP.normalizeOptions({});
    expect(GP.rowCapacity(opts, 1, false)).toBeGreaterThan(GP.rowCapacity(opts, 4, false));
    expect(GP.rowCapacity(opts, 1, true)).toBeLessThan(GP.rowCapacity(opts, 1, false));
    expect(GP.rowCapacity(GP.normalizeOptions({ size: 'compact' }), 1, false)).toBeGreaterThan(
      GP.rowCapacity(opts, 1, false),
    );
  });

  it('puts every column on exactly one page, the summary beside the last', () => {
    [0, 1, 11, 12, 15, 26, 37, 60].forEach(n => {
      const blocks = GP.columnBlocks(n, 15, 11, true);
      const total = blocks.reduce((t, b) => t + b.count, 0);
      expect(total).toBe(n);
      blocks.slice(0, -1).forEach(b => expect(b.count).toBeLessThanOrEqual(15));
      expect(blocks[blocks.length - 1].count).toBeLessThanOrEqual(11);
      blocks.forEach((b, i) => i && expect(b.start).toBe(blocks[i - 1].start + blocks[i - 1].count));
    });
  });

  it('gives the summary its own page when it leaves no room for a column', () => {
    expect(GP.columnBlocks(5, 5, 0, true)).toEqual([
      { start: 0, count: 5 },
      { start: 5, count: 0 },
    ]);
  });

  it('pages the demo-sized class: 27 students, 37 columns, Letter and Legal', () => {
    const cols = Array.from({ length: 37 }, (_, i) => ({ n: i + 1, cut: false, outOf: null }));
    const letter = GP.paginate(cols, summary3, 27, GP.normalizeOptions({}));
    expect(letter.pages).toHaveLength(3);
    expect(letter.pages.filter(p => p.summary)).toHaveLength(1);
    expect(letter.pages[2].summary).toBe(true);
    const legal = GP.paginate(cols, summary3, 27, GP.normalizeOptions({ paper: 'legal' }));
    expect(legal.pages).toHaveLength(2);
  });

  it('runs every column page of one student block before the next block', () => {
    const cols = Array.from({ length: 20 }, (_, i) => ({ n: i + 1, cut: false, outOf: null }));
    const out = GP.paginate(cols, summary3, 70, GP.normalizeOptions({}));
    const order = out.pages.map(p => p.students.start + ':' + p.cols.start);
    expect(out.pages.length).toBe(6);
    expect(order).toEqual(['0:0', '0:10', '24:0', '24:10', '48:0', '48:10']);
    expect(out.pages.filter(p => p.summary)).toHaveLength(3);
  });
});

describe('buildModel', () => {
  it('reads term grades and puts the gradebook term back', () => {
    setActiveTerm(CID, 2);
    const model = GP.buildModel(CID, { term: '1' });
    expect(getActiveTerm(CID).ordinal).toBe(2);
    expect(model.columns.map(c => c.id)).toEqual(['l1', 'q1', 'hw']);
    expect(model.header.period).toContain('Term 1');
  });

  it('carries the class header and only the marks it uses', () => {
    getConfig().displayName = 'Colin Brown';
    const model = GP.buildModel(CID, {});
    expect(model.header.title).toBe('Science 8 · Block A');
    expect(model.header.teacher).toBe('Colin Brown');
    expect(model.header.counts).toBe('3 Students · 5 Assessments · Scores as Entered');
    expect(model.marks.map(m => m.key).sort()).toEqual(['L', 'NS', '—', '✓', '✗'].sort());
  });

  it('prints overall grades and averages through calc.js', () => {
    const model = GP.buildModel(CID, {});
    const overallIdx = model.summary.findIndex(s => s.kind === 'overall');
    model.rows.forEach(r => {
      expect(r.summary[overallIdx]).toBe(studentGradeSummary(CID, r.id).text || '—');
    });
    expect(model.averages.summary[overallIdx]).toBe(classGradeSummary(CID, ['s3', 's1', 's2']).text);
    const quiz = model.columns.findIndex(c => c.id === 'q1');
    expect(model.averages.cells[quiz]).toBe('7.7');
  });

  it('sorts by last name as "Last, First", or by first name', () => {
    expect(GP.buildModel(CID, {}).rows.map(r => r.name)).toEqual(['Hopper, Grace', 'Lovelace, Ada', 'Turing, Alan']);
    expect(GP.buildModel(CID, { sortBy: 'first' }).rows.map(r => r.name)).toEqual([
      'Ada Lovelace',
      'Alan Turing',
      'Grace Hopper',
    ]);
  });

  it('lists the cut titles of a page in its key', () => {
    const model = GP.buildModel(CID, {});
    const key = GP.keyLines(model, model.pages[0]);
    expect(key.titles.map(t => t.text)).toEqual([
      'Photosynthesis vs Respiration Comparison (Nov 20, 2026)',
      'Undated Reflection',
    ]);
    expect(key.marks[0]).toMatch(/^\S+ [A-Z]/);
  });

  it('has a status line with students, columns and pages', () => {
    expect(GP.statusText(GP.buildModel(CID, {}))).toBe('3 students · 5 columns · 1 page.');
    expect(GP.statusText(GP.buildModel(CID, { assessments: 'pick', picked: [] }))).toBe('No assessments to print.');
  });
});

describe('renderPages', () => {
  it('draws one page per page of the model with Title Case labels and no sentences', () => {
    const model = GP.buildModel(CID, { studentNumbers: true });
    const html = GP.renderPages(model);
    expect((html.match(/class="gp-page/g) || []).length).toBe(model.pages.length);
    expect(html).toContain('Category Averages');
    expect(html).toContain('Class Average');
    expect(html).toContain('Student No.');
    expect(html).toContain('Page 1 of 1');
    expect(html).not.toMatch(/toFixed|NaN|undefined/);
  });
});
