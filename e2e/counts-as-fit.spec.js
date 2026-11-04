import { test, expect } from '@playwright/test';

/* Grading > Points and Proficiency: every Counts As value fits its box. */

test('Counts As values with a decimal are not clipped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Grading/ }).click();
  await page.locator('[data-action="cmPointsScaleBc"]').click();
  const boxes = page.locator('.cm-pts-pct');
  expect(await boxes.count()).toBeGreaterThan(5);
  const values = await boxes.evaluateAll(els => els.map(el => el.value));
  expect(values.some(v => v.includes('.'))).toBe(true);
  const clipped = await boxes.evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth).map(el => el.value));
  expect(clipped).toEqual([]);
});
