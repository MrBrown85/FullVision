/**
 * localStorage safety layer tests — gb-data.js
 * Tests _safeLSSet, _safeParseLS, and localStorage persistence.
 */

const CID = 'test';

beforeEach(() => {
  _cache.scores[CID] = undefined;
  _cache.students[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.courses = null;
  localStorage.clear();
});

describe('_safeLSSet', () => {
  it('writes to localStorage successfully', () => {
    _safeLSSet('gb-test-key', JSON.stringify({ hello: 'world' }));
    expect(localStorage.getItem('gb-test-key')).toBe('{"hello":"world"}');
  });

  it('catches errors without crashing when setItem throws', () => {
    const origSetItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => _safeLSSet('gb-boom', 'value')).not.toThrow();
    localStorage.setItem = origSetItem;
  });

  it('handles very large values without crashing', () => {
    const bigValue = 'x'.repeat(100000);
    expect(() => _safeLSSet('gb-big', bigValue)).not.toThrow();
    expect(localStorage.getItem('gb-big')).toBe(bigValue);
  });
});

describe('_safeParseLS', () => {
  it('returns parsed JSON on valid data', () => {
    localStorage.setItem('gb-valid', JSON.stringify([1, 2, 3]));
    expect(_safeParseLS('gb-valid', [])).toEqual([1, 2, 3]);
  });

  it('returns fallback on corrupted JSON', () => {
    localStorage.setItem('gb-corrupt', '{broken');
    expect(_safeParseLS('gb-corrupt', 'default')).toBe('default');
  });

  it('returns fallback on null/missing key', () => {
    expect(_safeParseLS('gb-nonexistent', [])).toEqual([]);
  });

  it('returns fallback object when key is missing', () => {
    expect(_safeParseLS('gb-nope', { a: 1 })).toEqual({ a: 1 });
  });
});

describe('saveCourses localStorage persistence', () => {
  it('persists courses to localStorage when Supabase is off', () => {
    const courses = { test: { id: 'test', name: 'Test Course' } };
    saveCourses(courses);
    const stored = JSON.parse(localStorage.getItem('gb-courses'));
    expect(stored.test.name).toBe('Test Course');
  });
});

describe('clearing all gb-* keys', () => {
  it('results in empty arrays from getStudents and getAssessments', () => {
    // Save some data first
    saveStudents(CID, [{ id: 's1', firstName: 'A', lastName: 'B', designations: [], sortName: 'B A' }]);
    saveAssessments(CID, [{ id: 'a1', title: 'Quiz', tagIds: ['t1'] }]);
    // Clear cache so getters fall through to localStorage
    _cache.students[CID] = undefined;
    _cache.assessments[CID] = undefined;
    // Clear localStorage
    localStorage.clear();
    // Reset cache again to force LS read
    _cache.students[CID] = undefined;
    _cache.assessments[CID] = undefined;
    expect(getStudents(CID)).toEqual([]);
    expect(getAssessments(CID)).toEqual([]);
  });
});
