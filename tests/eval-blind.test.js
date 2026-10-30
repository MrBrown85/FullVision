/**
 * The blind-rating export (plan PR 14): per gold student, the teacher's
 * comment, the generated draft and the teacher's edit, names taken out,
 * shuffled, with the key in a separate file. Synthetic class only
 * (tests/eval-fixture.js).
 */
import './setup.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { syntheticClass, STUDENTS } from './eval-fixture.js';
import { buildBlindSet, main, RUBRIC, stripNames } from '../scripts/eval/blind.mjs';
import { ROOT } from '../scripts/eval/app.mjs';
import { generateClass } from '../scripts/eval/generate.mjs';

const dir = mkdtempSync(join(tmpdir(), 'fv-blind-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const GOLD = [
  {
    studentName: 'Noor Haddad',
    comment: 'Noor is earning an A. Noor’s debate notes were careful, and she helped Owen.',
  },
  { studentName: 'Mateo Reyes', comment: 'Mateo Reyes has three Current Events assignments to hand in.' },
  { studentName: 'Priya Sandhu', comment: 'Priya is earning a C and is building her evidence skills.' },
];
const EDITED = [{ studentName: 'Noor Haddad', comment: 'Noor is earning an A this term, which is excellent work.' }];
const names = STUDENTS.flatMap(s => [s.first, s.last]);

describe('buildBlindSet', () => {
  const r = buildBlindSet({ classData: syntheticClass(), gold: GOLD, edited: EDITED, seed: 7 });

  it('gives each gold student a set: teacher-written, generated, and the edit when there is one', () => {
    const sets = {};
    r.key.forEach(k => (sets[k.student] = sets[k.student] || []).push(k.source));
    expect(Object.keys(sets).sort()).toEqual(['Mateo Reyes', 'Noor Haddad', 'Priya Sandhu']);
    expect(sets['Noor Haddad'].sort()).toEqual(['edited', 'generated', 'teacher']);
    expect(sets['Mateo Reyes'].sort()).toEqual(['generated', 'teacher']);
    // The key and the sheet line up row for row.
    expect(r.sheet.map(x => x.set + x.version)).toEqual(r.key.map(k => k.set + k.version));
  });

  it('puts the right text behind each key entry, with no student’s name left in it', () => {
    const drafts = generateClass(syntheticClass()).drafts;
    r.key.forEach((k, i) => {
      const text = r.sheet[i].comment;
      names.forEach(n => expect(text, k.set + k.version).not.toMatch(new RegExp('\\b' + n + '\\b')));
      if (k.source === 'teacher') {
        const gold = GOLD.find(g => g.studentName === k.student).comment;
        const student = drafts.find(d => k.student.startsWith(d.student.firstName)).student;
        expect(text).toBe(
          stripNames(
            gold,
            student,
            drafts.map(d => d.student),
          ),
        );
      }
      if (k.source === 'generated') expect(text).toMatch(/\[Student\]/);
    });
  });

  it('shuffles the sets and the versions in them, the same way for the same seed', () => {
    const again = buildBlindSet({ classData: syntheticClass(), gold: GOLD, edited: EDITED, seed: 7 });
    expect(again.key).toEqual(r.key);
    const orders = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const x = buildBlindSet({ classData: syntheticClass(), gold: GOLD, edited: EDITED, seed });
      orders.add(x.key.map(k => k.student + ':' + k.source).join('|'));
    }
    expect(orders.size).toBeGreaterThan(3);
  });

  it('counts gold entries that match no student', () => {
    const x = buildBlindSet({
      classData: syntheticClass(),
      gold: GOLD.concat({ studentName: 'Rowan Ellis', comment: 'Not in the class.' }),
      seed: 1,
    });
    expect(x.unmatched).toBe(1);
  });
});

describe('stripNames', () => {
  const { students } = generateClass(syntheticClass());
  const noor = students.find(s => s.firstName === 'Noor');

  it('takes out the student’s names, possessives included, and marks a classmate’s', () => {
    expect(stripNames('Noor Haddad wrote it. Noor’s notes helped Owen and Lena Okafor.', noor, students)).toBe(
      '[Student] wrote it. [Student]’s notes helped [Classmate] and [Classmate].',
    );
  });

  it('leaves a name inside another word', () => {
    expect(stripNames('Noorish ideas.', noor, students)).toBe('Noorish ideas.');
  });
});

describe('the files', () => {
  it('writes a rating sheet for the rubric’s five criteria, the rubric, and a separate key', () => {
    const classFile = join(dir, 'class.json');
    const goldFile = join(dir, 'gold.json');
    writeFileSync(classFile, JSON.stringify(syntheticClass()));
    writeFileSync(goldFile, JSON.stringify(GOLD));
    const out = join(dir, 'out');
    const said = main(['--class', classFile, '--gold', goldFile, '--out', out, '--seed', '3']);
    expect(said).toMatch(/^3 sets, 6 comments, seed 3/);
    STUDENTS.forEach(s => expect(said).not.toContain(s.first));

    const sheet = readFileSync(join(out, 'rating-sheet.csv'), 'utf-8');
    expect(sheet.charCodeAt(0)).toBe(0xfeff);
    const head = sheet.slice(1).split('\r\n')[0];
    expect(head).toBe(
      'Set,Version,Comment,Rater,Specificity (1-4),Tone (1-4),Written for This Student (1-4),Plain Language (1-4),Accuracy Errors (count),Notes',
    );
    names.forEach(n => expect(sheet).not.toMatch(new RegExp('\\b' + n + '\\b')));
    expect(RUBRIC.map(c => c.criterion)).toEqual([
      'Specificity',
      'Tone',
      'Written for This Student',
      'Plain Language',
      'Accuracy',
    ]);
    expect(readFileSync(join(out, 'rubric.csv'), 'utf-8')).toContain('Could fit any student');
    const key = readFileSync(join(out, 'key.csv'), 'utf-8');
    expect(key).toContain('Noor Haddad');
    expect(key).toMatch(/Seed,3/);
  });

  it('refuses paths inside the repo', () => {
    const classFile = join(dir, 'class2.json');
    writeFileSync(classFile, JSON.stringify(syntheticClass()));
    expect(() => main(['--class', classFile, '--gold', classFile, '--out', join(ROOT, 'blind-out')])).toThrow(
      /outside the FullVision folder/,
    );
    expect(existsSync(join(ROOT, 'blind-out'))).toBe(false);
  });
});
