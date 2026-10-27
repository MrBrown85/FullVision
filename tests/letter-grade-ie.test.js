/**
 * BC reporting: a student under 50% gets IE (Insufficient Evidence), not F,
 * until the course ends. Proficiency words are never replaced.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('IE before the course ends', () => {
  const CID = 'course-ie';
  const TERMS = [
    { ordinal: 1, label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-27' },
    { ordinal: 2, label: 'Term 2', starts_on: '2026-11-28', ends_on: '2027-01-26' },
  ];
  let today;
  let originals;

  beforeEach(() => {
    originals = { getReportingTerms: globalThis.getReportingTerms, courseToday: globalThis.courseToday };
    globalThis.getReportingTerms = () => TERMS;
    globalThis.courseToday = () => today;
    today = '2026-10-27';
    setActiveTerm(CID, null);
  });

  afterEach(() => {
    globalThis.getReportingTerms = originals.getReportingTerms;
    globalThis.courseToday = originals.courseToday;
    setActiveTerm(CID, null);
    vi.restoreAllMocks();
  });

  it('gives IE under 50% before the last term ends', () => {
    expect(percentageToLetter(42, CID)).toBe('IE');
    expect(percentageToLetter(0, CID)).toBe('IE');
  });

  it('leaves passing letters alone', () => {
    expect(percentageToLetter(50, CID)).toBe('C-');
    expect(percentageToLetter(90, CID)).toBe('A');
  });

  it('gives F once the last term has ended', () => {
    today = '2027-01-26';
    expect(percentageToLetter(42, CID)).toBe('F');
  });

  it('gives F on the final report, the last term in view', () => {
    setActiveTerm(CID, 2);
    expect(percentageToLetter(42, CID)).toBe('F');
    setActiveTerm(CID, 1);
    expect(percentageToLetter(42, CID)).toBe('IE');
  });

  it('gives IE in a class with no reporting terms', () => {
    globalThis.getReportingTerms = () => [];
    expect(courseHasEnded(CID)).toBe(false);
    expect(percentageToLetter(10, CID)).toBe('IE');
  });

  it('applies to a grade from proficiency work too', () => {
    expect(calcLetterGrade(0.5, CID).letter).toBe('IE');
  });
});
