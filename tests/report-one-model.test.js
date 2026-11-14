/**
 * One Report's model (teacher/report-one.js): the parts in print order,
 * what is kept for one student, the readers that turn a class's Quick
 * Report choices or built form into a model, and the one thing the form
 * engine learned for it (ReportSheets.pack: fill).
 * docs/plans/one-report-build-plan.md.
 */
import './setup.js';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';

const R = ReportOne;
const S = ReportSheets;
const CARD = () => R.fromSetup('report-card');

describe('the Setups', () => {
  it('each is a list of parts the registry knows, the letterhead first', () => {
    R.SETUPS.forEach(s => {
      const m = R.fromSetup(s.id);
      expect(m.setup).toBe(s.id);
      expect(m.parts[0]).toBe('header');
      m.parts.forEach(k => expect(R.PARTS[k], k).toBeTruthy());
      expect(new Set(m.parts).size).toBe(m.parts.length);
    });
  });

  it('the Report Card prints proficiency, the comment, the self-assessment, then the list, the response last', () => {
    expect(CARD().parts).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'self-assessment',
      'term-attendance',
      'assessments',
      'parent-response',
    ]);
    expect(R.order(CARD()).slice(-1)).toEqual(['parent-response']);
  });

  it('an unknown Setup is the Report Card', () => {
    expect(R.fromSetup('nope').setup).toBe('report-card');
  });
});

describe('reading what a class has today', () => {
  it('the Quick Report’s choices become its parts: the list, the summary, the grade', () => {
    const m = R.modelFor({ progressMode: 'grade', gradeReport: { summary: true, numbers: true, order: 'newest' } });
    expect(m.parts).toEqual(['header', 'assessments', 'category-summary', 'course-grade']);
    expect(m.options.assessments).toMatchObject({ numbers: true, order: 'newest', ungraded: true });
    expect(m.feedback).toEqual({ rubrics: false, comments: false, observations: false });
  });

  it('Category Summary off leaves the summary off; Feedback Pages bring their choices and the Term Comment', () => {
    const m = R.fromGrade({ summary: false, feedback: true, rubrics: true, comments: false, termComment: true });
    expect(m.parts).toEqual(['header', 'assessments', 'course-grade', 'teacher-narrative']);
    expect(m.feedback).toEqual({ rubrics: true, comments: false, observations: false });
  });

  it('a built form keeps its blocks in the order they print, side by side, row by row, the docked block last', () => {
    const form = S.normalizeForm(undefined); // the Report Card starter
    const m = R.fromForm(form);
    // Assignment Grades is the Assessments part, by month, newest first;
    // Missing Work beside it is in its list and goes.
    expect(m.parts).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance',
      'self-assessment',
      'assessments',
      'parent-response',
    ]);
    expect(m.options.assessments).toEqual({ organize: 'month', order: 'newest' });
    expect(m.options.assessments.missingOnly).toBeUndefined();
    expect(m.lines).toEqual({ 'teacher-narrative': 10, 'parent-response': 3 });
  });

  it('a built form’s options, and the blocks left off one student, come with it', () => {
    const form = S.normalizeForm(undefined);
    form.sides[0].rows[1].cells[0].options = { change: false };
    form.perStudent = { 'st-1': { hide: ['legend'] } };
    const before = JSON.stringify(form);
    const m = R.fromForm(form);
    expect(m.options.proficiency).toEqual({ change: false });
    expect(m.perStudent['st-1'].off).toEqual(['legend']);
    expect(R.isOn(m, 'legend')).toBe(true);
    expect(R.isOn(m, 'legend', 'st-1')).toBe(false);
    // The saved form is read, never rewritten.
    expect(JSON.stringify(form)).toBe(before);
  });

  it('a class on Build Your Own reads its form; one on the Quick Report its choices; a saved model wins', () => {
    const form = S.normalizeForm(undefined);
    expect(R.modelFor({ progressMode: 'build', form }).parts).toContain('assessments');
    expect(R.modelFor({ progressMode: 'build', form }).parts).not.toContain('grade-table');
    expect(R.modelFor({ progressMode: 'grade', form }).parts).toContain('assessments');
    expect(R.modelFor({ progressMode: 'build', form, one: R.fromSetup('interim-update') }).setup).toBe(
      'interim-update',
    );
    expect(R.modelFor(null).parts[0]).toBe('header');
  });
});

describe('changing the model', () => {
  it('a part switched on goes where the registry puts it; switched off it leaves; the model given is not changed', () => {
    const m = CARD();
    const on = R.setOn(m, 'next-steps', true);
    // After the last part on the report that the registry lists before it,
    // and never after the response.
    expect(on.parts.slice(-3)).toEqual(['assessments', 'next-steps', 'parent-response']);
    expect(R.setOn(on, 'next-steps', false).parts).toEqual(m.parts);
    expect(m.parts).not.toContain('next-steps');
    expect(on.setup).toBe('');
  });

  it('the letterhead cannot be switched off or moved; the response stays last', () => {
    const m = CARD();
    expect(R.setOn(m, 'header', false).parts[0]).toBe('header');
    expect(R.move(m, 'header', 3)).toBe(m);
    expect(R.move(m, 'proficiency', 0).parts.slice(0, 2)).toEqual(['header', 'proficiency']);
    const end = R.move(m, 'proficiency', 99).parts;
    expect(end.slice(-2)).toEqual(['proficiency', 'parent-response']);
  });

  it('a change for one student is kept as a difference from the class', () => {
    const m = CARD();
    const off = R.setOn(m, 'legend', false, 'st-1');
    expect(off.parts).toEqual(m.parts);
    expect(R.isOn(off, 'legend', 'st-1')).toBe(false);
    expect(R.isOn(off, 'legend', 'st-2')).toBe(true);
    expect(R.exceptions(off, 'st-1')).toBe(1);
    // Switching it back on for the student leaves no difference behind.
    expect(R.setOn(off, 'legend', true, 'st-1').perStudent).toEqual({});
    const on = R.setOn(m, 'next-steps', true, 'st-1');
    expect(R.order(on, 'st-1')).toContain('next-steps');
    expect(R.order(on)).not.toContain('next-steps');
    expect(R.clearStudent(on, 'st-1').perStudent).toEqual({});
  });

  it('rows left off: the class’s, a student’s own on top, and back again', () => {
    let m = R.setRemoved(CARD(), 'assessments', 'a1', true);
    m = R.setRemoved(m, 'assessments', 'a2', true, 'st-1');
    expect(R.removedOf(m, 'assessments')).toEqual(['a1']);
    expect(R.removedOf(m, 'assessments', 'st-1')).toEqual(['a1', 'a2']);
    expect(R.exceptions(m, 'st-1')).toBe(1);
    m = R.setRemoved(m, 'assessments', 'a1', false);
    expect(R.removedOf(m, 'assessments', 'st-1')).toEqual(['a2']);
    expect(R.setRemovedAll(m, 'assessments', [], 'st-1').perStudent).toEqual({});
  });

  it('a heading and the class’s wording are kept, and cleared by nothing', () => {
    let m = R.setTitle(CARD(), 'teacher-narrative', '  From Ms. Brown ');
    expect(m.titles).toEqual({ 'teacher-narrative': 'From Ms. Brown' });
    expect(R.setTitle(m, 'teacher-narrative', '').titles).toEqual({});
    m = R.setWording(m, 'parent-response', { intro: 'Please sign and return.' });
    expect(R.wordingOf(m, 'parent-response')).toEqual({ intro: 'Please sign and return.' });
    expect(R.setWording(m, 'parent-response', null).wording).toEqual({});
  });

  it('a saved model with Assignment Grades or Missing Work has the Assessments part in its place', () => {
    const g = R.normalize({
      parts: ['header', 'grade-table', 'legend'],
      options: { 'grade-table': { organize: 'competency', per: 8, columns: 'two', range: 'term', percent: false } },
      perStudent: { s1: { on: ['missing-work'], off: [] } },
      titles: { 'grade-table': 'Grades' },
    });
    expect(g.parts).toEqual(['header', 'assessments', 'legend']);
    expect(g.options.assessments).toEqual({
      organize: 'competency',
      per: 8,
      columns: 'two',
      range: 'term',
      order: 'newest',
      percent: false,
    });
    expect(g.options['grade-table']).toBeUndefined();
    expect(g.titles).toEqual({});
    expect(g.perStudent.s1.on).toEqual(['assessments']);
    const miss = R.normalize({ parts: ['header', 'term-attendance', 'missing-work'] });
    expect(miss.parts).toEqual(['header', 'term-attendance', 'assessments']);
    expect(miss.options.assessments).toEqual({ missingOnly: true });
    // Beside the Assessments part, Missing Work goes and the list is unchanged.
    const both = R.normalize({
      parts: ['header', 'missing-work', 'assessments'],
      options: { assessments: { numbers: true } },
    });
    expect(both.parts).toEqual(['header', 'assessments']);
    expect(both.options.assessments).toEqual({ numbers: true });
  });

  it('normalize drops what the registry does not know and keeps the letterhead first', () => {
    const m = R.normalize({ parts: ['legend', 'no-such-part', 'header', 'legend'], perStudent: { x: {} } });
    expect(m.parts).toEqual(['header', 'legend']);
    expect(m.perStudent).toEqual({});
  });
});

describe('options for the panel', () => {
  it('a block’s options come from the form engine’s registry with the class’s values', () => {
    const m = R.setOption(CARD(), 'term-attendance', 'period', 'year');
    const opts = R.optionsFor(m, 'term-attendance', 'c1');
    expect(opts.find(o => o.key === 'period')).toMatchObject({ kind: 'choice', value: 'year' });
    expect(opts.find(o => o.key === 'late')).toMatchObject({ kind: 'toggle', value: true });
  });

  it('Proficiency’s Rows starts on As Graded, one of its choices, until the teacher picks another', () => {
    const rows = R.optionsFor(CARD(), 'proficiency', 'c1').find(o => o.key === 'rows');
    expect(rows.value).toBe('auto');
    expect(rows.choices.map(c => c.v)).toContain(rows.value);
    const picked = R.optionsFor(R.setOption(CARD(), 'proficiency', 'rows', 'each'), 'proficiency', 'c1');
    expect(picked.find(o => o.key === 'rows').value).toBe('each');
  });

  it('the comment has its lines; the Assessments part its own choices', () => {
    const m = R.setOption(CARD(), 'teacher-narrative', 'lines', 6);
    expect(R.optionsFor(m, 'teacher-narrative', 'c1').find(o => o.kind === 'lines')).toMatchObject({ value: 6 });
    expect(R.optionsFor(CARD(), 'assessments', 'c1').map(o => o.key)).toEqual([
      'ungraded',
      'missingOnly',
      'numbers',
      'date',
      'category',
      'organize',
      'order',
      'columns',
      'range',
    ]);
    // Each choice shows only where it means something.
    let m2 = R.setOption(CARD(), 'assessments', 'organize', 'category');
    m2 = R.setOption(m2, 'assessments', 'columns', 'two');
    m2 = R.setOption(m2, 'assessments', 'missingOnly', true);
    const keys = R.optionsFor(m2, 'assessments', 'c1').map(o => o.key);
    expect(keys).toContain('catGrade');
    expect(keys).not.toContain('category');
    expect(keys).not.toContain('ungraded');
    expect(
      R.optionsFor(R.setOption(CARD(), 'assessments', 'organize', 'competency'), 'assessments', 'c1').map(o => o.key),
    ).toEqual(expect.arrayContaining(['per']));
    expect(
      R.optionsFor(R.setOption(CARD(), 'assessments', 'organize', 'competency'), 'assessments', 'c1').map(o => o.key),
    ).not.toContain('numbers');
  });

  it('the self-assessment offers the student’s words or a blank form, never a rating', () => {
    const keys = R.optionsFor(CARD(), 'self-assessment', 'c1').map(o => o.key);
    expect(keys).toContain('blank');
    expect(keys).not.toContain('strength');
    expect(JSON.stringify(R.PARTS['self-assessment'])).not.toMatch(/rating|level/i);
  });
});

describe('a block with rows left off', () => {
  const html =
    '<div class="report-block-box"><div class="report-block-title">Proficiency</div>' +
    '<table class="report-ct report-prof"><tbody>' +
    '<tr class="report-ct-group"><td colspan="3">Questioning</td></tr>' +
    '<tr><td class="report-ct-name">Asking Questions</td><td>Proficient</td></tr>' +
    '<tr class="report-ct-group"><td colspan="3">Planning</td></tr>' +
    '<tr><td class="report-ct-name">Fair Tests<span class="report-prof-count"> · 2 competencies</span></td><td>Developing</td></tr>' +
    '</tbody></table>' +
    '<div class="report-prof-facts"><div class="report-prof-fact"><b>Strongest now:</b> Asking Questions Proficient.</div>' +
    '<div class="report-prof-fact"><b>Next focus:</b> Fair Tests Developing.</div></div></div>';
  // partHtml reads the block's rows in a detached element: a real document for it.
  const draw = model => {
    const real = ReportSheets.one.cellHtml;
    const stub = globalThis.document;
    const { document: doc } = parseHTML('<!doctype html><html><body></body></html>');
    ReportSheets.one.cellHtml = () => html;
    globalThis.document = doc;
    try {
      const root = doc.createElement('div');
      root.innerHTML = R.partHtml(model, 'proficiency', 'c1', { id: 'st-1' }, {}, null);
      return root;
    } finally {
      ReportSheets.one.cellHtml = real;
      globalThis.document = stub;
    }
  };

  it('each row is named by what it prints, without a folder’s count', () => {
    const rows = [...draw(CARD()).querySelectorAll('[data-row]')].map(r => r.getAttribute('data-row'));
    expect(rows).toEqual(['Asking Questions', 'Fair Tests']);
  });

  it('a row left off takes its folder’s heading and the line that names it with it', () => {
    const root = draw(R.setRemoved(CARD(), 'proficiency', 'Fair Tests', true));
    expect(root.textContent).not.toContain('Fair Tests');
    expect(root.textContent).not.toContain('Planning');
    expect(root.textContent).not.toContain('Next focus');
    expect(root.textContent).toContain('Questioning');
    expect(root.textContent).toContain('Strongest now');
    // For one student only, the class's report is whole.
    const one = R.setRemoved(CARD(), 'proficiency', 'Fair Tests', true, 'st-2');
    expect(draw(one).textContent).toContain('Next focus');
  });
});

describe('ReportSheets.pack for One Report', () => {
  const H = 996;
  const HEAD = 16;
  const P = (rows, opts) => S.pack([rows], { H, gap: 12, pinned: null, head: HEAD, ...opts });
  const c = (id, px, more) => ({ id, size: 'row', px, ...more });
  const table = (id, n, rowPx) => c(id, 40 + n * rowPx, { rows: Array.from({ length: n }, () => rowPx), chrome: 40 });

  it('a table that would fit a side of its own still starts in the room left and goes on', () => {
    const rows = [[c('header', 600)], [table('list', 30, 20)]];
    const filled = P(rows);
    expect(filled.sides[0].rows[1].cells[0].part.start).toBe(0);
    expect(filled.sides[0].rows[1].cells[0].part.end).toBeGreaterThan(5);
    expect(filled.sides[1].rows[0].cells[0].part.end).toBe(30);
    filled.sides.forEach(sd => sd.rows.forEach(r => expect(r.y + r.h).toBeLessThanOrEqual(H)));
  });
});
