import { test, expect } from '@playwright/test';

/* Nov 3 sweep (step 4 group 3 #44): Escape did nothing on Edit Assessment.
   It is now the form's Cancel: an unchanged form closes, a changed one asks
   first, and Escape on that question only closes the question. Demo Mode,
   Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openAssignments(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await expect(page.locator('.assess-card').first()).toBeVisible();
}
async function openEdit(page) {
  const aid = await page.evaluate(() => getAssessments('sci8')[0].id);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  return aid;
}

test('Escape closes an unchanged Edit Assessment and goes back to the card’s ⋯, which holds Edit', async ({ page }) => {
  await openAssignments(page);
  const aid = await openEdit(page);
  await page.locator('#af-title').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-assess-form')).toBeHidden();
  await expect(page.locator(`#ac-${aid} .assess-more-btn`)).toBeFocused();
});

test('Escape on a changed form asks first; Escape on the question keeps the form', async ({ page }) => {
  await openAssignments(page);
  const aid = await openEdit(page);
  const before = await page.inputValue('#af-title');
  await page.fill('#af-title', before + ' (revised)');
  await page.keyboard.press('Escape');
  await expect(page.locator('#af-dialog-title')).toHaveText('Discard Your Changes?');
  await page.keyboard.press('Escape');
  await expect(page.locator('#af-dialog-title')).toHaveCount(0);
  await expect(page.locator('#new-assess-form')).toBeVisible();
  await expect(page.locator('#af-title')).toHaveValue(before + ' (revised)');
  await page.locator('#af-title').focus();
  await page.keyboard.press('Escape');
  await page.locator('.af-dialog-card button', { hasText: 'Discard' }).click();
  await expect(page.locator('#new-assess-form')).toBeHidden();
  expect(await page.evaluate(id => getAssessments('sci8').find(a => a.id === id).title, aid)).toBe(before);
});

test('Escape closes an untouched New Assessment form', async ({ page }) => {
  await openAssignments(page);
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-assess-form')).toBeHidden();
});
