/**
 * The words on the Bulletins page that come from rules (teacher/page-bulletins.js):
 * the day headings, the kind label, "26 students can see it" and the notes
 * after it. The drawing itself is tried in a browser (e2e/bulletins-teacher.spec.js).
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
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
