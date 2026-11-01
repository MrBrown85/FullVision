import { test, expect } from '@playwright/test';

/* Attendance on the Term Questionnaire: the teacher types the totals to
   date at each report; the card says "Added to the comment." once a total
   is entered (the States mockup) and warns when a total goes down.
   Generate Comment uses the totals once entered. */
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
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');

  await pickReport(page, 2);
  await expect(page.locator('#tq-att-note')).toHaveText('Optional. Left out until entered.');
  await enter(page, 10, 5);
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');

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

test('Generate Comment uses the attendance totals once they are entered', async ({ page }) => {
  await openQuestionnaire(page);
  await pickReport(page, 1);
  await expect(page.locator('#tq-att-note')).toHaveText('Optional. Left out until entered.');
  await enter(page, 4, 2);
  await page.locator('#tq-generate').click();
  // One attendance sentence (plan, Sentence grammar): numbers in words.
  await expect(page.locator('#tq-narrative')).toHaveValue(/missed four classes and been late twice this term\./);
  // Its row: Attendance, tinted, "From Attendance above · new" (the States mockup).
  const row = page.locator('#tq-sentences .qn-srow', { has: page.locator('.qn-req-label:text-is("Attendance")') });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/\battendance\b/);
  await expect(row.locator('.qn-req-text')).toHaveText(/missed four classes and been late twice this term\./);
  await expect(row.locator('.qn-req-source')).toHaveText('From Attendance above · new');
});
