import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, gotoApp, navigateTo } from './helpers.js';

test.describe('Dashboard & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await gotoApp(page, '/dashboard');
  });

  test('app boots and renders dock navigation', async ({ page }) => {
    const dock = page.locator('#dock-mount nav');
    await expect(dock).toBeVisible();
    // All 5 dock tabs should be present
    await expect(page.locator('#dock-mount')).toContainText('Dashboard');
    await expect(page.locator('#dock-mount')).toContainText('Assignments');
    await expect(page.locator('#dock-mount')).toContainText('Gradebook');
    await expect(page.locator('#dock-mount')).toContainText('Observations');
    await expect(page.locator('#dock-mount')).toContainText('Reports');
  });

  test('dashboard page renders main content', async ({ page }) => {
    // Main area should have content
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('course name is visible in the UI', async ({ page }) => {
    // The course name "Science 8 — Test" should appear somewhere
    await expect(page.locator('body')).toContainText('Science 8');
  });

  test('navigate to Assignments via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Assignments")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/assignments');
  });

  test('navigate to Gradebook via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Gradebook")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/gradebook');
  });

  test('navigate to Observations via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Observations")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/observations');
  });

  test('navigate to Reports via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Reports")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/reports');
  });

  test('hash navigation updates page content', async ({ page }) => {
    await navigateTo(page, '#/assignments');
    // Should no longer show dashboard content
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('skip-to-content link exists', async ({ page }) => {
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toHaveAttribute('href', '#main');
  });

  test('user menu shows teacher name', async ({ page }) => {
    // The dock should show user info somewhere
    const dock = page.locator('#dock-mount');
    await expect(dock).toContainText('Test Teacher');
  });
});
