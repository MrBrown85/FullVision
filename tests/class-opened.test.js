/**
 * A class opened (shared/data-courses-terms.js, noteClassOpened; migrations/
 * 2026111704). The nightly job deletes a class's photos once it has gone a
 * year without being opened, so the class on screen sends note_course_opened:
 *
 * - once a day per class on this device, through the outbox, with a key;
 * - only for the class on screen: a class loaded in the background
 *   (preloadClasses) is not opened;
 * - never for a class with no server id yet, and never in Demo Mode;
 * - after the load, so the class never waits on it, and a refused stamp
 *   shows only on the sync dot.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';
import { syntheticClass } from './eval-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const A = 'e0000000-0000-4000-8000-00000000000a';
const B = 'e0000000-0000-4000-8000-00000000000b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let fake;
let original;
const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const stamps = () => fake.calls.filter(c => c.name === 'note_course_opened').map(c => c.params);

function bundle() {
  const b = syntheticClass();
  b.version = 1;
  return b;
}

async function quiet() {
  for (let i = 0; i < 4; i++) {
    await settle();
    await window.v2Queue.flush();
  }
  await settle();
}

beforeEach(() => {
  original = {
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    teacher: _teacherId,
    quiet: _REFRESH_QUIET_MS,
    isDemoMode: window.isDemoMode,
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T17:00:00'));
  _REFRESH_QUIET_MS = 0;
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-a';
  globalThis.__FV_CLASS_BUNDLE = true;
  localStorage.clear();
  _classOpenedHere = { day: '', ids: {} };
  fake = makeFakeSupabase();
  fake.on('get_class_bundle', () => ({ data: bundle(), error: null }));
  fake.on('list_course_grade_returns', () => ({ data: {}, error: null }));
  fake.on('note_course_opened', () => ({ data: true, error: null }));
  globalThis.getSupabase = () => fake;
  setOnline(true);
  window.v2Queue.clear();
  saveCourses({ [A]: { id: A, name: 'History 12' }, [B]: { id: B, name: 'Science 9' } });
  saveConfig({ activeCourse: A });
});

afterEach(() => {
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  window.v2Queue.clear();
  globalThis.getSupabase = original.getSupabase;
  _useSupabase = original.useSupabase;
  _teacherId = original.teacher;
  _REFRESH_QUIET_MS = original.quiet;
  window.isDemoMode = original.isDemoMode;
  globalThis.__FV_CLASS_BUNDLE = false;
  vi.useRealTimers();
  localStorage.clear();
  [A, B].forEach(cid => {
    delete _cache.students[cid];
    delete _classVersion[cid];
    delete _classLoads[cid];
  });
});

describe('the class on screen is noted as opened', () => {
  it('sends note_course_opened once, with the class and a key, after the class has loaded', async () => {
    await initData(A);
    await quiet();
    expect(stamps()).toEqual([{ p_course_id: A, p_idempotency_key: expect.stringMatching(UUID) }]);
    const names = fake.calls.map(c => c.name);
    expect(names.indexOf('note_course_opened')).toBeGreaterThan(names.indexOf('get_class_bundle'));
    expect(getSyncDotState().status).toBe('idle');
  });

  it('opened again the same day, on this device: nothing more is sent', async () => {
    await initData(A);
    await quiet();
    await initData(A);
    await switchActiveCourse(A);
    await quiet();
    expect(stamps()).toHaveLength(1);
    // A reload of the page keeps the day's list (gb-class-opened).
    _classOpenedHere = { day: '', ids: {} };
    expect(noteClassOpened(A)).toBe(false);
    await quiet();
    expect(stamps()).toHaveLength(1);
  });

  it('the next day it is sent again', async () => {
    await initData(A);
    await quiet();
    vi.setSystemTime(new Date('2026-11-18T08:00:00'));
    await initData(A);
    await quiet();
    expect(stamps().map(p => p.p_course_id)).toEqual([A, A]);
  });

  it('switching to another class notes that one, once', async () => {
    await initData(A);
    await switchActiveCourse(B);
    await switchActiveCourse(A);
    await switchActiveCourse(B);
    await quiet();
    expect(stamps().map(p => p.p_course_id)).toEqual([A, B]);
  });

  it('with storage blocked, this visit still sends it only once', async () => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'gb-class-opened') throw new Error('blocked');
      return set.call(this, k, v);
    };
    try {
      expect(noteClassOpened(A)).toBe(true);
      expect(noteClassOpened(A)).toBe(false);
    } finally {
      Storage.prototype.setItem = set;
    }
    await quiet();
    expect(stamps()).toHaveLength(1);
  });
});

describe('what is not an open', () => {
  it('a class loaded in the background (preloadClasses) sends nothing', async () => {
    await initData(A);
    await quiet();
    expect(classesToPreload()).toEqual([B]);
    await preloadClasses();
    await quiet();
    expect(fake.calls.filter(c => c.name === 'get_class_bundle').length).toBeGreaterThanOrEqual(2);
    expect(stamps().map(p => p.p_course_id)).toEqual([A]);
  });

  it('another class loaded for a copy (initData of a class not on screen) sends nothing', async () => {
    await initData(B);
    await quiet();
    expect(stamps()).toEqual([]);
  });

  it('a class with no server id yet sends nothing (a new class counts from when it was made)', async () => {
    expect(noteClassOpened('c' + Date.now().toString(36))).toBe(false);
    expect(noteClassOpened(null)).toBe(false);
    await quiet();
    expect(stamps()).toEqual([]);
  });

  it('Demo Mode sends nothing', async () => {
    window.isDemoMode = () => true;
    localStorage.setItem('gb-demo-mode', '1');
    expect(noteClassOpened(A)).toBe(false);
    _useSupabase = false;
    expect(noteClassOpened(A)).toBe(false);
    await quiet();
    expect(stamps()).toEqual([]);
  });
});

describe('when the stamp fails', () => {
  it('the class loads as ever and the failure shows only on the sync dot', async () => {
    fake.on('note_course_opened', () => ({ data: null, error: { message: 'boom', code: 'XX000' } }));
    await initData(A);
    await quiet();
    expect(_cache.students[A]).toBeDefined();
    expect(stamps()).toHaveLength(1);
    expect(getSyncDotState().status).toBe('error');
  });

  it('its echo is safe: the class is not loaded again for it', () => {
    expect(_ECHO_SAFE_RPCS.note_course_opened).toBe(true);
  });
});
