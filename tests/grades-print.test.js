/**
 * Print Grades: the class grade sheet (teacher/grades-print.js). The pure
 * parts: titles, columns, summary columns, cells, capacity, pagination,
 * the header and the key. The e2e (e2e/grades-print.spec.js) prints the
 * demo class to PDF and counts the pages.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('page geometry', () => {
  it('holds more columns at Compact, fewer with pupil numbers, the same on Legal', () => {
    const letter = GP.pageCapacity(GP.normalizeOptions({}));
    expect(letter.full).toBe(16);
    expect(GP.pageCapacity(GP.normalizeOptions({ paper: 'legal' })).full).toBe(16);
    expect(GP.pageCapacity(GP.normalizeOptions({ size: 'compact' })).full).toBe(19);
    expect(GP.pageCapacity(GP.normalizeOptions({ students: 'name' })).full).toBe(18);
  });

  it('holds more rows on Legal and at Compact, fewer when rows hold two lines', () => {
    const opts = GP.normalizeOptions({});
    expect(GP.rowCapacity(opts, false)).toBe(32);
    expect(GP.rowCapacity(GP.normalizeOptions({ paper: 'legal' }), false)).toBe(46);
    expect(GP.rowCapacity(opts, true)).toBeLessThan(GP.rowCapacity(opts, false));
    expect(GP.rowCapacity(GP.normalizeOptions({ size: 'compact' }), false)).toBeGreaterThan(
      GP.rowCapacity(opts, false),
    );
  });

  it('stretches items to fill a space, adding blank ones past their most', () => {
    expect(GP.fill(7, 28, 0.3)).toEqual({ size: 0.25, blank: 0 });
    expect(GP.fill(6, 4, 0.3)).toEqual({ size: 0.3, blank: 16 });
    expect(GP.fill(5, 0, 0.5)).toEqual({ size: 0.5, blank: 10 });
  });

  it('pages the demo-sized class: 27 students and 37 columns on 3 Letter pages, 2 at Compact', () => {
    const cols = Array.from({ length: 37 }, (_, i) => ({ n: i + 1, outOf: null }));
    const letter = GP.paginate(cols, 27, GP.normalizeOptions({}));
    expect(letter.pages.map(p => p.cols.count)).toEqual([13, 13, 11]);
    expect(GP.paginate(cols, 27, GP.normalizeOptions({ paper: 'legal' })).pages).toHaveLength(3);
    expect(GP.paginate(cols, 27, GP.normalizeOptions({ size: 'compact' })).pages).toHaveLength(2);
  });

  it('fills every page to its foot and right edge', () => {
    const opts = GP.normalizeOptions({});
    const cols = Array.from({ length: 37 }, (_, i) => ({ n: i + 1, outOf: null }));
    const out = GP.paginate(cols, 27, opts);
    const width = GP.pageCapacity(opts).width;
    out.pages.forEach(p => {
      const rows = p.students.count + p.blankRows + 1;
      expect(rows * p.rowH).toBeCloseTo(out.gridH, 1);
      expect((p.cols.count + p.blankCols) * p.colW).toBeCloseTo(width, 1);
    });
  });

  it('adds blank rows and columns when the class is small', () => {
    const cols = Array.from({ length: 3 }, (_, i) => ({ n: i + 1, outOf: null }));
    const [page] = GP.paginate(cols, 3, GP.normalizeOptions({})).pages;
    expect(page.blankRows).toBeGreaterThan(0);
    expect(page.blankCols).toBeGreaterThan(0);
    expect(page.rowH).toBeLessThanOrEqual(0.31);
    expect(page.colW).toBeLessThanOrEqual(0.51);
  });

  it('runs every column page of one student block before the next block', () => {
    const cols = Array.from({ length: 20 }, (_, i) => ({ n: i + 1, outOf: null }));
    const out = GP.paginate(cols, 70, GP.normalizeOptions({}));
    const order = out.pages.map(p => p.students.start + ':' + p.cols.start);
    expect(order).toEqual(['0:0', '0:10', '24:0', '24:10', '48:0', '48:10']);
    // Every column page of a student block shares its row height.
    expect(out.pages[0].rowH).toBe(out.pages[1].rowH);
  });
});

describe('buildModel', () => {
  it('reads the term and puts the gradebook term back', () => {
    setActiveTerm(CID, 2);
    const model = GP.buildModel(CID, { term: '1' });
    expect(getActiveTerm(CID).ordinal).toBe(2);
    expect(model.columns.map(c => c.id)).toEqual(['l1', 'q1', 'hw']);
    expect(model.header.period).toContain('Term 1');
  });

  it('carries the class header and only the marks it uses', () => {
    getConfig().displayName = 'Colin Brown';
    const model = GP.buildModel(CID, {});
    expect(model.header).toMatchObject({
      className: 'Science 8',
      block: 'A',
      teacher: 'Colin Brown',
      students: '3',
      scores: 'As Entered',
    });
    expect(model.header.printed).toMatch(/\d{4}, \d{1,2}:\d{2}/);
    expect(model.marks.map(m => m.key).sort()).toEqual(['L', 'NS', '—', '✓', '✗'].sort());
  });

  it('prints no category averages, only the final grade at the right', () => {
    const model = GP.buildModel(CID, {});
    const html = GP.renderPages(model);
    expect(html).not.toContain('Category Averages');
    expect(html).toContain('Final Grade');
    expect(model.final.w).toBe(GP.SIZES.normal.finalW.proficiency);
    model.rows.forEach(r => expect(r.final).toBe(studentGradeSummary(CID, r.id).text || '\u2014'));
    expect(model.rows.find(r => r.id === 's3').final).toBe('4.0');
    expect(model.averages.final).toBe(classGradeSummary(CID, ['s3', 's1', 's2']).text);
  });

  it('leaves the final grade off when switched off, for custom dates, and on a blank sheet', () => {
    [{ finalGrade: false }, { term: 'custom', from: '2026-09-01', to: '2026-12-01' }, { blank: true }].forEach(o => {
      const model = GP.buildModel(CID, o);
      expect(model.final).toBeNull();
      expect(GP.renderPages(model)).not.toContain('Final Grade');
    });
  });

  it('puts the final grade on the last column page of each student block only', () => {
    const cols = Array.from({ length: 37 }, (_, i) => ({ n: i + 1, outOf: null }));
    const out = GP.paginate(cols, 27, GP.normalizeOptions({}), false, 0.5);
    expect(out.pages.map(p => p.final)).toEqual([false, false, true]);
    const total = out.pages.reduce((t, p) => t + p.cols.count, 0);
    expect(total).toBe(37);
    const last = out.pages[2];
    expect((last.cols.count + last.blankCols) * last.colW).toBeCloseTo(
      GP.pageCapacity(GP.normalizeOptions({}), 0.5).widthWithFinal,
      1,
    );
  });

  it('follows a Letter class in the final grade column', () => {
    seed({ course: { gradingSystem: 'letter' } });
    const model = GP.buildModel(CID, {});
    expect(model.rows.find(r => r.id === 's3').final).toMatch(/^[A-F][+-]? \d+%$/);
    expect(model.final.w).toBe(GP.SIZES.normal.finalW.letter);
  });

  it('prints names and pupil numbers, names only, or pupil numbers only', () => {
    const both = GP.renderPages(GP.buildModel(CID, { students: 'both' }));
    expect(both).toContain('Pupil #');
    expect(both).toContain('>Name<');
    const names = GP.renderPages(GP.buildModel(CID, { students: 'name' }));
    expect(names).not.toContain('Pupil #');
    expect(names).toContain('Lovelace, Ada');
    const numbers = GP.renderPages(GP.buildModel(CID, { students: 'number' }));
    expect(numbers).toContain('Pupil #');
    expect(numbers).not.toContain('>Name<');
    expect(numbers).not.toContain('Lovelace');
    expect(numbers).toContain('1001');
    // The number column alone is wide enough for "Class Average".
    expect(GP.pageCapacity(GP.normalizeOptions({ students: 'number' })).width).toBeGreaterThan(
      GP.pageCapacity(GP.normalizeOptions({ students: 'both' })).width,
    );
  });

  it('sorts by pupil number in numeric order', () => {
    _cache.students[CID] = [
      { id: 'a', firstName: 'A', lastName: 'A', studentNumber: '10' },
      { id: 'b', firstName: 'B', lastName: 'B', studentNumber: '9' },
      { id: 'c', firstName: 'C', lastName: 'C', studentNumber: '100' },
    ];
    expect(GP.buildModel(CID, { sortBy: 'number' }).rows.map(r => r.studentNumber)).toEqual(['9', '10', '100']);
  });

  it('reads the old Pupil Numbers box as Name Only', () => {
    expect(GP.normalizeOptions({ studentNumbers: false }).students).toBe('name');
    expect(GP.normalizeOptions({ studentNumbers: true }).students).toBe('both');
  });

  it('averages each assignment through calc.js', () => {
    const model = GP.buildModel(CID, {});
    const quiz = model.columns.findIndex(c => c.id === 'q1');
    expect(model.averages.cells[quiz]).toBe('7.7');
    const lab = model.columns.findIndex(c => c.id === 'l1');
    expect(model.averages.cells[lab]).toBe(formatLevel(CID, (3 + 1 / 3 + 4) / 2));
  });

  it('sorts by last name as "Last, First", or by first name', () => {
    expect(GP.buildModel(CID, {}).rows.map(r => r.name)).toEqual(['Hopper, Grace', 'Lovelace, Ada', 'Turing, Alan']);
    expect(GP.buildModel(CID, { sortBy: 'first' }).rows.map(r => r.name)).toEqual([
      'Ada Lovelace',
      'Alan Turing',
      'Grace Hopper',
    ]);
  });

  it('has a status line with students, columns and pages', () => {
    expect(GP.statusText(GP.buildModel(CID, {}))).toBe('3 students · 5 columns · 1 page.');
    expect(GP.statusText(GP.buildModel(CID, { assessments: 'pick', picked: [] }))).toBe(
      '3 students · Blank Grid · 1 page.',
    );
  });
});

describe('Blank Gradebook', () => {
  it('prints the assessment titles across the top with every score box empty', () => {
    const model = GP.buildModel(CID, { blank: true });
    expect(model.columns.map(c => c.title)).toEqual(GP.buildModel(CID, {}).columns.map(c => c.title));
    model.rows.forEach(r => r.cells.forEach(c => expect(c.text).toBe('')));
    expect(model.averages).toBeNull();
    expect(model.final).toBeNull();
    expect(model.marks).toEqual([]);
    const html = GP.renderPages(model);
    expect(html).toContain('Cell Structure Lab');
    expect(html).toContain('Lovelace, Ada');
    expect(html).not.toContain('Class Average');
    expect(html).not.toContain('Final Grade');
    expect(GP.previewLines(model)).toEqual({
      pages: '1 page · Letter',
      detail: '3 students · Blank Gradebook · 5 columns',
    });
  });

  it('reads the old Blank Grid choice as Blank Gradebook', () => {
    const o = GP.normalizeOptions({ assessments: 'blank', gridCols: 6 });
    expect(o.assessments).toBe('all');
    expect(o.blank).toBe(true);
    expect(o.gridCols).toBeUndefined();
  });

  it('prints a blank grid for a class with no assessments', () => {
    _cache.assessments[CID] = [];
    clearProfCache();
    const model = GP.buildModel(CID, {});
    expect(model.columns).toEqual([]);
    expect(model.pages).toHaveLength(1);
    expect(model.pages[0].blankCols).toBe(11);
    expect(GP.statusText(model)).toBe('3 students · Blank Grid · 1 page.');
    expect(GP.previewLines(model).detail).toBe('3 students · Blank Grid · 11 columns');
  });
});

describe('Attendance', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(iso) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso + 'T10:00:00'));
  }

  it('starts on the Monday of the week it is printed, or the coming Monday at a weekend', () => {
    const iso = d => GP.weekStart(new Date(d + 'T10:00:00')).toDateString();
    expect(iso('2026-10-19')).toBe(new Date('2026-10-19T00:00:00').toDateString());
    expect(iso('2026-10-21')).toBe(new Date('2026-10-19T00:00:00').toDateString());
    expect(iso('2026-10-23')).toBe(new Date('2026-10-19T00:00:00').toDateString());
    expect(iso('2026-10-24')).toBe(new Date('2026-10-26T00:00:00').toDateString());
    expect(iso('2026-10-25')).toBe(new Date('2026-10-26T00:00:00').toDateString());
  });

  it('fills the page width with school days, Monday to Friday, a band per week', () => {
    at('2026-10-21');
    const model = GP.buildModel(CID, { attendance: true });
    const cap = GP.pageCapacity(model.opts);
    expect(model.columns).toHaveLength(cap.full);
    expect(model.columns.slice(0, 7).map(c => c.title)).toEqual([
      'Mon Oct 19',
      'Tue Oct 20',
      'Wed Oct 21',
      'Thu Oct 22',
      'Fri Oct 23',
      'Mon Oct 26',
      'Tue Oct 27',
    ]);
    expect(model.columns.every(c => !/Sat|Sun/.test(c.title))).toBe(true);
    expect(model.columns[0].catName).toBe('Week of Oct 19');
    expect(model.columns[5].catName).toBe('Week of Oct 26');
    const [page] = model.pages;
    expect(model.pages).toHaveLength(1);
    expect(page.blankCols).toBe(0);
    expect(page.cols.count * page.colW).toBeCloseTo(cap.width, 1);
    expect(page.colW).toBeGreaterThanOrEqual(GP.SIZES.normal.colMin);
    expect(model.averages).toBeNull();
    expect(model.final).toBeNull();
    model.rows.forEach(r => r.cells.forEach(c => expect(c.text).toBe('')));
  });

  it('prints an Attendance Sheet with the dates, a heavier rule between weeks and no scores', () => {
    at('2026-10-21');
    const model = GP.buildModel(CID, { attendance: true, scoresAs: 'both' });
    const html = GP.renderPages(model);
    expect(html).toContain('Attendance Sheet');
    expect(html).toContain('gp-attendance');
    expect(html).toContain('<b>Dates:</b> <span>Oct 19 – Nov 9, 2026</span>');
    expect(html).toContain('<b>School Days:</b> <span>16</span>');
    expect(html).toContain('Week of Oct 26');
    expect(html).toContain('<div>Mon Oct 26</div>');
    expect(html).not.toContain('Quiz 1');
    expect(html).not.toContain('Class Average');
    expect((html.match(/gp-cat-start/g) || []).length).toBeGreaterThan(0);
    expect(GP.previewLines(model)).toEqual({ pages: '1 page · Letter', detail: '3 students · 16 school days' });
  });

  it('fits more days with Name Only or Compact text, and the same across on Legal', () => {
    at('2026-10-21');
    const normal = GP.buildModel(CID, { attendance: true }).columns.length;
    expect(GP.buildModel(CID, { attendance: true, students: 'name' }).columns.length).toBeGreaterThan(normal);
    expect(GP.buildModel(CID, { attendance: true, size: 'compact' }).columns.length).toBeGreaterThan(normal);
    const legal = GP.buildModel(CID, { attendance: true, paper: 'legal' });
    expect(legal.columns.length).toBe(normal);
    expect(legal.layout.gridH).toBeGreaterThan(GP.buildModel(CID, { attendance: true }).layout.gridH);
  });
});

describe('renderPages', () => {
  it('draws a MyEd-style header and grid with Title Case labels and no sentences', () => {
    getConfig().displayName = 'Colin Brown';
    const model = GP.buildModel(CID, {});
    const html = GP.renderPages(model);
    expect((html.match(/class="gp-page/g) || []).length).toBe(model.pages.length);
    expect(html).toContain('Class Grade Sheet');
    expect(html).toContain('Page 1 of 1');
    for (const label of ['Class:', 'Teacher:', 'Block:', 'Term:', 'Students:', 'Scores:', 'Pupil #', 'Name']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Class Average');
    expect(html).toContain('Photosynthesis vs Respiration');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('keeps every header field in its place when one is empty', () => {
    getConfig().displayName = '';
    const html = GP.renderPages(GP.buildModel(CID, {}));
    expect(html).toContain('<b>Teacher:</b>');
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
