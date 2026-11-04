/**
 * The grades beside the names follow the reporting term picked on the
 * Gradebook. Assignments has no term picker, so with Term 2 picked every
 * name there read IC with nothing to say why. The roster now names the term.
 * Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test('the roster says which term its grades cover on a page with no term picker', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.goto('/gradebook?course=sci8');
  const picker = page.locator('.gb-toolbar .term-select');
  await picker.selectOption({ index: 1 });
  const label = (await picker.locator('option:checked').textContent()).split(' · ')[0];

  await page.goto('/assignments?course=sci8');
  await expect(page.locator('#gb-roster-list .student-row').first()).toBeVisible();
  await expect(page.locator('.term-select')).toHaveCount(0);
  await expect(page.locator('#sb-term-note')).toHaveText('Grades for ' + label);
  await expect(page.locator('#sb-term-note')).toBeVisible();

  // The Gradebook has its own picker, so the roster doesn't repeat it.
  await page.goto('/gradebook?course=sci8');
  await expect(page.locator('#sb-term-note')).toBeHidden();

  // All Time says nothing extra.
  await page.goto('/gradebook?course=sci8');
  await page.locator('.gb-toolbar .term-select').selectOption('all');
  await page.goto('/assignments?course=sci8');
  await expect(page.locator('#gb-roster-list .student-row').first()).toBeVisible();
  await expect(page.locator('#sb-term-note')).toHaveCount(0);
});
