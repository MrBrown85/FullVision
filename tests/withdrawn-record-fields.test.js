/**
 * The table of a withdrawn student's records (shared/data.js) is built when
 * it is read, not while the file loads, so a getter can move to a file that
 * loads later. It must hold the same fields, in the same order, with the same
 * getters as the table it replaced.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

// The table as it was written before it became lazy, field for field.
const OLD_TABLE = [
  ['scores', 'getScores'],
  ['goals', 'getGoals'],
  ['reflections', 'getReflections'],
  ['notes', 'getNotes'],
  ['flags', 'getFlags'],
  ['observations', 'getQuickObs'],
  ['termRatings', 'getTermRatings'],
  ['overrides', 'getOverrides'],
  ['studentProfileSummaries', 'getStudentProfileSummaries'],
];

describe('withdrawn record fields', () => {
  it('is a function, built on use', () => {
    expect(typeof globalThis._withdrawnRecordFields).toBe('function');
    expect(globalThis._WITHDRAWN_RECORD_FIELDS).toBeUndefined();
  });

  it('has the same fields in the same order as the old table', () => {
    const table = globalThis._withdrawnRecordFields();
    expect(Object.keys(table)).toEqual(OLD_TABLE.map(([field]) => field));
  });

  it('points each field at the same getter as the old table', () => {
    const table = globalThis._withdrawnRecordFields();
    OLD_TABLE.forEach(([field, getter]) => {
      expect(typeof globalThis[getter]).toBe('function');
      expect(table[field]).toBe(globalThis[getter]);
    });
  });

  it('gives the same table every time it is read', () => {
    const a = globalThis._withdrawnRecordFields();
    const b = globalThis._withdrawnRecordFields();
    expect(a).not.toBe(b);
    expect(Object.entries(a)).toEqual(Object.entries(b));
  });
});
