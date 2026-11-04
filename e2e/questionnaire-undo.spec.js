import { test, expect } from '@playwright/test';

/* Undo toasts on the Term Questionnaire (Nov 3 sweep, step 4 group 2 #56
   and #57): Remove From Comment on a typed sentence, and Generate Comment
   replacing a draft. Demo Mode, Science 8, Report 2. */
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

test('Generate Comment again offers Undo, which brings the last version back', async ({ page }) => {
  await open(page);
  const box = page.locator('#tq-narrative');
  await page.locator('#tq-generate').click();
  const first = await box.inputValue();
  await page.locator('#tq-generate').click();
  const second = await box.inputValue();
  expect(second).not.toBe(first);
  const toast = page.locator('#undo-toast');
  await expect(toast).toContainText('Replaced with a new version.');
  await toast.locator('button', { hasText: 'Undo' }).click();
  await expect(box).toHaveValue(first);
  await expect.poll(() => saved(page)).toBe(first);
  // The rows follow the comment that came back.
  const shown = await rows(page).locator('.qn-req-text').allTextContents();
  for (const t of shown) expect(first).toContain(t.trim().slice(0, 20));
});

/* Step 4 group 3 #67: a bank sentence's row can be removed, and an edited
   one can go back to the bank's wording. */
test('Other Wording has Remove From Comment, and an edited sentence can go back to the bank wording', async ({
  page,
}) => {
  await open(page);
  const box = page.locator('#tq-narrative');
  await page.locator('#tq-generate').click();
  // Edit a bank sentence in the box.
  const last = rows(page)
    .filter({ has: page.locator('[data-do="wording"]') })
    .nth(1);
  const bankText = (await last.locator('.qn-req-text').textContent()).trim();
  await box.evaluate((el, t) => {
    const i = el.value.indexOf(t) + t.length - 1;
    el.focus();
    el.setSelectionRange(i, i);
  }, bankText);
  await page.keyboard.type(' today');
  const edited = rows(page).filter({ hasText: 'today.' });
  await expect(edited.locator('.qn-edited')).toHaveText('Edited');
  await edited.locator('[data-do="wording"]').click();
  const menu = page.locator('#tq-wording-menu');
  await menu.locator('.qn-menu-item', { hasText: 'The bank’s wording, before your edit' }).click();
  await expect(box).toHaveValue(new RegExp(bankText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(rows(page).filter({ hasText: 'today.' })).toHaveCount(0);
  // Remove From Comment on a bank sentence, then Undo.
  const before = await box.inputValue();
  const row = rows(page).filter({ hasText: bankText });
  await row.locator('[data-do="wording"]').click();
  await menu.locator('[data-do="remove"]').click();
  await expect(box).not.toHaveValue(new RegExp(bankText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await page.locator('#undo-toast button', { hasText: 'Undo' }).click();
  await expect(box).toHaveValue(before);
});
