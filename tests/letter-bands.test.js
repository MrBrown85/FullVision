/**
 * One table of BC letter bands (BC_LETTER_BANDS) drives every letter cutoff
 * in calc.js, and scoreLevelText names one score's level with its + or −.
 * The old hand-written cutoffs are kept here to prove nothing moved.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

function oldPercentageToLetter(R, cid) {
  if (R == null) return null;
  if (R >= 86) return 'A';
  if (R >= 73) return 'B';
  if (R >= 67) return 'C+';
  if (R >= 60) return 'C';
  if (R >= 50) return 'C-';
  return cid == null || courseHasEnded(cid) ? 'F' : 'IE';
}
function oldPercentLevel(pct) {
  return pct >= 86 ? 4 : pct >= 73 ? 3 : pct >= 60 ? 2 : 1;
}
function oldNextLetterBand(R) {
  var bands = [
    { label: 'A', min: 86 },
    { label: 'B', min: 73 },
    { label: 'C+', min: 67 },
    { label: 'C', min: 60 },
    { label: 'C-', min: 50 },
    { label: 'F', min: 0 },
  ];
  if (R == null || isNaN(Number(R))) return null;
  for (var i = bands.length - 1; i >= 0; i--) {
    if (bands[i].min > Number(R)) return { letter: bands[i].label, min: bands[i].min };
  }
  return null;
}

const VALUES = [null, undefined, NaN, -5, 0, 49.99, 50, 59.9, 60, 66.95, 67, 72.99, 73, 85.95, 86, 100, 104.5];
for (let p = 0; p <= 1000; p++) VALUES.push(p / 10);

describe('BC_LETTER_BANDS', () => {
  const originalTerms = globalThis.getReportingTerms;
  afterEach(() => {
    globalThis.getReportingTerms = originalTerms;
  });

  it('gives the same letter as the old cutoffs, with and without a class', () => {
    VALUES.forEach(v => {
      expect(percentageToLetter(v)).toBe(oldPercentageToLetter(v));
    });
    // A class with no reporting terms never ends, so under 50 is IE.
    globalThis.getReportingTerms = () => [];
    VALUES.forEach(v => {
      expect(percentageToLetter(v, 'course-x')).toBe(oldPercentageToLetter(v, 'course-x'));
    });
  });

  it('gives the same colour level as the old cutoffs (C- and F are 1)', () => {
    VALUES.forEach(v => {
      expect(_percentLevel(v)).toBe(oldPercentLevel(v));
    });
  });

  it('gives the same next band up', () => {
    VALUES.forEach(v => {
      expect(nextLetterBand(v)).toEqual(oldNextLetterBand(v));
    });
  });

  it('is not the points → proficiency scale (50–59% is Developing there)', () => {
    const developing = DEFAULT_GRADING_SCALE.boundaries.find(b => b.proficiency === 2);
    expect(developing.min).toBe(50);
    expect(_percentLevel(55)).toBe(1);
  });
});

describe('scoreLevelText', () => {
  it('names the level with its + or −', () => {
    expect(scoreLevelText(3, 1)).toBe('Proficient +');
    expect(scoreLevelText(2, -1)).toBe('Developing −');
    expect(scoreLevelText(3, 0)).toBe('Proficient');
    expect(scoreLevelText(3)).toBe('Proficient');
  });

  it('drops a sign a level cannot carry (no 1− or 4+)', () => {
    expect(scoreLevelText(4, 1)).toBe('Extending');
    expect(scoreLevelText(1, -1)).toBe('Emerging');
  });

  it('is empty with no level', () => {
    expect(scoreLevelText(0, 1)).toBe('');
    expect(scoreLevelText(null)).toBe('');
  });
});
