/**
 * Demo Mode says so at the left of the top bar: an amber Demo Mode pill whose
 * panel explains Demo Mode and offers Create an Account, Sign In and Reset
 * Demo Data. A signed-in teacher never sees it. The phone app has the same
 * pill in each tab's header, with the panel as a sheet.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, mockPersistentAuthFlow, seedCourse, gotoApp } from './helpers.js';

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openDemo(page) {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.locator('.tb-demo-pill').waitFor();
  }

  test('the pill sits after Toggle Sidebar and leaves the tabs where they are', async ({ page }) => {
    await openDemo(page);
    const box = sel => page.locator(sel).first().boundingBox();
    const toggle = await box('[data-action="toggleSidebar"]');
    const pill = await box('.tb-demo-pill');
    const tabs = await box('.tb-seg');
    expect(pill.x).toBeGreaterThanOrEqual(toggle.x + toggle.width);
    expect(pill.x + pill.width).toBeLessThan(tabs.x);
    expect(Math.round(pill.height)).toBe(30);
    // The tabs are centred in the bar whether or not the pill is there.
    expect(Math.abs(tabs.x + tabs.width / 2 - 720)).toBeLessThanOrEqual(1);
  });

  test('the panel explains Demo Mode and offers the ways out', async ({ page }) => {
    await openDemo(page);
    const pill = page.getByRole('button', { name: 'Demo Mode' });
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    await pill.click();
    const panel = page.getByRole('dialog', { name: 'Demo Mode' });
    await expect(panel).toBeVisible();
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toContainText('A sample Science 8 class. Nothing is saved to an account.');
    await expect(panel.getByRole('link', { name: 'Create an Account' })).toHaveAttribute('href', '/login.html#signup');
    await expect(panel.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login.html');
    await expect(panel.getByRole('button', { name: 'Reset Demo Data' })).toBeVisible();

    // Escape closes it and puts the focus back on the pill.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(pill).toBeFocused();

    // A click elsewhere closes it too.
    await pill.click();
    await expect(panel).toBeVisible();
    await page.locator('#main').click({ position: { x: 600, y: 400 } });
    await expect(panel).toBeHidden();
  });

  test('Reset Demo Data asks first, then closes the panel', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Demo Mode' }).click();
    await page.getByRole('dialog', { name: 'Demo Mode' }).getByRole('button', { name: 'Reset Demo Data' }).click();
    await expect(page.locator('.tb-demo-panel')).toBeHidden();
    await expect(
      page.getByText('All classes are deleted and the sample Science 8 class is restored. This cannot be undone.'),
    ).toBeVisible();
  });

  test('Create an Account opens the Sign Up tab', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Demo Mode' }).click();
    await page.getByRole('link', { name: 'Create an Account' }).click();
    await page.waitForURL(/\/login\.html#signup$/);
    await expect(page.locator('#form-signup')).toBeVisible();
  });

  test('Sign In leaves Demo Mode', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('button', { name: 'Demo Mode' }).click();
    await page.getByRole('link', { name: 'Sign In' }).click();
    await page.waitForURL(/\/login\.html$/);
    await expect(page.locator('#form-signin')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('gb-demo-mode'))).toBeNull();
  });

  /* A teacher can enter Demo Mode while signed in (the zero-class screen's
     Open Demo Mode). The sign-in page sends a live session back into the
     app, so Sign In signs out first; it used to land back in Demo Mode. */
  test('Sign In from Demo Mode entered while signed in shows the sign-in form', async ({ page }) => {
    await mockPersistentAuthFlow(page);
    const email = `demo-${Date.now()}@example.com`;
    await page.goto('/login.html');
    await page.locator('#tab-signup').click();
    await page.locator('#su-name').fill('Demo Leaver');
    await page.locator('#su-email').fill(email);
    await page.locator('#su-password').fill('test1234!');
    await page.locator('#su-confirm').fill('test1234!');
    await page.locator('#form-signup button[type="submit"]').click();
    await expect(page.locator('#auth-success')).toBeVisible();
    await page.locator('#tab-signin').click();
    await page.locator('#si-email').fill(email);
    await page.locator('#si-password').fill('test1234!');
    await page.locator('#form-signin button[type="submit"]').click();
    await page.waitForURL(/\/dashboard/);

    // Into Demo Mode with the session still alive.
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/);
    await page.getByRole('button', { name: 'Demo Mode' }).click();
    await page.getByRole('link', { name: 'Sign In' }).click();

    await page.waitForURL(/\/login\.html$/);
    await expect(page.locator('#form-signin')).toBeVisible();
    // Still on the sign-in page a moment later: no bounce back into the app.
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/login\.html$/);
    expect(await page.evaluate(() => localStorage.getItem('gb-demo-mode'))).toBeNull();
  });

  test('unsent changes stop Sign In with a confirm', async ({ page }) => {
    await openDemo(page);
    // signOut's check finds two changes that have not reached the server.
    await page.evaluate(() => {
      window.signOut = async opts => (opts && opts.force ? undefined : { unsent: 2 });
    });
    await page.getByRole('button', { name: 'Demo Mode' }).click();
    await page.getByRole('link', { name: 'Sign In' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unsent Changes' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      '2 changes have not reached the server. Leaving Demo Mode signs out and deletes them.',
    );
    await expect(dialog.getByRole('button', { name: 'Leave Demo Mode' })).toBeVisible();
  });

  test('a signed-in teacher has no pill', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await gotoApp(page, '/dashboard');
    await page.locator('#app-dock').waitFor();
    await expect(page.locator('.tb-demo-pill')).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('each tab shows the pill, and it opens the Demo Mode sheet', async ({ page }) => {
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/teacher-mobile\//);
    await expect(page.locator('#m-loading')).toBeHidden();
    const pill = page.locator('.m-screen .m-demo-pill');
    await expect(pill).toHaveCount(1);
    await expect(pill).toBeVisible();
    // It fits in the bar beside the class name and the buttons.
    const bar = await page.locator('.m-nav-bar-inner').first().boundingBox();
    const p = await pill.boundingBox();
    expect(p.x + p.width).toBeLessThanOrEqual(bar.x + bar.width);

    for (const tab of ['observe', 'grade', 'students']) {
      await page.locator(`#m-tab-bar [data-tab="${tab}"]`).click();
      await expect(page.locator('.m-screen .m-demo-pill')).toBeVisible();
    }

    await pill.click();
    const sheet = page.locator('#m-sheet-container .m-sheet.m-sheet-visible');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Demo Mode');
    await expect(sheet).toContainText('Nothing is saved to an account.');
    await expect(sheet.getByRole('button', { name: 'Create an Account' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Reset Demo Data' })).toBeVisible();

    // Reset Demo Data asks inside the sheet; Cancel goes back.
    await sheet.getByRole('button', { name: 'Reset Demo Data' }).click();
    await expect(sheet).toContainText(
      'All classes are deleted and the sample Science 8 class is restored. This cannot be undone.',
    );
    await expect(sheet.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet.getByRole('button', { name: 'Create an Account' })).toBeVisible();

    // Unsent changes stop Sign In inside the sheet.
    await page.evaluate(() => {
      window.signOut = async () => ({ unsent: 1 });
    });
    await sheet.getByRole('button', { name: 'Sign In' }).click();
    await expect(sheet).toContainText('Unsent Changes');
    await expect(sheet).toContainText(
      '1 change has not reached the server. Leaving Demo Mode signs out and deletes it.',
    );
    await expect(sheet.getByRole('button', { name: 'Leave Demo Mode' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet.getByRole('button', { name: 'Create an Account' })).toBeVisible();

    // Reset runs it: the sample class comes back after the reload.
    await sheet.getByRole('button', { name: 'Reset Demo Data' }).click();
    await sheet.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForLoadState('load');
    await expect(page.locator('#m-loading')).toBeHidden();
    await expect(page.locator('.m-screen .m-demo-pill')).toBeVisible();
    await expect(page.locator('.m-nav-bar-class-name').first()).toHaveText('Science 8');
  });
});
