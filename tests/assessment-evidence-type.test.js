/**
 * Evidence chips on the assessment form (plan item 8, Nov 4 2026): a new
 * assessment's kind is guessed from its title and scoring until the teacher
 * taps a chip. This checks the guess as written in page-assignments.js.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

function guess() {
  const src = readFileSync('teacher/page-assignments.js', 'utf-8');
  const fn = src.match(/ {2}function _guessEvidenceType\([^)]*\) \{[\s\S]*?\n {2}\}\n/);
  expect(fn, '_guessEvidenceType in page-assignments.js').toBeTruthy();
  // eslint-disable-next-line no-new-func
  return new Function(fn[0] + '\nreturn _guessEvidenceType;')();
}

describe('evidence kind guessed from the title', () => {
  const g = guess();
  it.each([
    ['Density Lab', 'lab'],
    ['Lab 3: Reaction Rates', 'lab'],
    ['Periodic Table Quiz', 'quiz'],
    ['Unit 2 Test', 'test'],
    ['Biodiversity Project', 'project'],
    ['Research Proposal', 'project'],
    ['Plate Tectonics Presentation', 'presentation'],
    ['Persuasive Essay', 'written'],
    ['', 'written'],
  ])('%s → %s', (title, kind) => {
    expect(g(title, 'proficiency')).toBe(kind);
  });

  it('matches whole words only', () => {
    expect(g('Labrador Retrievers', 'proficiency')).toBe('written');
    expect(g('Contest Entry', 'proficiency')).toBe('written');
    expect(g('Collaboration Reflection', 'proficiency')).toBe('written');
  });

  it('takes the last kind named', () => {
    expect(g('Lab Safety Quiz', 'proficiency')).toBe('quiz');
    expect(g('Quiz Review Project', 'points')).toBe('project');
  });

  it('is Written for Complete/Incomplete work', () => {
    expect(g('Density Lab', 'complete')).toBe('written');
  });
});
