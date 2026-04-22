import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USER = {
  email: 'teacher@example.com',
  user_metadata: { display_name: 'Teacher Example', portal: 'teacher' },
};

function makeElement() {
  return {
    value: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    addEventListener() {},
    remove() {},
    querySelector() {
      return makeElement();
    },
    focus() {},
  };
}

describe('login restore-account prompt', () => {
  var originalWindow;
  var originalDocument;
  var originalLocalStorage;
  var originalGetSupabase;
  var originalSignIn;
  var originalIntl;
  var elements;

  beforeEach(() => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalLocalStorage = globalThis.localStorage;
    originalGetSupabase = globalThis.getSupabase;
    originalSignIn = globalThis.signIn;
    originalIntl = globalThis.Intl;

    elements = {
      'tab-signin': makeElement(),
      'tab-signup': makeElement(),
      'form-signin': makeElement(),
      'form-signup': makeElement(),
      'auth-error': makeElement(),
      'auth-success': makeElement(),
      'si-submit': makeElement(),
      'si-email': makeElement(),
      'si-password': makeElement(),
      'su-name': makeElement(),
      'su-email': makeElement(),
      'su-password': makeElement(),
      'su-confirm': makeElement(),
    };

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
        return Object.keys(this._store)[i] || null;
      },
      get length() {
        return Object.keys(this._store).length;
      },
    };
    globalThis.document = {
      getElementById(id) {
        if (!elements[id]) elements[id] = makeElement();
        return elements[id];
      },
      createElement() {
        return makeElement();
      },
      addEventListener() {},
      body: { appendChild() {} },
    };
    globalThis.location = { href: '', search: '', hostname: 'fullvision.ca' };
    globalThis.getSupabase = function () {
      return {
        auth: {
          getSession() {
            return Promise.resolve({ data: { session: null } });
          },
          signOut() {
            return Promise.resolve({ error: null });
          },
        },
        rpc() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    };
    globalThis.signIn = function () {
      return Promise.resolve({ user: USER });
    };
    globalThis.Intl = originalIntl;

    runInThisContext(readFileSync(resolve(root, 'login-auth.js'), 'utf-8'), {
      filename: 'login-auth.js',
    });
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.getSupabase = originalGetSupabase;
    globalThis.signIn = originalSignIn;
    globalThis.Intl = originalIntl;
    globalThis.showRestoreAccountPrompt = undefined;
    globalThis.maybePromptRestoreAccount = undefined;
  });

  it('restores the teacher when they choose Restore', async () => {
    var calls = [];
    globalThis.getSupabase = function () {
      return {
        auth: {
          getSession() {
            return Promise.resolve({ data: { session: null } });
          },
          signOut() {
            calls.push('signOut');
            return Promise.resolve({ error: null });
          },
        },
        rpc(name, payload) {
          calls.push({ name: name, payload: payload || {} });
          if (name === 'bootstrap_teacher') {
            return Promise.resolve({
              data: {
                id: 'teacher-1',
                deleted_at: '2026-04-01T12:00:00Z',
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    };
    globalThis.showRestoreAccountPrompt = function () {
      return Promise.resolve(true);
    };

    var shouldRedirect = await maybePromptRestoreAccount(USER);

    expect(shouldRedirect).toBe(true);
    expect(calls).toEqual([
      {
        name: 'bootstrap_teacher',
        payload: {
          p_email: USER.email,
          p_display_name: USER.user_metadata.display_name,
        },
      },
      { name: 'restore_teacher', payload: {} },
    ]);
  });

  it('signs the user back out when they continue deletion', async () => {
    var calls = [];
    globalThis.getSupabase = function () {
      return {
        auth: {
          getSession() {
            return Promise.resolve({ data: { session: null } });
          },
          signOut() {
            calls.push('signOut');
            return Promise.resolve({ error: null });
          },
        },
        rpc(name, payload) {
          calls.push({ name: name, payload: payload || {} });
          return Promise.resolve({
            data: {
              id: 'teacher-1',
              deleted_at: '2026-04-01T12:00:00Z',
            },
            error: null,
          });
        },
      };
    };
    globalThis.showRestoreAccountPrompt = function () {
      return Promise.resolve(false);
    };

    var shouldRedirect = await maybePromptRestoreAccount(USER);

    expect(shouldRedirect).toBe(false);
    expect(calls).toEqual([
      {
        name: 'bootstrap_teacher',
        payload: {
          p_email: USER.email,
          p_display_name: USER.user_metadata.display_name,
        },
      },
      'signOut',
    ]);
    expect(elements['auth-success'].textContent).toMatch(/within 30 days/);
  });
});
