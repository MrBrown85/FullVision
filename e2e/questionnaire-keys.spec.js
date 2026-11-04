import { test, expect } from '@playwright/test';

/* The Term Questionnaire's arrow keys (Nov 3 sweep, step 4 group 2 #53):
   in a menu they move between its items, and on a Work Habits rating
   between Rarely and Not Seen, one Tab stop per habit; neither opens
   another student. Demo Mode, Science 8, Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

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
const shown = page => page.locator('.qn').getAttribute('data-sid');

test('arrow keys move between ratings and pick one, without changing the student', async ({ page }) => {
  await open(page);
  const sid = await shown(page);
  const row = page.locator('.qn-habit-row[aria-label="Completes Work"]');
  // One Tab stop per habit.
  await expect(row.locator('.qn-radio[tabindex="0"]')).toHaveCount(1);
  await row.locator('.qn-radio[data-value="1"]').click();
  await expect(row.locator('.qn-radio[data-value="1"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(row.locator('.qn-radio[data-value="2"]')).toHaveAttribute('aria-checked', 'true');
  await expect(row.locator('.qn-radio[data-value="2"]')).toBeFocused();
  await expect(row.locator('.qn-radio[data-value="2"]')).toHaveAttribute('tabindex', '0');
  await expect(row.locator('.qn-radio[data-value="1"]')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowDown');
  await expect(row.locator('.qn-radio[data-value="3"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await expect(row.locator('.qn-radio[data-value="1"]')).toHaveAttribute('aria-checked', 'true');
  expect(await shown(page)).toBe(sid);
});

test('Down in the Other Wording menu moves to the next wording, not the next student', async ({ page }) => {
  await open(page);
  const sid = await shown(page);
  await page.locator('#tq-generate').click();
  const btn = page.locator('#tq-sentences [data-do="wording"]').first();
  await btn.click();
  const items = page.locator('#tq-wording-menu button');
  await expect(items.first()).toBeVisible();
  const first = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
  await page.keyboard.press('ArrowDown');
  const second = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
  expect(second).not.toBe(first);
  expect(await page.evaluate(() => !!document.activeElement.closest('#tq-wording-menu'))).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.textContent)).toBe(first);
  expect(await shown(page)).toBe(sid);
});
