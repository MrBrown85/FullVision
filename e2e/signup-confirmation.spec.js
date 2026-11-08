import { test, expect } from '@playwright/test';
import { mockPersistentAuthFlow } from './helpers.js';

// After Create Account the sign-up form gives way to Check Your Inbox. The
// link in the email opens login.html?confirmed=1 signed in, which goes on
// into the gradebook.

const PASSWORD = 'test1234!';

async function signUp(page, email, prefix = '') {
  await page.locator(prefix ? '[data-action="m-auth-tab"][data-tab="signup"]' : '#tab-signup').click();
  await page.locator(`#${prefix}su-name`).fill('Ms. Test');
  await page.locator(`#${prefix}su-email`).fill(email);
  await page.locator(`#${prefix}su-password`).fill(PASSWORD);
  await page.locator(`#${prefix}su-confirm`).fill(PASSWORD);
  await page.locator(`#${prefix}su-submit`).click();
}

test.describe('Sign-up confirmation', () => {
  test.beforeEach(async ({ page }) => {
    await mockPersistentAuthFlow(page);
  });

  test('Create Account shows Check Your Inbox in place of the form', async ({ page }) => {
    const email = `new-${Date.now()}@example.com`;
    await page.goto('/login.html');
    await signUp(page, email);

    await expect(page.locator('#panel-inbox')).toBeVisible();
    await expect(page.locator('#inbox-title')).toBeFocused();
    await expect(page.locator('#inbox-email')).toHaveText(email);
    await expect(page.locator('#form-signup')).toBeHidden();
    await expect(page.locator('.auth-tabs')).toBeHidden();
    await expect(page.locator('.auth-demo')).toBeHidden();
    // Just sent: Resend waits out Supabase's one-a-minute limit.
    await expect(page.locator('#inbox-resend')).toBeDisabled();
    await expect(page.locator('#inbox-resend')).toContainText('Resend Email (');

    // Use a Different Email goes back to the form with the name and address kept.
    await page.locator('[data-action="inbox-change-email"]').click();
    await expect(page.locator('#form-signup')).toBeVisible();
    await expect(page.locator('#panel-inbox')).toBeHidden();
    await expect(page.locator('#su-email')).toHaveValue(email);
    await expect(page.locator('#su-name')).toHaveValue('Ms. Test');
  });

  test('Resend Email sends the sign-up link again to the confirmation address', async ({ page }) => {
    await page.clock.install();
    const email = `resend-${Date.now()}@example.com`;
    await page.goto('/login.html');
    await signUp(page, email);
    await expect(page.locator('#inbox-resend')).toBeDisabled();

    await page.clock.runFor(61000);
    await expect(page.locator('#inbox-resend')).toBeEnabled();
    await expect(page.locator('#inbox-resend')).toHaveText('Resend Email');
    await page.locator('#inbox-resend').click();

    await expect(page.locator('#auth-success')).toContainText('Sent.');
    const resends = await page.evaluate(() => window.__e2eResends);
    expect(resends).toHaveLength(1);
    expect(resends[0].type).toBe('signup');
    expect(resends[0].email).toBe(email);
    expect(resends[0].options.emailRedirectTo).toMatch(/\/login\.html\?confirmed=1$/);
  });

  test('an address that already has an account goes to Sign In', async ({ page }) => {
    const email = `taken-${Date.now()}@example.com`;
    await page.goto('/login.html');
    await signUp(page, email);
    await expect(page.locator('#panel-inbox')).toBeVisible();
    await page.locator('[data-action="inbox-change-email"]').click();

    await page.locator('#su-password').fill(PASSWORD);
    await page.locator('#su-confirm').fill(PASSWORD);
    await page.locator('#su-submit').click();

    await expect(page.locator('#form-signin')).toBeVisible();
    await expect(page.locator('#si-email')).toHaveValue(email);
    await expect(page.locator('#auth-error')).toContainText('You already have an account with this email.');
  });

  test('the confirmation link opens the gradebook signed in', async ({ page }) => {
    const email = `link-${Date.now()}@example.com`;
    await page.goto('/login.html');
    await signUp(page, email);
    await page.locator('[data-action="inbox-signin"]').click();
    await page.locator('#si-password').fill(PASSWORD);
    await page.locator('#si-submit').click();
    await page.waitForURL(/\/dashboard/);

    // The link's session is in place; the page goes straight on into the app.
    await page.goto('/login.html?confirmed=1');
    await page.waitForURL(/\/dashboard/);
  });

  test('an expired confirmation link says so on Sign In', async ({ page }) => {
    await page.goto('/login.html?confirmed=1#error=access_denied&error_code=otp_expired');
    await expect(page.locator('#form-signin')).toBeVisible();
    await expect(page.locator('#auth-error')).toContainText('This link has expired or was already used.');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('a confirmation link that lands on the front page goes on to sign-in', async ({ page }) => {
    await page.goto('/#error=access_denied&type=signup');
    await expect(page.locator('#auth-error')).toContainText('This link has expired or was already used.');
  });

  test('on the phone, Create Account shows Check Your Inbox', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `phone-${Date.now()}@example.com`;
    await page.goto('/teacher-mobile/');
    await expect(page.locator('#m-form-signin')).toBeVisible();
    await signUp(page, email, 'm-');

    await expect(page.locator('#m-panel-inbox')).toBeVisible();
    await expect(page.locator('#m-inbox-email')).toHaveText(email);
    await expect(page.locator('#m-form-signup')).toBeHidden();
    await expect(page.locator('.m-auth-tabs')).toBeHidden();

    await page.locator('[data-action="m-inbox-signin"]').click();
    await expect(page.locator('#m-form-signin')).toBeVisible();
    await expect(page.locator('#m-si-email')).toHaveValue(email);
  });
});
