/**
 * The Grade row's source line on the Sentences card says in plain words how
 * far the mark is from the next letter (Nov 3 sweep, step 4, group 3 #71:
 * "Not called close to an A: 13 points short." read as jargon).
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const ST = { id: 's1', firstName: 'Rowan', lastName: 'Lee' };
const piece = (i, pct) => ({ id: 'p' + i, d: '2026-10-' + String(i + 1).padStart(2, '0'), pct });
const src = (pct, n) =>
  RQ.rowSource({ step: 'grade', text: '' }, 'c1', ST, {
    grade: {
      mode: 'letter',
      letter: percentageToLetter(pct, 'c1'),
      pct,
      next: nextLetterBand(pct),
      pieces: Array.from({ length: n }, (_, i) => piece(i, pct)),
    },
  });

describe('the Grade row’s source', () => {
  it('says how many points below the next letter, with no "Not called close"', () => {
    const s = src(73, 8);
    expect(s).not.toMatch(/Not called close|points short/);
    expect(s).toMatch(/^B · 73%\. 13 points below an A\.$/);
  });
  it('says why a mark within 2 points is not called close', () => {
    expect(src(85, 3)).toMatch(
      /^B · 85%\. 1 point below an A, but the comment does not say close because there are fewer than six marked pieces\.$/,
    );
  });
  it('says close when the comment does', () => {
    expect(src(85, 8)).toMatch(/^B · 85%\. Close to an A, 1 point below it\.$/);
  });
});
