/**
 * The password reset email's link opens login.html?reset=1, signed in for
 * that one job. The page shows Choose a New Password instead of going on to
 * the gradebook, saves the new password, then opens FullVision. A used or
 * expired link goes back to Sign In and says why.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'login.html'), 'utf-8');
const device = readFileSync(resolve(root, 'shared/device.js'), 'utf-8');
const shared = readFileSync(resolve(root, 'shared/sign-in.js'), 'utf-8');
const script = readFileSync(resolve(root, 'login-auth.js'), 'utf-8');
const USER = { email: 'teacher@example.com', user_metadata: { portal: 'teacher' } };

const saved = {};
const KEYS = ['window', 'document', 'location', 'history', 'localStorage', 'getSupabase', 'esc'];

function load({ search = '', hash = '', session = USER, updateError = null } = {}) {
  KEYS.forEach(k => (saved[k] = globalThis[k]));
  const { document } = parseHTML(html);
  const calls = { updateUser: [], resetPasswordForEmail: [], replaced: [] };
  const location = {
    search,
    hash,
    pathname: '/login.html',
    origin: 'https://fullvision.ca',
    href: '',
    hostname: 'fullvision.ca',
  };
  globalThis.window = globalThis;
  globalThis.document = document;
  globalThis.location = location;
  globalThis.history = {
    replaceState(_s, _t, url) {
      calls.replaced.push(url);
      const [p, q] = url.split('?');
      location.pathname = p;
      location.search = q ? '?' + q : '';
      location.hash = '';
    },
  };
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: k => delete store[k],
  };
  globalThis.esc = s => String(s);
  globalThis.getSupabase = () => ({
    auth: {
      getSession: async () => ({ data: { session: session ? { user: session } : null } }),
      updateUser: async attrs => {
        calls.updateUser.push(attrs);
        return updateError ? { error: updateError } : { data: { user: USER } };
      },
      resetPasswordForEmail: async (email, opts) => {
        calls.resetPasswordForEmail.push([email, opts]);
        return { error: null };
      },
    },
    rpc: async () => ({ data: null, error: null }),
  });
  runInThisContext(device, { filename: 'shared/device.js' });
  runInThisContext(shared, { filename: 'shared/sign-in.js' });
  runInThisContext(script, { filename: 'login-auth.js' });
  return { document, location, calls };
}

const settle = () => new Promise(r => setTimeout(r, 0));

afterEach(() => {
  KEYS.forEach(k => (globalThis[k] = saved[k]));
});

describe('choose a new password', () => {
  it('shows Choose a New Password from a reset link, not the gradebook', async () => {
    const { document, location, calls } = load({ search: '?reset=1', hash: '#access_token=t&type=recovery' });
    await settle();
    expect(document.getElementById('form-reset').hidden).toBe(false);
    expect(document.getElementById('form-signin').hidden).toBe(true);
    expect(document.querySelector('.auth-tabs').hidden).toBe(true);
    expect(location.href).toBe('');
    // The link's tokens are cleared from the address.
    expect(calls.replaced).toEqual(['/login.html?reset=1']);
  });

  it('saves the new password, then opens FullVision', async () => {
    const { document, location, calls } = load({ search: '?reset=1' });
    await settle();
    // The page waits before it opens FullVision: the clock is moved, not slept through.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      document.getElementById('rs-password').value = 'new-secret-1';
      document.getElementById('rs-confirm').value = 'new-secret-1';
      document.getElementById('form-reset').dispatchEvent(new document.defaultView.Event('submit'));
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.updateUser).toEqual([{ password: 'new-secret-1' }]);
      expect(document.getElementById('auth-success').textContent).toMatch(/password is changed/);
      await vi.advanceTimersByTimeAsync(1300);
      expect(location.href).toBe('/dashboard');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks again when the two passwords differ', async () => {
    const { document, calls } = load({ search: '?reset=1' });
    await settle();
    document.getElementById('rs-password').value = 'new-secret-1';
    document.getElementById('rs-confirm').value = 'new-secret-2';
    document.getElementById('form-reset').dispatchEvent(new document.defaultView.Event('submit'));
    await settle();
    expect(calls.updateUser).toEqual([]);
    expect(document.getElementById('auth-error').textContent).toBe('Passwords do not match.');
  });

  it('sends an expired or used link back to Sign In with a reason', async () => {
    const { document, location } = load({
      search: '?reset=1',
      hash: '#error=access_denied&error_code=otp_expired',
      session: null,
    });
    await settle();
    expect(document.getElementById('form-reset').hidden).toBe(true);
    expect(document.getElementById('form-signin').hidden).toBe(false);
    expect(document.getElementById('auth-error').textContent).toMatch(/expired or was already used/);
    expect(location.href).toBe('');
  });

  it('Forgot password? sends a link that comes back to this page', async () => {
    const { document, calls } = load();
    await settle();
    document.getElementById('si-email').value = 'teacher@example.com';
    document.querySelector('[data-action="forgot-password"]').click();
    await settle();
    expect(calls.resetPasswordForEmail).toEqual([
      ['teacher@example.com', { redirectTo: 'https://fullvision.ca/login.html?reset=1' }],
    ]);
  });
});

describe('a reset link that lands on the front page', () => {
  it('goes on to the sign-in page with the link', () => {
    const page = readFileSync(resolve(root, 'index.html'), 'utf-8');
    expect(page).toMatch(/location\.replace\('\/login\.html\?reset=1' \+ location\.hash\)/);
    expect(page).toMatch(/type=recovery\|error_code=/);
  });
});
