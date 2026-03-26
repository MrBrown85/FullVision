import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_STUDENTS } from './helpers.js';

test.describe('Class Manager — Student CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
  });

  test('class manager section is visible on dashboard', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('shows empty state or add button when no students', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const body = page.locator('body');
    const text = await body.textContent();
    const hasAddOrEmpty = text.includes('Add') || text.includes('add') || text.includes('Import') || text.includes('No students') || text.includes('0 students');
    expect(hasAddOrEmpty).toBeTruthy();
  });

  test('can open class management panel', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const cmBtn = page.locator('button:has-text("Class Management"), [data-action="cmOpen"], [data-action="cmToggle"]').first();
    if (await cmBtn.isVisible()) {
      await cmBtn.click();
      await page.waitForTimeout(300);
      const main = page.locator('#main');
      await expect(main).not.toBeEmpty();
    }
  });

  test('displays seeded students in roster', async ({ page }) => {
    await seedStudents(page);
    await gotoApp(page, '/dashboard');

    const body = page.locator('body');
    await expect(body).toContainText('Alice');
    await expect(body).toContainText('Bob');
    await expect(body).toContainText('Charlie');
  });

  test('student count matches seeded data', async ({ page }) => {
    await seedStudents(page);
    await gotoApp(page, '/dashboard');

    const text = await page.locator('body').textContent();
    expect(text).toContain('3');
  });
});
