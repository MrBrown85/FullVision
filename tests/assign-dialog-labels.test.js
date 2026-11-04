import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/* Nov 3 sweep (step 4 group 3 #25): dialogs on Assignments use Title Case
   for their titles and buttons, and Set Everyone To's dialog has the
   button's name. */
const read = f => readFileSync(new URL('../teacher/' + f, import.meta.url), 'utf-8');

describe('Assignments dialog words', () => {
  it('Criteria From Competencies and its Add button are in Title Case', () => {
    const src = read('page-assignments.js');
    expect(src).toContain("title: 'Criteria From Competencies'");
    expect(src).toContain("(n === 1 ? ' Criterion' : ' Criteria')");
    expect(src).not.toContain("title: 'Criteria from competencies'");
  });
  it('Check Before Adding and its buttons are in Title Case', () => {
    const src = read('assessment-copy.js');
    expect(src).toContain("title: 'Check Before Adding'");
    expect(src).toContain("cancelLabel: 'Don’t Add'");
    expect(src).toContain("plans.length + ' Classes'");
  });
  it('Set Everyone To opens a dialog of the same name', () => {
    const src = read('page-assignments.js');
    expect(src).toContain("var title = 'Set Everyone To ' + label;");
    expect(src).not.toMatch(/Fill All Scores/);
  });
});
