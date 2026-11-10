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
 * openStudentPage() returns { ctx, T, root(), calls, replies, probes, fetched,
 * net, store, start, click, type, choose, submit, tick, settle, run,
 * watchGlobals }.
 * fetch is a stand-in for the student-submit function. It records every
 * call and answers from `replies`, with one exception. Since S0-W1 the page
 * puts every typed or scanned code to the function's `card` route before it
 * opens it as a slip. The stand-in answers that question as the real
 * function answers a slip's code or one nobody holds, { ok: false, error:
 * 'not_found' }, and records it in `probes`, so `calls` and `replies` stay
 * what they were: the slip routes' own. In Demo Mode nothing may be asked
 * at all, so there a `card` question lands in `calls` like any other and
 * fails the test that counts them.
 * A test of the card's own routes sets `server`, a function from a request
 * body to a reply: it then answers everything, and every call is in `calls`.
 * `store` is what the page has kept in localStorage and `tab` what it has
 * kept in sessionStorage; openStudentPage({ store }) opens the page on a
 * device that already holds something (the same device, opened again).
 * `addresses` is each address the page has put in the bar (replaceState).
 * openStudentPage({ noStorage: true }) is a private window, where every use
 * of localStorage throws.
 *
 * The window. fire(name) sends the window an event (pageshow, storage,
 * pointerdown, keydown, scroll…) and fireDocument(name) the document.
 * hide() and show() make the tab hidden or visible, as switching tabs or
 * closing a lid does. advance(ms) moves the page's clock (Date.now) on
 * without running its timers, as a closed lid does; a timer the page set
 * for longer than a second never fires here, so a test moves the clock and
 * then sends the event that would wake the page.
 *
 * What is on screen. There is no layout here, so the page's
 * IntersectionObserver is a stand-in a test drives: onScreen(el => true or
 * false) tells every observer which of the rows it watches are in view.
 *
 * watchGlobals(files) finds every global name those files read that the
 * page does not define (a reader the teacher's apps get from
 * shared/data.js, say) and returns a Set that fills with each such name as
 * the page's code reaches for it, behind a `typeof` guard or not.
 * spyGlobals(names) returns a Set that fills with each of those globals as
 * the page's code reads it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { parseHTML } from 'linkedom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The scripts s/index.html loads, as paths from the repo root. */
export function studentPageScripts() {
  const html = readFileSync(resolve(ROOT, 's/index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => 's/' + m[1]).map(p => p.replace('s/../', ''));
}

/** Every name a script reads that it does not declare itself, at any depth. */
export function freeNames(file) {
  const ast = parse(readFileSync(resolve(ROOT, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
  const read = new Set();
  const declared = new Set();
  const named = node => node.id && declared.add(node.id.name);
  simple(ast, {
    Identifier: node => read.add(node.name),
    VariablePattern: node => declared.add(node.name),
    FunctionDeclaration: named,
    FunctionExpression: named,
    ClassDeclaration: named,
  });
  return [...read].filter(name => !declared.has(name));
}

export function openStudentPage(opts = {}) {
  // The scripts load before #app exists, so the page doesn't start itself.
  const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  const calls = [];
  const replies = [];
  const probes = [];
  const fetched = [];
  const net = { fail: () => false };
  const out = { server: null };
  let pending = 0;
  const store = opts.store || {};
  const addresses = [];
  const tab = {};
  const storage = kept => ({
    getItem: k => (k in kept ? kept[k] : null),
    setItem: (k, v) => (kept[k] = String(v)),
    removeItem: k => delete kept[k],
  });
  const win = new EventTarget();
  const observers = [];
  class FakeIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.watched = new Set();
      observers.push(this);
    }
    observe(el) {
      this.watched.add(el);
    }
    unobserve(el) {
      this.watched.delete(el);
    }
    disconnect() {
      this.watched.clear();
      const at = observers.indexOf(this);
      if (at >= 0) observers.splice(at, 1);
    }
  }
  let visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const sandbox = {
    document,
    console,
    // A long timer (a session's end, fifteen idle minutes) must not hold the test run open.
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (ms > 1000) t.unref();
      return t;
    },
    clearTimeout,
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    IntersectionObserver: opts.noObserver ? undefined : FakeIntersectionObserver,
    // The loading screen turns its lines on a timer; nothing here waits on it.
    setInterval: () => 0,
    clearInterval() {},
    __ENV: { SUPABASE_URL: 'https://x.supabase.co' },
    scrollTo() {},
    history: { replaceState: (state, title, address) => addresses.push(address) },
    location: { pathname: '/s/', hash: '' },
    // A private window: every use of localStorage throws.
    localStorage: opts.noStorage
      ? new Proxy(
          {},
          {
            get() {
              throw new Error('SecurityError');
            },
          },
        )
      : storage(store),
    sessionStorage: storage(tab),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      const answer = r => ({ json: async () => JSON.parse(JSON.stringify(r)) });
      if (out.server) {
        calls.push({ url, body, init });
        // The function takes a moment (it hashes the caller's address);
        // settle() waits until every call has been answered.
        pending += 1;
        try {
          return answer(await out.server(body));
        } finally {
          setTimeout(() => (pending -= 1), 0);
        }
      }
      const demo = !!(out.T && out.T.state() && out.T.state().demo);
      if (body.route === 'card' && !demo) {
        probes.push({ url, body, init });
        return answer({ ok: false, error: 'not_found' });
      }
      calls.push({ url, body });
      return answer(replies.length ? replies.shift() : { ok: true });
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
  out.T = T;
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
  return Object.assign(out, {
    ctx,
    T,
    run,
    root,
    calls,
    replies,
    probes,
    fetched,
    net,
    store,
    addresses,
    tab,
    observers,
    fire: (name, init) => {
      const e = new Event(name);
      win.dispatchEvent(Object.assign(e, init));
    },
    fireDocument: name => document.dispatchEvent(new window.Event(name)),
    hide: () => {
      visibility = 'hidden';
      document.dispatchEvent(new window.Event('visibilitychange'));
    },
    show: () => {
      visibility = 'visible';
      document.dispatchEvent(new window.Event('visibilitychange'));
    },
    advance: ms =>
      run('Date.now = (function (now, by) { return function () { return now() + by; }; })(Date.now, ' + ms + ')'),
    onScreen: inView => {
      observers.slice().forEach(o => {
        const entries = [...o.watched]
          .filter(el => root().contains(el))
          .map(el => ({ target: el, isIntersecting: !!inView(el) }));
        if (entries.length) o.callback(entries, o);
      });
    },
    tick,
    settle,
    watchGlobals: files => {
      const reached = new Set();
      const defined = name => {
        try {
          return run('typeof ' + name) !== 'undefined';
        } catch (e) {
          return true; // a keyword-like name (arguments, undefined): not a global to supply
        }
      };
      [...new Set(files.flatMap(freeNames))]
        .filter(name => !defined(name))
        .forEach(name =>
          Object.defineProperty(sandbox, name, {
            configurable: true,
            get() {
              reached.add(name);
              return undefined;
            },
          }),
        );
      return reached;
    },
    spyGlobals: names => {
      const used = new Set();
      names.forEach(name => {
        const value = sandbox[name];
        Object.defineProperty(sandbox, name, {
          configurable: true,
          get() {
            used.add(name);
            return value;
          },
        });
      });
      return used;
    },
    start: async hash => {
      T.start(root(), hash);
      await settle();
    },
    click: async sel => {
      find(sel).dispatchEvent(new window.Event('click', { bubbles: true }));
      await settle();
    },
    // A click that is not waited for: what it started is still on its way.
    tap: sel => {
      find(sel).dispatchEvent(new window.Event('click', { bubbles: true }));
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
    // A form sent and not waited for.
    send: sel => {
      find(sel).dispatchEvent(new window.Event('submit', { bubbles: true }));
    },
  });
}

/**
 * A `page` reply written with each grade as the score tables' rows
 * ({ score, tag_scores, rubric_scores }, what get_assessment_detail gives a
 * teacher) as the server sends it: each grade a copy, { v, value, modifier,
 * comment, tags, criteria, checks } (migrations/2026110902_grade_return.sql,
 * 3). Everything else in the reply is left as written.
 */
export function asServerSends(reply) {
  const level = (r, criterion) =>
    Object.assign(
      { value: r.value, modifier: r.modifier || 0, comment: r.comment || null },
      criterion ? { beyond: r.beyond || null } : {},
    );
  const copy = rows => {
    if (!rows) return rows;
    const score = rows.score || {};
    return {
      v: 1,
      value: score.value == null ? null : score.value,
      modifier: score.value == null ? 0 : score.modifier || 0,
      comment: score.comment || null,
      tags: Object.fromEntries((rows.tag_scores || []).map(r => [r.tag_id, level(r, false)])),
      criteria: Object.fromEntries((rows.rubric_scores || []).map(r => [r.criterion_id, level(r, true)])),
      checks: [],
    };
  };
  return Object.assign({}, reply, {
    assessments: (reply.assessments || []).map(a =>
      'grade' in a ? Object.assign({}, a, { grade: copy(a.grade) }) : a,
    ),
  });
}
