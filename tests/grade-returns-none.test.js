/**
 * A class with no Draft and Returned rows on this device answers "none"
 * without reading localStorage for every cell.
 *
 * What was slow: getGradeReturns is asked for each cell of a draw (through
 * getGradeReturn), and for a class that keeps no rows, every class whose
 * student page is off, it read localStorage each time, on purpose caching
 * nothing. That this device holds none is now kept (shared/data.js,
 * _cache.gradeReturnsNone) until the class's cache is dropped or another tab
 * writes the rows; every way rows come in on this page sets the cache first.
 *
 * This file holds the answer beside what this device holds after each way
 * rows come in or go, and counts the reads.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const Q = U(41);
const PIECE = U(31);
const IDS = [U(100), U(101)];
const KEY = 'gb-grade-returns-' + CID;
let wasDemo;
let reads;
let realGet;

function seed(pageOn) {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'F' + i, lastName: 'L' + i })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: PIECE, title: 'Letter', tagIds: [Q], date: '2026-10-20' }],
    courseConfigs: pageOn ? { student_page_enabled: true, return_grades: 'on_return' } : {},
  });
}
// What this device holds: the cache, or else the saved copy, or else none.
function held() {
  if (_cache.gradeReturns[CID] !== undefined) return _cache.gradeReturns[CID];
  let stored = null;
  try {
    stored = JSON.parse(realGet.call(localStorage, KEY));
  } catch (e) {
    stored = null;
  }
  return _plainObject(stored) ? stored : {};
}
const same = () => expect(getGradeReturns(CID)).toEqual(held());

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  realGet = localStorage.getItem;
  reads = 0;
  localStorage.getItem = function (k) {
    if (k === KEY) reads++;
    return realGet.apply(localStorage, arguments);
  };
});
afterEach(() => {
  localStorage.getItem = realGet;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('a class with no rows on this device', () => {
  it('answers none from one read, and a new object each time, as before', () => {
    seed(false);
    reads = 0;
    const first = getGradeReturns(CID);
    expect(first).toEqual({});
    for (let i = 0; i < 500; i++) expect(getGradeReturn(CID, IDS[0], PIECE)).toBeNull();
    expect(reads).toBe(1);
    expect(getGradeReturns(CID)).not.toBe(first);
    // Nothing is put in the class's cache or in localStorage for it.
    expect(_cache.gradeReturns[CID]).toBeUndefined();
    expect(realGet.call(localStorage, KEY)).toBeNull();
  });

  it('a saved copy that is not rows counts as none, as before', () => {
    seed(false);
    localStorage.setItem(KEY, '[1,2]');
    same();
    getGradeReturns(CID);
    expect(reads).toBe(1);
  });

  it('shows rows at once, however they come in or go', () => {
    seed(true);
    same();
    // A grade saved on this page: a Draft row.
    Grader.setLevel(CID, IDS[0], PIECE, Q, 3);
    same();
    expect(getGradeReturn(CID, IDS[0], PIECE)).not.toBeNull();
    // The class's cache dropped and read again from this device (a class switch, another tab's change).
    _loadCourseFromLS(CID);
    same();
    expect(getGradeReturn(CID, IDS[0], PIECE)).not.toBeNull();
    // The rows forgotten (the student page turned on again), then the server's loaded.
    _forgetGradeReturns(CID);
    same();
    expect(getGradeReturns(CID)).toEqual({});
    _loadGradeReturns(CID, { [PIECE]: { [IDS[1]]: { is_draft: true } } });
    same();
    expect(getGradeReturn(CID, IDS[1], PIECE)).toEqual({ is_draft: true });
    // Dropped from the cache: read from the copy just written.
    _loadCourseFromLS(CID);
    same();
    expect(getGradeReturn(CID, IDS[1], PIECE)).toEqual({ is_draft: true });
  });

  it("follows another tab's rows", () => {
    seed(false);
    expect(getGradeReturns(CID)).toEqual({});
    // Another tab writes the class's rows: the storage event says so.
    localStorage.setItem(KEY, JSON.stringify({ [PIECE]: { [IDS[0]]: { is_draft: false } } }));
    _gradeReturnsElsewhere({ key: KEY });
    same();
    expect(getGradeReturn(CID, IDS[0], PIECE)).toEqual({ is_draft: false });
    // Another class's key changes nothing here; storage cleared everywhere forgets every class's none.
    clearClass(CID);
    seed(false);
    localStorage.removeItem(KEY);
    getGradeReturns(CID);
    _gradeReturnsElsewhere({ key: 'gb-grade-returns-' + U(2) });
    expect(_cache.gradeReturnsNone[CID]).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ [PIECE]: {} }));
    _gradeReturnsElsewhere({ key: null });
    same();
    expect(getGradeReturns(CID)).toEqual({ [PIECE]: {} });
  });
});
