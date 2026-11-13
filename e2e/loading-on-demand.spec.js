/**
 * Scripts a page loads only when it is opened (teacher/router.js _onDemand).
 *
 * Reports: its fourteen scripts (report-sheets.js to page-reports.js) are not
 * in teacher/app.html. The router fetches them the first time Reports is
 * opened, shows the loading screen meanwhile, runs them once in order, and
 * then draws the page. Every way in is covered: a click, a direct visit to
 * a tab's address, a reload, the Back button, Demo Mode, offline after a
 * first visit that never opened Reports (sw.js precaches the files), and a
 * file that cannot be fetched (a message with Try Again).
 *
 * Print, QR and the Rubric Bank (S19-C3): Assignments' rubric scripts
 * (rubric-library.js, rubric-bank.js) load before Assignments first draws.
 * grades-print.js loads when Print Grades is pressed, grading-setup-copy.js
 * when Copy Grading Setup or Copy From Another Class is, and the QR maker
 * (vendor/qrcode.js) when a sheet of slips or cards is printed. No other
 * page asks for them, and each works on a fresh load where it is used,
 * offline after a first visit, and after a file that could not be fetched.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp } from './helpers.js';

test.use({ viewport: { width: 1440, height: 900 } });

const REPORTS = [
  '/teacher/report-sheets.js',
  '/teacher/report-issues.js',
  '/teacher/report-questionnaire.js',
  '/teacher/grade-report.js',
  '/teacher/report-preview.js',
  '/shared/phone-report-view.js',
  '/teacher/phone-reports.js',
  '/teacher/report-feedback.js',
  '/teacher/report-feedback-cards.js',
  '/teacher/report-one.js',
  '/teacher/report-one-panel.js',
  '/teacher/report-one-page.js',
  '/teacher/report-one-comment.js',
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
    await page.route('**/teacher/report-one.js', route => (blocked ? route.abort() : route.continue()));
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Reports Could Not Open');
    await expect(alert).toContainText('Check your internet connection');
    // Nothing after the failed file ran.
    expect(await page.evaluate(() => [typeof window.ReportOne, typeof window.PageReports])).toEqual([
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

/* ── Print, QR and the Rubric Bank ───────────────────────────── */

const RUBRIC = ['/teacher/rubric-library.js', '/teacher/rubric-bank.js'];
const GRADES_PRINT = '/teacher/grades-print.js';
const SETUP_COPY = '/teacher/grading-setup-copy.js';
const QR = '/vendor/qrcode.js';
const PRINT_QR_RUBRIC = [...RUBRIC, GRADES_PRINT, SETUP_COPY, QR];
const printAsked = asked => asked.filter(p => PRINT_QR_RUBRIC.includes(p));

// Demo Mode with its sample class seeded.
async function demoClass(page) {
  await demo(page);
  await page.waitForFunction(
    () => typeof getStudents === 'function' && getStudents('sci8').length > 0 && getAssessments('sci8').length > 0,
    null,
    { timeout: 15000 },
  );
}

// A second class, so Copy Grading Setup has somewhere to copy to.
async function addSecondClass(page) {
  await page.evaluate(() => {
    COURSES.sci8b = Object.assign(structuredClone(COURSES.sci8), { id: 'sci8b', name: 'Science 8', block: 'B' });
    saveCourses(COURSES);
  });
}

// The print dialog held shut; counts what the sheet of slips or cards holds.
async function catchSheet(page) {
  await page.evaluate(() => {
    window.__sheet = null;
    window.print = () => {
      const root = document.getElementById('qr-slips-root');
      window.__sheet = {
        cells: root.querySelectorAll('.qs-slip').length,
        qrs: root.querySelectorAll('.qs-qr svg').length,
      };
    };
  });
}

async function expectRubricBank(page) {
  await page.locator('[data-action="openRubricBank"]').click();
  const bank = page.getByRole('dialog', { name: 'Rubric Bank' });
  await expect(bank).toBeVisible();
  await expect(bank.locator('.rb-row').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bank).toHaveCount(0);
}

async function expectPrintGrades(page) {
  await page.getByRole('button', { name: 'Print Grades' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print Grades' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

async function expectCopySetup(page, button) {
  await page.getByRole('button', { name: button }).click();
  const dialog = page.locator('.copy-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(button === 'Copy Grading Setup…' ? 'Copy grading setup' : 'Copy categories');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
}

async function expectSlips(page, students) {
  await catchSheet(page);
  await page.getByRole('button', { name: 'Print QR Slips' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__sheet)).toEqual({ cells: students, qrs: students });
}

test.describe('Print, QR and the Rubric Bank load where they are used', () => {
  test.use({ serviceWorkers: 'block' });

  test('no other page asks for them; Assignments asks for its rubric scripts once, in order', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = watchScripts(page);
    await demoClass(page);
    for (const route of [
      '/gradebook',
      '/observations',
      '/student?id=st1&course=sci8',
      '/reports',
      '/dashboard?manage=grading',
      '/dashboard?manage=questionnaires',
      '/dashboard',
    ]) {
      await page.evaluate(r => window.Router.navigate(r), route);
      await expect(page.locator('#main')).not.toBeEmpty();
    }
    await page.waitForLoadState('networkidle');
    expect(printAsked(asked)).toEqual([]);
    expect(
      await page.evaluate(() =>
        ['RubricLibrary', 'RubricBank', 'GradesPrint', 'GradingSetupCopy', 'qrcode'].map(g => typeof window[g]),
      ),
    ).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);

    // A click on the dock's Assignments tab.
    await page.locator('#dock-mount').getByRole('link', { name: 'Assignments' }).click();
    await expect(page).toHaveURL(/\/assignments/);
    await expect(page.locator('.assess-card').first()).toBeVisible();
    await expect(page).toHaveTitle('FullVision — Assignments');
    expect(printAsked(asked)).toEqual(RUBRIC);
    await expectRubricBank(page);

    // Away and Back: no file is asked for twice, and nothing else is asked for.
    await page.evaluate(r => window.Router.navigate(r), '/gradebook');
    await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/assignments/);
    await expectRubricBank(page);
    expect(printAsked(asked)).toEqual(RUBRIC);
    expect(errors).toEqual([]);
  });

  test("Assignments' own address, a reload and the Back button open the Rubric Bank", async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await demoClass(page);
    await page.goto('/assignments?course=sci8');
    await expect(page.locator('#app-loading')).toHaveCount(0);
    await expectRubricBank(page);
    await page.reload();
    await expectRubricBank(page);
    await page.goto('/gradebook?course=sci8');
    await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/assignments/);
    await expectRubricBank(page);
    expect(errors).toEqual([]);
  });

  test('Print Grades asks for its script when pressed, on a fresh load, a reload and after Back', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = watchScripts(page);
    await demoClass(page);
    await page.goto('/gradebook?course=sci8');
    await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(printAsked(asked)).toEqual([]);
    await expectPrintGrades(page);
    expect(printAsked(asked)).toEqual([GRADES_PRINT]);
    // Pressed again on the same load: not asked for again.
    await expectPrintGrades(page);
    expect(printAsked(asked)).toEqual([GRADES_PRINT]);

    await page.reload();
    await expectPrintGrades(page);
    await page.evaluate(r => window.Router.navigate(r), '/observations');
    await expect(page.locator('#main')).not.toBeEmpty();
    await page.goBack();
    await expect(page).toHaveURL(/\/gradebook/);
    await expectPrintGrades(page);
    expect(errors).toEqual([]);
  });

  test('Copy Grading Setup and Copy From Another Class ask for their script when pressed', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = watchScripts(page);
    await demoClass(page);
    await addSecondClass(page);
    // Class Settings' own address, Grading tab.
    await page.goto('/dashboard?manage=grading&class=sci8');
    await expect(page.getByRole('button', { name: 'Copy Grading Setup…' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(printAsked(asked)).toEqual([]);
    await expectCopySetup(page, 'Copy Grading Setup…');
    expect(printAsked(asked)).toEqual([SETUP_COPY]);
    await expectCopySetup(page, 'Copy From Another Class');

    // A reload, then Copy From Another Class first.
    await page.reload();
    await expectCopySetup(page, 'Copy From Another Class');
    expect(errors).toEqual([]);
  });

  test('a sheet of QR slips asks for the QR maker when printed, and every slip has its code', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = watchScripts(page);
    await demoClass(page);
    const students = await page.evaluate(() => getStudents('sci8').length);
    await page.goto('/dashboard?manage=questionnaires&class=sci8');
    await expect(page.getByRole('button', { name: 'Print QR Slips' }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(printAsked(asked)).toEqual([]);
    await expectSlips(page, students);
    expect(printAsked(asked)).toEqual([QR]);
    // Printed again: not asked for again.
    await expectSlips(page, students);
    expect(printAsked(asked)).toEqual([QR]);
    expect(errors).toEqual([]);
  });

  test('a file that cannot be fetched: a Could Not Open question, then Try Again works', async ({ page }) => {
    await demoClass(page);
    const blocked = new Set([GRADES_PRINT, QR, '/teacher/rubric-bank.js']);
    await page.route(
      url => blocked.has(url.pathname),
      route => (blocked.has(new URL(route.request().url()).pathname) ? route.abort() : route.continue()),
    );

    // Print Grades.
    await page.evaluate(r => window.Router.navigate(r), '/gradebook');
    await page.getByRole('button', { name: 'Print Grades' }).click();
    let ask = page.getByRole('dialog', { name: 'Print Grades Could Not Open' });
    await expect(ask).toContainText('Check your internet connection');
    expect(await page.evaluate(() => typeof window.GradesPrint)).toBe('undefined');
    blocked.delete(GRADES_PRINT);
    await ask.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByRole('dialog', { name: 'Print Grades' })).toBeVisible();
    await page.keyboard.press('Escape');

    // QR slips.
    const students = await page.evaluate(() => getStudents('sci8').length);
    await page.evaluate(r => window.Router.navigate(r), '/dashboard?manage=questionnaires');
    await catchSheet(page);
    await page.getByRole('button', { name: 'Print QR Slips' }).first().click();
    ask = page.getByRole('dialog', { name: 'QR Codes Could Not Open' });
    await expect(ask).toContainText('Check your internet connection');
    expect(await page.evaluate(() => window.__sheet)).toBe(null);
    blocked.delete(QR);
    await ask.getByRole('button', { name: 'Try Again' }).click();
    await expect.poll(() => page.evaluate(() => window.__sheet)).toEqual({ cells: students, qrs: students });

    // Assignments: the page's own Could Not Open, as Reports has.
    await page.evaluate(r => window.Router.navigate(r), '/assignments');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Assignments Could Not Open');
    expect(await page.evaluate(() => [typeof window.RubricLibrary, typeof window.RubricBank])).toEqual([
      'object',
      'undefined',
    ]);
    blocked.delete('/teacher/rubric-bank.js');
    await alert.getByRole('button', { name: 'Try Again' }).click();
    await expectRubricBank(page);
  });
});

test.describe('Print, QR and the Rubric Bank, signed in', () => {
  test.use({ serviceWorkers: 'block' });

  test('Assignments opens the Rubric Bank and the Gradebook prints, each on a fresh load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = watchScripts(page);
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        'gb-rubrics-sci8',
        JSON.stringify([
          {
            id: 'rubric-001',
            name: 'Lab Report Rubric',
            criteria: [
              { id: 'c1', name: 'Hypothesis', tagIds: ['QAP'], weight: 1, levels: { 4: '', 3: '', 2: '', 1: '' } },
            ],
          },
        ]),
      );
    });
    await gotoApp(page, '/gradebook');
    await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
    expect(printAsked(asked)).toEqual([]);
    await expectPrintGrades(page);
    await page.evaluate(r => window.Router.navigate(r), '/assignments');
    await expectRubricBank(page);
    expect(printAsked(asked)).toEqual([GRADES_PRINT, ...RUBRIC]);

    await gotoApp(page, '/assignments');
    await expectRubricBank(page);
    expect(errors).toEqual([]);
  });
});

test('offline after a first visit that never used them, print, QR and the Rubric Bank open from the cache', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const asked = watchScripts(page);
  await demoClass(page);
  await addSecondClass(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  expect(printAsked(asked)).toEqual([]);
  // Each file was cached at install, not by a page asking for it.
  const cached = await page.evaluate(async files => {
    const out = [];
    for (const f of files) if (await caches.match(f)) out.push(f);
    return out;
  }, PRINT_QR_RUBRIC);
  expect(cached).toEqual(PRINT_QR_RUBRIC);

  await context.setOffline(true);
  await page.evaluate(r => window.Router.navigate(r), '/assignments');
  await expectRubricBank(page);
  await page.evaluate(r => window.Router.navigate(r), '/gradebook');
  await expectPrintGrades(page);
  await page.evaluate(r => window.Router.navigate(r), '/dashboard?manage=grading');
  await expectCopySetup(page, 'Copy Grading Setup…');
  const students = await page.evaluate(() => getStudents('sci8').length);
  await page.evaluate(r => window.Router.navigate(r), '/dashboard?manage=questionnaires');
  await expectSlips(page, students);
  // A reload of Assignments itself, still offline.
  await page.goto('/assignments?course=sci8');
  await expectRubricBank(page);
  await context.setOffline(false);
});
