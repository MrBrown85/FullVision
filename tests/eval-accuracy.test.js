/**
 * The accuracy audit (plan PR 14): Generate runs for every student of a
 * class, and every wrong name, title, mark, count or grade in a comment is
 * marked against the gradebook. Synthetic class only (tests/eval-fixture.js).
 */
import './setup.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { syntheticClass, STUDENTS } from './eval-fixture.js';
import { checkComment, main, parseCount, runAccuracy, truthOf, ERROR_TYPES } from '../scripts/eval/accuracy.mjs';
import { assertOutsideRepo, ROOT } from '../scripts/eval/app.mjs';
import { findStudent, generateClass } from '../scripts/eval/generate.mjs';

const dir = mkdtempSync(join(tmpdir(), 'fv-eval-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/* The facts for one synthetic student, to check hand-written comments. */
function truthFor(first) {
  const run = generateClass(syntheticClass());
  const d = run.drafts.find(x => x.student.firstName === first);
  return truthOf(run.cid, d.student, d.facts, run.students);
}
const types = r => r.errors.map(e => e.type).sort();

describe('the drafts Generate writes', () => {
  it('draft every student and get none of the gradebook wrong', () => {
    const r = runAccuracy({ classData: syntheticClass() });
    expect(r.summary.students).toBe(STUDENTS.length);
    r.students.forEach(s => expect(s.generated.text.length, s.student).toBeGreaterThan(80));
    expect(r.summary.generated.total).toBe(0);
    expect(r.summary.generated.byType).toEqual(Object.fromEntries(ERROR_TYPES.map(t => [t, 0])));
    expect(r.summary.verifierReplaced).toBe(0);
  });

  it('are checked against real facts: titles, marks, counts and grades all appear in them', () => {
    const all = runAccuracy({ classData: syntheticClass() })
      .students.map(s => s.generated.text)
      .join(' ');
    expect(all).toMatch(/is earning an? [ABC]/);
    expect(all).toMatch(/“[^”]+”/);
    expect(all).toMatch(/\d+%/);
    expect(all).toMatch(/not handed in/);
  });

  it('are the same on every run (the first press of Generate Comment)', () => {
    const a = generateClass(syntheticClass()).drafts.map(d => d.text);
    const b = generateClass(syntheticClass()).drafts.map(d => d.text);
    expect(b).toEqual(a);
  });
});

describe('checkComment', () => {
  // Owen: C+ (68%), Current Events: Week 3 labelled Missing, best piece
  // Primary Source Analysis at 100%.
  it('passes a correct comment', () => {
    const r = checkComment(
      'Owen is earning a C+ this term, which is good work. One assignment is not handed in: “Current Events: Week 3.” ' +
        'His best piece was “Primary Source Analysis”, at 100%.',
      truthFor('Owen'),
    );
    expect(r.errors).toEqual([]);
    expect(r.unchecked).toEqual([]);
  });

  it('marks a classmate’s name', () => {
    const r = checkComment('Owen worked with Noor on the debate. Mateo’s group helped too.', truthFor('Owen'));
    expect(r.errors.map(e => e.found).sort()).toEqual(['Mateo', 'Noor']);
    expect(types(r)).toEqual(['name', 'name']);
  });

  it('marks a title that is no assignment, one not labelled Missing, and a best piece that is not the best', () => {
    const t = truthFor('Owen');
    expect(types(checkComment('His work on “The Cold War Essay” was careful.', t))).toEqual(['title']);
    expect(types(checkComment('One assignment is not handed in: “Treaty Debate.”', t))).toEqual(['title']);
    expect(types(checkComment('His best piece was “Treaty Debate”.', t))).toEqual(['title']);
    // The lesson number is dropped and a closing period ignored.
    expect(checkComment('One assignment is not handed in: “Current Events: Week 3.”', t).errors).toEqual([]);
    expect(checkComment('He did well on “Causes of the War.”', t).errors).toEqual([]);
  });

  it('marks a mark beside a title that is not the student’s mark on it', () => {
    const t = truthFor('Owen');
    const r = checkComment('He did well on “Primary Source Analysis”, reaching 75%.', t);
    expect(r.errors).toEqual([expect.objectContaining({ type: 'level', found: '75%', expected: '100%' })]);
    // Two titles, two marks, in order.
    const two = checkComment(
      '“Primary Source Analysis” (100%) went well, and “Treaty Debate” (50%) shows the skills.',
      t,
    );
    expect(two.errors).toEqual([expect.objectContaining({ type: 'level', found: '50%', expected: '75%' })]);
  });

  it('marks wrong counts of work not handed in, groups, attendance and a wrong course %', () => {
    const owen = truthFor('Owen');
    expect(types(checkComment('Two assignments are not handed in.', owen))).toEqual(['number']);
    expect(checkComment('One assignment is not handed in.', owen).errors).toEqual([]);
    const mateo = truthFor('Mateo');
    expect(
      checkComment('Three assignments are not handed in, including three Current Events assignments.', mateo).errors,
    ).toEqual([]);
    expect(
      types(checkComment('Four assignments are not handed in, including two Current Events assignments.', mateo)),
    ).toEqual(['number', 'number']);
    expect(types(checkComment('He has missed three classes and been late twice this term.', owen))).toEqual([
      'number',
      'number',
    ]);
    expect(types(checkComment('Overall, Mateo has an F (52%).', mateo))).toEqual(['number']);
    expect(checkComment('Overall, Mateo has an F (39%).', mateo).errors).toEqual([]);
  });

  it('marks a wrong letter, standing word or "close to"', () => {
    const t = truthFor('Owen');
    expect(types(checkComment('Owen is earning a B this term, which is very good work.', t))).toEqual([
      'grade',
      'grade',
    ]);
    expect(types(checkComment('Owen is earning a C+ this term, which is excellent work.', t))).toEqual(['grade']);
    expect(types(checkComment('Owen is earning a C+ this term, which is good work and close to a B.', t))).toEqual([
      'grade',
    ]);
    // Inside the gate (two points or fewer below the band), it holds.
    const close = Object.assign({}, t, { next: 'B' });
    expect(checkComment('Owen is earning a C+ this term, which is good work and close to a B.', close).errors).toEqual(
      [],
    );
  });

  it('reads a title written without quotes, and a mark beside it', () => {
    const t = truthFor('Owen');
    expect(checkComment('He scored 100% on Primary Source Analysis.', t).errors).toEqual([]);
    expect(checkComment('He scored 100% on Primary Source Analysis.', t).unchecked).toEqual([]);
    const r = checkComment('He scored 90% on the Primary Source Analysis, his best piece.', t);
    expect(r.errors).toEqual([expect.objectContaining({ type: 'level', found: '90%', expected: '100%' })]);
    expect(types(checkComment('One assignment, 1.1 Causes of the War, has not been handed in yet.', t))).toEqual([
      'title',
    ]);
  });

  it('reads the letter only where the comment says it is the student’s, and "a good standing"', () => {
    const t = truthFor('Owen');
    expect(checkComment('Owen is earning a C+ this term, a good standing.', t).errors).toEqual([]);
    expect(types(checkComment('Owen is earning a C+ this term, a very good standing.', t))).toEqual(['grade']);
    expect(types(checkComment('Owen has a B this term.', t))).toEqual(['grade']);
    expect(types(checkComment('A B is within reach of an A.', t))).toEqual(['grade']);
    expect(checkComment('He wrote a C major scale and an excellent work plan.', t).errors).toEqual([]);
  });

  it('lists a numeral it cannot check without counting it as an error', () => {
    const r = checkComment('Owen wrote 12 pages for History 12.', truthFor('Owen'));
    expect(r.errors).toEqual([]);
    expect(r.unchecked.map(u => u.found)).toEqual(['12']);
  });
});

describe('the run', () => {
  it('checks only the gold file’s students, and the teacher’s edits the same way', () => {
    const r = runAccuracy({
      classData: syntheticClass(),
      gold: [
        { studentName: 'Noor Haddad', comment: 'Hand-written.' },
        { studentName: 'Owen', comment: 'Hand-written.' },
        { studentName: 'Rowan Ellis', comment: 'Not in the class.' },
      ],
      edited: [{ studentName: 'Owen Fraser', comment: 'Owen is earning a B this term. Noor helped him.' }],
    });
    expect(r.students.map(s => s.student)).toEqual(['Noor Haddad', 'Owen Fraser']);
    expect(r.summary.goldUnmatched).toBe(1);
    expect(r.summary.edited.comments).toBe(1);
    expect(r.summary.edited.byType).toMatchObject({ grade: 1, name: 1 });
  });

  it('reads get_class_bundle data, bare or with the course row beside it, for the report asked for', () => {
    const bare = generateClass(syntheticClass());
    const bundle = syntheticClass();
    const wrapped = generateClass({ bundle, course: bundle.gradebook.course });
    expect(wrapped.drafts.map(d => d.text)).toEqual(bare.drafts.map(d => d.text));
    expect(bare.termId).toBe('term-1');
    expect(generateClass(syntheticClass(), 2).termId).toBe('term-2');
    expect(() => generateClass({ students: [] })).toThrow(/not get_class_bundle data/);
  });

  it('matches names by full name, then by a first name only one student has', () => {
    const { students } = generateClass(syntheticClass());
    expect(findStudent(students, 'lena okafor').lastName).toBe('Okafor');
    expect(findStudent(students, 'Priya').lastName).toBe('Sandhu');
    expect(findStudent(students, 'Priya Haddad')).toBe(null);
  });

  it('reads and writes student data only outside the repo, and prints counts only', () => {
    expect(() => assertOutsideRepo(join(ROOT, 'class.json'), 'The class file')).toThrow(
      /outside the FullVision folder/,
    );
    expect(() => assertOutsideRepo(ROOT, 'The output folder')).toThrow(/outside/);
    const classFile = join(dir, 'class.json');
    writeFileSync(classFile, JSON.stringify(syntheticClass()));
    expect(() => main(['--class', classFile, '--out', join(ROOT, 'eval-out')])).toThrow(/outside/);
    const out = main(['--class', classFile, '--out', join(dir, 'out')]);
    expect(out).toMatch(/^Generated: 0 errors in 5 comments/);
    STUDENTS.forEach(s => expect(out).not.toContain(s.first));
    const saved = JSON.parse(readFileSync(join(dir, 'out', 'accuracy.json'), 'utf-8'));
    expect(saved.students).toHaveLength(5);
  });

  it('reads number words', () => {
    expect([parseCount('one'), parseCount('Twelve'), parseCount('twenty-one'), parseCount('14')]).toEqual([
      1, 12, 21, 14,
    ]);
    expect([parseCount('once'), parseCount('twice'), parseCount('many')]).toEqual([1, 2, null]);
  });
});
