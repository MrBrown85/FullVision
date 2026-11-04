import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp } from './helpers.js';

// The gradebook toolbar is the same in both views and stays one row down to
// 1024px wide.
const positions = page =>
  page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('.gb-toolbar > *'), function (el) {
      var b = el.getBoundingClientRect();
      return Math.round(b.left) + ',' + Math.round(b.top) + ',' + Math.round(b.width);
    }),
  );

for (const width of [1440, 1024]) {
  test(`at ${width}px the toolbar is one row and does not move between views`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
    await gotoApp(page, '/gradebook');
    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    const scores = await positions(page);
    await expect(page.locator('[data-action="exportScoresCSV"]')).toBeVisible();
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('[data-action="exportScoresCSV"]')).toBeVisible();
    expect(await positions(page)).toEqual(scores);
    const tops = new Set(scores.map(p => p.split(',')[1]));
    expect(tops.size).toBe(1);
  });
}

test('the gradebook toolbar has no term picker: it always shows the year so far', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.goto('/gradebook?course=sci8');
  await expect(page.locator('[data-action="exportScoresCSV"]')).toBeVisible();
  await expect(page.locator('.gb-toolbar .term-select')).toHaveCount(0);
});
