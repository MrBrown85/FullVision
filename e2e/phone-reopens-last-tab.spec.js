/**
 * The phone reopens on the tab the teacher last used on this device (speed
 * assessment P6): the first open is on Students; after Observe or Grade, a
 * reload opens there, with the tab bar showing it. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('#m-loading')).toBeHidden();
}

const openTab = page => page.locator('.m-tab-item.m-tab-active').getAttribute('data-tab');

test('opens on Students the first time, then where the teacher left', async ({ page }) => {
  await enterDemo(page);
  expect(await openTab(page)).toBe('students');
  await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();

  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await expect(page.locator('#m-obs-feed-content')).toBeVisible();
  await page.reload();
  await expect(page.locator('#m-loading')).toBeHidden();
  await expect(page.locator('#m-obs-feed-content')).toBeVisible();
  expect(await openTab(page)).toBe('observe');
  await expect(page.locator('.m-tab-item[data-tab="observe"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.m-tab-item[data-tab="students"]')).toHaveAttribute('aria-selected', 'false');

  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('[data-action="m-grade-assess"]').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('#m-loading')).toBeHidden();
  await expect(page.locator('[data-action="m-grade-assess"]').first()).toBeVisible();
  expect(await openTab(page)).toBe('grade');

  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.reload();
  await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();
  expect(await openTab(page)).toBe('students');
});
