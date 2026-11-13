/* global Grader, document, getActiveCourse, getAssessments, window -- page.evaluate code runs in the app page. */
/**
 * One build's browser session for a differential run: a fresh browser
 * context, the deterministic page set-up (page-init.js and Playwright's fake
 * clock, paused), and, signed in, e2e/helpers.js mockAuth (the fake
 * Supabase the browser specs use) with the run's classes seeded once and
 * the run's own fake server laid over it (fake-server.js).
 */
import { readFileSync } from 'node:fs';
import { mockAuth } from '../../e2e/helpers.js';
import { seedSignedIn, signedInClasses } from './fixtures.mjs';
import { watch } from './given.mjs';
import { quiet, runClock, settle } from './probe.mjs';

const INIT_SRC = readFileSync(new URL('./page-init.js', import.meta.url), 'utf-8');
const SERVER_SRC = readFileSync(new URL('./fake-server.js', import.meta.url), 'utf-8');
// 2026-10-15 15:00 UTC, a school day.
export const BASE_TIME = Date.UTC(2026, 9, 15, 15, 0, 0);

export const VIEWPORT = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };

/* How far the clock moves after an action, in steps, with the pages left to
   finish their real work (scripts loading, other tabs' messages) before
   each: what the action set off at once, then the short waits (debounces,
   the outbox's first retry, the lease's heartbeat): six seconds a step. */
export const STEP_CHUNKS = [0, 2500, 3500];
/* Back online: long enough for every outbox retry (its longest backoff is
   a minute) and its periodic send. Kept out of the ordinary step, where a
   page's one-second timers would make each minute cost a second. */
export const DRAIN_CHUNKS = [0, 2500, 30000, 61000, 61000];

/* A page starting (a first load, a new tab, a reload) is given the clock in
   rounds of BOOT_TICKS moves of BOOT_TICK_MS, every tab left to finish its
   real work before each move. Build A and build B are always given the
   same number of rounds (bootTogether), so however long either took in real
   time their clocks stay together. */
const BOOT_TICK_MS = 100;
const BOOT_TICKS = 20;
const BOOT_ROUNDS = 20;

export async function newSession(browser, { url, mode, seed }) {
  const context = await browser.newContext({
    baseURL: url,
    viewport: VIEWPORT,
    timezoneId: 'UTC',
    locale: 'en-CA',
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  // A click or wait that cannot happen in 5 seconds is the run's bug: it
  // fails at once instead of waiting the default 30. A page load is given
  // longer: on a busy machine a reload can take more than 5.
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(45000);
  const origin = new URL(url).origin;
  // `given`: everything the run asks of this build's pages (given.mjs).
  const s = { context, url, mode, pages: [], errors: [], external: [], seenCalls: new Set(), heldCalls: [], given: [] };
  // Every request that goes to another server than the build's own. Demo
  // Mode must make none; signed in, the fake server answers in the page.
  context.on('request', req => {
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || u.origin === origin) return;
    s.external.push(req.method() + ' ' + u.origin + u.pathname);
  });
  // Before the clock, so it keeps the real setTimeout.
  await context.addInitScript({
    content: INIT_SRC + '\ndifferentialPageInit(' + JSON.stringify({ seed }) + ');',
  });
  if (mode === 'signed-in') {
    // mockAuth registers its init script and routes on what it is given; a
    // context does both for every page, the second tab's too.
    await mockAuth(context);
    await context.addInitScript(seedSignedIn, signedInClasses());
    // After mockAuth, whose fake client it wraps.
    await context.addInitScript({ content: SERVER_SRC + '\ndifferentialFakeServer();' });
  }
  // The clock last: a route added after it leaves a tab opened later on a
  // clock that runs in real time. Installed a little early and paused at the
  // start time, so every page's clock starts at exactly BASE_TIME however
  // long the set-up took.
  await context.clock.install({ time: BASE_TIME - 60000 });
  await context.clock.pauseAt(BASE_TIME);
  context.__diffNow = BASE_TIME;
  return s;
}

export function tabsOf(s) {
  return s.pages.filter(p => !p.isClosed());
}

/* Deliver the messages between tabs (page-init.js): every tab sends a
   barrier and the run waits until each other tab has had it on every
   channel they share; then each tab, in a fixed order, is given what came
   in; again until nothing more comes. Each tab finishes its real work
   between. */
export async function barrier(s) {
  for (let round = 0; round < 10; round++) {
    const tabs = tabsOf(s);
    await Promise.all(tabs.map(p => settle(p)));
    if (tabs.length > 1) {
      s.barrierN = (s.barrierN || 0) + 1;
      const n = s.barrierN;
      const sent = await Promise.all(tabs.map(p => p.evaluate(n => window.__diffBarrierSend(n), n).catch(() => null)));
      await Promise.all(
        tabs.map((p, i) => {
          if (!sent[i]) return null;
          const want = [];
          sent.forEach((from, j) => {
            if (!from || j === i) return;
            for (const name of from.names) if (sent[i].names.includes(name)) want.push(name + ' ' + from.tab);
          });
          return p
            .waitForFunction(([want, n]) => want.every(k => window.__diffSeen[k] >= n), [want, n], {
              polling: 5,
              timeout: 5000,
            })
            .catch(() => {});
        }),
      );
    }
    let delivered = 0;
    for (const p of tabs) {
      const n = await p.evaluate(() => (window.__diffDeliver ? window.__diffDeliver() : 0)).catch(() => 0);
      if (n) await settle(p);
      delivered += n;
    }
    if (!delivered) return;
  }
}

/* Move the clock through `chunks`, letting every tab finish its real work
   (and hear from the others) before each move and after the last. */
export async function advance(s, chunks = STEP_CHUNKS) {
  for (const ms of chunks) {
    await barrier(s);
    await runClock(s.context, ms);
  }
  await barrier(s);
}

/* Whether a page's app is up: the desktop app with its class and work in,
   or the phone app with its class. */
function appUp(page, phone) {
  return page
    .evaluate(phone => {
      if (typeof getActiveCourse !== 'function') return false;
      const cid = getActiveCourse();
      if (!cid) return false;
      if (phone) return typeof Grader !== 'undefined';
      if (!document.querySelector('#dock-mount nav')) return false;
      return typeof getAssessments === 'function' && getAssessments(cid).length > 0;
    }, phone)
    .catch(() => false);
}

/* Give the clock to pages that are starting, one in each build (`pageOf`
   picks it), until both are up. Both builds are given the same rounds. */
export async function bootTogether(sides, pageOf, phone = false) {
  for (let round = 0; round < BOOT_ROUNDS; round++) {
    await Promise.all(
      sides.map(async s => {
        for (let i = 0; i < BOOT_TICKS; i++) {
          await Promise.all(tabsOf(s).map(p => quiet(p)));
          await runClock(s.context, BOOT_TICK_MS);
        }
        await Promise.all(tabsOf(s).map(p => quiet(p)));
      }),
    );
    const up = await Promise.all(sides.map(s => appUp(pageOf(s), phone)));
    if (up.every(Boolean)) {
      await Promise.all(sides.map(s => advance(s)));
      return;
    }
  }
  throw new Error('The app did not start: ' + sides.map(s => s.label + ' at ' + pageOf(s).url()).join(', '));
}

/* Open a tab of the session and start it loading. bootTogether brings it
   up. Demo Mode's first tab starts at the login page, as a teacher does. */
export async function startTab(s, path, viewport) {
  // A page opened later starts its clock from the log of every move so
  // far, which can land a few milliseconds off; this puts it at the time.
  if (s.pages.length) await s.context.clock.setSystemTime(s.context.__diffNow);
  const page = watch(await s.context.newPage(), s.given, () => 'tab ' + (s.pages.indexOf(page) + 1));
  if (viewport) await page.setViewportSize(viewport);
  page.on('pageerror', e => s.errors.push(String(e && e.message)));
  s.pages.push(page);
  // As the front page's Try Demo Mode link starts it (login-auth.js
  // markStudentDemo): the student page on, Return Grades When I Return
  // Them, Send Work and My Learning, so Draft and Returned are in play.
  if (s.mode === 'demo' && s.pages.length === 1) await page.goto('/login.html?demo=1&student=1');
  else await page.goto(path || '/dashboard');
  return page;
}

/* Reload a tab. bootTogether brings it up again. */
export async function reloadTab(s, page) {
  await s.context.clock.setSystemTime(s.context.__diffNow);
  await page.reload();
}
