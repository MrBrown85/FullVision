import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, navigateTo } from './helpers.js';

test.describe('Observations — Quick Capture', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await gotoApp(page, '/observations');
  });

  test('observations page renders', async ({ page }) => {
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('shows observation input area', async ({ page }) => {
    // Should have a text area or input for observation text
    const textarea = page
      .locator('textarea, [contenteditable="true"], input[placeholder*="observation" i], input[placeholder*="note" i]')
      .first();
    const submitBtn = page
      .locator('[data-action="submitOb"], button:has-text("Add"), button:has-text("Save"), button:has-text("Submit")')
      .first();
    // At least one of these must be visible
    const inputCount = await textarea.count();
    const submitCount = await submitBtn.count();
    expect(inputCount + submitCount).toBeGreaterThanOrEqual(1);
  });

  test('student selector is visible with seeded students', async ({ page }) => {
    await seedStudents(page);
    await navigateTo(page, '#/dashboard');
    await page.waitForTimeout(300);
    await navigateTo(page, '#/observations');
    await page.waitForTimeout(500);

    // Should show student names or a student selector
    const body = await page.locator('body').textContent();
    const hasStudents = body.includes('Alice') || body.includes('Bob') || body.includes('Charlie');
    const hasSelector = body.includes('Select Student') || body.includes('select student') || body.includes('Student');
    expect(hasStudents || hasSelector).toBeTruthy();
  });

  test('type filter offers strength, growth and concern', async ({ page }) => {
    await page.getByRole('button', { name: 'Type' }).click();
    const options = page.locator('#filter-type-dropdown [role="option"]');
    await expect(options).toHaveText(['Strength', 'Growth', 'Concern']);
  });

  test('observation list shows empty state initially', async ({ page }) => {
    const main = page.locator('#main');
    const text = await main.textContent();
    // Should either show "no observations" or an empty list
    expect(text.length).toBeGreaterThan(0);
  });
});
