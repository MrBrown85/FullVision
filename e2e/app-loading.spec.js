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
  expect(html).toContain('data-fv-loading="teacher"');
  expect(html).toContain('/shared/loading-screen.js');
});

test('the loading screen goes once the dashboard is drawn', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Class Settings' }).first()).toBeVisible();
});

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
