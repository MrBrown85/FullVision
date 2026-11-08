/**
 * Continue with Google — shared/supabase.js :: signInWithGoogle() and
 * shared/sign-in.js :: ensureDisplayName().
 *
 * The button sends the teacher to Google, which comes back to
 * login.html?signin=google. Google fills full_name and name, not the
 * display_name the app reads, so the name is copied across on the way in.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let oauthCalls;
let oauthResult;
let updateCalls;
let updateResult;

function load() {
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
  globalThis.location = {
    origin: 'https://fullvision.ca',
    pathname: '/login.html',
    href: '',
    hostname: 'fullvision.ca',
  };
  if (!globalThis.navigator) globalThis.navigator = { userAgent: 'test' };
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  globalThis.setInterval = () => 0;
  globalThis.__ENV = undefined;
  // A stub client stands in for the Supabase CDN.
  globalThis._supabase = {
    auth: {
      async signInWithOAuth(opts) {
        oauthCalls.push(opts);
        return oauthResult;
      },
      async updateUser(attrs) {
        updateCalls.push(attrs);
        if (updateResult instanceof Error) throw updateResult;
        return updateResult;
      },
      onAuthStateChange() {},
    },
  };

  for (const file of ['shared/supabase.js', 'shared/sign-in.js']) {
    runInThisContext(readFileSync(resolve(root, file), 'utf-8'), { filename: file });
  }
}

load();

beforeEach(() => {
  localStorage.clear();
  oauthCalls = [];
  oauthResult = { data: { url: 'https://example.supabase.co/auth/v1/authorize' }, error: null };
  updateCalls = [];
  updateResult = { data: { user: null }, error: null };
});

describe('signInWithGoogle', () => {
  it('asks Supabase for Google and comes back to login.html?signin=google', async () => {
    await window.signInWithGoogle();
    expect(oauthCalls).toEqual([
      { provider: 'google', options: { redirectTo: 'https://fullvision.ca/login.html?signin=google' } },
    ]);
  });

  it('ends Demo Mode before leaving, as an email sign-in does', async () => {
    localStorage.setItem('gb-demo-mode', '1');
    localStorage.setItem('gb-demo-mode-token', 'token');
    localStorage.setItem('gb-courses', '[{"id":"demo-sci8"}]');
    await window.signInWithGoogle();
    expect(localStorage.getItem('gb-demo-mode')).toBeNull();
    expect(localStorage.getItem('gb-courses')).toBeNull();
  });

  it('keeps a teacher’s saved copy when Demo Mode was never on', async () => {
    localStorage.setItem('gb-courses', '[{"id":"real"}]');
    await window.signInWithGoogle();
    expect(localStorage.getItem('gb-courses')).toBe('[{"id":"real"}]');
  });

  it('throws Supabase’s error so the button can show it', async () => {
    oauthResult = { data: null, error: new Error('Unsupported provider: provider is not enabled') };
    await expect(window.signInWithGoogle()).rejects.toThrow('provider is not enabled');
  });
});

describe('ensureDisplayName', () => {
  it('copies Google’s full name into display_name', async () => {
    const updated = { email: 'a@school.ca', user_metadata: { full_name: 'Avery Chen', display_name: 'Avery Chen' } };
    updateResult = { data: { user: updated }, error: null };
    const user = await ensureDisplayName({ email: 'a@school.ca', user_metadata: { full_name: 'Avery Chen' } });
    expect(updateCalls).toEqual([{ data: { display_name: 'Avery Chen' } }]);
    expect(user).toBe(updated);
  });

  it('falls back to name when there is no full_name', async () => {
    await ensureDisplayName({ user_metadata: { name: 'Avery' } });
    expect(updateCalls).toEqual([{ data: { display_name: 'Avery' } }]);
  });

  it('leaves a name the teacher already has', async () => {
    const user = { user_metadata: { display_name: 'Ms. Chen', full_name: 'Avery Chen' } };
    expect(await ensureDisplayName(user)).toBe(user);
    expect(updateCalls).toEqual([]);
  });

  it('does nothing when Google gave no name', async () => {
    const user = { email: 'a@school.ca', user_metadata: {} };
    expect(await ensureDisplayName(user)).toBe(user);
    expect(updateCalls).toEqual([]);
  });

  it('goes on with the same user when the copy fails', async () => {
    const user = { user_metadata: { full_name: 'Avery Chen' } };
    updateResult = { data: { user: null }, error: new Error('network') };
    expect(await ensureDisplayName(user)).toBe(user);
    updateResult = new Error('offline');
    expect(await ensureDisplayName(user)).toBe(user);
  });
});
