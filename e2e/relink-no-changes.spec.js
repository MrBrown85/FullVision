import { test, expect } from '@playwright/test';

/* Re-link with nothing to change: Apply Changes is disabled and looks it. */

test('Re-link with no changes shows Apply Changes greyed out', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Competencies/ }).click();
  await page.locator('button', { hasText: 'Re-link Curriculum' }).first().click();
  await page.locator('[data-action="cmRelinkNext"]').click();
  await expect(page.locator('.cm-import-foot')).toContainText('No changes.');
  const apply = page.locator('[data-action="cmCompReviewApply"]');
  await expect(apply).toBeDisabled();
  expect(Number(await apply.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(0.6);
});
