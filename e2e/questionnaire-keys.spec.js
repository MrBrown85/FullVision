import { test, expect } from '@playwright/test';

/* The Term Questionnaire's arrow keys (Nov 3 sweep, step 4 group 2 #53):
   in a menu they move between its items, and on a Work Habits slider
   between Rarely and Consistently, one Tab stop per habit; neither opens
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

test('a slider’s keys step, set and clear a rating, without changing the student', async ({ page }) => {
  await open(page);
  const sid = await shown(page);
  const slider = page.locator('.qn-hs[data-habit="ready"]');
  await expect(slider).toHaveAttribute('role', 'slider');
  await expect(slider).toHaveAttribute('tabindex', '0');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await page.keyboard.press('4');
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Consistently');
  await page.keyboard.press('Backspace');
  await expect(slider).not.toHaveAttribute('aria-valuenow', /./);
  await page.keyboard.press('3');
  await page.keyboard.press('Delete');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({});
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
