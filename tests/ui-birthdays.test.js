/**
 * Birthday calculation tests — gb-ui.js :: getUpcomingBirthdays()
 */

const CID = 'test';
const origGetStudents = globalThis.getStudents;

afterEach(() => {
  globalThis.getStudents = origGetStudents;
});

function mockStudents(students) {
  globalThis.getStudents = () => students;
}

describe('getUpcomingBirthdays', () => {
  it('returns students sorted by days until birthday', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    mockStudents([
      { id: 's1', firstName: 'Far', dateOfBirth: `2010-${String(nextWeek.getMonth()+1).padStart(2,'0')}-${String(nextWeek.getDate()).padStart(2,'0')}` },
      { id: 's2', firstName: 'Near', dateOfBirth: `2011-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}` },
    ]);

    const result = getUpcomingBirthdays(CID);
    expect(result[0].student.firstName).toBe('Near');
    expect(result[0].daysUntil).toBeLessThan(result[1].daysUntil);
  });

  it('skips students without dateOfBirth', () => {
    mockStudents([
      { id: 's1', firstName: 'NoDob' },
      { id: 's2', firstName: 'HasDob', dateOfBirth: '2010-06-15' },
    ]);

    const result = getUpcomingBirthdays(CID);
    expect(result.every(r => r.student.firstName !== 'NoDob')).toBe(true);
  });

  it('handles birthday today (daysUntil = 0)', () => {
    const today = new Date();
    // Use YYYY-MM-DDT12:00:00 to avoid timezone-offset date shifting
    const dob = `2010-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}T12:00:00`;

    mockStudents([{ id: 's1', firstName: 'BdayToday', dateOfBirth: dob }]);

    const result = getUpcomingBirthdays(CID);
    expect(result).toHaveLength(1);
    expect(result[0].daysUntil).toBe(0);
  });

  it('wraps past birthdays to next year', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dob = `2010-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;

    mockStudents([{ id: 's1', firstName: 'Past', dateOfBirth: dob }]);

    const result = getUpcomingBirthdays(CID);
    expect(result).toHaveLength(1);
    expect(result[0].daysUntil).toBeGreaterThan(300); // next year
  });

  it('returns at most 3 students', () => {
    const students = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, firstName: `S${i}`,
      dateOfBirth: `2010-${String(((new Date().getMonth() + i + 1) % 12) + 1).padStart(2, '0')}-15`,
    }));

    mockStudents(students);
    expect(getUpcomingBirthdays(CID).length).toBeLessThanOrEqual(3);
  });

  it('returns empty when no students have birthdays', () => {
    mockStudents([{ id: 's1', firstName: 'NoDob' }]);
    expect(getUpcomingBirthdays(CID)).toEqual([]);
  });
});

describe('date-only birth dates in Pacific time', () => {
  // new Date('YYYY-MM-DD') parses as UTC midnight, which is the previous
  // evening in Vancouver. Node honours a runtime TZ change.
  const origTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Vancouver';
  });
  afterAll(() => {
    if (origTZ === undefined) delete process.env.TZ;
    else process.env.TZ = origTZ;
  });

  it('formatDate shows the stored day, not the day before', () => {
    expect(formatDate('2012-11-04')).toBe(
      new Date(2012, 10, 4).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
    );
    expect(formatDate('2012-11-04')).toMatch(/Nov\.? 4, 2012/);
  });

  it('parseLocalDate keeps the calendar day for date-only strings', () => {
    const d = parseLocalDate('2012-11-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2012, 10, 4]);
  });

  it('getUpcomingBirthdays counts a plain YYYY-MM-DD birthday today as 0 days', () => {
    const today = new Date();
    const dob = `2010-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    mockStudents([{ id: 's1', firstName: 'BdayToday', dateOfBirth: dob }]);
    const result = getUpcomingBirthdays(CID);
    expect(result[0].daysUntil).toBe(0);
    expect(result[0].nextBday.getDate()).toBe(today.getDate());
  });
});
