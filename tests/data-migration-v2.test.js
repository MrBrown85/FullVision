/**
 * Student migration tests — migrateStudent from gb-data.js.
 */

describe('migrateStudent', () => {
  it('adds sortName when migrating from old name-based format', () => {
    const st = { id: 's1', name: 'Alice Smith' };
    const result = migrateStudent(st);
    expect(result.sortName).toBe('Smith Alice');
    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBe('Smith');
    // Old name field should be removed
    expect(result.name).toBeUndefined();
  });

  it('preserves existing firstName/lastName and returns early', () => {
    const st = {
      id: 's1', firstName: 'Alice', lastName: 'Smith',
      sortName: 'Smith Alice', designations: ['Q']
    };
    const result = migrateStudent(st);
    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBe('Smith');
    expect(result.sortName).toBe('Smith Alice');
    expect(result.designations).toEqual(['Q']);
  });

  it('converts string designation to designations array', () => {
    const st = { id: 's1', firstName: 'Bob', lastName: 'Jones', designation: 'Q' };
    const result = migrateStudent(st);
    expect(result.designations).toEqual(['Q']);
    expect(result.designation).toBeUndefined();
  });

  it('preserves existing designations array', () => {
    const st = { id: 's1', firstName: 'Carol', lastName: 'Lee', designations: ['G', 'Q'] };
    const result = migrateStudent(st);
    expect(result.designations).toEqual(['G', 'Q']);
  });

  it('is idempotent — running twice gives same result', () => {
    const st = { id: 's1', name: 'Alice Smith', designation: 'Q' };
    const first = migrateStudent(st);
    const firstCopy = JSON.parse(JSON.stringify(first));
    const second = migrateStudent(first);
    expect(second.firstName).toBe(firstCopy.firstName);
    expect(second.lastName).toBe(firstCopy.lastName);
    expect(second.sortName).toBe(firstCopy.sortName);
    expect(second.designations).toEqual(firstCopy.designations);
  });

  it('handles student with no lastName gracefully (single-word name)', () => {
    const st = { id: 's1', name: 'Madonna' };
    const result = migrateStudent(st);
    expect(result.firstName).toBe('Madonna');
    expect(result.lastName).toBe('');
    expect(result.sortName).toBe('Madonna');
    expect(result.designations).toEqual([]);
  });
});
