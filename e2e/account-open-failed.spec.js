import { test, expect } from '@playwright/test';
import { mockPersistentAuthFlow } from './helpers.js';

// Signed in, but bootstrap_teacher refuses, so there is no account to open.
// Nov 7 2026: a teacher record left by a deleted sign-in account held the
// email, and the sign-in page stayed on Sign In without a word.

const PASSWORD = 'test1234!';

async function makeAccount(page, email) {
  await page.goto('/login.html');
  await page.locator('#tab-signup').click();
  await page.locator('#su-name').fill('Ms. Test');
  await page.locator('#su-email').fill(email);
  await page.locator('#su-password').fill(PASSWORD);
  await page.locator('#su-confirm').fill(PASSWORD);
  await page.locator('#su-submit').click();
  await page.locator('[data-action="inbox-signin"]').click();
}

test.describe('An account that will not open', () => {
  test.beforeEach(async ({ page }) => {
    await mockPersistentAuthFlow(page);
  });

  test('a returning visit with a session says so on Sign In', async ({ page }) => {
    const email = `stuck-${Date.now()}@example.com`;
    await makeAccount(page, email);
    await page.locator('#si-password').fill(PASSWORD);
    await page.locator('#si-submit').click();
    await page.waitForURL(/\/dashboard/);

    await page.evaluate(() => localStorage.setItem('e2e-bootstrap-fails', '1'));
    await page.goto('/login.html');

    await expect(page.locator('#form-signin')).toBeVisible();
    await expect(page.locator('#auth-error')).toContainText(
      "You're signed in, but FullVision couldn't open your account.",
    );
    await expect(page.locator('#auth-error')).not.toContainText('duplicate key');
  });

  test('Sign In shows the same message, not the database error', async ({ page }) => {
    const email = `stuck-form-${Date.now()}@example.com`;
    await makeAccount(page, email);
    await page.evaluate(() => localStorage.setItem('e2e-bootstrap-fails', '1'));

    await page.locator('#si-password').fill(PASSWORD);
    await page.locator('#si-submit').click();

    await expect(page.locator('#auth-error')).toContainText("couldn't open your account");
    await expect(page.locator('#auth-error')).not.toContainText('duplicate key');
    await expect(page).toHaveURL(/\/login\.html/);
  });

  test('after Google, it says the account would not open, not that Google failed', async ({ page }) => {
    await page.goto('/login.html');
    await page.evaluate(() => localStorage.setItem('e2e-bootstrap-fails', '1'));
    await page.locator('#google-btn').click();

    await expect(page.locator('#auth-error')).toContainText("couldn't open your account");
    await expect(page.locator('#auth-error')).not.toContainText("Google sign-in didn't finish");
    await expect(page).toHaveURL(/\/login\.html$/);
  });
});
