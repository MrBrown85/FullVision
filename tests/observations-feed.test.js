/**
 * Observations feed helpers — teacher/page-observations.js
 *
 * The "Quoted in Report N" mark, the "with …" line for a multi-student
 * capture, and the date filter ranges.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { describe, expect, it } from 'vitest';

runInThisContext(readFileSync(resolve(__dirname, '../teacher/page-observations.js'), 'utf-8'), {
  filename: 'teacher/page-observations.js',
});
const H = window.PageObservations._helpers;

describe('quotedIndex / quotedLabel', () => {
  const ratings = {
    st1: {
      'term-1': { mentionObs: ['ob1', 'ob2'] },
      'term-2': { mentionObs: ['ob2'] },
    },
    st2: { 'term-1': { narrative: 'no mentions' } },
  };

  it('keys by student and observation, listing each term once', () => {
    const qi = H.quotedIndex(ratings);
    expect(qi['st1|ob1']).toEqual([1]);
    expect(qi['st1|ob2']).toEqual([1, 2]);
    expect(qi['st2|ob1']).toBeUndefined();
  });

  it('says which report quoted it', () => {
    expect(H.quotedLabel([1], true)).toBe('Quoted in Report 1');
    expect(H.quotedLabel([1, 2], true)).toBe('Quoted in Reports 1 and 2');
    expect(H.quotedLabel([1, 2, 3], true)).toBe('Quoted in Reports 1, 2 and 3');
  });

  it('says "Quoted" alone when the class has no reporting terms', () => {
    expect(H.quotedLabel([1], false)).toBe('Quoted');
  });

  it('gives no mark when the observation is not quoted', () => {
    expect(H.quotedLabel(undefined, true)).toBeNull();
  });
});

describe('sameCaptureIndex / withLabel', () => {
  const t = '2026-10-15T18:42:10.000Z';
  const obs = [
    { id: 'a', studentId: 'mei', text: 'Calibrated the balance.', created: t },
    { id: 'b', studentId: 'sofia', text: 'Calibrated the balance. ', created: '2026-10-15T18:42:11.000Z' },
    { id: 'c', studentId: 'ines', text: 'Calibrated the balance.', created: '2026-10-15T18:43:00.000Z' },
    { id: 'd', studentId: 'ethan', text: 'Something else.', created: t },
  ];

  it('groups the same text captured in the same minute', () => {
    const idx = H.sameCaptureIndex(obs);
    expect(idx[H.captureKey(obs[0])]).toEqual(['mei', 'sofia']);
    expect(idx[H.captureKey(obs[2])]).toEqual(['ines']);
    expect(idx[H.captureKey(obs[3])]).toEqual(['ethan']);
  });

  it('names the other students', () => {
    expect(H.withLabel([])).toBe('');
    expect(H.withLabel(['Sofia Bianchi'])).toBe('with Sofia Bianchi');
    expect(H.withLabel(['A', 'B'])).toBe('with A and B');
    expect(H.withLabel(['A', 'B', 'C'])).toBe('with A, B and C');
    expect(H.withLabel(['A', 'B', 'C', 'D', 'E'])).toBe('with A, B and 3 others');
  });
});

describe('date ranges', () => {
  it('this week runs Monday to today', () => {
    expect(H.weekRange('2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' }); // Sunday
    expect(H.weekRange('2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-12' }); // Monday
  });

  const terms = [
    { ordinal: 1, starts_on: '2026-09-02', ends_on: '2026-11-27' },
    { ordinal: 2, starts_on: '2026-11-30', ends_on: '2027-03-12' },
  ];

  it('this term is the term holding today', () => {
    expect(H.termRange(terms, '2026-10-18')).toEqual({ from: '2026-09-02', to: '2026-11-27' });
  });

  it('between terms, the latest one that has started', () => {
    expect(H.termRange(terms, '2026-11-28')).toEqual({ from: '2026-09-02', to: '2026-11-27' });
  });

  it('none before the first term or without terms', () => {
    expect(H.termRange(terms, '2026-08-01')).toBeNull();
    expect(H.termRange([], '2026-10-18')).toBeNull();
  });
});

describe('isLinked', () => {
  it('is true for an observation with an assessment', () => {
    expect(H.isLinked({ assignmentContext: { assessmentId: 'a1' } })).toBe(true);
    expect(H.isLinked({ assignmentContext: { assessmentTitle: 'Lab' } })).toBe(true);
    expect(H.isLinked({})).toBe(false);
  });
});
