/**
 * Auth helpers for real-Supabase tests.
 *
 * Drives the actual login form and the production window.signOut wrapper,
 * so the tests exercise the same paths the user does — including the
 * waitForPendingSyncs gate that's the crux of the persistence fix.
 */

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

/**
 * Sign in via the real login form. Waits until the app shell has booted,
 * the supabase client exposes an authenticated session, and DashClassManager
 * is available — i.e. it's safe to drive the UI.
 */
export async function signIn(page) {
  await page.goto('/login.html');
  await page.fill('#si-email', TEST_USER_EMAIL);
  await page.fill('#si-password', TEST_USER_PASSWORD);
  await page.click('#si-submit');
  await page.waitForURL('**/teacher/app.html**', { timeout: 15_000 });
  await page.waitForFunction(() => window.DashClassManager !== undefined, null, { timeout: 15_000 });
  await page.waitForFunction(
    async () => {
      if (!window._supabase || !window._supabase.auth) return false;
      const { data } = await window._supabase.auth.getSession();
      return !!(data && data.session);
    },
    null,
    { timeout: 15_000 },
  );
}

/**
 * Production sign-out path: window.signOut wraps waitForPendingSyncs(5000)
 * → supabase.auth.signOut → localStorage clear → redirect to login. This is
 * exactly what the user hits via the account menu.
 *
 * Note: race tests should call this *with no preceding wait* after a write,
 * to make sure the production wait-for-pending-syncs gate is doing its job.
 */
export async function signOut(page) {
  await page.evaluate(() => window.signOut && window.signOut());
  await page.waitForURL('**/login.html', { timeout: 15_000 });
}

/**
 * Convenience: sign out, sign back in. The whole-cycle pattern most
 * persistence tests need.
 */
export async function recycleSession(page) {
  await signOut(page);
  await signIn(page);
}
