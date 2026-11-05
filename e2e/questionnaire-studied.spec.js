import { test, expect } from '@playwright/test';

/* The Studied row on the Sentences card (inputs plan, item 6): one line
   per class and report, above Support, set from any student's card and
   saved in the report config's commentSettings.studied[termId]. Not in
   Browse Sentences. Demo Mode, Science 8, Report 2. */
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
const saved = page =>
  page.evaluate(() => {
    const cs = (getReportConfig('sci8') || {}).commentSettings || {};
    return (cs.studied || {})[ReportBlocks.getTermId()] || null;
  });
const LINE = 'This report, we studied cells and ecosystems.';

test('Studied: Add One saves a line for the report, shown for every student', async ({ page }) => {
  await open(page);
  const row = page.locator('#tq-row-studied');
  await expect(row.locator('.qn-req-label')).toHaveText('Studied');
  await expect(row).toContainText('No studied line for this report.');
  await expect(row.locator('button')).toHaveText('Add One…');
  // Above Support.
  expect(
    await page.evaluate(() => {
      const s = document.getElementById('tq-row-studied');
      const sup = document.getElementById('tq-row-support');
      return !!(s && sup && s.compareDocumentPosition(sup) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);

  await row.locator('button', { hasText: 'Add One…' }).click();
  const input = page.locator('#tq-line-studied');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('placeholder', LINE);
  await expect(input).toHaveAttribute('maxlength', '90');
  await input.fill('This report, we studied forces and motion.');
  await page.keyboard.press('Enter');
  await expect(row.locator('.qn-req-text')).toHaveText('This report, we studied forces and motion.');
  await expect(row.locator('button')).toHaveText(['Edit', 'Remove']);
  expect(await saved(page)).toBe('This report, we studied forces and motion.');
  // Saved for this report only.
  expect(await page.evaluate(() => Object.keys(getReportConfig('sci8').commentSettings.studied))).toEqual([
    await page.evaluate(() => ReportBlocks.getTermId()),
  ]);

  // Edit: the box opens with the line; Cancel keeps it.
  await row.locator('button', { hasText: 'Edit' }).click();
  await expect(page.locator('#tq-line-studied')).toHaveValue('This report, we studied forces and motion.');
  await page.locator('#tq-line-studied').fill(LINE);
  await row.locator('button', { hasText: 'Save for Class' }).click();
  await expect(row.locator('.qn-req-text')).toHaveText(LINE);

  // Another student's card shows the same line.
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st2');
  await expect(page.locator('#tq-row-studied .qn-req-text')).toHaveText(LINE);

  // Remove: the row is empty again and the report has no line.
  await page.locator('#tq-row-studied button', { hasText: 'Remove' }).click();
  await expect(page.locator('#tq-row-studied')).toContainText('No studied line for this report.');
  expect(await saved(page)).toBe(null);
});

test('Studied: Escape closes the box, the row stays after Generate, not in Browse Sentences', async ({ page }) => {
  await open(page);
  await page.locator('#tq-row-studied button', { hasText: 'Add One…' }).click();
  await page.locator('#tq-line-studied').fill('Not saved');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tq-line-studied')).toHaveCount(0);
  await expect(page.locator('#tq-row-studied button')).toBeFocused();
  expect(await saved(page)).toBe(null);

  await page.locator('#tq-generate').click();
  await expect(page.locator('#tq-sentences [data-row]').first()).toBeVisible();
  await expect(page.locator('#tq-row-studied')).toContainText('No studied line for this report.');
  expect(
    await page.evaluate(() => {
      const s = document.getElementById('tq-row-studied');
      const sup = document.getElementById('tq-row-support');
      return !!(s && sup && s.compareDocumentPosition(sup) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);

  await page.locator('#tq-browse-btn').click();
  await expect(page.locator('.qn-browse-tab').first()).toBeVisible();
  await expect(page.locator('.qn-browse-tab', { hasText: 'Studied' })).toHaveCount(0);
});
