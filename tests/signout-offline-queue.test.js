/**
 * signOut() and the offline write queue — shared/supabase.js.
 *
 * The queue (fv-sync-queue-v1 / fv-sync-dead-letter-v1) holds student names
 * and observation text, so a sign-out clears it. But clearing it throws
 * away changes that never reached the server, so a sign-out stops and
 * reports them first. A sign-out ends this device's session only, and
 * nothing signs a teacher out for being idle (teachers use their own
 * devices).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  globalThis.__docListeners = [];
  globalThis.document = {
    cookie: '',
    addEventListener(evt) {
      globalThis.__docListeners.push(evt);
    },
  };
  globalThis.addEventListener = () => {};
  // teacher/ui.js (loaded by the test setup) closes the Undo toast; no toast here.
  globalThis.dismissUndoToast = () => {};
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
          async signOut(opts) {
            globalThis.__signOutOpts = opts;
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

  it('stops and reports unsent and failed changes instead of wiping them', async () => {
    loadSupabase({ queued: 2, deadLettered: 1 });
    const res = await window.signOut();
    expect(res).toEqual({ unsent: 3 });
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

  it('signs out this device only, so the phone and other computers stay signed in', async () => {
    loadSupabase({ queued: 0, deadLettered: 0 });
    await window.signOut();
    expect(globalThis.__signOutOpts).toEqual({ scope: 'local' });
  });

  describe('a delete still in its Undo window', () => {
    it('commits before the wipe, so nothing it saves stays on the device', async () => {
      loadSupabase({ queued: 0, deadLettered: 0 });
      let pending = true;
      globalThis.dismissUndoToast = () => {
        if (!pending) return;
        pending = false;
        localStorage.setItem('gb-scores-c1', '{"s1":[]}');
      };
      await window.signOut();
      // The Gradebook's pagehide listener closes the toast as the page goes.
      globalThis.dismissUndoToast();
      expect(localStorage.getItem('gb-scores-c1')).toBeNull();
      expect(window.location.href).toBe('/login.html');
    });

    it('counts as unsent when the delete has not reached the server', async () => {
      const stats = { queued: 0, deadLettered: 0 };
      loadSupabase(stats);
      globalThis.dismissUndoToast = () => {
        stats.queued = 1;
      };
      const res = await window.signOut();
      expect(res).toEqual({ unsent: 1 });
      expect(window.location.href).toBe('');
    });
  });

  describe('other open tabs', () => {
    const RealChannel = globalThis.BroadcastChannel;
    let channels;
    beforeEach(() => {
      channels = [];
      globalThis.BroadcastChannel = class {
        constructor(name) {
          this.name = name;
          this.onmessage = null;
          channels.push(this);
        }
        postMessage(data) {
          channels.filter(c => c !== this && c.name === this.name && c.onmessage).forEach(c => c.onmessage({ data }));
        }
        close() {}
      };
    });
    afterEach(() => {
      globalThis.BroadcastChannel = RealChannel;
    });

    it('tells the other tabs when this tab signs out', async () => {
      loadSupabase({ queued: 0, deadLettered: 0 });
      const heard = [];
      const otherTab = new BroadcastChannel('fv-auth');
      otherTab.onmessage = e => heard.push(e.data);
      await window.signOut();
      expect(heard).toEqual([{ type: 'signed-out' }]);
    });

    it('leaves for sign-in and clears what the page saves on its way out', () => {
      loadSupabase({ queued: 0, deadLettered: 0 });
      const pagehide = [];
      globalThis.addEventListener = (evt, fn) => evt === 'pagehide' && pagehide.push(fn);
      new BroadcastChannel('fv-auth').postMessage({ type: 'signed-out' });
      expect(localStorage.getItem('gb-students-c1')).toBeNull();
      expect(localStorage.getItem('fv-sync-queue-v1')).toBeNull();
      expect(localStorage.getItem('unrelated')).toBe('kept');
      expect(window.location.href).toBe('/login.html');
      // A delete still in its Undo window commits on pagehide and saves the class.
      localStorage.setItem('gb-scores-c1', '{"s1":[]}');
      localStorage.setItem('fv-sync-queue-v1', '{"entries":[{"id":"q2"}]}');
      pagehide.forEach(fn => fn());
      expect(localStorage.getItem('gb-scores-c1')).toBeNull();
      expect(localStorage.getItem('fv-sync-queue-v1')).toBeNull();
    });

    it('does nothing on the sign-in page', () => {
      loadSupabase({ queued: 0, deadLettered: 0 });
      window.location.pathname = '/login.html';
      new BroadcastChannel('fv-auth').postMessage({ type: 'signed-out' });
      expect(localStorage.getItem('gb-students-c1')).not.toBeNull();
      expect(window.location.href).toBe('');
    });
  });

  it('never signs a teacher out for being idle', () => {
    loadSupabase({ queued: 0, deadLettered: 0 });
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
      expect(globalThis.__docListeners).not.toContain(evt),
    );
  });
});
