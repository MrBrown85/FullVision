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

describe('displayNameWithLast', () => {
  it('puts the preferred name before the last name', () => {
    expect(displayNameWithLast({ preferred: 'Bobby', firstName: 'Robert', lastName: 'Smith' })).toBe('Bobby Smith');
  });

  it('uses the first name when there is no preferred name', () => {
    expect(displayNameWithLast({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
  });

  it('handles a missing last name', () => {
    expect(displayNameWithLast({ preferred: 'Cece', firstName: 'Cece', lastName: '' })).toBe('Cece');
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

  describe('gradeLow and flagged', () => {
    const roster = [
      { id: 'a', firstName: 'Ann', lastName: 'Able' },
      { id: 'b', firstName: 'Ben', lastName: 'Best' },
      { id: 'c', firstName: 'Cal', lastName: 'Cole' },
    ];
    const saved = {};
    const stub = (name, fn) => {
      saved[name] = globalThis[name];
      globalThis[name] = fn;
    };
    afterEach(() => {
      Object.keys(saved).forEach(name => (globalThis[name] = saved[name]));
    });

    it('puts the lowest proficiency first and ungraded students last', () => {
      stub('courseGradeMode', () => 'proficiency');
      stub('getOverallProficiency', (cid, sid) => ({ a: 0, b: 3.2, c: 1.8 })[sid]);
      expect(sortStudents(roster, 'gradeLow', 'c1').map(s => s.id)).toEqual(['c', 'b', 'a']);
    });

    it('sorts a Letter class by percent', () => {
      stub('courseGradeMode', () => 'letter');
      stub('getCourseLetterData', (cid, sid) => ({ R: { a: 91, b: 64, c: null }[sid] }));
      expect(sortStudents(roster, 'gradeLow', 'c1').map(s => s.id)).toEqual(['b', 'a', 'c']);
    });

    it('puts flagged students first and keeps the order within each group', () => {
      stub('getFlags', () => ({ c: true }));
      expect(sortStudents(roster, 'flagged', 'c1').map(s => s.id)).toEqual(['c', 'a', 'b']);
    });
  });
});
