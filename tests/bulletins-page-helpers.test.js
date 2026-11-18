/**
 * The words on the Bulletins page that come from rules (teacher/page-bulletins.js):
 * the day headings, the kind label, "26 students can see it" and the notes
 * after it. The drawing itself is tried in a browser (e2e/bulletins-teacher.spec.js).
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

runInThisContext(readFileSync('teacher/page-bulletins.js', 'utf-8'), { filename: 'teacher/page-bulletins.js' });
const H = window.PageBulletins._helpers;
const now = new Date(2026, 10, 17, 12, 0, 0); // Tue, Nov 17, 2026

describe('day headings and times', () => {
  it('Today, Yesterday, a weekday, then a date', () => {
    expect(H.dayHeading(new Date(2026, 10, 17, 9, 58).toISOString(), now)).toBe('Today');
    expect(H.dayHeading(new Date(2026, 10, 16, 9, 58).toISOString(), now)).toBe('Yesterday');
    expect(H.dayHeading(new Date(2026, 10, 15, 8, 42).toISOString(), now)).toBe('Sunday');
    expect(H.dayHeading(new Date(2026, 10, 9, 8, 42).toISOString(), now)).toBe('Nov 9');
    expect(H.dayHeading(new Date(2025, 11, 9, 8, 42).toISOString(), now)).toBe('Dec 9, 2025');
    expect(H.dayHeading('nonsense', now)).toBe('');
  });

  it('a time today is the time; earlier it carries the day', () => {
    expect(H.timeLabel(new Date(2026, 10, 17, 10, 15).toISOString(), now)).toBe('10:15 a.m.');
    expect(H.timeLabel(new Date(2026, 10, 15, 8, 42).toISOString(), now)).toBe('Sunday 8:42 a.m.');
    expect(H.timeLabel(new Date(2026, 10, 17, 13, 5).toISOString(), now)).toBe('1:05 p.m.');
  });
});

describe('the kind label', () => {
  it('Announcement, Reminder with its last day, and Photo of the Board', () => {
    expect(H.kindLabel({ kind: 'announcement', files: [] })).toBe('Announcement');
    expect(H.kindLabel({ kind: 'reminder', pinned_until: '2026-11-19', files: [] })).toBe(
      'Reminder · Until Thu, Nov 19',
    );
    expect(H.kindLabel({ kind: 'reminder', pinned_until: null, files: [] })).toBe('Reminder');
    expect(H.kindLabel({ kind: 'announcement', body: '', files: [{ kind: 'photo' }] })).toBe('Photo of the Board');
    expect(H.kindLabel({ kind: 'announcement', body: 'Caption', files: [{ kind: 'photo' }] })).toBe(
      'Photo of the Board',
    );
    expect(H.kindLabel({ kind: 'announcement', files: [{ kind: 'pdf' }] })).toBe('Announcement');
    expect(H.kindLabel({ kind: 'announcement', link_url: 'https://a.org', files: [{ kind: 'photo' }] })).toBe(
      'Announcement',
    );
  });
});

describe('the header', () => {
  it('says how many can see it', () => {
    expect(H.canSeeText(26)).toBe('26 students can see it');
    expect(H.canSeeText(1)).toBe('1 student can see it');
    expect(H.canSeeText(0)).toBe('No students can see it yet');
  });

  it('names a paused student when one or two, and counts when more; Have No Card Yet is a count', () => {
    expect(H.headerNotes({ no_card: 4, paused: 1 }, ['Jordan Kim'])).toEqual({
      noCard: '4 Have No Card Yet',
      paused: 'Jordan Kim Not Counted (Page Paused)',
    });
    expect(H.headerNotes({ no_card: 0, paused: 2 }, ['Jordan Kim', 'Sam Blackwood']).paused).toBe(
      'Jordan Kim and Sam Blackwood Not Counted (Page Paused)',
    );
    expect(H.headerNotes({ no_card: 0, paused: 3 }, ['A', 'B', 'C'])).toEqual({
      noCard: '',
      paused: '3 Not Counted (Page Paused)',
    });
    // Names not known yet: the count.
    expect(H.headerNotes({ no_card: 0, paused: 1 }, []).paused).toBe('1 Not Counted (Page Paused)');
    expect(H.headerNotes({ no_card: 0, paused: 0 }, [])).toEqual({ noCard: '', paused: '' });
  });
});

describe('a file that cannot be used', () => {
  const R = window.PhotoShrink.REASONS;

  it('says what Add Work says for a photo the browser cannot read (HEIC) and for a PDF reader that did not load', () => {
    expect(H.refusal({ ok: false, kind: 'heic', reason: R.NO_DECODER })).toBe(
      'Save that photo as a JPEG first, then add it.',
    );
    expect(H.refusal({ ok: false, kind: 'pdf', reason: R.NO_DECODER })).toBe(
      "The PDF reader couldn't load. Check the connection and try again.",
    );
    expect(H.refusal({ ok: false, reason: R.OFFICE })).toBe('Save it as a PDF first.');
    expect(H.refusal({ ok: false, kind: 'pdf', locked: true })).toBe(
      'That PDF has a password. Save a copy without one, then add it.',
    );
    expect(H.refusal({ ok: false, reason: R.TOO_MANY_PAGES })).toMatch(/more than 20 pages/);
  });
});

/* Heading and time labels around midnight and across both clock changes, in
   Vancouver and in Auckland (whose changes fall on other days, and which is
   ahead of Vancouver). The labels use the device's zone; dates are made in it. */
const ZONES = {
  'America/Vancouver': { springDay: [2, 8], fallDay: [10, 1] }, // Mar 8 (23-hour day), Nov 1 (25-hour day), 2026
  'Pacific/Auckland': { springDay: [8, 27], fallDay: [3, 5] }, // Sep 27 (23-hour day), Apr 5 (25-hour day), 2026
};

describe.each(Object.keys(ZONES))('day headings and times in %s', zone => {
  const was = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  });
  const at = (m, d, h, mi) => new Date(2026, m, d, h, mi);

  it('23:59 is Today and 00:01 the next morning is Yesterday for it', () => {
    expect(H.dayHeading(at(5, 10, 23, 59).toISOString(), at(5, 10, 23, 59))).toBe('Today');
    expect(H.dayHeading(at(5, 10, 23, 59).toISOString(), at(5, 11, 0, 1))).toBe('Yesterday');
    expect(H.dayHeading(at(5, 11, 0, 1).toISOString(), at(5, 11, 0, 1))).toBe('Today');
    expect(H.timeLabel(at(5, 10, 23, 59).toISOString(), at(5, 10, 23, 59))).toBe('11:59 p.m.');
    expect(H.timeLabel(at(5, 11, 0, 1).toISOString(), at(5, 11, 0, 1))).toBe('12:01 a.m.');
    expect(H.timeLabel(at(5, 10, 23, 59).toISOString(), at(5, 11, 0, 1))).toBe('Yesterday 11:59 p.m.');
    expect(H.timeLabel(at(5, 11, 12, 0).toISOString(), at(5, 11, 12, 0))).toBe('12:00 p.m.');
  });

  it('the short day (clocks forward) and the long day (clocks back) count as one day', () => {
    for (const [m, d] of [ZONES[zone].springDay, ZONES[zone].fallDay]) {
      // Just before midnight the day before, just after midnight the day after.
      expect(H.dayHeading(at(m, d - 1, 23, 59).toISOString(), at(m, d, 0, 1))).toBe('Yesterday');
      expect(H.dayHeading(at(m, d, 23, 59).toISOString(), at(m, d + 1, 0, 1))).toBe('Yesterday');
      expect(H.dayHeading(at(m, d, 12, 0).toISOString(), at(m, d, 12, 0))).toBe('Today');
      // Two calendar days back, across the change, is a weekday name, never Yesterday or Today.
      const back = at(m, d - 1, 12, 0);
      const now = at(m, d + 1, 12, 0);
      expect(H.dayHeading(back.toISOString(), now)).toBe(
        ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][back.getDay()],
      );
    }
  });

  it('a returned bulletin names its day when it is not from today', () => {
    expect(H.returnedWhen(at(5, 10, 12, 17).toISOString(), at(5, 10, 18, 0))).toBe('12:17 p.m.');
    expect(H.returnedWhen(at(5, 9, 12, 17).toISOString(), at(5, 10, 18, 0))).toBe('yesterday at 12:17 p.m.');
    // June 8, 2026 is a Monday.
    expect(H.returnedWhen(at(5, 8, 12, 17).toISOString(), at(5, 10, 18, 0))).toBe('Monday at 12:17 p.m.');
    expect(H.returnedWhen(at(4, 1, 12, 17).toISOString(), at(5, 10, 18, 0))).toBe('May 1 at 12:17 p.m.');
  });
});
