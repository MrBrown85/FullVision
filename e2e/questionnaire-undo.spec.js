import { test, expect } from '@playwright/test';

/* Undo toasts on the Term Questionnaire (Nov 3 sweep, step 4 group 2 #56
  ): Remove From Comment on a typed sentence. Demo Mode, Science 8, Report 2. */
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
const rows = page => page.locator('#tq-sentences .qn-req-row[data-row]');
const saved = page => page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative);

test('Remove From Comment on a typed sentence offers Undo, which puts it back in its place', async ({ page }) => {
  await open(page);
  const box = page.locator('#tq-narrative');
  await page.locator('#tq-generate').click();
  await box.evaluate(el => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  await page.keyboard.type(' Cece led her lab group well this term.');
  const typed = rows(page).filter({ hasText: 'led her lab group' });
  await expect(typed).toHaveCount(1);
  const with_ = await box.inputValue();
  await typed.locator('[data-do="options"]').click();
  await page.locator('#tq-options-menu [data-do="remove"]').click();
  await expect(box).not.toHaveValue(/led her lab group/);
  const toast = page.locator('#undo-toast');
  await expect(toast).toContainText('Removed from the comment.');
  await toast.locator('button', { hasText: 'Undo' }).click();
  await expect(box).toHaveValue(with_);
  await expect(rows(page).filter({ hasText: 'led her lab group' })).toHaveCount(1);
  await expect.poll(() => saved(page)).toBe(with_);
});
