import { test, expect } from '@playwright/test';

/* Menus on the Sentences card stay inside the window (Nov 3 sweep, step 4
   group 3 #68): Other Wording and Support on a low row open upward or
   scroll inside a box that ends at the window's foot. Demo Mode,
   Science 8, Report 2, on a short window. */
test.use({ viewport: { width: 1440, height: 700 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
}
const inWindow = loc =>
  loc.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });

test('Other Wording and Support on low rows open inside the window', async ({ page }) => {
  await open(page);
  await page.locator('#tq-generate').click();
  const btns = page.locator('#tq-sentences [data-do="wording"]');
  const last = btns.last();
  // The row at the window's foot.
  await last.evaluate(el => el.scrollIntoView({ block: 'end' }));
  await last.click();
  const menu = page.locator('#tq-wording-menu');
  await expect(menu).toBeVisible();
  expect(await inWindow(menu)).toBe(true);
  await page.keyboard.press('Escape');
  const support = page.locator('#tq-row-support [data-do="supportMenu"]');
  await support.evaluate(el => el.scrollIntoView({ block: 'end' }));
  await support.click();
  const sm = page.locator('#tq-support-menu');
  await expect(sm).toBeVisible();
  expect(await inWindow(sm)).toBe(true);
});
