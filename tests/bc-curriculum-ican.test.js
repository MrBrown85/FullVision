/**
 * data/bc-curriculum-ican.json holds the I Can statements for BC curriculum
 * competencies (stage 3 of the bank rebuild), keyed by competency id in
 * data/bc-curriculum-source.json. It covers every subject in the source:
 * Social Studies, English Language Arts, Science, Mathematics, Physical and
 * Health Education, Career Education, Applied Design, Skills and Technologies
 * and Arts Education. These checks read only the two JSON files and keep their
 * own rules, apart from whatever produced the statements.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const source = JSON.parse(readFileSync('data/bc-curriculum-source.json', 'utf-8'));
const ican = JSON.parse(readFileSync('data/bc-curriculum-ican.json', 'utf-8'));

const SUBJECTS = new Set([
  'Social Studies',
  'English Language Arts',
  'Science',
  'Mathematics',
  'Physical and Health Education',
  'Career Education',
  'Applied Design, Skills and Technologies',
  'Arts Education',
]);
const rows = Object.entries(source)
  .filter(([key, course]) => !key.startsWith('_') && SUBJECTS.has(course.subject))
  .flatMap(([key, course]) =>
    course.categories.flatMap(cat =>
      cat.competencies.map(x => ({ key, grade: course.grade, id: x.id, raw: x.raw, ic: ican[x.id] })),
    ),
  );
const statements = rows.flatMap(r => (r.ic ? r.ic.i_can_statements.map(s => ({ ...r, s })) : []));

// Words a statement may not use: vague verbs a teacher cannot see in student
// work, words that shame or qualify a level, and outdated terms.
const BANNED =
  /\b(understand|appreciate|know|learn about|still|again|finally|unfortunately|always|independently|with support|aboriginal|gay)\b/i;
const CAP = { 8: 14, 9: 17, 10: 17, 11: 22, 12: 22 };
const sha = raw => createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
const words = s => s.split(/\s+/).filter(Boolean).length;

describe('BC curriculum I Can statements', () => {
  it('covers every competency in its eight subjects, and nothing else', () => {
    expect(rows.length).toBe(5029);
    expect(rows.filter(r => !r.ic).map(r => r.id)).toEqual([]);
    const ids = new Set(rows.map(r => r.id));
    expect(Object.keys(ican).filter(id => !id.startsWith('_') && !ids.has(id))).toEqual([]);
    for (const r of rows) expect(r.ic.course, r.id).toBe(r.key);
  });

  it('gives each competency 2 to 4 statements, none repeated', () => {
    const bad = rows.filter(r => {
      const s = r.ic.i_can_statements;
      return s.length < 2 || s.length > 4 || new Set(s).size !== s.length;
    });
    expect(bad.map(r => r.id)).toEqual([]);
  });

  it('starts every statement "I can" and a lower-case word, with no ending punctuation', () => {
    const bad = statements.filter(x => !/^I can [a-z]/.test(x.s) || /[.!?;:,]$/.test(x.s) || x.s !== x.s.trim());
    expect(bad.map(x => `${x.id}: ${x.s}`)).toEqual([]);
  });

  it('uses none of the banned words', () => {
    expect(statements.filter(x => BANNED.test(x.s)).map(x => `${x.id}: ${x.s}`)).toEqual([]);
  });

  it('keeps statements within the word cap for the grade: 14 at 8, 17 at 9-10, 22 at 11-12', () => {
    expect(statements.filter(x => words(x.s) > CAP[x.grade]).map(x => `${x.id} (${words(x.s)}): ${x.s}`)).toEqual([]);
  });

  it('was written against the current Ministry text', () => {
    // A change to the official wording flags the statements built on it.
    expect(rows.filter(r => r.ic.prov.raw_sha !== sha(r.raw)).map(r => r.id)).toEqual([]);
    for (const r of rows) {
      expect(['exemplar', 'adapted'], r.id).toContain(r.ic.prov.method);
      expect(r.ic.prov.approved_by_owner, r.id).toBe(true);
      expect(ican[r.ic.prov.exemplar], `${r.id} exemplar`).toBeTruthy();
    }
  });

  it('gives identical Ministry wording within a cluster identical statements', () => {
    const byWording = new Map();
    for (const r of rows) {
      const k = r.ic.cluster + '\u0000' + r.raw;
      const set = JSON.stringify(r.ic.i_can_statements);
      if (!byWording.has(k)) byWording.set(k, { set, id: r.id });
      else expect(set, `${r.id} vs ${byWording.get(k).id}`).toBe(byWording.get(k).set);
    }
  });
});
