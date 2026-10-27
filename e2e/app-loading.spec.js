/**
 * Between signing in and the first page, app.html shows a loading screen
 * instead of a blank grey page. Boot removes it once the page is drawn.
 */
import { test, expect } from '@playwright/test';

test('the page starts on the loading screen', async ({ page }) => {
  const res = await page.request.get('/teacher/app.html');
  const html = await res.text();
  expect(html).toContain('id="app-loading"');
  expect(html).toContain('Loading your classes');
});

test('the loading screen goes once the dashboard is drawn', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Class Management' }).first()).toBeVisible();
});
