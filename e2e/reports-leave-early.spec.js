import { test, expect } from '@playwright/test';

/* Leaving Reports before the sentence bank (shared/comment-bank.js) has
   loaded. The bank arrives after the teacher is on another page; Reports
   must not try to redraw a page that is gone. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

test('leaving Reports before the sentence bank loads throws no error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Hold the bank's file until the test lets it go.
  let release;
  const held = new Promise(r => (release = r));
  let asked = false;
  await page.route('**/shared/comment-bank.js*', async route => {
    asked = true;
    await held;
    await route.continue();
  });

  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);

  await page.evaluate(() => window.Router.navigate('/reports?tab=questionnaire'));
  await expect(page.locator('#report-output')).toContainText('Loading the sentence bank');
  expect(asked).toBe(true);

  // Off to the dashboard while the bank is still on its way.
  await page.evaluate(() => window.Router.navigate('/dashboard'));
  await expect(page.locator('#report-output')).toHaveCount(0);

  release();
  await page.waitForFunction(() => typeof COMMENT_BANK !== 'undefined');
  // Give the late redraw its chance to run.
  await page.waitForTimeout(300);

  expect(errors).toEqual([]);
  await expect(page).toHaveURL(/\/dashboard/);
});

test('staying on Reports still draws the questionnaire once the bank loads', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  let release;
  const held = new Promise(r => (release = r));
  await page.route('**/shared/comment-bank.js*', async route => {
    await held;
    await route.continue();
  });

  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);

  await page.evaluate(() => window.Router.navigate('/reports?tab=questionnaire'));
  await expect(page.locator('#report-output')).toContainText('Loading the sentence bank');

  release();
  await page.locator('#tq-narrative').waitFor();
  expect(errors).toEqual([]);
});
