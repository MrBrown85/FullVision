import { expect } from '@playwright/test';
import { fakeStudentSubmit, sampleCard } from '../tests/helpers/fake-student-submit.js';
import { findLowContrastText } from './contrast-check.js';

/* What the browser tests of a real student card share
   (e2e/student-card-wired.spec.js, e2e/student-card-session.spec.js): the
   student-submit function answered in the test by its own handler and
   routes over a stand-in database (tests/helpers/fake-student-submit.js),
   and the checks every screen gets.

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
   request. `codes` ({ K7M4QX2P: 'P3R8WD' }) puts an eight-character card
   code to the stand-in database as one of its cards, which it knows by six
   characters as the database does today. Any request to anywhere but this
   site and the function is recorded in `elsewhere`. */
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
    const asked = opts.codes && has(opts.codes, body.code) ? { ...body, code: opts.codes[body.code] } : body;
    const { status, json } = (opts.answer && opts.answer(body)) || (await fn.respond(asked));
    return route.fulfill({
      status,
      headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify(json),
    });
  });
  return posts;
}

const has = (map, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
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

export async function signIn(page) {
  await page.goto('/s/#P3R-8WD');
  await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
  await page.getByLabel('Student Number').fill('0123456');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
}
