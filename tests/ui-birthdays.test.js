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

// 'YYYY-MM-DD' for the given year and the month/day of a Date
function ymd(year, d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return year + '-' + mm + '-' + dd;
}

describe('getUpcomingBirthdays', () => {
  it('returns students sorted by days until birthday', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    mockStudents([
      { id: 's1', firstName: 'Far', dateOfBirth: ymd(2010, nextWeek) },
      { id: 's2', firstName: 'Near', dateOfBirth: ymd(2011, tomorrow) },
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
    mockStudents([{ id: 's1', firstName: 'BdayToday', dateOfBirth: ymd(2010, new Date()) }]);

    const result = getUpcomingBirthdays(CID);
    expect(result).toHaveLength(1);
    expect(result[0].daysUntil).toBe(0);
  });

  it('wraps past birthdays to next year', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    mockStudents([{ id: 's1', firstName: 'Past', dateOfBirth: ymd(2010, yesterday) }]);

    const result = getUpcomingBirthdays(CID);
    expect(result).toHaveLength(1);
    expect(result[0].daysUntil).toBeGreaterThan(300); // next year
  });

  it('returns at most 3 students', () => {
    const students = Array.from({ length: 5 }, (_, i) => ({
      id: 's' + i,
      firstName: 'S' + i,
      dateOfBirth: '2010-' + String(((new Date().getMonth() + i + 1) % 12) + 1).padStart(2, '0') + '-15',
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
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    expect(formatDate('2012-11-04')).toBe(new Date(2012, 10, 4).toLocaleDateString('en-CA', opts));
    expect(formatDate('2012-11-04')).toMatch(/Nov\.? 4, 2012/);
  });

  it('parseLocalDate keeps the calendar day for date-only strings', () => {
    const d = parseLocalDate('2012-11-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2012, 10, 4]);
  });

  it('getUpcomingBirthdays counts a plain YYYY-MM-DD birthday today as 0 days', () => {
    const today = new Date();
    mockStudents([{ id: 's1', firstName: 'BdayToday', dateOfBirth: ymd(2010, today) }]);
    const result = getUpcomingBirthdays(CID);
    expect(result[0].daysUntil).toBe(0);
    expect(result[0].nextBday.getDate()).toBe(today.getDate());
  });
});
