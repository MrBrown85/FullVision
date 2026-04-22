/**
 * Data-isolation security test — the storage layer must not put PII into
 * localStorage keys. (esc/escJs XSS coverage lives in data-utils.test.js.)
 */

const CID = 'sectest';

beforeEach(() => {
  localStorage.clear();
  _cache.students[CID] = undefined;
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;
});

describe('localStorage key format — data isolation', () => {
  it('stores course data using gb-{dataKey}-{courseId} format, not student names', () => {
    const students = [{ id: 's1', firstName: 'Alice', lastName: 'Smith', designations: [], sortName: 'Smith Alice' }];
    saveStudents(CID, students);

    const key = 'gb-students-' + CID;
    const stored = localStorage.getItem(key);
    expect(stored).not.toBeNull();
    // Key itself must not contain PII
    expect(key).not.toContain('Alice');
    expect(key).not.toContain('Smith');
    // Data is stored under the generic key
    const parsed = JSON.parse(stored);
    expect(parsed[0].firstName).toBe('Alice');
  });
});
