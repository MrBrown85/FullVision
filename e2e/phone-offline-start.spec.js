/**
 * The phone app opens offline after one visit online (sw.js).
 *
 * What a teacher saw: after opening the phone app once with signal, then
 * losing it, a reload (or the home-screen icon, which opens /launch.html and
 * goes on to /teacher-mobile/) showed the service worker's "Offline" page.
 * /login.html?demo=1 did the same. /teacher-mobile/index.html opened.
 *
 * The cause: the worker cached each page under the exact address it was
 * asked for. The precache holds /teacher-mobile/index.html and /login.html,
 * but the phone app is opened as /teacher-mobile/ and Demo Mode as
 * /login.html?demo=1, so offline those lookups missed. The first visit's
 * phone page is fetched before the worker controls the tab, so it was never
 * stored under its own address either.
 *
 * Every test visits once online, waits for the worker to control the page,
 * and goes offline with no extra online reload: a teacher who opens the
 * app once and then loses signal. The desktop app's clean routes are
 * checked too, as a guard: they already worked.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents } from './helpers.js';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

// Responses a page got that an offline start must never see: a 503 (the
// worker's answer when it has no copy) or the worker's "Offline" page.
function watchFailures(page) {
  const failed = [];
  page.on('response', r => {
    if (r.status() >= 500) failed.push(r.status() + ' ' + new URL(r.url()).pathname + new URL(r.url()).search);
  });
  return failed;
}

async function workerControls(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
}

async function expectPhoneClass(page, className) {
  await expect(page).toHaveURL(/\/teacher-mobile\//);
  await expect(page.locator('body')).not.toContainText('please check your connection');
  await expect(page.locator('#m-loading')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('.m-tab-item[data-tab="students"]')).toBeVisible();
  await expect(page.locator('body')).toContainText(className);
}

async function expectDesktopClass(page, path, className) {
  await expect(page).toHaveURL(path);
  await expect(page.locator('body')).not.toContainText('please check your connection');
  await expect(page.locator('#app-loading')).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('body')).toContainText(className);
}

test.describe('Phone app offline after one visit', () => {
  test.use({ viewport: PHONE });

  test('Demo Mode: reload, /teacher-mobile/, index.html and /login.html?demo=1 all open the class', async ({
    page,
    context,
  }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/teacher-mobile\//);
    await expectPhoneClass(page, 'Science 8');
    await workerControls(page);

    const failed = watchFailures(page);
    await context.setOffline(true);

    await page.reload();
    await expectPhoneClass(page, 'Science 8');

    await page.goto('/teacher-mobile/');
    await expectPhoneClass(page, 'Science 8');

    await page.goto('/teacher-mobile/index.html');
    await expectPhoneClass(page, 'Science 8');

    // Demo Mode's own address starts the sample class again, offline too.
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/teacher-mobile\//);
    await expectPhoneClass(page, 'Science 8');

    // The home-screen icon's start page goes on to the phone app.
    await page.goto('/launch.html');
    await page.waitForURL(/\/teacher-mobile\//);
    await expectPhoneClass(page, 'Science 8');

    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
    await context.setOffline(false);
  });

  test('signed in: reload, /teacher-mobile/ and index.html open the class', async ({ page, context }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.goto('/teacher-mobile/');
    await expectPhoneClass(page, 'Alice');
    await workerControls(page);

    const failed = watchFailures(page);
    await context.setOffline(true);

    await page.reload();
    await expectPhoneClass(page, 'Alice');

    await page.goto('/teacher-mobile/');
    await expectPhoneClass(page, 'Alice');

    await page.goto('/teacher-mobile/index.html');
    await expectPhoneClass(page, 'Alice');

    expect(failed).toEqual([]);
    await context.setOffline(false);
  });

  // Lead 3: the first visit's phone page is fetched before the worker
  // controls the tab, so the worker never saw it. A teacher who signs in
  // once on the phone and then loses signal must still get the app.
  test('the first visit alone is enough: the phone page was never fetched through the worker', async ({
    page,
    context,
  }) => {
    const viaWorker = [];
    page.on('response', r => {
      if (new URL(r.url()).pathname === '/teacher-mobile/' && r.fromServiceWorker()) viaWorker.push(r.url());
    });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/teacher-mobile\//);
    await expectPhoneClass(page, 'Science 8');
    await workerControls(page);
    // The worker took over after the page loaded: it holds the precached
    // /teacher-mobile/index.html and nothing under /teacher-mobile/.
    expect(viaWorker).toEqual([]);

    const failed = watchFailures(page);
    await context.setOffline(true);
    await page.reload();
    await expectPhoneClass(page, 'Science 8');
    expect(failed).toEqual([]);
    await context.setOffline(false);
  });

  // Lead 4: files the phone loads on demand, cached at install so they
  // work offline before they were ever asked for.
  test('the curriculum bank wording loads offline on the phone', async ({ page, context }) => {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/teacher-mobile\//);
    await expectPhoneClass(page, 'Science 8');
    await workerControls(page);
    await context.setOffline(true);
    await page.reload();
    await expectPhoneClass(page, 'Science 8');
    expect(await page.evaluate(() => CompetencyWording.loadBank())).toBe(true);
    await context.setOffline(false);
  });
});

test.describe('Desktop app offline after one visit (guard)', () => {
  test.use({ viewport: DESKTOP });

  test('Demo Mode: clean routes and /login.html?demo=1 open the class', async ({ page, context }) => {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/);
    await expectDesktopClass(page, /\/dashboard/, 'Science 8');
    await workerControls(page);

    const failed = watchFailures(page);
    await context.setOffline(true);

    await page.reload();
    await expectDesktopClass(page, /\/dashboard/, 'Science 8');

    for (const route of ['/gradebook?course=sci8', '/assignments?course=sci8', '/observations?course=sci8']) {
      await page.goto(route);
      await expectDesktopClass(page, new RegExp(route.split('?')[0]), 'Science 8');
    }

    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/);
    await expectDesktopClass(page, /\/dashboard/, 'Science 8');

    expect(failed).toEqual([]);
    await context.setOffline(false);
  });

  test('signed in: /dashboard and /gradebook reload offline', async ({ page, context }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.goto('/dashboard');
    await expectDesktopClass(page, /\/dashboard/, 'Science 8');
    await workerControls(page);

    const failed = watchFailures(page);
    await context.setOffline(true);
    await page.reload();
    await expectDesktopClass(page, /\/dashboard/, 'Science 8');
    await page.goto('/gradebook?course=sci8');
    await expectDesktopClass(page, /\/gradebook/, 'Science 8');
    expect(failed).toEqual([]);
    await context.setOffline(false);
  });

  // Lead 4 on the desktop: Generate's course-set wording, printed Tag
  // Rubrics' bank wording and the Excel export each load a file on demand.
  test('the bank files and the Excel library load offline before they were ever used', async ({ page, context }) => {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/);
    await expectDesktopClass(page, /\/dashboard/, 'Science 8');
    await workerControls(page);
    await context.setOffline(true);
    await page.reload();
    await expectDesktopClass(page, /\/dashboard/, 'Science 8');

    const loaded = await page.evaluate(async () => {
      function load(src, ready) {
        return new Promise(resolve => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = () => resolve(ready());
          s.onerror = () => resolve(false);
          document.head.appendChild(s);
        });
      }
      return {
        sets: await load('/shared/bank-sets.js', () => !!window.BANK_SETS),
        proficiency: await RubricPrint.loadBankLevels(),
        excel: await load('/vendor/exceljs.min.js', () => !!window.ExcelJS),
      };
    });
    expect(loaded).toEqual({ sets: true, proficiency: true, excel: true });
    await context.setOffline(false);
  });
});
