/**
 * Between signing in and the first page, app.html shows a loading screen
 * instead of a blank grey page. Boot removes it once the page is drawn.
 */
import { test, expect } from '@playwright/test';

test('the phone and the student page use the same loading screen', async ({ page }) => {
  const phone = await (await page.request.get('/teacher-mobile/index.html')).text();
  expect(phone).toContain('id="m-loading"');
  expect(phone).toContain('data-fv-loading="teacher"');
  expect(phone).toContain('../shared/loading-screen.js');
  const student = await (await page.request.get('/s/index.html')).text();
  expect(student).toContain('../shared/loading-screen.js');
  expect(student).toContain('../shared/loading-screen.css');
});

test('the phone loading screen goes once the class list is drawn', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login.html?demo=1');
  await page.goto('/teacher-mobile/');
  await expect(page.locator('#m-loading')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#m-loading .app-loading-logo')).toHaveCount(1);
});
