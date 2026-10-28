/**
 * Competency labels in curriculum_by_course.json read as names, not as the
 * first words of a statement cut short (scripts/clean-competency-labels.py).
 * The questionnaire's Comment Bank and the printed Proficiency block put
 * them in sentences ("her strongest work is in …").
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const data = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
const STOP = new Set('a an the and or of to in for with on by from through about as at that which into'.split(' '));
const words = t => (t.toLowerCase().match(/[a-z][a-z'-]*/g) || []).filter(w => !STOP.has(w));
const all = Object.entries(data).flatMap(([tag, course]) =>
  course.categories.flatMap(cat =>
    cat.competencies.map(c => ({ tag, cat: cat.name, n: cat.competencies.length, ...c })),
  ),
);

describe('competency labels', () => {
  it('has no label that is just the statement’s first words, cut', () => {
    const cut = all.filter(c => {
      const lw = words(c.short_label);
      const rw = words(c.raw);
      const prefix = lw.length > 0 && rw.slice(0, lw.length).join(' ') === lw.join(' ');
      const sameStart = c.short_label.split(' ')[0].toLowerCase() === c.raw.split(' ')[0].toLowerCase();
      // Short whole labels ("Access Information") and a label equal to its
      // whole statement are fine.
      return prefix && sameStart && lw.length >= 3 && rw.length > lw.length && c.n > 1;
    });
    expect(cut.map(c => c.tag + ': ' + c.short_label)).toEqual([]);
  });

  it('ends on a word, not a dangling and / of / using', () => {
    const dangling = all.filter(c => /\b(and|or|of|to|in|for|with|using|how|about)$/i.test(c.short_label));
    expect(dangling.map(c => c.tag + ': ' + c.short_label)).toEqual([]);
  });

  it('keeps the JS copy the same as the JSON', () => {
    const js = readFileSync('curriculum_data.js', 'utf-8');
    expect(JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1))).toEqual(data);
  });
});
