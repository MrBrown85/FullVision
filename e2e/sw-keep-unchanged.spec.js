/**
 * A release downloads only the files that changed (sw.js, precacheKeepingUnchanged).
 *
 * scripts/build.sh writes each precached file's fingerprint into dist/sw.js.
 * On install, the new worker copies a file from the previous version's cache
 * when the old version recorded the same fingerprint and the stored bytes
 * hash to it, and downloads the rest. HTML pages are always downloaded: the
 * edge function gives each response its own nonce, so they never match.
 *
 * Each test runs its own server (e2e/sw-versions-server.mjs) on its own port,
 * so it starts with no worker, and releases versions of the built dist/ by
 * changing sw.js's cache name and fingerprints and any changed files.
 * Requests are counted at that server.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, distSw, startServer } from './sw-versions-server.mjs';
import { isPage, precacheUrls } from '../scripts/sw-fingerprints.mjs';

test.use({ viewport: { width: 1440, height: 900 } });

// Read from dist/ once the test server has built it (listing the tests, as
// CI does to split them, happens before the build).
let URLS, ALWAYS;
const RECORD = '/__sw-precache-fingerprints.json';
const CHANGED = 'teacher/page-gradebook.js';
const changedBody = name => readFileSync(join(DIST, CHANGED), 'utf-8') + `\nwindow.__fvRelease = '${name}';\n`;
const sorted = list => [...list].sort();

let server;
test.beforeAll(() => {
  URLS = precacheUrls(distSw());
  // What every update fetches whatever changed: the new sw.js and the pages.
  ALWAYS = ['/sw.js', ...URLS.filter(isPage)];
});
test.beforeEach(async () => {
  server = await startServer();
});
test.afterEach(async () => {
  await server.close();
});

// The installed worker's state: cache names and whether the cache is complete.
async function cacheState(page) {
  return page.evaluate(
    async ({ urls, record }) => {
      const names = await caches.keys();
      const out = { names, complete: {}, missing: {} };
      for (const name of names) {
        const cache = await caches.open(name);
        out.complete[name] = !!(await cache.match(record));
        const missing = [];
        for (const url of urls) if (!(await cache.match(url))) missing.push(url);
        out.missing[name] = missing;
      }
      return out;
    },
    { urls: URLS, record: RECORD },
  );
}

// A first visit in Demo Mode, until the worker has installed and runs the page.
async function firstVisit(page, name) {
  await page.goto(server.origin + '/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  await expect.poll(async () => (await cacheState(page)).names).toEqual(['fullvision-' + name]);
}

/* Release version `name` and have the browser find it. The page first leaves
   the app for a plain file, so nothing but the worker asks the server for
   anything while the update runs (no app code, no quiet reload). Returns the
   new worker's final state and every request the update made. */
async function update(page, name, changed, options) {
  await page.goto(server.origin + '/favicon.svg');
  server.release(name, changed, options);
  await page.waitForTimeout(200);
  server.takeLog();
  const state = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const found = new Promise(r => reg.addEventListener('updatefound', () => r(reg.installing), { once: true }));
    await reg.update().catch(() => {});
    const worker = await Promise.race([found, new Promise(r => setTimeout(() => r(null), 15000))]);
    if (!worker) return 'no update';
    await new Promise(r => {
      const done = () => (worker.state === 'activated' || worker.state === 'redundant') && r();
      worker.addEventListener('statechange', done);
      done();
    });
    return worker.state;
  });
  return { state, asked: server.takeLog().filter(u => u !== '/favicon.ico') };
}

async function cachedText(page, url) {
  return page.evaluate(async u => {
    const r = await caches.match(u);
    return r ? r.text() : null;
  }, url);
}

test('a release with one changed file downloads only it, sw.js and the pages, and works offline', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // First-ever install: everything is downloaded.
  server.release('a');
  await firstVisit(page, 'a');
  const first = server.takeLog();
  expect(URLS.filter(u => !first.includes(u))).toEqual([]);
  expect((await cacheState(page)).complete).toEqual({ 'fullvision-a': true });

  // One file changes.
  const b = await update(page, 'b', { [CHANGED]: changedBody('b') });
  expect(b.state).toBe('activated');
  expect(sorted(b.asked)).toEqual(sorted([...ALWAYS, '/' + CHANGED]));
  let state = await cacheState(page);
  expect(state.names).toEqual(['fullvision-b']);
  expect(state.missing['fullvision-b']).toEqual([]);
  expect(state.complete['fullvision-b']).toBe(true);
  expect(await cachedText(page, '/' + CHANGED)).toBe(changedBody('b'));
  expect(await cachedText(page, '/shared/calc.js')).toBe(readFileSync(join(DIST, 'shared/calc.js'), 'utf-8'));
  expect(await cachedText(page, '/shared/seed-data.js?v=46')).toBe(
    readFileSync(join(DIST, 'shared/seed-data.js'), 'utf-8'),
  );

  // Nothing changes but the cache name: copies of copies are kept too.
  const c = await update(page, 'c', { [CHANGED]: changedBody('b') });
  expect(c.state).toBe('activated');
  expect(sorted(c.asked)).toEqual(sorted(ALWAYS));
  state = await cacheState(page);
  expect(state.names).toEqual(['fullvision-c']);
  expect(state.missing['fullvision-c']).toEqual([]);

  // Offline: Demo Mode, the Gradebook running the new file, and Reports
  // (its scripts load on demand and were never opened online).
  await context.setOffline(true);
  await page.goto(server.origin + '/dashboard');
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.locator('#main')).not.toBeEmpty();
  expect(await page.evaluate(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0)).toBe(
    true,
  );
  await page.goto(server.origin + '/gradebook?course=sci8');
  await expect(page.locator('#main')).not.toBeEmpty();
  expect(await page.evaluate(() => window.__fvRelease)).toBe('b');
  await page.evaluate(r => window.Router.navigate(r), '/reports?course=sci8&tab=progress');
  await expect(page.locator('#studio')).toBeVisible();
  await page.reload();
  await expect(page.locator('#studio')).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('a bad copy in the old cache is noticed and downloaded instead', async ({ page }) => {
  test.setTimeout(60_000);
  server.release('a');
  await firstVisit(page, 'a');
  await page.goto(server.origin + '/favicon.svg');

  // calc.js: a newer server answered with other bytes, and the running worker
  // stored that answer over its copy (as it does with every good response).
  // It is a real 200 for that address, so only its hash gives it away.
  server.state.files['/shared/calc.js'] = Buffer.from('/* not this release */');
  await page.evaluate(() => fetch('/shared/calc.js', { cache: 'reload' }));
  await expect.poll(() => cachedText(page, '/shared/calc.js')).toBe('/* not this release */');
  delete server.state.files['/shared/calc.js'];
  // constants.js: the right bytes, but not a response from the network.
  // offline-queue.js: removed from the old cache.
  await page.evaluate(async () => {
    const cache = await caches.open('fullvision-a');
    const right = await (await cache.match('/shared/constants.js')).arrayBuffer();
    await cache.put('/shared/constants.js', new Response(right, { headers: { 'Content-Type': 'text/javascript' } }));
    await cache.delete('/shared/offline-queue.js');
  });

  const b = await update(page, 'b', { [CHANGED]: changedBody('b') });
  expect(b.state).toBe('activated');
  expect(sorted(b.asked)).toEqual(
    sorted([...ALWAYS, '/' + CHANGED, '/shared/calc.js', '/shared/constants.js', '/shared/offline-queue.js']),
  );
  const state = await cacheState(page);
  expect(state.names).toEqual(['fullvision-b']);
  expect(state.missing['fullvision-b']).toEqual([]);
  for (const rel of ['shared/calc.js', 'shared/constants.js', 'shared/offline-queue.js']) {
    expect(await cachedText(page, '/' + rel)).toBe(readFileSync(join(DIST, rel), 'utf-8'));
  }
});

test('an install over a cache from a worker without fingerprints downloads everything once', async ({ page }) => {
  test.setTimeout(60_000);
  // The worker as it was before fingerprints: its cache has no record.
  server.release('old', {}, { fingerprints: false });
  await firstVisit(page, 'old');
  expect((await cacheState(page)).complete).toEqual({ 'fullvision-old': false });

  const b = await update(page, 'b', {});
  expect(b.state).toBe('activated');
  expect(sorted(b.asked)).toEqual(sorted(['/sw.js', ...URLS]));
  const state = await cacheState(page);
  expect(state.names).toEqual(['fullvision-b']);
  expect(state.missing['fullvision-b']).toEqual([]);
  expect(state.complete['fullvision-b']).toBe(true);
});

test('a failed download fails the install: the old version keeps its cache, and the next try works', async ({
  page,
}) => {
  test.setTimeout(60_000);
  server.release('a');
  await firstVisit(page, 'a');

  server.state.fail.add('/' + CHANGED);
  const failed = await update(page, 'b', { [CHANGED]: changedBody('b') });
  expect(failed.state).toBe('redundant');
  let state = await cacheState(page);
  expect(state.complete['fullvision-a']).toBe(true);
  expect(state.missing['fullvision-a']).toEqual([]);
  // The new cache, if left, is not marked complete, so no later install copies from it.
  expect(state.complete['fullvision-b'] || false).toBe(false);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state)).toBe(
    'activated',
  );

  server.state.fail.clear();
  const b = await update(page, 'b', { [CHANGED]: changedBody('b') });
  expect(b.state).toBe('activated');
  state = await cacheState(page);
  expect(state.names).toEqual(['fullvision-b']);
  expect(state.missing['fullvision-b']).toEqual([]);
  expect(await cachedText(page, '/' + CHANGED)).toBe(changedBody('b'));
});
