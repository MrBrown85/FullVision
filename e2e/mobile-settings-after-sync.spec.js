/**
 * The phone's Settings sheet (switch class, Customize Card, Sign Out) opens
 * after a sync. getLastSyncedAt() returns an ISO string, and the sheet used
 * to call .toISOString() on it, so the gear did nothing until a reload.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test('Settings opens after a sync and says when it last synced', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('#m-loading')).toBeHidden();

  // What a finished sync leaves behind (data.js stores an ISO string).
  await page.evaluate(() => {
    const at = new Date(Date.now() - 60000).toISOString();
    window.GB.getLastSyncedAt = () => at;
  });
  await page.locator('[data-action="m-settings"]').first().click();
  const sheet = page.locator('#m-sheet-container .m-sheet.m-sheet-visible');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Last synced');
  await expect(sheet).toContainText('Sign Out');
  expect(errors).toEqual([]);
});
