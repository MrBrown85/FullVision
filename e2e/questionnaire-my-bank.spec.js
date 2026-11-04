import { test, expect } from '@playwright/test';

/* + Add to My Bank on the Term Questionnaire (Nov 3 sweep, step 4).
   Demo Mode, Science 8, Report 2. */
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

test('Belongs Under starts on the part it was opened from, says why Grade is not offered, and the box wraps (group 2 #58)', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tq-generate').click();
  await page.locator('#tq-browse-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
  const box = sheet.locator('#tq-own');
  // From the Strengths tab: Strengths.
  await sheet.locator('[role="tab"]', { hasText: 'Strengths' }).click();
  await sheet.locator('.qn-browse-add-top').click();
  await expect(box.locator('#tq-own-part')).toHaveValue('strengths');
  await expect(box.locator('.qn-own-hint', { hasText: 'My Bank keeps no' })).toHaveCount(0);
  await box.locator('.qn-line-cancel').click();
  // From the Grade tab: Grade is not a part My Bank keeps, and it says so.
  await sheet.locator('[role="tab"]', { hasText: 'Grade' }).click();
  await sheet.locator('.qn-browse-add-top').click();
  await expect(box.locator('.qn-own-hint', { hasText: 'My Bank keeps no Grade sentences' })).toHaveCount(1);
  // The box is two lines and wraps a long sentence.
  const input = box.locator('#tq-own-input');
  await expect(input).toHaveJSProperty('tagName', 'TEXTAREA');
  await input.fill('Cece reads every lab question twice, plans each step on paper first and then checks her results with a partner.');
  expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await input.evaluate(el => el.clientHeight)).toBeGreaterThan(40);
});
