import { test, expect } from '@playwright/test';

/* An offline reload of Progress Reports in Demo Mode. The sample class
   lives in shared/seed-data.js, not in the device's saved classes, so an
   offline start needs the service worker to have that file. Before it did,
   the page came back with no class and threw from the grade math and the
   report header. */
test.use({ viewport: { width: 1440, height: 900 } });

test('Progress Reports reloads offline in Demo Mode with the sample class and no error', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // The service worker has installed (and cached the app) before the
  // network goes.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await page.evaluate(() => window.Router.navigate('/reports?tab=progress'));
  await page.locator('#rb-preview .report-sheet:not(.report-sheet-measure)').first().waitFor();
  expect(errors).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveURL(/\/reports\?course=sci8&tab=progress/);
  await page.locator('#rb-preview').waitFor();
  // Give the page and any late redraw their chance to throw.
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => !!COURSES.sci8)).toBe(true);
  await expect(page.locator('#rb-preview .report-sheet:not(.report-sheet-measure)').first()).toBeVisible();
  await expect(page.locator('#rb-preview')).toContainText('Science 8');
  await context.setOffline(false);
});
