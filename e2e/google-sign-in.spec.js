import { test, expect } from '@playwright/test';
import { mockPersistentAuthFlow } from './helpers.js';

// Continue with Google sends the teacher to Google, which comes back to
// login.html?signin=google signed in; that page goes on into the gradebook.
// The fake client in helpers.js plays Google's part.

const SESSION_KEY = 'e2e-auth-smoke-session';

async function oauthCalls(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('e2e-oauth-calls') || '[]'));
}

async function sessionName(page) {
  return page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key) || 'null');
    return session && session.user.user_metadata.display_name;
  }, SESSION_KEY);
}

test.describe('Continue with Google', () => {
  test.beforeEach(async ({ page }) => {
    await mockPersistentAuthFlow(page);
  });

  test('signs in and opens the gradebook, with Google’s name as the display name', async ({ page }) => {
    await page.goto('/login.html');
    const button = page.locator('#google-btn');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Continue with Google');

    await button.click();
    await page.waitForURL(/\/dashboard/);

    const calls = await oauthCalls(page);
    expect(calls).toHaveLength(1);
    expect(calls[0].provider).toBe('google');
    expect(calls[0].options.redirectTo).toMatch(/\/login\.html\?signin=google$/);
    expect(await sessionName(page)).toBe('Avery Chen');
  });

  test('shows on both tabs and hides with the forms on Check Your Inbox', async ({ page }) => {
    await page.goto('/login.html');
    await page.locator('#tab-signup').click();
    await expect(page.locator('#google-btn')).toBeVisible();

    await page.locator('#su-name').fill('Ms. Test');
    await page.locator('#su-email').fill(`inbox-${Date.now()}@example.com`);
    await page.locator('#su-password').fill('test1234!');
    await page.locator('#su-confirm').fill('test1234!');
    await page.locator('#su-submit').click();
    await expect(page.locator('#panel-inbox')).toBeVisible();
    await expect(page.locator('.auth-google')).toBeHidden();
  });

  test('a cancelled Google sign-in comes back to Sign In and says so', async ({ page }) => {
    await page.goto('/login.html');
    await page.evaluate(() => {
      window.__e2eGoogleCancel = true;
    });
    await page.locator('#google-btn').click();

    await expect(page.locator('#form-signin')).toBeVisible();
    await expect(page.locator('#google-btn')).toBeVisible();
    await expect(page.locator('#auth-error')).toContainText("Google sign-in didn't finish.");
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('on the phone, Continue with Google opens the phone app', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/teacher-mobile/');
    await expect(page.locator('#m-google-btn')).toBeVisible();

    await page.locator('#m-google-btn').click();
    await page.waitForURL(/\/teacher-mobile\/$/);
    await expect(page.locator('#m-app')).toBeVisible();

    const calls = await oauthCalls(page);
    expect(calls[0].options.redirectTo).toMatch(/\/login\.html\?signin=google$/);
  });
});
