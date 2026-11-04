import { test, expect } from '@playwright/test';

/* New Class is easy to find: a button at the top of Class Management's class
   list, and the last choice in the sidebar's class picker. Demo Mode. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

test('The class picker offers New Class, which opens the wizard', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/assignments');
  const picker = page.locator('#gb-course-select');
  await expect(picker.locator('option').last()).toHaveText('New Class…');
  await picker.selectOption({ label: 'New Class…' });
  await expect(page).toHaveURL(/\/dashboard\?manage=new$/);
  await expect(page.locator('.cw-steps')).toBeVisible();
  expect(await page.evaluate(() => getActiveCourse())).toBe('sci8');
});

test('Class Management shows New Class as a button at the top of the class list', async ({ page }) => {
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
