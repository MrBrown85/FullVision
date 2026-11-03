/**
 * A real sign-in ends Demo Mode — shared/supabase.js :: window.signIn().
 *
 * Nov 2 2026: a teacher who had opened Try Demo Mode on her browser signed in
 * with her real account and saw only the Demo class. The demo flags survived
 * the sign-in, requireAuth() took the demo branch, and her classes never
 * loaded. signIn() must clear the demo flags and the demo data with them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let signInResult;

function loadSupabase() {
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
  globalThis.location = { pathname: '/login.html', href: '', hostname: 'fullvision.ca' };
  if (!globalThis.navigator) globalThis.navigator = { userAgent: 'test' };
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  globalThis.setInterval = () => 0;
  globalThis.__ENV = undefined;
  // A stub client stands in for the Supabase CDN.
  globalThis._supabase = {
    auth: {
      signInWithPassword: async () => signInResult,
      onAuthStateChange() {},
    },
  };

  const code = readFileSync(resolve(root, 'shared/supabase.js'), 'utf-8');
  runInThisContext(code, { filename: 'shared/supabase.js' });
}

loadSupabase();

function enterDemo() {
  localStorage.setItem('gb-demo-mode', '1');
  localStorage.setItem('gb-demo-mode-token', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  localStorage.setItem('gb-courses', '[{"id":"demo-sci8","name":"Science 8"}]');
  localStorage.setItem('gb-students-demo-sci8', '[]');
}

describe('signIn leaves Demo Mode', () => {
  beforeEach(() => {
    localStorage.clear();
    signInResult = { data: { user: { id: 'u1' }, session: {} }, error: null };
  });

  it('clears the demo flags and demo data after a real sign-in', async () => {
    enterDemo();
    localStorage.setItem('sb-novsfeqjhbleyyaztmlh-auth-token', 'session');
    expect(window.isDemoMode()).toBe(true);

    await window.signIn('teacher@example.com', 'pw');

    expect(window.isDemoMode()).toBe(false);
    expect(localStorage.getItem('gb-demo-mode')).toBeNull();
    expect(localStorage.getItem('gb-demo-mode-token')).toBeNull();
    expect(localStorage.getItem('gb-courses')).toBeNull();
    expect(localStorage.getItem('gb-students-demo-sci8')).toBeNull();
    expect(localStorage.getItem('sb-novsfeqjhbleyyaztmlh-auth-token')).toBe('session');
  });

  it('keeps a teacher’s saved copy when Demo Mode was never on', async () => {
    localStorage.setItem('gb-courses', '[{"id":"real"}]');
    await window.signIn('teacher@example.com', 'pw');
    expect(localStorage.getItem('gb-courses')).toBe('[{"id":"real"}]');
  });

  it('leaves Demo Mode alone when the sign-in fails', async () => {
    enterDemo();
    signInResult = { data: null, error: new Error('Invalid login credentials') };
    await expect(window.signIn('teacher@example.com', 'bad')).rejects.toThrow('Invalid login credentials');
    expect(window.isDemoMode()).toBe(true);
  });
});
