/**
 * The Grade Report (teacher/grade-report.js): the ready-made progress
 * report with a row per assessment this term, a summary by category and
 * the term grade, laid out to one sheet per student.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const G = GradeReport;
const CID = 'cg';
const ST = { id: 's1', firstName: 'Ada', lastName: 'Lovelace' };

const keep = {};
const stub = (name, fn) => {
  if (!(name in keep)) keep[name] = globalThis[name];
  globalThis[name] = fn;
};
afterEach(() => {
  Object.keys(keep).forEach(k => {
    globalThis[k] = keep[k];
    delete keep[k];
  });
});

function seed(mode) {
  const work = [
    { id: 'a1', title: 'Formulas Quiz', date: '2026-09-10', categoryId: 'c2', scoreMode: 'points', maxPoints: 15 },
    { id: 'a2', title: 'Plate Tectonics', date: '2026-10-05', categoryId: 'c1' },
    { id: 'a3', title: 'Energy Quiz', date: '2026-10-12', categoryId: 'c2', scoreMode: 'points', maxPoints: 10 },
    { id: 'a4', title: 'Reading Log', date: '2026-10-14', categoryId: 'c1', scoreMode: 'complete' },
    { id: 'a5', title: 'Field Trip Form', date: '2026-10-15', categoryId: 'c1' },
    { id: 'a6', title: 'Next Week', date: '2026-10-20', categoryId: 'c1' },
  ];
  const cells = {
    a1: { kind: 'points', value: 12, level: 3, late: true },
    a2: { kind: 'level', value: 3.33, level: 3, late: false },
    a3: { kind: 'missing', value: 0, level: 0, zero: false, late: false },
    a4: { kind: 'complete', mark: 'complete', value: 1, late: false },
    a5: { kind: 'status', status: 'EXC', late: false },
    a6: { kind: 'none', late: false },
  };
  stub('getAssessments', () => work);
  stub('assessmentInActiveTerm', () => true);
  stub('assessmentCellValue', (cid, sid, a) => cells[a.id]);
  stub('getCategories', () => [
    { id: 'c1', name: 'Labs', weight: 40 },
    { id: 'c2', name: 'Quizzes', weight: 60 },
  ]);
  stub('courseGradeMode', () => mode || 'proficiency');
}

describe('options', () => {
  it('fills the defaults and keeps only known choices', () => {
    expect(G.options(null)).toEqual({
      summary: true,
      order: 'oldest',
      name: 'preferred',
    });
    expect(G.options({ summary: false, comment: true, order: 'newest', name: 'first', junk: 1 })).toEqual({
      summary: false,
      order: 'newest',
      name: 'first',
    });
  });
});

describe('rows', () => {
  it('lists this term’s marked, missing and excused work, oldest first, and leaves unmarked work off', () => {
    seed();
    const rows = G.rows(CID, ST);
    expect(rows.map(r => r.title)).toEqual([
      'Formulas Quiz',
      'Plate Tectonics',
      'Energy Quiz',
      'Reading Log',
      'Field Trip Form',
    ]);
    expect(rows[0]).toMatchObject({
      category: 'Quizzes',
      score: '12',
      outOf: '15',
      percent: '80%',
      note: 'Late',
    });
    expect(rows[1]).toMatchObject({ category: 'Labs', score: '3.3', outOf: '4', note: '' });
    expect(rows[0]).not.toHaveProperty('word');
    expect(rows[2]).toMatchObject({ score: '', outOf: '', note: 'Missing' });
    expect(rows[3]).toMatchObject({ score: 'Complete', outOf: '' });
    expect(rows[4]).toMatchObject({ score: '', note: 'Excused' });
  });

  it('runs newest first on request', () => {
    seed();
    expect(G.rows(CID, ST, { order: 'newest' })[0].title).toBe('Field Trip Form');
  });

  it('shows the percent in a Letter or Both class, and never a proficiency word', () => {
    seed('letter');
    expect(G.columnsFor(CID)).toEqual({ percent: true });
    seed('proficiency');
    expect(G.columnsFor(CID)).toEqual({ percent: false });
    seed('both');
    expect(G.columnsFor(CID)).toEqual({ percent: true });
  });
});

describe('plan', () => {
  const sizes = { letterheadPx: 60, tailPx: 200, headPx: 20 };
  const regular = { key: 'regular', rowPx: 19, cols: 1 };
  const two = { key: 'two', rowPx: 15, cols: 2 };
  const H = 996;

  it('keeps everything on the front when it fits there', () => {
    expect(G.plan(20, sizes, regular, H)).toEqual({ front: 20, back: 0, tailOnFront: true, fits: true });
  });

  it('carries the rows the front cannot hold to the back, with the summary under them', () => {
    const p = G.plan(60, sizes, regular, H);
    expect(p.tailOnFront).toBe(false);
    expect(p.front).toBe(Math.floor((H - 60 - 12 - 20) / 19));
    expect(p.front + p.back).toBe(60);
    expect(p.fits).toBe(true);
  });

  it('does not fit past both sides at a size, and holds twice the rows in two columns', () => {
    expect(G.plan(120, sizes, regular, H).fits).toBe(false);
    const p = G.plan(120, sizes, two, H);
    expect(p.fits).toBe(true);
    expect(p.front % 2).toBe(0);
  });
});
