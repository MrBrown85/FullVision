import { test, expect } from '@playwright/test';

/* The Students roster is wider than a 1440 px window. The scrolling must be
   plain to see: a line says so, and the right edge fades until the last
   column is in view. */

test('At 1440 px the roster says to scroll sideways and fades its right edge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Students/ }).click();
  const section = page.locator('.cm-rs-section');
  await expect(page.locator('#cm-rs-more')).toBeVisible();
  await expect(page.locator('#cm-rs-more')).toHaveText('Scroll sideways for more columns.');
  await expect(section).toHaveClass(/cm-rs-more-right/);
  await page.locator('.cm-rs-scroll').evaluate(el => (el.scrollLeft = el.scrollWidth));
  await expect(section).not.toHaveClass(/cm-rs-more-right/);
});

test('A window wide enough for every column shows no cue', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Students/ }).click();
  await expect(page.locator('.cm-rs-row').first()).toBeVisible();
  await expect(page.locator('#cm-rs-more')).toBeHidden();
  await expect(page.locator('.cm-rs-section')).not.toHaveClass(/cm-rs-more-right/);
});
