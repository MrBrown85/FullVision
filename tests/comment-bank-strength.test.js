/**
 * Bank strength and the near-identical audit's set-aside sentences (plan
 * PR 13). bankStrength() says, for each part a draft picks among bank
 * sentences for, how many sentences fit how many students, and flags a part
 * where more students draw only from its sentences than there are
 * sentences. nearIdentical() never counts a sentence every student must get
 * (the grade sentence, the class's closing, support and late-work lines) as
 * shared. Synthetic classes only (tests/eval-fixture.js,
 * scripts/eval/synthetic.mjs).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syntheticClass as fixtureClass, STUDENTS } from './eval-fixture.js';
import { loadClass } from '../scripts/eval/app.mjs';
import { syntheticClass } from '../scripts/eval/synthetic.mjs';

const home = (id, extra) => Object.assign({ id, part: 'how', group: 'For the Family', text: id + ' at home.' }, extra);
const bankOf = sentences => ({ parts: COMMENT_BANK.parts, sentences });

describe('stepPool', () => {
  it('keeps the sentences that can fill the step, at the top specificity', () => {
    const bank = bankOf([
      home('h1'),
      home('h2', { when: { picture: 'steady' } }),
      home('h3', { when: { picture: 'steady' } }),
      home('h4', { when: { picture: 'climb' } }),
      { id: 'o1', part: 'now', group: 'Openings', text: 'An opening.' },
    ]);
    const ids = ctx => CommentBank.stepPool('home', ctx, bank).map(s => s.id);
    expect(ids({ picture: 'steady' })).toEqual(['h2', 'h3']);
    expect(ids({ picture: 'none' })).toEqual(['h1']);
    expect(CommentBank.stepPool('opening', { picture: 'steady' }, bank).map(s => s.id)).toEqual(['o1']);
    // A class line has no bank sentences.
    expect(CommentBank.stepPool('closer', {}, bank)).toEqual([]);
  });
});

// Demo Mode first: it seeds only into an empty data layer.
describe('bankStrength in Demo Mode (Science 8, Report 2)', () => {
  let saved;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    setActiveTerm('sci8', 2);
  });
  afterAll(() => {
    setActiveTerm('sci8', null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  it('finds the one next-step sentence every student draws from', () => {
    const r = CommentBank.bankStrength('sci8', { termId: 'term-2' });
    const n = getStudents('sci8').length;
    expect(r.parts.find(p => p.step === 'nextStep')).toMatchObject({
      sentences: 1,
      students: n,
      thin: true,
      worst: { sentences: 1, students: n },
    });
  });
});

describe('bankStrength on a small class', () => {
  let cid, termId;
  beforeAll(() => {
    ({ cid, termId } = loadClass(fixtureClass(), 1));
  });
  const part = (r, step) => r.parts.find(p => p.step === step);
  const sidOf = first => getStudents(cid).find(s => s.firstName === first).id;

  it('flags a part with fewer sentences than the students who draw only from them', () => {
    const r = CommentBank.bankStrength(cid, { termId, bank: bankOf([home('h1'), home('h2')]) });
    expect(r.students).toBe(STUDENTS.length);
    expect(part(r, 'home')).toMatchObject({
      sentences: 2,
      students: 5,
      thin: true,
      worst: { sentences: 2, students: 5 },
    });
    Object.values(r.byStudent).forEach(s => expect(s.home).toEqual({ sentences: 2, students: 5, thin: true }));
  });

  it('does not flag a part with a sentence for every student', () => {
    const bank = bankOf([1, 2, 3, 4, 5].map(n => home('h' + n)));
    const r = CommentBank.bankStrength(cid, { termId, bank });
    expect(part(r, 'home')).toMatchObject({ sentences: 5, students: 5, thin: false, worst: null });
  });

  it('counts with a student only the classmates whose sentences are all among theirs', () => {
    // Mateo and Owen have work labelled Missing, so the third sentence fits
    // only them: their three sentences fit all five students, the other
    // three students have only the first two.
    const bank = bankOf([home('h1'), home('h2'), home('h3', { needs: ['missingWork'] })]);
    const r = CommentBank.bankStrength(cid, { termId, bank });
    expect(r.byStudent[sidOf('Mateo')].home).toEqual({ sentences: 3, students: 5, thin: true });
    expect(r.byStudent[sidOf('Noor')].home).toEqual({ sentences: 2, students: 3, thin: true });
    expect(part(r, 'home')).toMatchObject({ sentences: 3, students: 5, worst: { sentences: 3, students: 5 } });
  });

  it('leaves out the parts whose wording is fixed: grade, attendance, not handed in, class lines, the IE parts', () => {
    const r = CommentBank.bankStrength(cid, { termId });
    const steps = r.parts.map(p => p.step);
    ['grade', 'attendance', 'notHandedIn', 'lateWork', 'support', 'closer', 'ieProblem', 'iePlan'].forEach(k =>
      expect(steps).not.toContain(k),
    );
    expect(steps).toEqual(expect.arrayContaining(['habits', 'overall', 'example', 'nextStep', 'home']));
    r.parts.forEach(p => {
      expect(p.students).toBeLessThanOrEqual(STUDENTS.length);
      if (p.thin) expect(p.worst.students).toBeGreaterThan(p.worst.sentences);
    });
  });
});

describe('bankStrength on a synthetic History 12 class', () => {
  let cid, termId, r;
  beforeAll(() => {
    ({ cid, termId } = loadClass(syntheticClass('history12'), 1));
    r = CommentBank.bankStrength(cid, { termId });
  });

  it('flags the habits part: the two "excellent" sentences fit every student rated all Consistently', () => {
    const excellent = getStudents(cid).filter(st => {
      const f = CommentBank.facts(cid, st, termId);
      const rating = getStudentTermRating(cid, st.id, termId) || {};
      const ctx = CommentBank.context(f, { habits: rating.habits || {} });
      return CommentBank.reportPath(f) !== 'ie' && ctx.habitsExcellent;
    });
    expect(excellent.length).toBeGreaterThan(2);
    excellent.forEach(st =>
      expect(r.byStudent[st.id].habits).toEqual({ sentences: 2, students: excellent.length, thin: true }),
    );
    expect(r.parts.find(p => p.step === 'habits').thin).toBe(true);
  });

  it('counts an IE comment for no part', () => {
    const ie = getStudents(cid).filter(st => CommentBank.reportPath(CommentBank.facts(cid, st, termId)) === 'ie');
    expect(ie.length).toBeGreaterThan(0);
    ie.forEach(st => expect(r.byStudent[st.id]).toEqual({}));
  });
});

describe('nearIdentical sets aside the sentences every student gets', () => {
  const four = [
    'Noor explains each result in a lab report with care.',
    'She comes to class ready and uses class time well.',
    'The next step is to support each claim with evidence from a source.',
    'At home, ask about one source from this unit and who made it.',
  ];
  const named = (name, s) => s.replace(/^Noor\b/, name);
  const pair = (extra, opts) =>
    CommentBank.nearIdentical(
      [
        { sid: 'n', name: 'Noor', text: [extra('Noor')].concat(four).join(' ') },
        { sid: 'm', name: 'Mateo', text: [extra('Mateo')].concat(four.map(s => named('Mateo', s))).join(' ') },
      ],
      opts,
    );

  it('never counts a grade sentence as shared, in any of its wordings', () => {
    const grades = [
      n => n + ' is earning a B this term, which is very good work.',
      n => n + ' is earning an A this term, which is excellent work and close to an A.',
      n => n + ' is earning a C- this term, which is minimally acceptable work.',
      n => n + ' is earning a C- this term, which is minimally acceptable work and close to a C.',
      n => n + ' is Proficient on the BC proficiency scale this term.',
      n => n + '’s mark this term is IE, which means there is not yet enough evidence for a letter grade.',
      n => 'This term, ' + n + ' is assessed in relation to their goals for English language proficiency.',
      n => 'This term, ' + n + ' is assessed in relation to the goals in their IEP.',
    ];
    grades.forEach(g => {
      expect(pair(g), g('Noor')).toEqual([]);
      expect(pair(g, { min: 4 })[0].pairs).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ]);
    });
    // Another sentence in the same place still counts.
    expect(pair(n => n + ' had a steady term of work in every unit of this class.')[0].shared).toBe(5);
  });

  it('never counts the class’s own lines as shared: given as lines, or read from the class', () => {
    const closing = () => 'It has been a pleasure to teach this class this term.';
    expect(pair(closing)[0].shared).toBe(5);
    expect(pair(closing, { lines: ['It has been a pleasure to teach this class this term.'] })).toEqual([]);
    // Matched whole: case, curly quotes and spacing aside.
    expect(pair(closing, { lines: ['  it has been a pleasure to teach  this class this term '] })).toEqual([]);
    // A sentence that only starts the same way is not a class line.
    expect(pair(closing, { lines: ['It has been a pleasure to teach this class.'] })[0].shared).toBe(5);

    // The synthetic History 12 class has a closing, support lines and a
    // Late Work Policy set.
    const { cid } = loadClass(syntheticClass('history12'), 1);
    const cs = CommentBank.classSettings(cid);
    expect(cs.closing).toBeTruthy();
    const lines = [
      cs.closing,
      CommentBank.supportChecklist(cid, CommentBank.familyOf(cid)).find(l => l.on).text,
      COURSES[cid].lateWorkPolicy,
    ];
    lines.forEach(l => {
      expect(pair(() => l)[0].shared, l).toBe(5);
      expect(
        pair(() => l, { cid }),
        l,
      ).toEqual([]);
    });
  });
});
