/**
 * The words on the My Bank form and the Browse headings it saves under
 * (Nov 3 sweep, step 4, group 3 #72): a sentence saved for any student no
 * longer lands under "Steady", a heading the teacher never picked; the
 * best-piece cases name the Note for the Report; the hidden story says what
 * it means.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const label = (part, id) => (RQ.browseCases(part).find(c => c.id === id) || {}).label;

describe('the My Bank and Browse case labels', () => {
  it('say Any Student for a strengths sentence bound to no story, where one saved with no case lands', () => {
    expect(RQ.browseCase('strengths', { part: 'now', group: 'Overall', when: {} })).toEqual(['steady']);
    expect(label('strengths', 'steady')).toBe('Any Student');
  });
  it('name the Note for the Report and the grade lowered by missing work', () => {
    expect(label('bestPiece', 'note')).toBe('With a Note for the Report');
    expect(label('bestPiece', 'noNote')).toBe('Without a Note for the Report');
    expect(label('strengths', 'hidden')).toBe('Grade Lowered by Missing Work');
  });
  it('use none of the old words', () => {
    RQ.PARTS.forEach(p =>
      RQ.browseCases(p.id).forEach(c =>
        expect(c.label).not.toMatch(/^(Steady|Any Case|Without a Note|With a Note|Hidden by Missing Work)$/),
      ),
    );
  });
});
