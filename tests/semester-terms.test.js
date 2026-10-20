/**
 * Full year / Semester 1 / Semester 2 per class (DECISIONS, Reporting
 * periods 9). A semester class carries only its semester's terms and keeps
 * the school's numbers, so Semester 2's terms stay Report 3 and Report 4.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const IN_YEAR = '2026-10-17';
const grandview = () => reportingTermPreset('grandviewheights', IN_YEAR);

describe('semester spans', () => {
  it("splits a school's terms at the day its Semester 2 starts", () => {
    const full = grandview();
    const sem2 = semesterTwoStart(full);
    expect(sem2).toBe('2027-01-27');
    expect(termsInSpan(full, 's1', sem2).map(t => t.ordinal)).toEqual([1, 2]);
    expect(termsInSpan(full, 's2', sem2).map(t => t.ordinal)).toEqual([3, 4]);
    expect(termsInSpan(full, 'full', sem2).map(t => t.ordinal)).toEqual([1, 2, 3, 4]);
  });

  it('a semester subset still matches its school, so Semester 2 reads Apr and Jun', () => {
    const sem2 = termsInSpan(grandview(), 's2', '2027-01-27');
    expect(semesterTwoStart(sem2)).toBe('2027-01-27');
    expect(reportingTermReportNames(sem2)).toEqual(['Apr report card', 'Jun report card']);
  });

  it('reads the span back off the terms a class carries', () => {
    const full = grandview();
    const sem2 = semesterTwoStart(full);
    expect(termSpanOf(full, sem2)).toBe('full');
    expect(termSpanOf(full.slice(0, 2), sem2)).toBe('s1');
    expect(termSpanOf(full.slice(2), sem2)).toBe('s2');
    expect(termSpanOf([], sem2)).toBe('full');
  });

  it('a year of typed terms that runs past Feb 1 reads as full year', () => {
    const terms = [
      { ordinal: 1, label: 'Term 1', starts_on: '2025-09-01', ends_on: '2025-11-30' },
      { ordinal: 2, label: 'Term 2', starts_on: '2025-12-01', ends_on: '2026-06-26' },
    ];
    expect(termSpanOf(terms, semesterTwoStart(terms))).toBe('full');
  });

  it('uses Feb 1 for terms that are not a school preset', () => {
    expect(semesterTwoStart([{ ordinal: 1, starts_on: '2026-09-02', ends_on: '2027-01-30' }])).toBe('2027-02-01');
  });
});

describe('term numbers', () => {
  it('keeps Terms 3 and 4 for a Semester 2 class', () => {
    const sem2 = grandview().slice(2);
    expect(normalizeTermOrdinals(sem2).map(t => t.ordinal)).toEqual([3, 4]);
  });

  it('gives a typed term the next number after the school ones', () => {
    const rows = grandview()
      .slice(2)
      .concat([{ label: 'Summer', starts_on: '2027-07-02', ends_on: '2027-08-15' }]);
    expect(normalizeTermOrdinals(rows).map(t => t.ordinal)).toEqual([3, 4, 5]);
  });

  it('renumbers 1..n when the numbers are out of date order or run past 6', () => {
    expect(
      normalizeTermOrdinals([
        { ordinal: 1, label: 'B', starts_on: '2027-02-01', ends_on: '2027-06-30' },
        { ordinal: 2, label: 'A', starts_on: '2026-09-01', ends_on: '2027-01-31' },
      ]).map(t => [t.label, t.ordinal]),
    ).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
    expect(
      normalizeTermOrdinals([
        { ordinal: 6, label: 'X', starts_on: '2026-09-01', ends_on: '2026-10-01' },
        { label: 'Y', starts_on: '2026-10-02', ends_on: '2026-11-01' },
      ]).map(t => t.ordinal),
    ).toEqual([1, 2]);
  });

  it('a saved Semester 2 class keeps its chosen term', () => {
    const cid = 'e0000000-0000-4000-8000-0000000000s2';
    saveCourses({ [cid]: { id: cid, name: 'Philosophy 12' } });
    _cache.courseConfigs[cid] = {};
    expect(saveReportingTerms(cid, grandview().slice(2))).toBeNull();
    expect(getReportingTerms(cid).map(t => t.ordinal)).toEqual([3, 4]);
    setSelectedTermOrdinal(cid, 4);
    expect(saveReportingTerms(cid, grandview().slice(2))).toBeNull();
    expect(getSelectedTermOrdinal(cid)).toBe(4);
    setSelectedTermOrdinal(cid, null);
  });
});
