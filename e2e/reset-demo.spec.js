/**
 * "Reset Demo" deletes every class and reseeds the demo class. It belongs to
 * Demo Mode only: a signed-in teacher must never see it, because clicking it
 * would delete all of their classes on the server.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, gotoApp } from './helpers.js';

async function openAdvanced(page) {
  await page.getByRole('button', { name: 'Advanced' }).click();
  const panel = page.locator('#tb-advanced-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test('a signed-in teacher has no Reset Demo in Advanced', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await gotoApp(page, '/assignments');
  const panel = await openAdvanced(page);
  await expect(panel.getByRole('button', { name: 'Delete Account' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reset Demo' })).toHaveCount(0);
  await expect(panel).not.toContainText('Reset to Demo Data');
});

test('Demo Mode keeps Reset Demo in Advanced', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/assignments'));
  const panel = await openAdvanced(page);
  await expect(panel.getByRole('button', { name: 'Reset Demo' })).toBeVisible();
});
