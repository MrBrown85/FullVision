import { test, expect } from '@playwright/test';

/* Attendance on the Term Questionnaire (Colin, 2026-10-24): the teacher
   copies the totals to date from MyEd at each report; the questionnaire
   shows the change since the last report and warns when a total goes
   down. Its sentences are in the Comment Bank (e2e/questionnaire.spec.js). */
test.use({ viewport: { width: 1440, height: 900 } });

async function openQuestionnaire(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-att-absences').waitFor();
}

async function pickReport(page, n) {
  await page.locator('#report-period').selectOption('Report ' + n);
  await page.locator('#tq-att-absences').waitFor();
}

async function enter(page, absences, lates) {
  await page.locator('#tq-att-absences').fill(String(absences));
  await page.locator('#tq-att-absences').press('Tab');
  await page.locator('#tq-att-lates').fill(String(lates));
  await page.locator('#tq-att-lates').press('Tab');
}

test('totals to date give this term without any math', async ({ page }) => {
  await openQuestionnaire(page);
  await pickReport(page, 1);
  await enter(page, 4, 3);
  await expect(page.locator('#tq-att-note')).toContainText('No earlier report has attendance');

  await pickReport(page, 2);
  await expect(page.locator('#tq-att-note')).toContainText('report had 4 absent, 3 late');
  await enter(page, 10, 5);
  await expect(page.locator('#tq-att-note')).toContainText('6 absent, 2 late');

  // Back to Report 2 after a reload: the totals stay.
  await page.reload();
  await pickReport(page, 2);
  await expect(page.locator('#tq-att-absences')).toHaveValue('10');
  await expect(page.locator('#tq-att-lates')).toHaveValue('5');

  // Lower than the last report: a warning, not a block.
  await page.locator('#tq-att-absences').fill('3');
  await page.locator('#tq-att-absences').press('Tab');
  await expect(page.locator('#tq-att-note')).toContainText('Lower than the 4 absences');
  await expect(page.locator('#tq-att-absences')).toHaveClass(/warn/);
});
