/**
 * signOut() and the offline write queue — shared/supabase.js.
 *
 * The queue (fv-sync-queue-v1 / fv-sync-dead-letter-v1) holds student names
 * and observation text, so a sign-out on a shared computer must clear it. But
 * clearing it throws away changes that never reached the server, so an
 * explicit sign-out stops and reports them first, and the idle-timeout
 * sign-out (nobody there to ask) keeps them for the same teacher's next
 * session.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadSupabase(queueStats) {
  globalThis.window = globalThis;
  globalThis.localStorage = {
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
  globalThis.sessionStorage = { clear() {} };
  globalThis.document = { cookie: '', addEventListener() {} };
  globalThis.addEventListener = () => {};
  try {
    globalThis.location = { pathname: '/teacher/app.html', hostname: 'fullvision.ca', href: '' };
  } catch {
    globalThis.location.pathname = '/teacher/app.html';
    globalThis.location.hostname = 'fullvision.ca';
    globalThis.location.href = '';
  }
  if (!globalThis.navigator) globalThis.navigator = { userAgent: 'test' };
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

  globalThis.v2Queue = {
    stats: () => queueStats,
    flush: async () => ({}),
  };
  localStorage.setItem('fv-sync-queue-v1', '{"entries":[{"id":"q1"}]}');
  localStorage.setItem('fv-sync-dead-letter-v1', '[]');
  localStorage.setItem('gb-students-c1', '[]');
  localStorage.setItem('sb-example-auth-token', '{}');
  localStorage.setItem('unrelated', 'kept');
}

describe('signOut and unsent offline changes', () => {
  beforeEach(() => {
    delete globalThis.window;
    delete globalThis._supabase;
    delete globalThis.v2Queue;
  });

  it('stops and reports unsent changes instead of wiping them', async () => {
    loadSupabase({ queued: 2, deadLettered: 1 });
    const res = await window.signOut();
    expect(res).toEqual({ unsent: 2 });
    expect(localStorage.getItem('fv-sync-queue-v1')).not.toBeNull();
    expect(localStorage.getItem('gb-students-c1')).not.toBeNull();
    expect(window.location.href).toBe('');
  });

  it('clears the queue with the rest of the local data when forced', async () => {
    loadSupabase({ queued: 2, deadLettered: 1 });
    await window.signOut({ force: true });
    expect(localStorage.getItem('fv-sync-queue-v1')).toBeNull();
    expect(localStorage.getItem('fv-sync-dead-letter-v1')).toBeNull();
    expect(localStorage.getItem('gb-students-c1')).toBeNull();
    expect(localStorage.getItem('sb-example-auth-token')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('kept');
    expect(window.location.href).toBe('/login.html');
  });

  it('clears the queue when nothing is waiting', async () => {
    loadSupabase({ queued: 0, deadLettered: 0 });
    await window.signOut();
    expect(localStorage.getItem('fv-sync-queue-v1')).toBeNull();
    expect(window.location.href).toBe('/login.html');
  });

  it('keeps the owner-stamped queue on an idle-timeout sign-out', async () => {
    loadSupabase({ queued: 2, deadLettered: 0 });
    await window.signOut({ keepQueue: true });
    expect(localStorage.getItem('fv-sync-queue-v1')).not.toBeNull();
    expect(localStorage.getItem('gb-students-c1')).toBeNull();
    expect(localStorage.getItem('sb-example-auth-token')).toBeNull();
    expect(window.location.href).toBe('/login.html');
  });
});
