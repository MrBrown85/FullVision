import { test, expect } from '@playwright/test';
import {
  mockPersistentAuthFlow,
  SMOKE_WELCOME_COURSE,
  SMOKE_WELCOME_STUDENTS,
  SMOKE_WELCOME_ASSESSMENT,
} from './helpers.js';

test.describe('Regression smoke (P1.2)', () => {
  test.beforeEach(async ({ page }) => {
    await mockPersistentAuthFlow(page);
  });

  test('sign-up -> sign-in -> class -> enter score -> sign-out -> sign-in -> score survives', async ({ page }) => {
    const email = `smoke-${Date.now()}@example.com`;
    const password = 'test1234!';
    const teacherName = 'Smoke Tester';
    const firstStudentId = SMOKE_WELCOME_STUDENTS[0].id;
    const assessmentId = SMOKE_WELCOME_ASSESSMENT.id;
    const tagId = SMOKE_WELCOME_ASSESSMENT.tagIds[0];
    let writtenValue = '';
    const scoreCell = page.locator(
      `td.gb-score[data-sid="${firstStudentId}"][data-aid="${assessmentId}"][data-tid="${tagId}"]`,
    );

    await page.goto('/login.html');

    await page.locator('#tab-signup').click();
    await page.locator('#su-name').fill(teacherName);
    await page.locator('#su-email').fill(email);
    await page.locator('#su-password').fill(password);
    await page.locator('#su-confirm').fill(password);
    await page.locator('#form-signup button[type="submit"]').click();

    await expect(page.locator('#auth-success')).toContainText('Check your email for a confirmation link.');

    await page.locator('#tab-signin').click();
    await page.locator('#si-email').fill(email);
    await page.locator('#si-password').fill(password);
    await page.locator('#form-signin button[type="submit"]').click();

    await page.waitForURL(/\/dashboard/);
    await page.evaluate(courseId => {
      window.Router.navigate('/gradebook?course=' + courseId);
    }, SMOKE_WELCOME_COURSE.id);
    await expect(page.getByRole('combobox', { name: 'Select course' })).toHaveValue(SMOKE_WELCOME_COURSE.id);
    // The gradebook opens on Scores (#305); the per-competency cells are in Competencies.
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(scoreCell).toBeVisible();

    await scoreCell.click();
    writtenValue = ((await scoreCell.locator('.gb-score-val').textContent()) || '').trim();
    expect(writtenValue).not.toBe('');
    expect(writtenValue).not.toBe('·');
    expect(writtenValue).not.toBe('—');

    await page.locator('[data-action="toggleUserMenu"]').click();
    await page.locator('[data-action="signOut"]').click();
    await page.waitForURL(/\/login(?:\.html)?/);
    await page.goto('/login.html');

    await page.locator('#si-email').fill(email);
    await page.locator('#si-password').fill(password);
    await page.locator('#form-signin button[type="submit"]').click();

    await page.waitForURL(/\/dashboard/);
    await page.evaluate(courseId => {
      window.Router.navigate('/gradebook?course=' + courseId);
    }, SMOKE_WELCOME_COURSE.id);
    await expect(page.locator('body')).toContainText(SMOKE_WELCOME_STUDENTS[0].firstName);
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(scoreCell.locator('.gb-score-val')).toHaveText(writtenValue);
  });
});
