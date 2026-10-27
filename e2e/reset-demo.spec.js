/**
 * "Reset Demo Data" deletes every class and reseeds the demo class. It belongs
 * to Demo Mode only: a signed-in teacher must never see it, because clicking
 * it would delete all of their classes on the server.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, gotoApp } from './helpers.js';

async function openAccountMenu(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  const menu = page.locator('.tb-user-dropdown');
  await expect(menu).toBeVisible();
  return menu;
}

test('a signed-in teacher has no Reset Demo Data in the account menu', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await gotoApp(page, '/assignments');
  const menu = await openAccountMenu(page);
  await expect(menu.getByRole('button', { name: 'Sign Out' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Reset Demo Data' })).toHaveCount(0);
});

test('Demo Mode has Reset Demo Data in the account menu', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  const menu = await openAccountMenu(page);
  await expect(menu.getByRole('button', { name: 'Reset Demo Data' })).toBeVisible();
});
