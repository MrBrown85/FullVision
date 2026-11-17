/**
 * A warning before the year runs out (shared/photo-expiry.js; migrations/
 * 2026111705). The nightly job deletes a class's photos once it has gone 365
 * days without being opened; in the 30 days before, the Dashboard and the
 * phone's Students screen show one line per such class:
 *
 * - only a class of the teacher's with photos, within 30 days of the year,
 *   and not the class on screen;
 * - the date is the first nightly run (10:27 UTC) after 365 days;
 * - at most three, then "And N more classes.";
 * - opening the class clears its line;
 * - asked once per page load; a server without the function, or any
 *   failure, is no line and nothing on the sync dot;
 * - Demo Mode asks no server and shows a line only when a test seeds one.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const NOW = Date.parse('2026-11-17T17:00:00Z');
const DAY = 86400000;
const ids = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ago = days => new Date(NOW - days * DAY).toISOString();
const row = (n, days, photos = 4) => ({ course_id: ids(n), last_opened_at: ago(days), photos });

let fake;
let original;
const asked = () => fake.calls.filter(c => c.name === 'list_course_photo_expiry');

function courses(n) {
  const all = {};
  for (let i = 1; i <= n; i++) all[ids(i)] = { id: ids(i), name: 'Class ' + i };
  return all;
}

beforeEach(() => {
  original = {
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    isDemoMode: window.isDemoMode,
    document: globalThis.document,
  };
  globalThis.document = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  localStorage.clear();
  fake = makeFakeSupabase();
  globalThis.getSupabase = () => fake;
  _useSupabase = true;
  window.isDemoMode = () => false;
  saveCourses(courses(9));
  saveConfig({ activeCourse: ids(9) });
  PhotoExpiry._reset();
});

afterEach(() => {
  globalThis.getSupabase = original.getSupabase;
  _useSupabase = original.useSupabase;
  window.isDemoMode = original.isDemoMode;
  vi.useRealTimers();
  localStorage.clear();
  PhotoExpiry._reset();
  globalThis.document = original.document;
});

describe('which classes get a line', () => {
  it('a class with photos within 30 days of a year unopened, and no other', () => {
    PhotoExpiry._reset([
      row(1, 345), // 20 days left: a line
      row(2, 335), // exactly 30 days left: a line
      row(3, 334), // 31 days left: not yet
      row(4, 345, 0), // no photos
      { course_id: ids(77), last_opened_at: ago(345), photos: 2 }, // not one of this teacher's loaded classes
      row(9, 345), // the class on screen: it is being opened
    ]);
    expect(PhotoExpiry.lines().map(l => l.cid)).toEqual([ids(1), ids(2)]);
  });

  it('the date is the first nightly run after 365 days, in the plain sentence', () => {
    // Opened Dec 16 2025 at 18:00 UTC: 365 days later is Dec 16 2026 18:00 UTC, after that day's
    // 10:27 UTC run, so the photos go at the run on Dec 17.
    PhotoExpiry._reset([{ course_id: ids(1), last_opened_at: '2025-12-16T18:00:00Z', photos: 3 }]);
    const at = PhotoExpiry.deletionAt('2025-12-16T18:00:00Z', NOW);
    expect(at.toISOString()).toBe('2026-12-17T10:27:00.000Z');
    const day = formatShortDate(
      at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0'),
    );
    expect(PhotoExpiry.lines()[0].text).toBe(
      'Photos in Class 1 will be deleted on ' +
        day +
        " because the class hasn't been opened for a year. Open it to keep them.",
    );
    // Opened before that day's run: the run on the anniversary itself takes them.
    expect(PhotoExpiry.deletionAt('2025-12-16T09:00:00Z', NOW).toISOString()).toBe('2026-12-16T10:27:00.000Z');
    // Overdue (the job has not run yet): the next run, never one past.
    expect(PhotoExpiry.deletionAt(ago(400), NOW).getTime()).toBeGreaterThan(NOW);
  });

  it('soonest first, at most three, then "And N more classes."', () => {
    PhotoExpiry._reset([row(1, 340), row(2, 360), row(3, 350), row(4, 345), row(5, 336)]);
    const box = document.createElement('div');
    document.body.appendChild(box);
    box.innerHTML = PhotoExpiry.html('dash');
    const shown = [...box.querySelectorAll('.photo-expiry-line')].map(l => l.dataset.cid);
    expect(shown).toEqual([ids(2), ids(3), ids(4)]);
    expect(box.querySelectorAll('button[data-action="photoExpiryOpen"]')).toHaveLength(3);
    expect([...box.querySelectorAll('button')].every(b => b.textContent === 'Open Class')).toBe(true);
    expect(box.querySelector('.photo-expiry-more').textContent).toBe('And 2 more classes.');
    PhotoExpiry._reset([row(1, 340), row(2, 360), row(3, 350), row(4, 345)]);
    box.innerHTML = PhotoExpiry.html('phone');
    expect(box.querySelector('.photo-expiry-more').textContent).toBe('And 1 more class.');
    expect(box.querySelectorAll('button[data-action="m-photo-expiry-open"]')).toHaveLength(3);
  });

  it('a class name is escaped', () => {
    COURSES[ids(1)].name = '<b>Art</b> & "Design"';
    PhotoExpiry._reset([row(1, 350)]);
    const out = PhotoExpiry.html('dash');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;b&gt;Art&lt;/b&gt; &amp;');
  });

  it('nothing to warn about: the box is empty', () => {
    PhotoExpiry._reset([]);
    expect(PhotoExpiry.html('dash')).toBe('');
    expect(PhotoExpiry.mount('dash')).toBe('<div class="photo-expiry" data-where="dash"></div>');
  });
});

describe('opening the class clears its line', () => {
  it('a class picked in Class Settings, or switched to', async () => {
    PhotoExpiry._reset([row(1, 350), row(2, 350)]);
    document.body.innerHTML = PhotoExpiry.mount('dash');
    expect(document.querySelectorAll('.photo-expiry-line')).toHaveLength(2);
    noteClassOpenedSoon(ids(1), true); // picked in Class Settings
    expect([...document.querySelectorAll('.photo-expiry-line')].map(l => l.dataset.cid)).toEqual([ids(2)]);
    setActiveCourse(ids(2)); // the class on screen
    noteClassOpenedSoon(ids(2));
    expect(document.querySelector('.photo-expiry').innerHTML).toBe('');
    await settle();
  });
});

describe('asking the server', () => {
  it('once per page load, after sign-in, never per class', async () => {
    fake.on('list_course_photo_expiry', () => ({ data: [row(1, 350)], error: null }));
    document.body.innerHTML = PhotoExpiry.mount('dash') + PhotoExpiry.mount('phone');
    PhotoExpiry.mount('dash');
    await settle();
    expect(asked()).toHaveLength(1);
    expect(document.querySelectorAll('.photo-expiry-line')).toHaveLength(2); // the line, in both boxes
  });

  it('not before the teacher is signed in', async () => {
    _useSupabase = false;
    PhotoExpiry.mount('dash');
    await settle();
    expect(asked()).toHaveLength(0);
    _useSupabase = true;
    PhotoExpiry.mount('dash');
    await settle();
    expect(asked()).toHaveLength(1);
  });

  it('a server without the function: no line, nothing on the sync dot', async () => {
    fake.on('list_course_photo_expiry', () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.list_course_photo_expiry' },
    }));
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = PhotoExpiry.mount('dash');
    await settle();
    expect(document.querySelector('.photo-expiry').innerHTML).toBe('');
    expect(PhotoExpiry.lines()).toEqual([]);
    expect(getSyncDotState().status).toBe('idle');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a call that throws: no line', async () => {
    fake.on('list_course_photo_expiry', () => {
      throw new Error('offline');
    });
    document.body.innerHTML = PhotoExpiry.mount('dash');
    await settle();
    expect(PhotoExpiry.lines()).toEqual([]);
    expect(getSyncDotState().status).toBe('idle');
  });
});

describe('Demo Mode', () => {
  it('asks no server; shows nothing unless a test seeds a class, and opening it clears the seed', async () => {
    window.isDemoMode = () => true;
    document.body.innerHTML = PhotoExpiry.mount('dash');
    await settle();
    expect(asked()).toHaveLength(0);
    expect(PhotoExpiry.lines()).toEqual([]);

    PhotoExpiry._reset();
    localStorage.setItem(PhotoExpiry.SEED_KEY, JSON.stringify([row(1, 350)]));
    document.body.innerHTML = PhotoExpiry.mount('dash');
    expect(document.querySelectorAll('.photo-expiry-line')).toHaveLength(1);
    noteClassOpenedSoon(ids(1), true);
    expect(document.querySelector('.photo-expiry').innerHTML).toBe('');
    expect(JSON.parse(localStorage.getItem(PhotoExpiry.SEED_KEY))).toEqual([]);
    await settle();
    expect(asked()).toHaveLength(0);
  });
});
