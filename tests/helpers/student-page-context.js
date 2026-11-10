/**
 * The student page as a browser loads it: a context of its own holding the
 * scripts s/index.html names, in its order, and nothing else. tests/setup.js
 * loads shared/data.js for every test file; this context has no data layer,
 * so shared/calc.js runs here on s/student-data.js alone, as it does on a
 * student's phone.
 *
 * A script the page adds later (a <script src> appended to <head>) is
 * fetched as a browser would: its name goes on `fetched`, and it runs in
 * the context a moment later, in the order added. `net.fail(src)` returning
 * true makes that fetch fail instead.
 *
 * openStudentPage() returns { ctx, T, root(), calls, replies, fetched, net,
 * start, click, type, choose, submit, tick, settle, run }. fetch is a
 * stand-in that records every call and answers from `replies`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The scripts s/index.html loads, as paths from the repo root. */
export function studentPageScripts() {
  const html = readFileSync(resolve(ROOT, 's/index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => 's/' + m[1]).map(p => p.replace('s/../', ''));
}

export function openStudentPage() {
  // The scripts load before #app exists, so the page doesn't start itself.
  const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  const calls = [];
  const replies = [];
  const fetched = [];
  const net = { fail: () => false };
  let pending = 0;
  const store = {};
  const storage = () => ({
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: k => delete store[k],
  });
  const sandbox = {
    document,
    console,
    setTimeout,
    clearTimeout,
    // The loading screen turns its lines on a timer; nothing here waits on it.
    setInterval: () => 0,
    clearInterval() {},
    __ENV: { SUPABASE_URL: 'https://x.supabase.co' },
    scrollTo() {},
    history: { replaceState() {} },
    location: { pathname: '/s/', hash: '' },
    localStorage: storage(),
    sessionStorage: storage(),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      const r = replies.length ? replies.shift() : { ok: true };
      return { json: async () => JSON.parse(JSON.stringify(r)) };
    },
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const append = document.head.appendChild.bind(document.head);
  document.head.appendChild = el => {
    const src = el && el.tagName === 'SCRIPT' ? el.getAttribute('src') : null;
    if (!src) return append(el);
    fetched.push(src);
    pending += 1;
    setTimeout(() => {
      pending -= 1;
      if (net.fail(src)) return el.onerror && el.onerror();
      vm.runInContext(readFileSync(resolve(ROOT, 's', src), 'utf8'), ctx, { filename: src });
      return el.onload && el.onload();
    }, 0);
    return append(el);
  };
  studentPageScripts().forEach(f => vm.runInContext(readFileSync(resolve(ROOT, f), 'utf8'), ctx, { filename: f }));

  const app = document.createElement('div');
  app.id = 'app';
  document.body.appendChild(app);
  const run = code => vm.runInContext(code, ctx);
  const T = run('StudentPage._test');
  const root = () => document.getElementById('app');
  const find = sel => {
    const el = root().querySelector(sel);
    if (!el) throw new Error('not on the page: ' + sel);
    return el;
  };
  const tick = () => new Promise(r => setTimeout(r, 0));
  // Until the page has nothing left to fetch and has drawn what came.
  const settle = async () => {
    do {
      await tick();
    } while (pending > 0);
    await tick();
  };
  return {
    ctx,
    T,
    run,
    root,
    calls,
    replies,
    fetched,
    net,
    tick,
    settle,
    start: async hash => {
      T.start(root(), hash);
      await settle();
    },
    click: async sel => {
      find(sel).dispatchEvent(new window.Event('click', { bubbles: true }));
      await settle();
    },
    type: (sel, value) => {
      const el = find(sel);
      el.value = value;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    choose: (sel, value) => {
      root()
        .querySelectorAll(sel + ' option')
        .forEach(o => o.removeAttribute('selected'));
      if (value !== '') find(sel + ' option[value="' + value + '"]').setAttribute('selected', '');
    },
    submit: async sel => {
      find(sel).dispatchEvent(new window.Event('submit', { bubbles: true }));
      await settle();
    },
  };
}
