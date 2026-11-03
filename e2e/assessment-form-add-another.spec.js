import { test, expect } from '@playwright/test';

/* Create and Add Another (redesign PR 11, 2026-11-02): saves, then a fresh
   form keeps Classes, Module, Scoring, Max Points, Factor and the dates; the
   title is empty and focused; the Category is not kept. Ctrl/⌘+Shift+Enter
   does the same. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('saves, then reopens keeping the shared settings', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Lab Quiz 1');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  const mod = await page.evaluate(() => {
    const o = document.querySelector('#af-module option:not([value=""])');
    return o ? o.value : '';
  });
  if (mod) await page.selectOption('#af-module', mod);
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.fill('#af-maxpoints', '20');
  await page.selectOption('#af-weight', '2');
  await page.fill('#af-date-assigned', '2026-11-03');
  await page.fill('#af-due', '2026-11-05');
  await page.locator('.af-code[data-tag="QP3"]').click();
  await page.locator('[data-action="saveAndAddAnother"]').click();

  const made = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Lab Quiz 1'));
  expect(made).toEqual(
    expect.objectContaining({ scoreMode: 'points', maxPoints: 20, weight: 2, dueDate: '2026-11-05' }),
  );

  await expect(page.locator('#af-title')).toBeFocused();
  await expect(page.locator('#af-title')).toHaveValue('');
  await expect(page.locator('.af-heading-title')).toHaveText('New Assessment');
  await expect(page.locator('#af-scoremode')).toHaveValue('points');
  await expect(page.locator('#af-maxpoints')).toHaveValue('20');
  await expect(page.locator('#af-weight')).toHaveValue('2');
  await expect(page.locator('#af-date-assigned')).toHaveValue('2026-11-03');
  await expect(page.locator('#af-due')).toHaveValue('2026-11-05');
  if (mod) await expect(page.locator('#af-module')).toHaveValue(mod);
  await expect(page.locator('#af-category')).toHaveValue('');
  expect(await page.locator('.af-tag-cb:checked').count()).toBe(0);
});

test('Ctrl/⌘+Shift+Enter creates and adds another', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Lab Quiz 2');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('#af-title').focus();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  await expect.poll(() => page.evaluate(() => getAssessments('sci8').some(a => a.title === 'Lab Quiz 2'))).toBe(true);
  await expect(page.locator('#af-title')).toBeFocused();
  await expect(page.locator('#af-title')).toHaveValue('');
});

test('editing has no Create and Add Another', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="cancelAssessForm"]').click();
  const aid = await page.evaluate(() => getAssessments('sci8')[0].id);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  await expect(page.locator('[data-action="saveAndAddAnother"]')).toHaveCount(0);
});
