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
      ungraded: true,
      numbers: false,
      order: 'oldest',
      name: 'preferred',
      feedback: false,
      rubrics: true,
      comments: true,
      observations: false,
      termComment: false,
    });
    expect(
      G.options({
        summary: false,
        ungraded: false,
        numbers: true,
        comment: true,
        order: 'newest',
        name: 'first',
        junk: 1,
      }),
    ).toEqual({
      summary: false,
      ungraded: false,
      numbers: true,
      order: 'newest',
      name: 'first',
      feedback: false,
      rubrics: true,
      comments: true,
      observations: false,
      termComment: false,
    });
  });

  it('keeps the Feedback Pages choices when they are true or false, nothing else', () => {
    const o = G.options({ feedback: true, rubrics: false, comments: false, observations: true, termComment: 'yes' });
    expect(o).toMatchObject({
      feedback: true,
      rubrics: false,
      comments: false,
      observations: true,
      termComment: false,
    });
    expect(G.options({ feedback: 1 }).feedback).toBe(false);
  });
});

describe('rows', () => {
  it('lists this term’s marked, missing and excused work, oldest first, and unmarked work with a dash', () => {
    seed();
    stub('courseToday', () => '2026-10-29');
    const rows = G.rows(CID, ST, { ungraded: false });
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
    // Ungraded Assignments (on by default): work up to today with no mark
    // shows with a dash; work not yet due stays off.
    const all = G.rows(CID, ST);
    expect(all.map(r => r.title)).toEqual([
      'Formulas Quiz',
      'Plate Tectonics',
      'Energy Quiz',
      'Reading Log',
      'Field Trip Form',
      'Next Week',
    ]);
    expect(all[5]).toMatchObject({ score: '\u2014', outOf: '', percent: '', note: '' });
    stub('courseToday', () => '2026-10-18');
    expect(G.rows(CID, ST).map(r => r.title)).not.toContain('Next Week');
  });

  it('runs newest first on request', () => {
    seed();
    expect(G.rows(CID, ST, { order: 'newest', ungraded: false })[0].title).toBe('Field Trip Form');
  });

  it('numbers the rows 1 to n in the order they print, ungraded work included', () => {
    seed();
    stub('courseToday', () => '2026-10-29');
    const oldest = G.rows(CID, ST);
    expect(oldest.map(r => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(oldest[0].title).toBe('Formulas Quiz');
    expect(oldest[5]).toMatchObject({ n: 6, title: 'Next Week' });
    const newest = G.rows(CID, ST, { order: 'newest' });
    expect(newest.map(r => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(newest[0]).toMatchObject({ n: 1, title: 'Next Week' });
    // Rows left off (Ungraded Assignments off) leave no gap.
    expect(G.rows(CID, ST, { ungraded: false }).map(r => r.n)).toEqual([1, 2, 3, 4, 5]);
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

describe('Assignment Numbers column', () => {
  const stageHtml = numbers => {
    seed();
    stub('courseToday', () => '2026-10-29');
    stub('ReportBlocks', {
      renderBlockHeader: () => '<div class="gr-letterhead">Letterhead</div>',
      reportContext: () => ({}),
    });
    stub('ReportSheets', { sideHeight: () => 996 });
    stub('studentGradeSummary', () => ({ text: '80%' }));
    stub('assessmentGroupGrade', () => ({ text: '80%' }));
    stub('categoryCalcMode', () => 'average');
    stub('fullName', s => s.firstName + ' ' + s.lastName);
    // No DOM here: a stage that measures every block 50px tall.
    const stage = { innerHTML: '', firstChild: { offsetHeight: 50 }, querySelectorAll: () => [] };
    return G.layoutStudent(CID, ST, {}, { paper: 'letter', stage, grade: { numbers } }).html;
  };
  const cells = (html, re) => [...html.matchAll(re)].map(m => m[1]);

  it('adds a # header and a number on every row when on', () => {
    const html = stageHtml(true);
    expect(cells(html, /gr-head"><span class="gr-c gr-n gr-r">([^<]*)</g)).toEqual(['#']);
    expect(cells(html, /<span class="gr-c gr-n gr-r">(\d+)</g)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('leaves the table as it was when off', () => {
    const html = stageHtml(false);
    expect(html).not.toContain('gr-c gr-n ');
    expect(html).toContain('gr-head"><span class="gr-c gr-date">Date<');
  });
});

/* The Feedback Pages' packing: pure over measured heights. */
describe('packColumns', () => {
  const cols = r => r.sides.map(sd => sd.map(col => col.map(p => p.i)));

  it('fits in one column', () => {
    const r = G.packColumns([100, 200, 300], 1000, { gap: 12 });
    expect(cols(r)).toEqual([[[0, 1, 2], []]]);
    expect(r.over).toBe(false);
  });

  it('counts the gap between cards, not before the first', () => {
    // 3 × 330 + 2 gaps = 1014 > 1000: the third card moves on.
    expect(cols(G.packColumns([330, 330, 330], 1000, { gap: 12 }))).toEqual([[[0, 1], [2]]]);
    // Exactly full: 2 × 494 + 12 = 1000.
    expect(cols(G.packColumns([494, 494], 1000, { gap: 12 }))).toEqual([[[0, 1], []]]);
  });

  it('overflows to the right column, then to the next side', () => {
    const r = G.packColumns([600, 600, 600, 600, 100], 1000, { gap: 12 });
    expect(cols(r)).toEqual([
      [[0], [1]],
      [[2], [3, 4]],
    ]);
  });

  it('keeps the order: a short card never moves back into an earlier gap', () => {
    const r = G.packColumns([700, 400, 100, 900, 50], 1000, { gap: 12 });
    const order = r.sides.flatMap(sd => sd.flatMap(col => col.map(p => p.i)));
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(cols(r)).toEqual([
      [[0], [1, 2]],
      [[3, 4], []],
    ]);
  });

  it('gives no sides for no cards', () => {
    expect(G.packColumns([], 1000)).toEqual({ sides: [], over: false });
  });

  it('puts a card taller than a column alone and says it is over', () => {
    const r = G.packColumns([100, 1200, 100], 1000, { gap: 12 });
    expect(cols(r)).toEqual([
      [[0], [1]],
      [[2], []],
    ]);
    expect(r.over).toBe(true);
  });

  it('splits a rubric taller than a column between its rows, title and header repeated', () => {
    const rubric = { h: 1500, rows: [300, 300, 300, 300, 200], head: 60, contHead: 64, foot: 10, tail: 80 };
    const r = G.packColumns([200, rubric, 100], 1000, { gap: 12 });
    const pieces = r.sides.flatMap(sd => sd.flatMap(col => col)).filter(p => p.i === 1);
    // The first piece fills the room under the first card: 1000 − 200 − 12
    // = 788 holds the head, two rows and the foot (670).
    expect(pieces.map(p => [p.from, p.to, p.part, p.last])).toEqual([
      [0, 2, 0, false],
      [2, 5, 1, true],
    ]);
    expect(pieces[0].h).toBe(60 + 600 + 10);
    expect(pieces[1].h).toBe(64 + 800 + 80);
    expect(cols(r)).toEqual([
      [[0, 1], [1]],
      [[2], []],
    ]);
    expect(r.over).toBe(false);
  });

  it('never splits a card that fits a whole column: it moves to the next column instead', () => {
    const rubric = { h: 900, rows: [450, 450], head: 0, contHead: 0, foot: 0, tail: 0 };
    const r = G.packColumns([200, rubric], 1000, { gap: 12 });
    expect(r.sides[0][1]).toEqual([{ i: 1, h: 900 }]);
  });
});

describe('splitRows', () => {
  const parts = { head: 50, contHead: 55, foot: 5, tail: 40 };

  it('keeps every row whole and in order, the tail on the last piece', () => {
    const r = G.splitRows([200, 200, 200, 200, 200, 200], parts, 600, 600);
    expect(r.pieces).toEqual([
      { from: 0, to: 2, h: 455 },
      { from: 2, to: 4, h: 460 },
      { from: 4, to: 6, h: 495 },
    ]);
    expect(r.startNext).toBe(false);
    expect(r.over).toBe(false);
  });

  it('moves the last row on when the Feedback under it does not fit', () => {
    const r = G.splitRows([270, 270], { head: 50, contHead: 50, foot: 5, tail: 300 }, 600, 600);
    expect(r.pieces.map(p => [p.from, p.to])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('starts on a fresh column when not one row fits the room left', () => {
    const r = G.splitRows([300, 300, 300], parts, 600, 200);
    expect(r.startNext).toBe(true);
    expect(r.pieces[0]).toEqual({ from: 0, to: 1, h: 355 });
  });

  it('puts a row taller than a column alone and says it is over', () => {
    const r = G.splitRows([100, 900, 100], parts, 600, 600);
    expect(r.pieces.map(p => [p.from, p.to])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(r.over).toBe(true);
  });
});

describe('feedbackItems', () => {
  const items = () => [
    { id: 'r1', kind: 'rubric', rubric: { rows: [{}] }, feedback: [] },
    { id: 'r2', kind: 'rubric', rubric: { rows: [{}] }, feedback: [{ text: 'Good' }] },
    { id: 'p1', kind: 'points', rubric: null, feedback: [{ text: 'Check units' }] },
  ];

  it('keeps every card with Rubrics and Assignment Comments on', () => {
    stub('ReportFeedback', { forStudent: () => items() });
    expect(G.feedbackItems(CID, ST, G.options({})).map(x => x.id)).toEqual(['r1', 'r2', 'p1']);
  });

  it('Rubrics off drops the tables; a rubric with nothing written goes', () => {
    stub('ReportFeedback', { forStudent: () => items() });
    const out = G.feedbackItems(CID, ST, G.options({ rubrics: false }));
    expect(out.map(x => x.id)).toEqual(['r2', 'p1']);
    expect(out[0].rubric).toBe(null);
  });

  it('Assignment Comments off drops the feedback; a points card with nothing left goes', () => {
    stub('ReportFeedback', { forStudent: () => items() });
    const out = G.feedbackItems(CID, ST, G.options({ comments: false }));
    expect(out.map(x => x.id)).toEqual(['r1', 'r2']);
    expect(out[1].feedback).toEqual([]);
  });

  it('passes the order on', () => {
    let seen = null;
    stub('ReportFeedback', {
      forStudent: (cid, st, o) => {
        seen = o.order;
        return [];
      },
    });
    G.feedbackItems(CID, ST, G.options({ order: 'newest' }));
    expect(seen).toBe('newest');
  });
});

describe('extra cards: Observations and Term Comment', () => {
  const OBS = [
    { id: 'o1', date: 'Oct 6', dateIso: '2026-10-06', text: 'Led the group.', tags: ['Collaboration'] },
    { id: 'o2', date: 'Oct 9', dateIso: '2026-10-09', text: 'Asked a good question.', tags: [] },
    { id: 'o3', date: 'Oct 12', dateIso: '2026-10-12', text: 'Helped a partner.', tags: [] },
  ];
  const feed = (obs, text) => {
    const seen = {};
    stub('ReportFeedback', {
      observations: (cid, st, termId) => {
        seen.obs = termId;
        return obs;
      },
      termComment: (cid, st, termId) => {
        seen.term = termId;
        return text;
      },
    });
    return seen;
  };

  it('the options are off until ticked, and they add nothing then', () => {
    feed(OBS, 'A good term.');
    expect(G.extraCards(CID, ST, { termId: 'term-1' }, G.options({ feedback: true }))).toEqual([]);
  });

  it('Observations, then the Term Comment, for the report term', () => {
    const seen = feed(OBS, 'First.\nSecond.');
    const out = G.extraCards(CID, ST, { termId: 'term-2' }, G.options({ observations: true, termComment: true }));
    expect(out.map(x => x.kind)).toEqual(['observations', 'term']);
    expect(out[0].rows).toHaveLength(3);
    expect(out[1].rows).toEqual(['First.', 'Second.']);
    expect(seen).toEqual({ obs: 'term-2', term: 'term-2' });
  });

  it('a card is left out when the student has nothing for it', () => {
    feed([], 'A good term.');
    const o = G.options({ observations: true, termComment: true });
    expect(G.extraCards(CID, ST, {}, o).map(x => x.kind)).toEqual(['term']);
    feed(OBS, '');
    expect(G.extraCards(CID, ST, {}, o).map(x => x.kind)).toEqual(['observations']);
  });

  it('a piece of the Observations card holds its entries; a later piece says (continued)', () => {
    stub('ReportFeedback', ReportFeedback);
    const x = { kind: 'observations', rows: OBS };
    const first = G.extraHtml(x, { from: 0, to: 2, part: 0 });
    expect(first).toContain('Observations</b>');
    expect(first).toContain('Led the group.');
    expect(first).toContain('Asked a good question.');
    expect(first).not.toContain('Helped a partner.');
    const later = G.extraHtml(x, { from: 2, to: 3, part: 1 });
    expect(later).toContain('Observations (continued)');
    expect(later).toContain('Helped a partner.');
    expect(later).not.toContain('Led the group.');
  });

  it('a Term Comment splits between paragraphs the same way', () => {
    const x = { kind: 'term', rows: ['One.', 'Two.', 'Three.'] };
    const later = G.extraHtml(x, { from: 1, to: 3, part: 1 });
    expect(later).toContain('Term Comment (continued)');
    expect(later).toContain('Two.');
    expect(later).toContain('Three.');
    expect(later).not.toContain('One.');
  });

  it('splitRows cuts a long observations log between entries', () => {
    const rows = [100, 100, 100, 100, 100, 100];
    const r = G.splitRows(rows, { head: 30, contHead: 30, foot: 6, tail: 6 }, 340, 340);
    expect(r.over).toBe(false);
    expect(r.pieces.map(p => [p.from, p.to])).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });
});
