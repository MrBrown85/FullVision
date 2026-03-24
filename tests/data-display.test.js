/**
 * Display name and sorting tests — gb-data.js
 */

describe('fullName', () => {
  it('concatenates firstName and lastName', () => {
    expect(fullName({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
  });

  it('handles only firstName', () => {
    expect(fullName({ firstName: 'Jane', lastName: '' })).toBe('Jane');
  });

  it('handles only lastName', () => {
    expect(fullName({ firstName: '', lastName: 'Doe' })).toBe('Doe');
  });

  it('returns empty string when both empty', () => {
    expect(fullName({ firstName: '', lastName: '' })).toBe('');
  });
});

describe('displayName', () => {
  it('returns preferred when set', () => {
    expect(displayName({ preferred: 'JD', firstName: 'Jane', lastName: 'Doe' })).toBe('JD');
  });

  it('falls back to fullName when no preferred', () => {
    expect(displayName({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
  });

  it('falls back to fullName when preferred is empty', () => {
    expect(displayName({ preferred: '', firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
  });
});

describe('displayNameFirst', () => {
  it('returns preferred when set', () => {
    expect(displayNameFirst({ preferred: 'JD', firstName: 'Jane', lastName: 'Doe' })).toBe('JD');
  });

  it('falls back to firstName', () => {
    expect(displayNameFirst({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane');
  });

  it('falls back to lastName when no firstName', () => {
    expect(displayNameFirst({ firstName: '', lastName: 'Doe' })).toBe('Doe');
  });

  it('returns empty string when all missing', () => {
    expect(displayNameFirst({ firstName: '', lastName: '' })).toBe('');
  });
});

describe('sortStudents', () => {
  const students = [
    { firstName: 'Charlie', lastName: 'Adams' },
    { firstName: 'Alice', lastName: 'Brown' },
    { firstName: 'Bob', lastName: 'Adams' },
  ];

  it('sorts by lastName by default', () => {
    const result = sortStudents(students);
    expect(result[0].firstName).toBe('Bob'); // Adams, Bob < Adams, Charlie
    expect(result[1].firstName).toBe('Charlie');
    expect(result[2].firstName).toBe('Alice'); // Brown
  });

  it('sorts by firstName when mode is firstName', () => {
    const result = sortStudents(students, 'firstName');
    expect(result[0].firstName).toBe('Alice');
    expect(result[1].firstName).toBe('Bob');
    expect(result[2].firstName).toBe('Charlie');
  });

  it('does not mutate original array', () => {
    const original = [...students];
    sortStudents(students);
    expect(students[0]).toBe(original[0]);
  });
});
