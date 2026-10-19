/**
 * Utility function tests — pure helpers from gb-data.js.
 */

/* ── esc (HTML escaping) ──────────────────────────────────── */
describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
    expect(esc('"quoted"')).toBe('&quot;quoted&quot;');
    expect(esc("it's")).toBe('it&#39;s');
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('handles all dangerous characters together', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('returns empty string for null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc('')).toBe('');
  });
});

/* ── escJs (JS string escaping) ───────────────────────────── */
describe('escJs', () => {
  it('escapes quotes and backslashes', () => {
    expect(escJs("it's")).toBe("it\\'s");
    expect(escJs('say "hi"')).toBe('say \\"hi\\"');
    expect(escJs('back\\slash')).toBe('back\\\\slash');
  });

  it('returns empty string for null/undefined', () => {
    expect(escJs(null)).toBe('');
    expect(escJs(undefined)).toBe('');
  });
});

/* ── cssColor (CSS color allowlist) ───────────────────────── */
describe('cssColor', () => {
  it('accepts hex colors (3/4/6/8 digits)', () => {
    expect(cssColor('#abc')).toBe('#abc');
    expect(cssColor('#AABBCC')).toBe('#AABBCC');
    expect(cssColor('#ff00ff88')).toBe('#ff00ff88');
  });

  it('accepts rgb/rgba/hsl/hsla functional forms', () => {
    expect(cssColor('rgb(0, 128, 255)')).toBe('rgb(0, 128, 255)');
    expect(cssColor('rgba(0, 128, 255, 0.5)')).toBe('rgba(0, 128, 255, 0.5)');
    expect(cssColor('hsl(120, 50%, 50%)')).toBe('hsl(120, 50%, 50%)');
    expect(cssColor('hsla(120, 50%, 50%, 0.5)')).toBe('hsla(120, 50%, 50%, 0.5)');
  });

  it('accepts var(--token) custom-property refs', () => {
    expect(cssColor('var(--score-1)')).toBe('var(--score-1)');
    expect(cssColor('var(--text-3)')).toBe('var(--text-3)');
  });

  it('rejects style-context-breaking input with a safe fallback', () => {
    expect(cssColor('red;background:url(javascript:alert(1))')).toBe('var(--text-3)');
    expect(cssColor('red"}.evil{x:y')).toBe('var(--text-3)');
    expect(cssColor('red;}')).toBe('var(--text-3)');
    expect(cssColor('expression(alert(1))')).toBe('var(--text-3)');
    expect(cssColor('url(data:text/html,<script>)')).toBe('var(--text-3)');
    expect(cssColor('red /* comment */')).toBe('var(--text-3)');
    expect(cssColor('red\n; ')).toBe('var(--text-3)');
  });

  it('rejects raw CSS color names (limits surface)', () => {
    // We allowlist shapes, not names — "red" could collide with unknown CSS
    // or be concatenated into a broken-style attack upstream. The UI always
    // has a concrete hex or var() anyway.
    expect(cssColor('red')).toBe('var(--text-3)');
    expect(cssColor('transparent')).toBe('var(--text-3)');
  });

  it('rejects non-strings, empty, and oversized input', () => {
    expect(cssColor(null)).toBe('var(--text-3)');
    expect(cssColor(undefined)).toBe('var(--text-3)');
    expect(cssColor(42)).toBe('var(--text-3)');
    expect(cssColor({})).toBe('var(--text-3)');
    expect(cssColor('')).toBe('var(--text-3)');
    expect(cssColor('#' + 'a'.repeat(100))).toBe('var(--text-3)');
  });

  it('rejects malformed function calls', () => {
    expect(cssColor('rgb(0, 128)')).toBe('var(--text-3)');
    expect(cssColor('rgb(0 128 255)')).toBe('var(--text-3)'); // no commas
    expect(cssColor('var(--foo; color:red)')).toBe('var(--text-3)');
  });
});

/* ── initials ─────────────────────────────────────────────── */
describe('initials', () => {
  it('extracts initials from student object', () => {
    expect(initials({ firstName: 'John', lastName: 'Doe' })).toBe('JD');
  });

  it('handles missing lastName', () => {
    expect(initials({ firstName: 'John', lastName: '' })).toBe('JO');
  });

  it('handles missing firstName', () => {
    expect(initials({ firstName: '', lastName: 'Doe' })).toBe('DO');
  });

  it('extracts initials from string with two names', () => {
    expect(initials('Jane Smith')).toBe('JS');
  });

  it('handles single-name string', () => {
    expect(initials('Madonna')).toBe('MA');
  });

  it('returns ?? for null/undefined', () => {
    expect(initials(null)).toBe('??');
    expect(initials(undefined)).toBe('??');
  });
});

/* ── migrateStudent ───────────────────────────────────────── */
describe('migrateStudent', () => {
  it('converts old name + designation format', () => {
    const old = { name: 'John Doe', designation: 'Q' };
    const result = migrateStudent(old);
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Doe');
    expect(result.designations).toEqual(['Q']);
    expect(result.name).toBeUndefined();
    expect(result.designation).toBeUndefined();
  });

  it('generates sortName (LastName FirstName) when migrating from old format', () => {
    const result = migrateStudent({ id: 's1', name: 'Alice Smith' });
    expect(result.sortName).toBe('Smith Alice');
    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBe('Smith');
  });

  it('preserves already-migrated students including sortName', () => {
    const modern = {
      firstName: 'Jane',
      lastName: 'Doe',
      sortName: 'Doe Jane',
      designations: ['G'],
    };
    const result = migrateStudent(modern);
    expect(result.firstName).toBe('Jane');
    expect(result.sortName).toBe('Doe Jane');
    expect(result.designations).toEqual(['G']);
  });

  it('handles empty designation', () => {
    const old = { name: 'Solo Name', designation: '' };
    const result = migrateStudent(old);
    expect(result.designations).toEqual([]);
  });

  it('handles missing designation', () => {
    const old = { name: 'Test User' };
    const result = migrateStudent(old);
    expect(result.firstName).toBe('Test');
    expect(result.lastName).toBe('User');
    expect(result.designations).toEqual([]);
  });

  it('handles single name (no last name → sortName equals first name)', () => {
    const result = migrateStudent({ id: 's1', name: 'Madonna' });
    expect(result.firstName).toBe('Madonna');
    expect(result.lastName).toBe('');
    expect(result.sortName).toBe('Madonna');
  });

  it('is idempotent — running twice gives same result', () => {
    const first = migrateStudent({ id: 's1', name: 'Alice Smith', designation: 'Q' });
    const snapshot = JSON.parse(JSON.stringify(first));
    const second = migrateStudent(first);
    expect(second.firstName).toBe(snapshot.firstName);
    expect(second.lastName).toBe(snapshot.lastName);
    expect(second.sortName).toBe(snapshot.sortName);
    expect(second.designations).toEqual(snapshot.designations);
  });
});

/* ── anonymizeStudents ────────────────────────────────────── */
describe('anonymizeStudents', () => {
  it('returns same-length array with _anonLabel', () => {
    const students = [
      { id: '1', firstName: 'A' },
      { id: '2', firstName: 'B' },
      { id: '3', firstName: 'C' },
    ];
    const result = anonymizeStudents(students);
    expect(result).toHaveLength(3);
    result.forEach(s => {
      expect(s._anonLabel).toMatch(/^Student \d{3}$/);
    });
  });

  it('does not mutate original objects', () => {
    const original = { id: '1', firstName: 'Alice' };
    const students = [original];
    anonymizeStudents(students);
    expect(original._anonLabel).toBeUndefined();
  });

  it('labels include sequential numbers', () => {
    const students = [{ id: '1' }, { id: '2' }];
    const result = anonymizeStudents(students);
    const labels = result.map(s => s._anonLabel).sort();
    expect(labels).toContain('Student 001');
    expect(labels).toContain('Student 002');
  });
});

/* ── formatDate ───────────────────────────────────────────── */
describe('formatDate', () => {
  it('formats a date string', () => {
    // Use a full ISO timestamp to avoid timezone-offset date shifting
    const result = formatDate('2025-03-15T12:00:00');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });

  it('returns empty string for falsy input', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });
});

/* ── formatShortDate ──────────────────────────────────────── */
describe('formatShortDate', () => {
  it('leaves the year off dates in the current school year', () => {
    expect(formatShortDate('2026-04-25', '2026-05-01')).toBe('Apr 25');
    expect(formatShortDate('2025-09-03', '2026-06-20')).toBe('Sep 3');
    expect(formatShortDate('2026-08-01', '2026-10-19')).toBe('Aug 1');
  });

  it('adds the year to dates in another school year', () => {
    expect(formatShortDate('2026-04-25', '2026-10-19')).toBe('Apr 25, 2026');
    expect(formatShortDate('2026-07-31', '2026-08-01')).toBe('Jul 31, 2026');
    expect(formatShortDate('2027-09-10', '2026-10-19')).toBe('Sep 10, 2027');
  });

  it('returns empty string for missing or bad input', () => {
    expect(formatShortDate('', '2026-10-19')).toBe('');
    expect(formatShortDate(null)).toBe('');
    expect(formatShortDate('not a date')).toBe('');
  });
});
