/**
 * P5.5 session hardening — shared/supabase.js :: window.requireAuth().
 *
 * A shared-computer attacker who manually edits the cached `expires_at`
 * value in a `sb-*-auth-token` localStorage entry must NOT be granted
 * access. The production auth check must round-trip to Supabase via
 * `sb.auth.getUser()`, not trust the locally-cached expiry.
 *
 * Pairs with P5.5 in codex.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Load shared/supabase.js with a production-like harness:
//   • hostname is NOT localhost (so _isDevMode = false)
//   • __ENV has real-looking creds (so _hasSupabaseConfig = true)
//   • supabase.createClient returns a stub whose auth.getUser() we control
function loadSupabaseProd({ getUserResult, getSessionResult }) {
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
  // location / navigator may be read-only getters in the test environment;
  // assign defensively.
  try {
    globalThis.location = { pathname: '/teacher/app.html', hostname: 'fullvision.ca', href: '' };
  } catch {
    globalThis.location.pathname = '/teacher/app.html';
    globalThis.location.hostname = 'fullvision.ca';
    globalThis.location.href = '';
  }
  if (!globalThis.navigator) globalThis.navigator = { userAgent: 'test' };
  // Keep real setTimeout / clearTimeout / setInterval so tests can flush
  // the microtask + macrotask queue. The idle-timer IIFE in shared/supabase.js
  // will register an initial timer but that's fine — vitest tears down after
  // each test anyway.
  globalThis.console = console;
  globalThis.__ENV = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_KEY: 'sbp_example_key',
  };

  const getUserSpy = vi.fn(async () => getUserResult);
  const getSessionSpy = vi.fn(async () => getSessionResult || { data: { session: null }, error: null });
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          getUser: getUserSpy,
          getSession: getSessionSpy,
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
      };
    },
  };

  const code = readFileSync(resolve(root, 'shared/supabase.js'), 'utf-8');
  runInThisContext(code, { filename: 'shared/supabase.js' });

  return { getUserSpy, getSessionSpy };
}

describe('requireAuth — server-side session validation', () => {
  beforeEach(() => {
    // Reset module state between tests by forcing a fresh load.
    delete globalThis.window;
    delete globalThis._supabase;
    delete globalThis.requireAuth;
    delete globalThis.isDemoMode;
  });

  it('calls sb.auth.getUser() (server round-trip) when a valid user exists', async () => {
    const { getUserSpy } = loadSupabaseProd({
      getUserResult: { data: { user: { id: 'u1' } }, error: null },
    });
    await window.requireAuth();
    expect(getUserSpy).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('');
  });

  it('redirects to /login.html when a forged expires_at is in localStorage but the server rejects', async () => {
    const { getUserSpy } = loadSupabaseProd({
      getUserResult: { data: { user: null }, error: { message: 'invalid JWT' } },
    });
    // Attacker seeds a locally-valid-looking token with a far-future expiry.
    const farFuture = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
    localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: 'forged', expires_at: farFuture }));
    // The production code returns a never-resolving Promise after setting
    // location.href (real browser then reloads). Don't await — just trigger
    // and flush microtasks so the getUser() call and redirect assignment run.
    window.requireAuth();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getUserSpy).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login.html');
  });

  // Step 4 group 2 #25: a check that throws (another tab holding the auth
  // lock) or can't reach the server is not a sign-out. It waits and asks
  // again; still unsure, the page stays.
  describe('a passing error', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries after getUser() throws, and stays signed in when the next check passes', async () => {
      vi.useFakeTimers();
      const { getUserSpy } = loadSupabaseProd({
        getUserResult: { data: { user: { id: 'u1' } }, error: null },
      });
      getUserSpy.mockImplementationOnce(async () => {
        throw new Error('Lock "lock:sb-x-auth-token" was released because another request stole it');
      });
      const done = window.requireAuth();
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(getUserSpy).toHaveBeenCalledTimes(2);
      expect(window.location.href).toBe('');
    });

    it('retries a network error and keeps the saved class data', async () => {
      vi.useFakeTimers();
      const { getUserSpy } = loadSupabaseProd({
        getUserResult: { data: { user: { id: 'u1' } }, error: null },
      });
      localStorage.setItem('gb-courses', '{}');
      getUserSpy.mockImplementationOnce(async () => ({
        data: { user: null },
        error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
      }));
      const done = window.requireAuth();
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(getUserSpy).toHaveBeenCalledTimes(2);
      expect(window.location.href).toBe('');
      expect(localStorage.getItem('gb-courses')).toBe('{}');
    });

    it('stays on the page, signed in, when every check throws and a session is saved', async () => {
      vi.useFakeTimers();
      const { getUserSpy, getSessionSpy } = loadSupabaseProd({
        getUserResult: { data: { user: null }, error: null },
        getSessionResult: { data: { session: { access_token: 't' } }, error: null },
      });
      getUserSpy.mockImplementation(async () => {
        throw new Error('network');
      });
      localStorage.setItem('gb-courses', '{}');
      const done = window.requireAuth();
      await vi.advanceTimersByTimeAsync(10000);
      await done;
      expect(getUserSpy).toHaveBeenCalledTimes(4);
      expect(getSessionSpy).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe('');
      expect(localStorage.getItem('gb-courses')).toBe('{}');
    });

    it('goes to Sign In when every check throws and no session is saved', async () => {
      vi.useFakeTimers();
      const { getUserSpy } = loadSupabaseProd({
        getUserResult: { data: { user: null }, error: null },
        getSessionResult: { data: { session: null }, error: null },
      });
      getUserSpy.mockImplementation(async () => {
        throw new Error('network');
      });
      window.requireAuth();
      await vi.advanceTimersByTimeAsync(10000);
      expect(window.location.href).toBe('/login.html');
    });

    // Review of #25: the usual offline case is an access token that expired
    // overnight. getSession then can't refresh it and returns no session
    // with an error; that is not a sign-out.
    it('stays when the saved session has expired and cannot be refreshed offline', async () => {
      vi.useFakeTimers();
      const offline = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
      const { getUserSpy } = loadSupabaseProd({
        getUserResult: { data: { user: null }, error: offline },
        getSessionResult: { data: { session: null }, error: offline },
      });
      localStorage.setItem('gb-courses', '{}');
      const done = window.requireAuth();
      await vi.advanceTimersByTimeAsync(10000);
      await done;
      expect(getUserSpy).toHaveBeenCalled();
      expect(window.location.href).toBe('');
      expect(localStorage.getItem('gb-courses')).toBe('{}');
    });

    it('is done within about 13 s even when every call hangs', async () => {
      vi.useFakeTimers();
      const { getUserSpy, getSessionSpy } = loadSupabaseProd({
        getUserResult: { data: { user: null }, error: null },
        getSessionResult: { data: { session: null }, error: null },
      });
      getUserSpy.mockImplementation(() => new Promise(() => {}));
      getSessionSpy.mockImplementation(() => new Promise(() => {}));
      let settled = false;
      window.requireAuth().then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(13000);
      expect(settled).toBe(true);
      expect(window.location.href).toBe('');
    });

    it('asks once, not four times, when the browser is offline', async () => {
      vi.useFakeTimers();
      const { getUserSpy } = loadSupabaseProd({
        getUserResult: { data: { user: null }, error: null },
        getSessionResult: { data: { session: { access_token: 't' } }, error: null },
      });
      getUserSpy.mockImplementation(async () => {
        throw new Error('network');
      });
      const had = Object.getOwnPropertyDescriptor(navigator, 'onLine');
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      try {
        const done = window.requireAuth();
        await vi.advanceTimersByTimeAsync(5000);
        await done;
        expect(getUserSpy).toHaveBeenCalledTimes(1);
        expect(window.location.href).toBe('');
      } finally {
        if (had) Object.defineProperty(navigator, 'onLine', had);
        else delete navigator.onLine;
      }
    });
  });

  it('caches the auth check across repeated calls (one server round-trip per page load)', async () => {
    const { getUserSpy } = loadSupabaseProd({
      getUserResult: { data: { user: { id: 'u1' } }, error: null },
    });
    await Promise.all([window.requireAuth(), window.requireAuth(), window.requireAuth()]);
    expect(getUserSpy).toHaveBeenCalledTimes(1);
  });
});
