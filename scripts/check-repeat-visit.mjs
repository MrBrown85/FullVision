// A read-only check of what a repeat visit asks the network for
// (docs/plans/caching-plan.md, option (a)).
//
//   node scripts/check-repeat-visit.mjs                    # https://fullvision.ca
//   node scripts/check-repeat-visit.mjs http://localhost:8347
//   node scripts/check-repeat-visit.mjs --expect-no-files
//
// It opens Demo Mode in a fresh headless Chrome, waits for the service worker
// to finish installing, then opens the Dashboard and the Gradebook again and
// prints, for each: the release the page names, how many files the page
// loaded, how many of them the worker sent on to the network, and the time
// until the loading screen was gone. With the saved copy first, a repeat
// visit sends the page itself to the network and no file.
//
// Safe to run any time: Demo Mode only, no sign-in, nothing typed or saved to
// the site. Exit code 0, unless --expect-no-files is passed and a repeat
// visit sent a file from this site to the network.
/* global document */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const expectNoFiles = args.includes('--expect-no-files');
const site = (args.find(a => /^https?:/.test(a)) || 'https://fullvision.ca').replace(/\/$/, '');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Requests the service worker itself sent to the network.
let sentOn = [];
context.on('request', request => {
  if (request.serviceWorker() && request.url().startsWith(site)) sentOn.push(request.url().slice(site.length));
});
// Requests the page made that no worker answered (there is none on a first visit).
let direct = [];
let loaded = 0;
page.on('response', response => {
  if (!response.url().startsWith(site)) return;
  loaded++;
  if (!response.fromServiceWorker()) direct.push(response.url().slice(site.length));
});

async function visit(label, path, ready) {
  sentOn = [];
  direct = [];
  loaded = 0;
  const started = Date.now();
  await page.goto(site + path);
  await ready();
  const usable = Date.now() - started;
  await page.waitForTimeout(1000);
  const release = await page.evaluate(
    () => (document.querySelector('meta[name="fv-release"]') || {}).content || 'none named',
  );
  const pagePath = new URL(page.url()).pathname;
  const isFile = u => u !== '/sw.js' && new URL(u, site).pathname !== pagePath && !u.startsWith('/login.html');
  const files = [...new Set([...sentOn, ...direct])].filter(isFile);
  console.log(
    `${label.padEnd(28)} release ${release}  loaded ${String(loaded).padStart(3)}  ` +
      `files sent to the network ${String(files.length).padStart(3)}  usable in ${usable} ms`,
  );
  return files;
}

const dashboardDrawn = async () => {
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('app-loading'), null, { timeout: 30000 });
};

console.log('A repeat visit on ' + site + ' (' + new Date().toISOString() + ')');
await visit('First visit (Demo Mode)', '/login.html?demo=1', dashboardDrawn);
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  }
});
const again = [
  ...(await visit('Repeat visit, Dashboard', '/dashboard', dashboardDrawn)),
  ...(await visit('Repeat visit, Gradebook', '/gradebook?course=sci8', async () => {
    await page.waitForFunction(() => !document.getElementById('app-loading'), null, { timeout: 30000 });
  })),
];
await browser.close();

if (again.length) {
  console.log('Verdict: a repeat visit sent ' + again.length + ' files to the network, among them:');
  for (const file of again.slice(0, 10)) console.log('  ' + file);
} else {
  console.log('Verdict: a repeat visit sent the page to the network and no file.');
}
process.exit(expectNoFiles && again.length ? 1 : 0);
