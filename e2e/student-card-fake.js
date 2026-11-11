import { expect } from '@playwright/test';
import { fakeStudentSubmit, sampleCard } from '../tests/helpers/fake-student-submit.js';
import { fakeTeacherCards } from '../tests/helpers/fake-teacher-cards.js';
import { findLowContrastText } from './contrast-check.js';

/* What the browser tests of a real student card share
   (e2e/student-card-wired.spec.js, e2e/student-card-session.spec.js): the
   student-submit function answered in the test by its own handler and
   routes over a stand-in database (tests/helpers/fake-student-submit.js),
   and the checks every screen gets.

   And the teacher's side (e2e/student-page-signed-in.spec.js,
   e2e/cm-student-cards.spec.js): the teacher-cards function answered by
   its own handler over a stand-in database
   (tests/helpers/fake-teacher-cards.js), with serveTeacherCards, and what
   a page holds anywhere it could keep a code (heldAnywhere).

   Set S0W1S_SHOTS to a folder to save a picture of each state, light and
   dark. */

export const TODAY = new Date().toISOString().slice(0, 10);
export const KEY = 'fv-s-session';
export const SHOTS = process.env.S0W1S_SHOTS || '';
export const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
export const CHROMEBOOK = { viewport: { width: 1366, height: 768 } };
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
export const SIGNED_OUT = 'You are signed out. Scan or type your card to open your page again.';

/* Answers the page's requests from `fn`. Returns the posts it saw. `fail`
   says which requests never arrive, `delay` holds a route's answers back
   ({ card: 600 }), and `answer` replaces the function's answer to one
   request. Any request to anywhere but this site and the function is
   recorded in `elsewhere`. */
export async function serve(page, fn, opts = {}) {
  const posts = [];
  posts.elsewhere = [];
  page.on('request', req => {
    const url = new URL(req.url());
    const own = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const fnCall = /\/functions\/v1\/student-submit$/.test(url.pathname);
    if (!own && !fnCall && url.protocol !== 'data:' && url.protocol !== 'about:') posts.elsewhere.push(req.url());
  });
  await page.route('**/functions/v1/student-submit**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    posts.push({ url: req.url(), body, headers: req.headers() });
    if (opts.delay && opts.delay[body.route]) await new Promise(r => setTimeout(r, opts.delay[body.route]));
    if (opts.fail && opts.fail(body)) return route.abort();
    // `answer` can stand in for the function on one request: { status, json }.
    const { status, json } = (opts.answer && opts.answer(body)) || (await fn.respond(body));
    return route.fulfill({
      status,
      headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify(json),
    });
  });
  return posts;
}

export const routes = posts => posts.map(p => p.body.route);
export const school = (card, more) => fakeStudentSubmit({ cards: [sampleCard(TODAY, card)], ...more });
export const row = (page, title) => page.locator('.sp-row', { hasText: title });
export const stored = page => page.evaluate(() => ({ local: { ...localStorage }, tab: { ...sessionStorage } }));

export async function fits(page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
}

/* Every control on the screen has a name a screen reader can say, and every
   message is announced. */
export async function named(page) {
  const nameless = await page.evaluate(() =>
    [...document.querySelectorAll('#app button, #app input, #app select, #app textarea, #app a[href]')]
      .filter(el => el.offsetParent !== null)
      .filter(el => {
        const label = el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].textContent) || '';
        const words = el.matches('button, a') ? el.textContent : '';
        return !(label + words).trim();
      })
      .map(el => el.outerHTML.slice(0, 120)),
  );
  expect(nameless).toEqual([]);
  const quiet = await page.evaluate(() =>
    [...document.querySelectorAll('#app .sp-msg')]
      .filter(el => !/^(alert|status)$/.test(el.getAttribute('role') || ''))
      .map(el => el.textContent),
  );
  expect(quiet).toEqual([]);
}

/* A picture of the screen as it is, in light and in dark. The student page
   has one look; the dark picture shows it stays readable when the device is
   set to dark. */
export async function shot(page, name) {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `${SHOTS}/s0w1s-${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/* Every word on the screen is readable (4.5 to 1), in light and in dark.
   One thing is left out, and it is not new here: the student page's blue
   button (white on #007aff, 4.02 to 1), which the questionnaire and report
   slips have had since they shipped. It is reported in this PR, not
   restyled by it. */
export async function contrast(page) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await findLowContrastText(page, { skip: ['.sp-btn-primary'] }), scheme).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/* The teacher-cards function, answered in the test by its real handler
   over a stand-in database. `fake` is fakeTeacherCards(...). Returns the
   posts it saw. `lose(post, n)` lets the n-th request reach the function
   and then loses its reply; `fail(post, n)` loses it before it arrives.
   The page's list_student_cards and mark_student_cards_printed can be
   answered from the same stand-in through window.__e2eCardList() and
   window.__e2eCardsPrinted(ids). */
export const TEACHER_CORS = {
  'access-control-allow-origin': 'http://localhost:8347',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-region',
  'access-control-allow-methods': 'POST, OPTIONS',
};
export async function serveTeacherCards(page, fake, opts = {}) {
  const posts = [];
  let n = 0;
  await page.exposeFunction('__e2eCardList', () => fake.cardsListed());
  await page.exposeFunction('__e2eCardsPrinted', ids => fake.markPrinted(ids));
  await page.route('**/functions/v1/teacher-cards**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: TEACHER_CORS });
    n += 1;
    const post = { url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || 'null') };
    posts.push(post);
    if (opts.fail && opts.fail(post, n)) return route.abort();
    const { status, json } = await fake.respond({
      url: post.url,
      method: req.method(),
      headers: post.headers,
      body: req.postData(),
    });
    if (opts.lose && opts.lose(post, n)) return route.abort();
    return route.fulfill({
      status,
      headers: { ...TEACHER_CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify(json),
    });
  });
  return posts;
}
export { fakeTeacherCards };

/* Everything the page keeps where a code could linger, as one string:
   localStorage (the outbox is there, fv-sync-queue-v1) but for the `skip`
   keys, the test's own stand-ins; sessionStorage; and every IndexedDB
   store. */
export function heldAnywhere(page, skip = []) {
  return page.evaluate(async skipped => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (skipped.indexOf(k) < 0) out.push(k + '=' + localStorage.getItem(k));
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      out.push(k + '=' + sessionStorage.getItem(k));
    }
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    for (const info of dbs) {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(info.name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise(resolve => {
          const r = db.transaction(store, 'readonly').objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve([]);
        });
        out.push(info.name + '/' + store + '=' + JSON.stringify(rows));
      }
      db.close();
    }
    return out.join('\n');
  }, skip);
}

/* Print with the dialog held shut: what is on the sheet each time it would
   be open, in window.__sheets. */
export function catchPrints(page) {
  return page.evaluate(() => {
    window.__sheets = [];
    window.print = () => {
      const root = document.getElementById('qr-slips-root');
      window.__sheets.push({
        pages: Array.from(root.querySelectorAll('.qs-page')).map(p => p.children.length),
        names: Array.from(root.querySelectorAll('.qs-name')).map(e => e.textContent),
        classes: Array.from(new Set(Array.from(root.querySelectorAll('.qs-class')).map(e => e.textContent))),
        numbers: Array.from(root.querySelectorAll('.qs-what .qs-dates')).map(e => e.textContent),
        codes: Array.from(root.querySelectorAll('.qs-type:not(.qs-pass) strong')).map(e => e.textContent),
        passwords: Array.from(root.querySelectorAll('.qs-pass strong')).map(e => e.textContent),
        qrs: root.querySelectorAll('.qs-qr svg').length,
        text: root.textContent,
      });
    };
  });
}
export const sheets = page => page.evaluate(() => window.__sheets || []);

export async function signIn(page) {
  await page.goto('/s/#P3R8-WDK4');
  await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
  await page.getByLabel('Student Number').fill('0123456');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('heading', { name: 'Assignments' })).toBeAttached();
  // Every piece in one list, as the tests of the list read it.
  await showAll(page);
}

/* All Assignments (the header's list button, S4-F1): every piece in one
   list, as the page drew it before To Do, Sent and Back. */
export async function showAll(page) {
  const b = page.getByRole('button', { name: 'All assignments' });
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await expect(page.getByRole('heading', { name: 'All Assignments' })).toBeVisible();
}
