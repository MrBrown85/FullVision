import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session so login page renders
    await page.goto('/login.html');
  });

  test('renders sign-in form by default', async ({ page }) => {
    await expect(page.locator('#form-signin')).toBeVisible();
    await expect(page.locator('#form-signup')).toBeHidden();
    await expect(page.locator('.auth-title')).toHaveText('FullVision');
    await expect(page.locator('.auth-subtitle')).toHaveText('Learning Profile Builder and Communicator');
  });

  test('sign-in form has email and password fields', async ({ page }) => {
    const email = page.locator('#si-email');
    const password = page.locator('#si-password');
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(email).toHaveAttribute('type', 'email');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(email).toHaveAttribute('required', '');
    await expect(password).toHaveAttribute('required', '');
  });

  test('can switch to sign-up tab', async ({ page }) => {
    await page.locator('#tab-signup').click();
    await expect(page.locator('#form-signup')).toBeVisible();
    await expect(page.locator('#form-signin')).toBeHidden();
    // Sign-up has 4 fields: name, email, password, confirm
    await expect(page.locator('#su-name')).toBeVisible();
    await expect(page.locator('#su-email')).toBeVisible();
    await expect(page.locator('#su-password')).toBeVisible();
    await expect(page.locator('#su-confirm')).toBeVisible();
  });

  test('can switch back to sign-in tab', async ({ page }) => {
    await page.locator('#tab-signup').click();
    await page.locator('#tab-signin').click();
    await expect(page.locator('#form-signin')).toBeVisible();
    await expect(page.locator('#form-signup')).toBeHidden();
  });

  test('sign-up form enforces min password length', async ({ page }) => {
    await page.locator('#tab-signup').click();
    const pw = page.locator('#su-password');
    await expect(pw).toHaveAttribute('minlength', '6');
  });

  test('tabs have correct ARIA roles', async ({ page }) => {
    const tablist = page.locator('[role="tablist"]');
    await expect(tablist).toBeVisible();
    await expect(page.locator('#tab-signin')).toHaveAttribute('role', 'tab');
    await expect(page.locator('#tab-signup')).toHaveAttribute('role', 'tab');
    await expect(page.locator('#tab-signin')).toHaveAttribute('aria-selected', 'true');
  });

  test('error message area exists with aria-live', async ({ page }) => {
    const errorEl = page.locator('#auth-error');
    await expect(errorEl).toHaveAttribute('role', 'alert');
    await expect(errorEl).toHaveAttribute('aria-live', 'assertive');
  });

  test('forgot password link is visible', async ({ page }) => {
    await expect(page.locator('[data-action="forgot-password"]')).toBeVisible();
  });
});
