/**
 * Try Demo Mode on the front page starts a sample class with the student
 * features on, and offers the Student Page tab in Class Settings. Demo Mode
 * entered any other way has no Student Page tab.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('Try Demo Mode on the front page shows the Student Page tab with Send Work on', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('link', { name: 'Try Demo Mode' }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.goto('/dashboard?manage=student-page');
  await expect(page.locator('#sp-send-switch')).toBeChecked({ timeout: 15000 });
  await expect(page.locator('#sp-build-switch')).toBeChecked();
  await expect(page.locator('#sp-reflect-switch')).toBeChecked();
  await expect(page.locator('#sp-learning-switch')).toBeChecked();
  // After a reload inside the session the tab is still offered.
  await page.reload();
  await expect(page.locator('#sp-send-switch')).toBeChecked({ timeout: 15000 });
});

test('Demo Mode from the sign-in address alone has no Student Page tab', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.goto('/dashboard?manage=student-page');
  await page.locator('.tb-demo-pill').waitFor();
  await expect(page.locator('#sp-send-switch')).toHaveCount(0);
  await expect(page.locator('#sp-build-switch')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveCount(0);
});
