/**
 * Regression smoke — P1.2 from the post-reconciliation backlog.
 *
 * Flow: sign up → Welcome Class auto-seeds → enter a score → sign out →
 * sign back in → score survives.
 *
 * WHY THIS MATTERS: unit tests stub `getSupabase()` and assert the dispatch
 * payload. They can't catch breakage in: the login form wiring, session
 * restoration on reload, bootstrap_teacher's Welcome Class seeding, or the
 * v2 cache → localStorage → reload round-trip that keeps data alive across
 * sessions.
 *
 * CURRENT STATUS: skipped. The Playwright webServer config
 * (`playwright.config.js`) uses `npx serve -l 8347` which serves raw source
 * without credential substitution — the login form renders empty because
 * `__SUPABASE_URL__` / `__SUPABASE_KEY__` placeholders are never replaced
 * and `getSupabase()` returns null. Every existing e2e test silently fails
 * the same way right now.
 *
 * TO UNBLOCK: either (a) change `webServer.command` to build dist + serve
 * dist with credentials substituted, matching the `dev:local` flow
 * introduced by the reconciliation plan, or (b) spin up `netlify dev`
 * which runs the inject-env edge function on each request. Tracked in the
 * backlog as a new item (P3.4).
 */
import { test, expect } from '@playwright/test';

// Skip the full regression flow until the e2e infra is repaired. Leaving
// the spec skeleton in place means the next session picks up where this
// one left off rather than re-designing from scratch.
test.describe.skip('Regression smoke (P1.2) — BLOCKED on e2e infra', () => {
  test('sign-up → welcome class → enter score → sign out → sign in → score survives', async ({ page }) => {
    const email = `smoke-${Date.now()}@example.com`;
    const password = 'test1234!';

    // 1. Sign up
    await page.goto('/login.html');
    await page.locator('#tab-signup').click();
    await page.locator('#su-name').fill('Smoke Tester');
    await page.locator('#su-email').fill(email);
    await page.locator('#su-password').fill(password);
    await page.locator('#su-confirm').fill(password);
    await page.locator('#form-signup button[type="submit"]').click();

    // 2. (Email verification would happen here in a real flow — skipped for
    //     local smoke; requires test-Supabase project with auto-confirm)

    // 3. Land on dashboard with Welcome Class auto-seeded
    await page.waitForURL(/\/teacher\/app/);
    await expect(page.locator('text=Welcome Class').first()).toBeVisible();

    // 4. Navigate to gradebook and enter a score on the seeded assessment
    //    (requires Welcome Class seed data; bootstrap_teacher creates empty
    //     course on first login today — P4.2 promotes Q43 seed into it)

    // 5. Sign out
    await page.locator('[data-action="sign-out"]').click();
    await page.waitForURL(/\/login/);

    // 6. Sign back in
    await page.locator('#si-email').fill(email);
    await page.locator('#si-password').fill(password);
    await page.locator('#form-signin button[type="submit"]').click();

    // 7. Assert the score from step 4 is still visible
    //    ...
  });
});
