import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp, TEST_STUDENTS } from './helpers.js';

test.describe('Responsive Layout', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
  });

  test('app renders without horizontal overflow at tablet size', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoApp(page, '/dashboard');
    // Check that body does not overflow horizontally
    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
    });
    expect(overflowX).toBeTruthy();
  });

  test('dock navigation is visible at tablet size', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoApp(page, '/dashboard');
    const dock = page.locator('#dock-mount nav');
    await expect(dock).toBeVisible();
  });

  test('gradebook page renders at tablet size', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoApp(page, '/gradebook');
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
    // Should still show student names
    const body = await page.locator('body').textContent();
    expect(body).toContain('Alice');
  });

  test('assignments page renders at mobile size', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoApp(page, '/assignments');
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
    // Assessment title should still be visible
    await expect(page.locator('body')).toContainText('Lab Report 1');
  });
});
