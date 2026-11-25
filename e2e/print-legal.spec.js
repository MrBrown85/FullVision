import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';

/* Printing on Legal paper (teacher/print-legal.js). A page can only
   suggest its paper: Chrome and Edge open their print box on Letter and
   shrink a Legal page onto it, and teachers thought the app was broken
   (Colin, 2026-11-25). On Legal, the Print box shows which setting to
   change in the browser's own print box, and Print reads Print on Legal;
   after the print, a bar asks whether the pages came out small, with the
   same picture and Use Letter Instead. Print Reports and Print Grades,
   Demo Mode's Science 8. */

test.setTimeout(120_000);
test.beforeEach(({ page }) => demoStudentPageOff(page));

/* window.print, counted, and afterprint as a browser fires it when its print box closes. */
async function stubPrint(page) {
  await page.addInitScript(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed++;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
}

async function openReports(page, paper) {
  await stubPrint(page);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  await page.evaluate(p => saveViewPref('gb-report-paper-sci8', p), paper);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio-fit')).not.toBeEmpty({ timeout: 30_000 });
}

/* The toolbar's Print Reports, then the box's Print; the drafts question, when it asks, prints without them. */
async function printReports(page) {
  await page.locator('#tb-print-btn').click();
  const box = page.locator('#issue-overlay');
  await expect(box).toBeVisible();
  return box;
}
async function pressPrint(page, box) {
  await box.locator('[data-issue="go"]').click();
  const without = page.getByRole('button', { name: 'Print Without Them' });
  await expect.poll(async () => (await page.evaluate(() => window.__printed)) || (await without.count())).toBeTruthy();
  if (await without.count()) await without.click();
  await expect.poll(() => page.evaluate(() => window.__printed)).toBe(1);
}

test('Print Reports on Legal: the step in the box, then “Did the pages come out small?”, then Use Letter Instead', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openReports(page, 'legal');
  const box = await printReports(page);
  await expect(box.locator('.pl-step')).toContainText('change it to Legal');
  await expect(box.locator('.pl-step .pl-text')).toHaveText(
    'In Chrome’s print box: More settings › Paper size › Legal.',
  );
  await expect(box.locator('[data-issue="go"]')).toHaveText('Print on Legal');

  await pressPrint(page, box);
  const bar = page.getByRole('region', { name: 'Printed on Legal' });
  await expect(bar).toContainText('Did the pages come out small?');
  await bar.getByRole('button', { name: 'Show Me How' }).click();
  await expect(bar.locator('.pl-step')).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Show Me How' })).toHaveAttribute('aria-expanded', 'true');

  // Use Letter Instead: the class on Letter, and the box again, with no step.
  await bar.getByRole('button', { name: 'Use Letter Instead' }).click();
  await expect(bar).toHaveCount(0);
  const again = page.locator('#issue-overlay');
  await expect(again).toBeVisible();
  await expect(again.locator('#issue-paper [data-paper="letter"]')).toHaveAttribute('aria-checked', 'true');
  await expect(again.locator('.pl-step')).toHaveCount(0);
  await expect(again.locator('[data-issue="go"]')).toHaveText('Print');
  expect(await page.evaluate(() => getViewPref('gb-report-paper-sci8'))).toBeNull();
  expect(errors).toEqual([]);
});

test('on Letter nothing asks; Don’t Ask Again quiets the bar on this computer', async ({ page }) => {
  await openReports(page, null);
  let box = await printReports(page);
  await expect(box.locator('.pl-step')).toHaveCount(0);
  await pressPrint(page, box);
  await expect(page.locator('#print-legal-bar')).toHaveCount(0);

  await page.locator('#report-paper [data-paper="legal"]').click();
  await page.evaluate(() => (window.__printed = 0));
  box = await printReports(page);
  await pressPrint(page, box);
  const bar = page.getByRole('region', { name: 'Printed on Legal' });
  await bar.getByRole('button', { name: 'Don’t Ask Again' }).click();
  await expect(bar).toHaveCount(0);

  await page.evaluate(() => (window.__printed = 0));
  box = await printReports(page);
  // The step stays in the box: it costs nothing there.
  await expect(box.locator('.pl-step')).toBeVisible();
  await pressPrint(page, box);
  await expect(page.locator('#print-legal-bar')).toHaveCount(0);
});

test('Print Grades on Legal: the step beside the picture, the question after, and back to Letter', async ({ page }) => {
  await stubPrint(page);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => saveViewPref('gb-report-paper-sci8', 'legal'));
  await page.evaluate(r => window.Router.navigate(r), '/gradebook');
  await expect(page.locator('.gb-toolbar [data-atb="more"]')).toBeVisible();
  await page.evaluate(() => Router.withScripts('gradesPrint', () => GradesPrint.open('sci8')));
  const dialog = page.getByRole('dialog', { name: 'Print Grades' });
  await expect(dialog.locator('.pl-step')).toBeVisible();
  await expect(dialog.locator('[data-gp="print"]')).toHaveText('Print on Legal');
  await dialog.locator('[data-gp="print"]').click();
  const bar = page.getByRole('region', { name: 'Printed on Legal' });
  await expect(bar).toContainText('Did the pages come out small?');
  await bar.getByRole('button', { name: 'Use Letter Instead' }).click();
  await expect(dialog.getByRole('button', { name: /^Paper / })).toHaveText('Letter · 8.5 × 11 in');
  await expect(dialog.locator('.pl-step')).toHaveCount(0);
  await expect(dialog.locator('[data-gp="print"]')).toHaveText('Print');
});
