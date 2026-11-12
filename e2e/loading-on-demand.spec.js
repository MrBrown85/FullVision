/**
 * Scripts a page loads only when it is opened (teacher/router.js _onDemand).
 *
 * Reports: its eleven scripts (report-sheets.js to page-reports.js) are not
 * in teacher/app.html. The router fetches them the first time Reports is
 * opened, shows the loading screen meanwhile, runs them once in order, and
 * then draws the page. Every way in is covered: a click, a direct visit to
 * a tab's address, a reload, the Back button, Demo Mode, offline after a
 * first visit that never opened Reports (sw.js precaches the files), and a
 * file that cannot be fetched (a message with Try Again).
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const REPORTS = [
  '/teacher/report-sheets.js',
  '/teacher/report-issues.js',
  '/teacher/report-questionnaire.js',
  '/teacher/report-studio.js',
  '/teacher/grade-report.js',
  '/teacher/report-preview.js',
  '/shared/phone-report-view.js',
  '/teacher/phone-reports.js',
  '/teacher/report-feedback.js',
  '/teacher/report-feedback-cards.js',
  '/teacher/page-reports.js',
];

// Every script the page asks for, by path, in the order asked.
function watchScripts(page) {
  const asked = [];
  page.on('request', r => {
    if (r.resourceType() === 'script') asked.push(new URL(r.url()).pathname);
  });
  return asked;
}
const reportsAsked = asked => asked.filter(p => REPORTS.includes(p));

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('#app-loading')).toHaveCount(0);
}

// The Term Questionnaire drawn: the student strip and the teacher comment.
async function expectQuestionnaire(page) {
  await expect(page.getByRole('tab', { name: 'Term Questionnaire' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tq-narrative')).toBeVisible();
}

test.describe('Reports loads its scripts when opened', () => {
  test.use({ serviceWorkers: 'block' });

  test('other pages never ask for them; Reports asks once, in order, and works', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = watchScripts(page);
    await demo(page);
    for (const route of ['/gradebook', '/assignments', '/observations', '/dashboard']) {
      await page.evaluate(r => window.Router.navigate(r), route);
      await expect(page.locator('#main')).not.toBeEmpty();
    }
    await page.waitForLoadState('networkidle');
    expect(reportsAsked(asked)).toEqual([]);
    expect(await page.evaluate(() => typeof window.PageReports)).toBe('undefined');

    // A click on the dock's Reports tab.
    await page.locator('#dock-mount').getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expectQuestionnaire(page);
    await expect(page).toHaveTitle('FullVision — Reports');
    expect(reportsAsked(asked)).toEqual(REPORTS);
    // They ran in order: each script is added once the one before has run.
    expect(
      await page.evaluate(
        files =>
          [...document.querySelectorAll('script[src]')]
            .map(s => new URL(s.src).pathname)
            .filter(p => files.includes(p)),
        REPORTS,
      ),
    ).toEqual(REPORTS);

    // Progress Reports and Page Studio, on the same load.
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('#studio')).toBeVisible();
    await expect(page.locator('.report-sheet').first()).toBeVisible();

    // Away and back, and the Back button: no file is asked for twice.
    await page.evaluate(r => window.Router.navigate(r), '/gradebook');
    await expect(page.locator('#main')).not.toBeEmpty();
    await page.goBack();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('#studio')).toBeVisible();
    expect(reportsAsked(asked)).toEqual(REPORTS);
    expect(errors).toEqual([]);
  });

  test("a tab's own address, a reload and the Back button open Reports", async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await demo(page);
    await page.goto('/reports?course=sci8&tab=progress');
    await expect(page.locator('#studio')).toBeVisible();
    await expect(page.locator('#app-loading')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('#studio')).toBeVisible();

    // A link from another page (the student's questionnaire button) and Back.
    await page.goto('/reports?course=sci8&tab=questionnaire&student=st2');
    await expectQuestionnaire(page);
    await page.goto('/gradebook?course=sci8');
    await expect(page.locator('#main')).not.toBeEmpty();
    await page.goBack();
    await expect(page).toHaveURL(/tab=questionnaire&student=st2/);
    await expectQuestionnaire(page);
    expect(errors).toEqual([]);
  });

  test('a file that cannot be fetched: a message, then Try Again opens Reports', async ({ page }) => {
    await demo(page);
    let blocked = true;
    await page.route('**/teacher/report-studio.js', route => (blocked ? route.abort() : route.continue()));
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Reports Could Not Open');
    await expect(alert).toContainText('Check your internet connection');
    // Nothing after the failed file ran.
    expect(await page.evaluate(() => [typeof window.ReportStudio, typeof window.PageReports])).toEqual([
      'undefined',
      'undefined',
    ]);
    blocked = false;
    await alert.getByRole('button', { name: 'Try Again' }).click();
    await expectQuestionnaire(page);
  });

  test('a page left while Reports loads stays the page shown', async ({ page }) => {
    await demo(page);
    let release;
    const held = new Promise(r => (release = r));
    await page.route('**/teacher/page-reports.js', async route => {
      await held;
      await route.continue();
    });
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    await expect(page.locator('#main .app-loading')).toBeVisible();
    await page.evaluate(r => window.Router.navigate(r), '/gradebook');
    release();
    await expect(page).toHaveURL(/\/gradebook/);
    await page.waitForFunction(() => typeof window.PageReports === 'object');
    await expect(page.locator('#main .app-loading')).toHaveCount(0);
    expect(await page.evaluate(() => window.Router.getCurrentPage() === window.PageGradebook)).toBe(true);
  });
});

test('offline after a first visit that never opened Reports, Reports opens from the cache', async ({
  page,
  context,
}) => {
  const asked = watchScripts(page);
  await demo(page);
  // The service worker has installed (its precache filled) and runs the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  expect(reportsAsked(asked)).toEqual([]);
  // Each file was cached at install, not by a page asking for it.
  const cached = await page.evaluate(async files => {
    const out = [];
    for (const f of files) if (await caches.match(f)) out.push(f);
    return out;
  }, REPORTS);
  expect(cached).toEqual(REPORTS);

  await context.setOffline(true);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=progress');
  await expect(page.locator('#studio')).toBeVisible();
  // And a reload of Reports itself, still offline.
  await page.reload();
  await expect(page.locator('#studio')).toBeVisible();
  await context.setOffline(false);
});
