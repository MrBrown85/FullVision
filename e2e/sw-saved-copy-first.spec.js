/**
 * The service worker answers from its saved copy first, behind a guard
 * (sw.js, "The saved copy first"; docs/plans/caching-plan.md, option (a)).
 *
 * A file the install saved is answered without asking the network, but only
 * for a page that names the worker's own release. Pages always come from the
 * network first. A page from another release, a page with no release name
 * and a page the worker has lost track of get their files from the network,
 * as every page did before. No page may run one release's HTML beside
 * another's files.
 *
 * Each test runs its own server (e2e/sw-versions-server.mjs), so it starts
 * with no worker and counts every request that reaches the network. Every
 * release here stamps five scripts with its name, so a page can say which
 * release each of its files came from: a mix shows as two names.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, distSw, startServer } from './sw-versions-server.mjs';
import { fingerprintsIn, isPage, precacheUrls } from '../scripts/sw-fingerprints.mjs';
import { cacheName, releaseIn, releasePages } from '../scripts/sw-release-pages.mjs';

test.use({ viewport: { width: 1440, height: 900 } });

const RECORD = '/__sw-precache-fingerprints.json';
// Scripts each release stamps: one every page loads early, one the sign-in
// page loads, one desktop page script, one Reports loads on demand, and the
// phone app's shell.
const STAMPED = {
  constants: 'shared/constants.js',
  device: 'shared/device.js',
  gradebook: 'teacher/page-gradebook.js',
  reports: 'teacher/page-reports.js',
  shell: 'teacher-mobile/shell.js',
};
// A file no page loads until the teacher exports to Excel: failing it fails
// an install without breaking a page.
const EXCEL = 'vendor/exceljs.min.js';

const filesOf = name =>
  Object.fromEntries(
    Object.entries(STAMPED).map(([key, rel]) => [
      rel,
      readFileSync(join(DIST, rel), 'utf-8') + `\n;(window.__fvStamp = window.__fvStamp || {}).${key} = '${name}';\n`,
    ]),
  );
const sorted = list => [...list].sort();

// Read from dist/ once the test server has built it.
let URLS, FILES, ALWAYS;
let server;
test.beforeAll(() => {
  URLS = precacheUrls(distSw());
  // Every address with a fingerprint: the files the install saves.
  FILES = Object.keys(fingerprintsIn(distSw()));
  // What every update fetches whatever changed: the new sw.js and the pages.
  ALWAYS = ['/sw.js', ...URLS.filter(isPage)];
});
test.beforeEach(async ({ context }) => {
  server = await startServer();
  // Every content-policy refusal a page sees, kept across its loads.
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      const seen = JSON.parse(sessionStorage.getItem('__csp') || '[]');
      seen.push(e.violatedDirective + ' ' + e.blockedURI);
      sessionStorage.setItem('__csp', JSON.stringify(seen));
    });
  });
});
test.afterEach(async () => {
  await server.close();
});

function watch(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/* The requests since the last call that asked the network for a file the
   install saved. A repeat visit must have none. */
function filesAsked(log) {
  return log.filter(u => FILES.includes(u));
}

/* What the page is running: the release its HTML names and the release each
   stamped script it has loaded came from. */
async function running(page) {
  return page.evaluate(() => ({
    page: (document.querySelector('meta[name="fv-release"]') || {}).content || null,
    files: [...new Set(Object.values(window.__fvStamp || {}))],
    stamps: window.__fvStamp || {},
  }));
}

async function expectOneRelease(page, name, keys) {
  const now = await running(page);
  expect(now.page).toBe('fullvision-' + name);
  expect(now.files).toEqual([name]);
  if (keys) expect(sorted(Object.keys(now.stamps))).toEqual(sorted(keys));
}

async function cacheNames(page) {
  return page.evaluate(() => caches.keys());
}

async function cachedText(page, url) {
  return page.evaluate(async u => {
    const r = await caches.match(u);
    return r ? r.text() : null;
  }, url);
}

async function appDrawn(page) {
  await expect(page.locator('#app-loading')).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('#main')).not.toBeEmpty();
}

async function openReports(page) {
  await page.evaluate(r => window.Router.navigate(r), '/reports?course=sci8&tab=progress');
  await expect(page.locator('#studio')).toBeVisible();
}

// A first visit in Demo Mode, until the worker has installed and runs the page.
async function firstVisit(page, name) {
  await page.goto(server.origin + '/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await appDrawn(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  await expect.poll(() => cacheNames(page)).toEqual(['fullvision-' + name]);
}

/* Have the browser look for a new sw.js now, from a plain file so no app
   code runs meanwhile. Returns the new worker's final state, or 'no update'
   when the browser's own look after the page load had already finished. */
async function update(page) {
  await page.goto(server.origin + '/favicon.svg');
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const found = new Promise(r => reg.addEventListener('updatefound', () => r(reg.installing), { once: true }));
    const already = reg.installing;
    if (!already) await reg.update().catch(() => {});
    const worker = already || (await Promise.race([found, new Promise(r => setTimeout(() => r(null), 5000))]));
    if (!worker) return 'no update';
    await new Promise(r => {
      const done = () => (worker.state === 'activated' || worker.state === 'redundant') && r();
      worker.addEventListener('statechange', done);
      done();
    });
    return worker.state;
  });
}

/* Look for the new release and wait until its worker is in charge. */
async function installs(page, name) {
  await update(page);
  await expect.poll(() => cacheNames(page)).toEqual(['fullvision-' + name]);
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state))
    .toBe('activated');
}

/* Tell the page its tab was hidden or shown, as the browser would. */
async function setHidden(page, hidden) {
  await page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/* Stop the running worker, as the browser does to an idle one. It starts
   again on the next request, remembering no page. */
async function stopWorker(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
}

test('the build names one release in sw.js and in every page the worker saves', () => {
  const sw = distSw();
  const name = cacheName(sw);
  expect(name).toMatch(/^fullvision-\w+$/);
  expect(name).not.toBe('fullvision-dev');
  expect(releasePages(sw)).toEqual(['login.html', 'launch.html', 'teacher/app.html', 'teacher-mobile/index.html']);
  for (const rel of releasePages(sw)) expect(releaseIn(readFileSync(join(DIST, rel), 'utf-8')), rel).toBe(name);
  // The student page registers no worker and names no release.
  const student = readFileSync(join(DIST, 's/index.html'), 'utf-8');
  expect(releaseIn(student)).toBeNull();
  expect(student).not.toContain('serviceWorker');
  expect(student).not.toContain('auto-update.js');
});

test('a first visit installs everything; a repeat visit asks the network for the page and no file', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');
  // First visit: the page's files and the install both came from the network.
  const first = server.takeLog();
  expect(URLS.filter(u => !first.includes(u))).toEqual([]);
  await expectOneRelease(page, 'a', ['constants', 'gradebook']);

  // Repeat visits: the Dashboard, the Gradebook, then Reports on demand.
  await page.goto(server.origin + '/dashboard');
  await appDrawn(page);
  let log = server.takeLog();
  expect(filesAsked(log)).toEqual([]);
  expect(log.filter(u => u !== '/sw.js')).toEqual(['/dashboard']);
  await expectOneRelease(page, 'a', ['constants', 'gradebook']);

  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await openReports(page);
  log = server.takeLog();
  expect(filesAsked(log)).toEqual([]);
  expect(log.filter(u => u !== '/sw.js')).toEqual(['/gradebook?course=sci8']);
  await expectOneRelease(page, 'a', ['constants', 'gradebook', 'reports']);

  // A plain reload is a repeat visit too.
  await page.reload();
  await expect(page.locator('#studio')).toBeVisible();
  expect(filesAsked(server.takeLog())).toEqual([]);
  await expectOneRelease(page, 'a');

  // Nothing new was saved: one cache, holding the install's own copies.
  expect(await cacheNames(page)).toEqual(['fullvision-a']);
  expect(await cachedText(page, '/' + STAMPED.constants)).toBe(filesOf('a')[STAMPED.constants]);
  expect(errors).toEqual([]);
});

test('Demo Mode and the phone app open from the saved copy, with the sample class', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');
  server.takeLog();

  // Try Demo Mode again: the sign-in page, then the Dashboard.
  await page.goto(server.origin + '/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await appDrawn(page);
  expect(await page.evaluate(() => getAssessments('sci8').length > 0)).toBe(true);
  await expect(page.locator('body')).toContainText('Science 8');
  let log = server.takeLog();
  expect(filesAsked(log)).toEqual([]);
  expect(sorted(log.filter(u => u !== '/sw.js'))).toEqual(['/dashboard', '/login.html?demo=1']);
  await expectOneRelease(page, 'a');

  // The phone app, at a phone's size.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.origin + '/teacher-mobile/');
  await expect(page.locator('#m-loading')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('.m-tab-item[data-tab="students"]')).toBeVisible();
  await expect(page.locator('body')).toContainText('Science 8');
  log = server.takeLog();
  expect(filesAsked(log)).toEqual([]);
  expect(log.filter(u => u !== '/sw.js')).toEqual(['/teacher-mobile/']);
  await expectOneRelease(page, 'a', ['constants', 'shell']);
  expect(errors).toEqual([]);
});

test('the content policy is the one the site sends, and nothing is refused from the saved copy', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');

  // What the site sends a browser with no worker, its nonce aside.
  const plain = policy => policy.replace(/'nonce-[^']+'/g, "'nonce-…'");
  const direct = await fetch(server.origin + '/gradebook?course=sci8');
  const sitePolicy = direct.headers.get('content-security-policy');
  expect(sitePolicy).toContain("script-src 'self' 'nonce-");

  // A repeat visit: the page from the network, its files from the saved copy.
  server.takeLog();
  const response = await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  expect(filesAsked(server.takeLog())).toEqual([]);
  expect(response.fromServiceWorker()).toBe(true);
  const policy = response.headers()['content-security-policy'];
  expect(plain(policy)).toBe(plain(sitePolicy));
  expect(policy).not.toBe(sitePolicy);
  // Every script tag in the page carries the policy's nonce.
  const scriptTags = html => (html.match(/<script[\s>]/g) || []).length;
  const withNonce = (html, p) => html.split('<script nonce="' + p.match(/'nonce-([^']+)'/)[1] + '"').length - 1;
  const body = await response.text();
  expect(scriptTags(body)).toBeGreaterThan(50);
  expect(withNonce(body, policy)).toBe(scriptTags(body));
  await openReports(page);
  expect(await page.evaluate(() => sessionStorage.getItem('__csp'))).toBeNull();

  // Offline, the saved page comes with the policy it was saved with.
  await context.setOffline(true);
  const offline = await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  const saved = offline.headers()['content-security-policy'];
  expect(plain(saved)).toBe(plain(sitePolicy));
  const savedBody = await offline.text();
  expect(withNonce(savedBody, saved)).toBe(scriptTags(savedBody));
  expect(await page.evaluate(() => sessionStorage.getItem('__csp'))).toBeNull();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('offline, every page opens from the saved copy as one release', async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  const failed = [];
  page.on('response', r => r.status() >= 500 && failed.push(r.status() + ' ' + r.url()));
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');

  await context.setOffline(true);
  server.takeLog();
  await page.goto(server.origin + '/dashboard');
  await appDrawn(page);
  await expect(page.locator('body')).toContainText('Science 8');
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await openReports(page);
  await expectOneRelease(page, 'a', ['constants', 'gradebook', 'reports']);
  await page.goto(server.origin + '/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await appDrawn(page);
  await expectOneRelease(page, 'a');
  expect(server.takeLog()).toEqual([]);
  expect(failed).toEqual([]);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('a release while a tab is open: the tab stays on one release until the quiet reload brings the new one', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await expectOneRelease(page, 'a', ['constants', 'gradebook']);

  // The release. The open tab has not looked for it yet: Reports, opened
  // now, comes from the saved copy, the same release as the rest of the tab.
  server.release('b', filesOf('b'));
  server.takeLog();
  await openReports(page);
  expect(server.takeLog()).toEqual([]);
  await expectOneRelease(page, 'a', ['constants', 'gradebook', 'reports']);

  // The teacher leaves the tab and comes back: shared/auto-update.js looks
  // for a new version, the new worker installs and takes over, and the tab
  // reloads before it is touched.
  await setHidden(page, true);
  const reloaded = page.waitForEvent('framenavigated', { timeout: 30000 });
  await setHidden(page, false);
  await reloaded;
  await expect(page.locator('#studio')).toBeVisible();
  await expect.poll(() => cacheNames(page)).toEqual(['fullvision-b']);
  await expectOneRelease(page, 'b', ['constants', 'gradebook', 'reports']);

  // The network was asked for the new worker, the pages and the changed
  // files once each (the install), and for the reloaded page: no file twice,
  // so the reload took its files from the new saved copy.
  const log = server.takeLog();
  const changed = Object.values(STAMPED).map(rel => '/' + rel);
  expect(sorted(log)).toEqual(sorted([...ALWAYS, ...changed, '/reports?course=sci8&tab=progress']));
  expect(errors).toEqual([]);
});

test('a release before a fresh load: that load runs the new release from the network, the next from the saved copy', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');
  await page.goto(server.origin + '/favicon.svg');

  server.release('b', filesOf('b'));
  server.takeLog();
  // The page's own load is what tells the browser to look for a new sw.js.
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await openReports(page);
  await expectOneRelease(page, 'b', ['constants', 'gradebook', 'reports']);
  // Its files came from the network, as before this change.
  const log = server.takeLog();
  expect(log).toContain('/shared/calc.js');
  expect(log).toContain('/' + STAMPED.gradebook);

  // The new worker installed behind that load. The next load is a repeat visit.
  await expect.poll(() => cacheNames(page)).toEqual(['fullvision-b']);
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state))
    .toBe('activated');
  server.takeLog();
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  expect(filesAsked(server.takeLog())).toEqual([]);
  await expectOneRelease(page, 'b', ['constants', 'gradebook']);
  expect(errors).toEqual([]);
});

test('new HTML with an old worker: the files come from the network, never the old saved copy', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');
  // The tab is on release a, its files from the saved copy.
  server.takeLog();
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  expect(filesAsked(server.takeLog())).toEqual([]);
  await expectOneRelease(page, 'a', ['constants', 'gradebook']);

  // Release b, but this device cannot fetch the new sw.js: the old worker
  // stays in charge, holding release a's files.
  server.release('b', filesOf('b'));
  server.state.fail.add('/sw.js');
  server.takeLog();
  for (const visit of [1, 2]) {
    // The same tab reloads, then opens the address afresh.
    if (visit === 1) await page.reload();
    else await page.goto(server.origin + '/gradebook?course=sci8');
    await appDrawn(page);
    await openReports(page);
    await expectOneRelease(page, 'b', ['constants', 'gradebook', 'reports']);
    const log = server.takeLog();
    // Every stamped file, and an unchanged one, was asked of the network.
    for (const key of ['constants', 'gradebook', 'reports']) expect(log, visit).toContain('/' + STAMPED[key]);
    expect(log).toContain('/shared/calc.js');
  }
  // The old worker's cache is still exactly release a: nothing from b was
  // written over it, the page included.
  expect(await cacheNames(page)).toEqual(['fullvision-a']);
  for (const rel of Object.values(STAMPED)) expect(await cachedText(page, '/' + rel), rel).toBe(filesOf('a')[rel]);
  expect(releaseIn(await cachedText(page, '/teacher/app.html'))).toBe('fullvision-a');

  // With the network gone, the b page is refused a's copy of an installed
  // file: a missing file, not a mix.
  await context.setOffline(true);
  expect(await page.evaluate(() => fetch('/shared/calc.js').then(r => r.status))).toBe(503);
  // A fresh offline load is the saved page with its own files: all release a.
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await openReports(page);
  await expectOneRelease(page, 'a', ['constants', 'gradebook', 'reports']);
  expect(await page.evaluate(() => fetch('/shared/calc.js').then(r => r.status))).toBe(200);
  await context.setOffline(false);

  // Once sw.js can be fetched, the next look installs b.
  server.state.fail.clear();
  await installs(page, 'b');
  server.takeLog();
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  expect(filesAsked(server.takeLog())).toEqual([]);
  await expectOneRelease(page, 'b', ['constants', 'gradebook']);
  expect(errors).toEqual([]);
});

test('a failed install: no mix online, the old release offline, and the next try installs', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors = watch(page);
  const a = { ...filesOf('a'), [EXCEL]: readFileSync(join(DIST, EXCEL), 'utf-8') + '\n/* a */\n' };
  const b = { ...filesOf('b'), [EXCEL]: readFileSync(join(DIST, EXCEL), 'utf-8') + '\n/* b */\n' };
  server.release('a', a);
  await firstVisit(page, 'a');

  // Release b; one of its downloads fails, so the install fails.
  server.release('b', b);
  server.state.fail.add('/' + EXCEL);
  expect(await update(page)).toBe('redundant');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state)).toBe(
    'activated',
  );
  expect(await cachedText(page, '/' + STAMPED.constants)).toBe(a[STAMPED.constants]);

  // Online, the old worker sees a page from another release and sends its
  // files to the network: the tab runs b, whole.
  server.takeLog();
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await openReports(page);
  await expectOneRelease(page, 'b', ['constants', 'gradebook', 'reports']);
  expect(server.takeLog()).toContain('/shared/calc.js');

  // Offline, the old release still opens, whole.
  await context.setOffline(true);
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await openReports(page);
  await expectOneRelease(page, 'a', ['constants', 'gradebook', 'reports']);
  await context.setOffline(false);

  // The download works again: the next look installs b, and b is a repeat visit.
  server.state.fail.clear();
  await installs(page, 'b');
  expect(
    await page.evaluate(
      async ({ urls, record }) => {
        const cache = await caches.open('fullvision-b');
        const missing = [];
        for (const url of [...urls, record]) if (!(await cache.match(url))) missing.push(url);
        return missing;
      },
      { urls: URLS, record: RECORD },
    ),
  ).toEqual([]);
  server.takeLog();
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  await openReports(page);
  expect(filesAsked(server.takeLog())).toEqual([]);
  await expectOneRelease(page, 'b', ['constants', 'gradebook', 'reports']);
  expect(errors).toEqual([]);
});

test('a worker that has lost track of a page sends its files to the network', async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors = watch(page);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');
  await page.goto(server.origin + '/gradebook?course=sci8');
  await appDrawn(page);
  // Known: a file comes from the saved copy.
  server.takeLog();
  expect(await page.evaluate(() => fetch('/shared/calc.js').then(r => r.status))).toBe(200);
  expect(server.takeLog()).toEqual([]);

  // The browser stops the idle worker. Started again, it remembers no page.
  await stopWorker(context, page);
  expect(await page.evaluate(() => fetch('/shared/calc.js').then(r => r.status))).toBe(200);
  expect(server.takeLog()).toEqual(['/shared/calc.js']);
  await openReports(page);
  expect(server.takeLog()).toContain('/' + STAMPED.reports);
  // The network still serves release a, so the tab is still one release, and
  // the saved copy was not written over.
  await expectOneRelease(page, 'a', ['constants', 'gradebook', 'reports']);

  // Offline, a lost page still gets the saved copy, as it did before.
  await context.setOffline(true);
  await stopWorker(context, page);
  expect(await page.evaluate(() => fetch('/shared/data.js').then(r => r.status))).toBe(200);
  await context.setOffline(false);

  // The next load is known again.
  server.takeLog();
  await page.reload();
  await expect(page.locator('#studio')).toBeVisible();
  expect(filesAsked(server.takeLog())).toEqual([]);
  expect(errors).toEqual([]);
});

test('a page that names no release gets its files from the network: the student page', async ({ page }) => {
  test.setTimeout(90_000);
  server.release('a', filesOf('a'));
  await firstVisit(page, 'a');
  server.takeLog();
  // On a teacher's device the worker is there; the student page has no tag.
  await page.goto(server.origin + '/s/');
  await page.waitForLoadState('load');
  expect(await page.evaluate(() => document.querySelector('meta[name="fv-release"]'))).toBeNull();
  const log = server.takeLog();
  // Files the worker holds a saved copy of were still asked of the network.
  expect(log).toContain('/shared/html.js');
  expect(log).toContain('/shared/loading-screen.js');
  expect(log).toContain('/s/page-view.js');
});
