/**
 * One build's browser session for a differential run: a fresh browser
 * context, the deterministic page set-up (page-init.js and Playwright's fake
 * clock, paused), and, signed in, e2e/helpers.js mockAuth (the fake
 * Supabase the browser specs use) with the run's classes seeded once.
 */
import { readFileSync } from 'node:fs';
import { mockAuth } from '../../e2e/helpers.js';
import { seedSignedIn, signedInClasses } from './fixtures.mjs';
import { runClock, settle } from './probe.mjs';

const INIT_SRC = readFileSync(new URL('./page-init.js', import.meta.url), 'utf-8');
// 2026-10-15 15:00 UTC, a school day.
export const BASE_TIME = Date.UTC(2026, 9, 15, 15, 0, 0);

export const VIEWPORT = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };

/* How far the clock moves after an action, in steps, with the pages left to
   finish their real work (scripts loading, other tabs' messages) before
   each: what the action set off at once, the short waits (debounces, the
   outbox's first retry), then the rest of a minute (the outbox's periodic
   send, the lease's heartbeat). */
export const STEP_CHUNKS = [0, 2500, 57500];

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
  // fails at once instead of waiting the default 30.
  context.setDefaultTimeout(5000);
  const s = { context, url, mode, pages: [], errors: [] };
  // Before the clock, so it keeps the real setTimeout.
  await context.addInitScript({
    content: INIT_SRC + '\ndifferentialPageInit(' + JSON.stringify({ seed }) + ');',
  });
  if (mode === 'signed-in') {
    // mockAuth registers its init script and routes on what it is given; a
    // context does both for every page, the second tab's too.
    await mockAuth(context);
    await context.addInitScript(seedSignedIn, signedInClasses());
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

/* Wait for the app to be up, moving the clock as it boots. */
export async function waitForApp(s, page) {
  for (let i = 0; i < 200; i++) {
    const up = await page
      .evaluate(() => {
        if (!document.querySelector('#dock-mount nav')) return false;
        const cid = typeof getActiveCourse === 'function' && getActiveCourse();
        return !!cid && typeof getAssessments === 'function' && getAssessments(cid).length > 0;
      })
      .catch(() => false);
    if (up) return advance(s);
    await settle(page);
    await runClock(s.context, 100);
  }
  throw new Error('The app did not start in ' + s.label + ' (' + page.url() + ')');
}

/* Open a tab of the session and wait for the app to be up. */
export async function openTab(s, path, viewport) {
  // A page opened later starts its clock from the log of every move so
  // far, which can land a few milliseconds off; this puts it at the time.
  if (s.pages.length) await s.context.clock.setSystemTime(s.context.__diffNow);
  const page = await s.context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  page.on('pageerror', e => s.errors.push(String(e && e.message)));
  s.pages.push(page);
  if (s.mode === 'demo' && s.pages.length === 1) {
    await page.goto('/login.html?demo=1');
    for (let i = 0; i < 100 && !/\/(dashboard|gradebook|assignments)/.test(page.url()); i++) {
      await runClock(s.context, 100);
      await page.waitForTimeout(10);
    }
    await page.waitForLoadState('domcontentloaded');
  } else {
    await page.goto(path || '/dashboard');
  }
  if (path && path.startsWith('/teacher-mobile')) {
    for (let i = 0; i < 200; i++) {
      const up = await page
        .evaluate(() => typeof Grader !== 'undefined' && typeof getActiveCourse === 'function' && !!getActiveCourse())
        .catch(() => false);
      if (up) break;
      await settle(page);
      await runClock(s.context, 100);
    }
    await advance(s);
  } else await waitForApp(s, page);
  return page;
}
