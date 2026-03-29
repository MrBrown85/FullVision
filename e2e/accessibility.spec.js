import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp } from './helpers.js';

test.describe('Accessibility Basics', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
  });

  test('app has a skip-to-content link', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    // Skip-to-content link should exist (may be visually hidden)
    const skipLink = page.locator('a[href="#main"], a[href="#content"], a.skip-to-content, a.skip-link, [class*="skip"]');
    const count = await skipLink.count();
    expect(count).toBeGreaterThanOrEqual(1);
    // The #main landmark should exist
    const main = page.locator('#main');
    await expect(main).toBeVisible();
  });

  test('dock navigation has aria-label', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const dock = page.locator('nav[aria-label="Main navigation"]');
    await expect(dock).toBeVisible();
  });

  test('dock buttons have aria-labels or title attributes', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    // Toggle sidebar button should have aria-label
    const sidebarBtn = page.locator('[data-action="toggleSidebar"]');
    const ariaLabel = await sidebarBtn.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    // Account menu button should have aria-label
    const userBtn = page.locator('[data-action="toggleUserMenu"]');
    const userAriaLabel = await userBtn.getAttribute('aria-label');
    expect(userAriaLabel).toBeTruthy();
  });

  test('interactive score buttons are focusable', async ({ page }) => {
    await gotoApp(page, '/assignments');
    const assessEl = page.locator('text=Lab Report 1').first();
    await assessEl.click();
    await page.waitForTimeout(500);
    // Score level buttons should have tabindex="0" or be natively focusable
    const levelBtn = page.locator('[data-action="selectTagLevel"]').first();
    if (await levelBtn.isVisible()) {
      const tabIndex = await levelBtn.getAttribute('tabindex');
      const role = await levelBtn.getAttribute('role');
      // Should either have tabindex >= 0 or role="button"
      const isFocusable = (tabIndex !== null && parseInt(tabIndex) >= 0) || role === 'button';
      expect(isFocusable).toBeTruthy();
    }
  });

  test('sync indicator has aria-label for status', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    // Sync status indicator should have role and aria-label
    const syncStatus = page.locator('[role="status"][aria-label="Sync status"]');
    await expect(syncStatus).toBeVisible();
  });
});
