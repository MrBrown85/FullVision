/**
 * The desktop app lives at real addresses (/dashboard, /gradebook?course=…)
 * instead of /teacher/app.html#/…. These check what that change could break:
 * old links, reloads, back and forward, and links switching pages without
 * reloading the app.
 */
import { test, expect } from '@playwright/test';

async function signInDemo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard$/, { timeout: 15000 });
  await page.waitForSelector('#dock-mount nav');
}

test('Demo Mode opens at /dashboard', async ({ page }) => {
  await signInDemo(page);
  expect(new URL(page.url()).pathname).toBe('/dashboard');
});

test('an old #/ link opens the same page at its clean address', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/teacher/app.html#/gradebook?course=sci8');
  await expect(page).toHaveURL(/\/gradebook\?course=sci8$/);
  await expect(page.locator('#dock-mount [aria-current="page"]')).toHaveText('Gradebook');
});

test('a reload keeps the page', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/reports');
  await page.reload();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.locator('#dock-mount [aria-current="page"]')).toHaveText('Reports');
});

test('dock links switch pages without reloading, and back/forward work', async ({ page }) => {
  await signInDemo(page);
  await page.evaluate(() => (window.__sameDocument = true));

  await page.locator('#dock-mount a[data-href="/gradebook"]').click();
  await expect(page).toHaveURL(/\/gradebook$/);
  await page.locator('#dock-mount a[data-href="/observations"]').click();
  await expect(page).toHaveURL(/\/observations$/);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\/gradebook$/);
  await expect(page.locator('#dock-mount [aria-current="page"]')).toHaveText('Gradebook');
  await page.goForward();
  await expect(page.locator('#dock-mount [aria-current="page"]')).toHaveText('Observations');
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test('the skip link does not redraw the page', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/gradebook');
  await page.waitForSelector('.gb-grid');
  await page.evaluate(() => (document.querySelector('.gb-grid').dataset.marker = 'kept'));
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/gradebook#main$/);
  await expect(page.locator('.gb-grid')).toHaveAttribute('data-marker', 'kept');
});

test('a trailing slash is tidied', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/gradebook/');
  await expect(page).toHaveURL(/\/gradebook$/);
});

test('an old Edit starters link opens My Sentence Starters with its own title', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/dashboard?manage=starters');
  await expect(page).toHaveURL(/\/observations\/starters$/);
  await expect(page).toHaveTitle('FullVision \u2014 My Sentence Starters');
});

test('a link with a broken %-code still opens the app', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/gradebook?course=sci8&x=%E0%A4%A');
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.locator('#dock-mount [aria-current="page"]')).toHaveText('Gradebook');
});
