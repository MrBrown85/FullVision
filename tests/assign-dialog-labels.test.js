import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/* Nov 3 sweep (step 4 group 3 #25): dialogs on Assignments use Title Case
   for their titles and buttons, and Set Everyone To's dialog has the
   button's name. */
const read = f => readFileSync(new URL('../teacher/' + f, import.meta.url), 'utf-8');

describe('Assignments dialog words', () => {
  it('Check Before Adding and its buttons are in Title Case', () => {
    const src = read('assessment-copy.js');
    expect(src).toContain("title: 'Check Before Adding'");
    expect(src).toContain("cancelLabel: 'Don’t Add'");
    expect(src).toContain("plans.length + ' Classes'");
  });
  it('Set Everyone To opens a dialog of the same name', () => {
    // The page is teacher/page-assignments.js and the teacher/assign-*.js cut from it.
    const src = ['page-assignments.js']
      .concat(readdirSync(new URL('../teacher/', import.meta.url)).filter(n => /^assign-.*\.js$/.test(n)))
      .map(read)
      .join('\n');
    expect(src).toContain("var title = 'Set Everyone To ' + label;");
    expect(src).not.toMatch(/Fill All Scores/);
  });
});
