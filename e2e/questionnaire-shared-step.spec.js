import { test, expect } from '@playwright/test';

/* The Questionnaire's Closing row (Nov 2 mockup): the next step most of the
   class shares, with its count, while there's no closing sentence and while
   the teacher writes one. Demo Mode, Science 8, Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

test('the Closing row shows the class’s shared next step', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
    window.Router.navigate('/reports?tab=questionnaire&student=st1');
  });
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  const r = await page.evaluate(() =>
    CommentBank.sharedNextStep('sci8', { termId: ReportBlocks.getTermId(), students: getStudents('sci8') }),
  );
  const row = page.locator('#tq-row-closing');
  const line = row.locator('.qn-shared-step');
  await expect(line).toContainText('Shared next step:');
  await expect(line).toContainText(r.count + ' of ' + r.total + ' students');
  await row.locator('[data-do="editClosing"]').click();
  await expect(page.locator('#tq-row-closing .qn-line-input')).toBeVisible();
  await expect(page.locator('#tq-row-closing .qn-shared-step')).toContainText('Shared next step:');
});
