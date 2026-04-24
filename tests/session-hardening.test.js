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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Load shared/supabase.js with a production-like harness:
//   • hostname is NOT localhost (so _isDevMode = false)
//   • __ENV has real-looking creds (so _hasSupabaseConfig = true)
//   • supabase.createClient returns a stub whose auth.getUser() we control
function loadSupabaseProd({ getUserResult }) {
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
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          getUser: getUserSpy,
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
      };
    },
  };

  const code = readFileSync(resolve(root, 'shared/supabase.js'), 'utf-8');
  runInThisContext(code, { filename: 'shared/supabase.js' });

  return { getUserSpy };
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
    localStorage.setItem(
      'sb-example-auth-token',
      JSON.stringify({ access_token: 'forged', expires_at: farFuture }),
    );
    // The production code returns a never-resolving Promise after setting
    // location.href (real browser then reloads). Don't await — just trigger
    // and flush microtasks so the getUser() call and redirect assignment run.
    window.requireAuth();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getUserSpy).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login.html');
  });

  it('redirects to /login.html when getUser() throws (network failure, expired JWT)', async () => {
    const { getUserSpy } = loadSupabaseProd({
      getUserResult: { data: { user: null }, error: null },
    });
    getUserSpy.mockImplementationOnce(async () => {
      throw new Error('network');
    });
    window.requireAuth();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.location.href).toBe('/login.html');
  });

  it('caches the auth check across repeated calls (one server round-trip per page load)', async () => {
    const { getUserSpy } = loadSupabaseProd({
      getUserResult: { data: { user: { id: 'u1' } }, error: null },
    });
    await Promise.all([window.requireAuth(), window.requireAuth(), window.requireAuth()]);
    expect(getUserSpy).toHaveBeenCalledTimes(1);
  });
});

describe('echo guard window', () => {
  it('is set to 8000ms — the old 35000ms window was longer than any real RPC timeout and masked a second legitimate write landing inside the same window with stale cached state', () => {
    const src = readFileSync(resolve(root, 'shared/data.js'), 'utf-8');
    const match = src.match(/const\s+_ECHO_GUARD_MS\s*=\s*(\d+)\s*;/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(8000);
  });
});
