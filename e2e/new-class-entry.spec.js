import { test, expect } from '@playwright/test';

/* New Class is a button at the top of Class Settings' class list. The
   sidebar's class picker lists only classes: a New Class choice there was
   easy to pick by accident during the year (Colin, Nov 2026). Demo Mode. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

test('The class picker lists only classes, with no New Class choice', async ({ page }) => {
  await enterDemo(page);
  // Every page with a class picker: no choice in any picker opens New Class.
  let pickers = 0;
  for (const route of ['/dashboard', '/assignments', '/observations', '/gradebook', '/reports']) {
    await page.goto(route);
    await page.waitForTimeout(600);
    pickers += await page.locator('select:has(option[value="sci8"])').count();
    await expect(page.locator('select option', { hasText: 'New Class' })).toHaveCount(0);
  }
  expect(pickers).toBeGreaterThan(0);
});

test('Class Settings shows New Class as a button at the top of the class list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await page.locator('[data-action="openClassManager"]').first().click();
  const btn = page.locator('.cm-sidebar-header [data-action="cmStartCreate"]');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('New Class');
  const box = await btn.boundingBox();
  expect(box.y).toBeLessThan(200);
  expect(box.height).toBeGreaterThanOrEqual(28);
  await btn.click();
  await expect(page.locator('.cw-steps')).toBeVisible();
});
