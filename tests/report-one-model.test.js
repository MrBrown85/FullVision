/**
 * One Report's model (teacher/report-one.js): the parts in print order,
 * what is kept for one student, the readers that turn a class's Quick
 * Report choices or built form into a model, and the two things the form
 * engine learned for it (ReportSheets.pack: caps and fill).
 * docs/plans/one-report-build-plan.md.
 */
import './setup.js';
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
      'missing-work',
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
  it('the Quick Report’s choices become its parts: the list, the summary, the grade, missing work', () => {
    const m = R.modelFor({ progressMode: 'grade', gradeReport: { summary: true, numbers: true, order: 'newest' } });
    expect(m.parts).toEqual(['header', 'assessments', 'category-summary', 'course-grade', 'missing-work']);
    expect(m.options.assessments).toMatchObject({ numbers: true, order: 'newest', ungraded: true });
    expect(m.feedback).toEqual({ rubrics: false, comments: false, observations: false });
  });

  it('Category Summary off leaves the summary off; Feedback Pages bring their choices and the Term Comment', () => {
    const m = R.fromGrade({ summary: false, feedback: true, rubrics: true, comments: false, termComment: true });
    expect(m.parts).toEqual(['header', 'assessments', 'course-grade', 'missing-work', 'teacher-narrative']);
    expect(m.feedback).toEqual({ rubrics: true, comments: false, observations: false });
  });

  it('a built form keeps its blocks in the order they print, side by side, row by row, the docked block last', () => {
    const form = S.normalizeForm(undefined); // the Report Card starter
    const m = R.fromForm(form);
    expect(m.parts).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance',
      'missing-work',
      'self-assessment',
      'grade-table',
      'parent-response',
    ]);
    expect(m.lines).toEqual({ 'teacher-narrative': 10, 'parent-response': 3 });
  });

  it('a built form’s options, and the blocks left off one student, come with it', () => {
    let form = S.normalizeForm(undefined);
    form = S.setOption(form, 'proficiency', 'change', false);
    form = S.hideFor(form, 'st-1', 'legend', true);
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
    expect(R.modelFor({ progressMode: 'build', form }).parts).toContain('grade-table');
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

  it('normalize drops what the registry does not know and keeps the letterhead first', () => {
    const m = R.normalize({ parts: ['legend', 'no-such-part', 'header', 'legend'], perStudent: { x: {} } });
    expect(m.parts).toEqual(['header', 'legend']);
    expect(m.perStudent).toEqual({});
  });
});

describe('options for the panel', () => {
  it('a block’s options come from the form engine’s registry with the class’s values', () => {
    const m = R.setOption(CARD(), 'missing-work', 'none', 'off');
    const opts = R.optionsFor(m, 'missing-work', 'c1');
    expect(opts.find(o => o.key === 'none')).toMatchObject({ kind: 'choice', value: 'off' });
    expect(opts.find(o => o.key === 'titles')).toMatchObject({ kind: 'toggle', value: true });
  });

  it('the comment has its lines; the Assessments part its own choices', () => {
    const m = R.setOption(CARD(), 'teacher-narrative', 'lines', 6);
    expect(R.optionsFor(m, 'teacher-narrative', 'c1').find(o => o.kind === 'lines')).toMatchObject({ value: 6 });
    expect(R.optionsFor(CARD(), 'assessments', 'c1').map(o => o.key)).toEqual([
      'ungraded',
      'numbers',
      'date',
      'category',
      'order',
    ]);
  });

  it('the self-assessment offers the student’s words or a blank form, never a rating', () => {
    const keys = R.optionsFor(CARD(), 'self-assessment', 'c1').map(o => o.key);
    expect(keys).toContain('blank');
    expect(keys).not.toContain('strength');
    expect(JSON.stringify(R.PARTS['self-assessment'])).not.toMatch(/rating|level/i);
  });
});

describe('ReportSheets.pack for One Report', () => {
  const H = 996;
  const HEAD = 16;
  const P = (rows, opts) => S.pack([rows], { H, gap: 12, pinned: null, head: HEAD, ...opts });
  const c = (id, px, more) => ({ id, size: 'row', px, ...more });
  const table = (id, n, rowPx) => c(id, 40 + n * rowPx, { rows: Array.from({ length: n }, () => rowPx), chrome: 40 });

  it('fill: a table that would fit a side of its own still starts in the room left and goes on', () => {
    const rows = [[c('header', 600)], [table('list', 30, 20)]];
    // Without fill it moves whole to the next side, leaving the front's foot empty.
    const whole = P(rows);
    expect(whole.sides[0].rows).toHaveLength(1);
    const filled = P(rows, { fill: true });
    expect(filled.sides[0].rows[1].cells[0].part.start).toBe(0);
    expect(filled.sides[0].rows[1].cells[0].part.end).toBeGreaterThan(5);
    expect(filled.sides[1].rows[0].cells[0].part.end).toBe(30);
    filled.sides.forEach(sd => sd.rows.forEach(r => expect(r.y + r.h).toBeLessThanOrEqual(H)));
  });

  it('caps: room kept free at the foot of a side moves what would have sat there to the next', () => {
    const rows = [[c('header', 300)], [c('a', 300)], [c('b', 300)]];
    expect(P(rows).sides).toHaveLength(1);
    const capped = P(rows, { caps: { 0: 200 } });
    expect(capped.sides).toHaveLength(2);
    expect(capped.sides[0].rows.map(r => r.cells[0].id)).toEqual(['header', 'a']);
    capped.sides[0].rows.forEach(r => expect(r.y + r.h).toBeLessThanOrEqual(H - 200));
  });

  it('neither changes a layout that does not ask for it', () => {
    const rows = [[c('header', 300)], [table('list', 60, 20)], [c('b', 300)]];
    expect(P(rows, { caps: null, fill: false })).toEqual(P(rows));
  });
});
