/**
 * The Sign Out flag (shared/supabase.js, window.isSigningOut): set just before
 * the device is cleared, so code that would write to the device after an
 * answer lands writes nothing (the phone's bulletin queue,
 * shared/data-bulletins-queue.js, slice B1f). A sign-out stopped for unsent
 * changes never sets it; a clear that fails sets it back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saved = { localStorage: globalThis.localStorage, PhotoQueue: globalThis.PhotoQueue, v2Queue: globalThis.v2Queue };

function storage() {
  return {
    _store: {},
    getItem(k) {
      return this._store[k] ?? null;
    },
    setItem(k, v) {
      this._store[k] = String(v);
    },
    removeItem(k) {
      delete this._store[k];
    },
    clear() {
      this._store = {};
    },
    key(i) {
      return Object.keys(this._store)[i] ?? null;
    },
    get length() {
      return Object.keys(this._store).length;
    },
  };
}

function loadSupabase(queueStats) {
  globalThis.localStorage = storage();
  globalThis.sessionStorage = { clear() {} };
  if (typeof document.cookie !== 'string') document.cookie = '';
  globalThis.dismissUndoToast = () => {};
  try {
    globalThis.location = { pathname: '/teacher-mobile/', hostname: 'fullvision.ca', href: '' };
  } catch {
    globalThis.location.pathname = '/teacher-mobile/';
    globalThis.location.href = '';
  }
  globalThis.__ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'sbp_example_key' };
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          async signOut() {
            return { error: null };
          },
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
      };
    },
  };
  runInThisContext(readFileSync(resolve(root, 'shared/supabase.js'), 'utf-8'), { filename: 'shared/supabase.js' });
  globalThis.v2Queue = { stats: () => queueStats, flush: async () => ({}) };
  localStorage.setItem('gb-students-c1', '[]');
}

describe('window.isSigningOut', () => {
  afterEach(() => {
    globalThis.localStorage = saved.localStorage;
    globalThis.PhotoQueue = saved.PhotoQueue;
    globalThis.v2Queue = saved.v2Queue;
  });

  it('is false until Sign Out clears the device, and a sign-out stopped for unsent changes never sets it', async () => {
    loadSupabase({ queued: 1, deadLettered: 0 });
    globalThis.PhotoQueue = { wipe: async () => ({ ok: true }) };
    expect(window.isSigningOut()).toBe(false);
    expect(await window.signOut()).toEqual({ unsent: 1 });
    expect(window.isSigningOut()).toBe(false);
    expect(_bltSigningOut()).toBe(false);
  });

  it('is true while the device is cleared: an answer landing then writes nothing of a bulletin back', async () => {
    loadSupabase({ queued: 0, deadLettered: 0 });
    const seen = [];
    globalThis.PhotoQueue = {
      async wipe() {
        // The photo queue goes after the device is cleared: a bulletin let go now must write nothing.
        seen.push(window.isSigningOut(), _bltSigningOut());
        const entry = {
          key: '77777777-7777-4777-8777-777777777777',
          at: new Date().toISOString(),
          bulletin: { kind: 'announcement', body: 'Mid sign-out' },
          files: [{ kind: 'photo', title: 'Board', pages: 1 }],
          queued: true,
        };
        await _bltQueuedDrop('c1', entry, { giveBack: true });
        _bltEntryChange('c1', entry.key, e => (e.placed = true));
        return { ok: true };
      },
    };
    await window.signOut({ force: true });
    expect(seen).toEqual([true, true]);
    expect(localStorage.getItem('gb-bulletins-returned-c1')).toBe(null);
    expect(localStorage.getItem('gb-bulletins-pending-c1')).toBe(null);
    expect(localStorage.getItem('gb-students-c1')).toBe(null);
  });

  it('is set back when the device could not be cleared (sign-out did not complete)', async () => {
    loadSupabase({ queued: 0, deadLettered: 0 });
    globalThis.PhotoQueue = { wipe: async () => ({ ok: true }) };
    Object.defineProperty(localStorage, 'length', {
      get() {
        throw new Error('storage blocked');
      },
    });
    await expect(window.signOut({ force: true })).rejects.toThrow('storage blocked');
    expect(window.isSigningOut()).toBe(false);
  });
});
