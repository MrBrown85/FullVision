/**
 * The phone's sync dot: a phone has no hover, so a tap says what the dot's
 * colour means, under the dot, and a red dot also tries again at once.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test('a tap on the sync dot says its words; a red one also tries again', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  const btn = page.locator('#m-nav-bar-students-list .m-sync').first();
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);

  await btn.click();
  const tip = btn.locator('.m-sync-tip');
  await expect(tip).toHaveText('All changes saved');
  // On screen, inside the phone's width.
  const t = await tip.boundingBox();
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(375);
  await expect(tip).toHaveCount(0, { timeout: 6000 });

  // A red dot: its words, and data.js is asked to try again.
  await page.evaluate(() => {
    window.__retried = 0;
    window.retryFromSyncDot = () => window.__retried++;
    const dot = document.querySelector('#m-nav-bar-students-list #sync-indicator-dot');
    dot.className = 'tb-sync-dot error';
    dot.title = "Some changes couldn't be saved";
  });
  await btn.click();
  await expect(tip).toHaveText("Some changes couldn't be saved");
  expect(await page.evaluate(() => window.__retried)).toBe(1);
});
