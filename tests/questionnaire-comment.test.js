/**
 * The Term Questionnaire's comment (teacher/report-questionnaire.js): plain
 * text now; a comment saved as HTML by the old editor reads as text.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

describe('plainComment', () => {
  it('leaves plain text as it is', () => {
    expect(ReportQuestionnaire.plainComment('Cece had a steady term.\n\nShe asks good questions.')).toBe(
      'Cece had a steady term.\n\nShe asks good questions.',
    );
  });

  it('reads an old HTML comment as text, block ends as new lines', () => {
    const html =
      '<p>Cece had a <b>steady</b> term &amp; asks questions.</p><p>Next: labs.<br>On time.</p><ul><li>One</li><li>Two</li></ul>';
    expect(ReportQuestionnaire.plainComment(html)).toBe(
      'Cece had a steady term & asks questions.\nNext: labs.\nOn time.\nOne\nTwo',
    );
  });

  it('gives an empty string for nothing', () => {
    expect(ReportQuestionnaire.plainComment(null)).toBe('');
  });
});
