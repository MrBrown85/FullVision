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

test('at full width the term picker shows the whole chosen term', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.goto('/gradebook?course=sci8');
  const picker = page.locator('.gb-toolbar .term-select');
  const count = await picker.locator('option').count();
  for (let i = 0; i < count; i++) {
    await picker.selectOption({ index: i });
    const [box, text] = await page.evaluate(() => {
      const s = document.querySelector('.gb-toolbar .term-select');
      const cs = getComputedStyle(s);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      return [s.clientWidth, ctx.measureText(s.options[s.selectedIndex].text).width + pad];
    });
    expect(box).toBeGreaterThanOrEqual(Math.floor(text));
  }
});
