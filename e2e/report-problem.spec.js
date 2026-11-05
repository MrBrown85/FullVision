/**
 * Report a Problem (onboarding C5): a form from the Help panel, the account
 * menu and the help site (/dashboard?report=1). It shows what goes with the
 * report (page, build, browser) and sends through the outbox; Demo Mode has
 * no account, so it offers Copy Text instead of Send.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, gotoApp } from './helpers.js';

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

async function serveHelp(page) {
  await page.route('**/help/index.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
}

test('Demo Mode: the form opens from the Help panel and offers Copy Text', async ({ page }) => {
  await serveHelp(page);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.locator('#help-panel').getByRole('button', { name: 'Report a Problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog).toBeVisible();
  const box = dialog.getByLabel('Describe the Problem');
  await expect(box).toBeFocused();
  await expect(dialog.locator('#report-attached')).toContainText(/^Page: Dashboard · FullVision.* · Chrome \d+ on /);
  await expect(dialog).toContainText('Reports are sent from a signed-in account.');
  await expect(dialog.getByRole('button', { name: 'Send' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Copy Text' })).toBeVisible();
  await expect(dialog).toContainText('Do not include student names.');
  // A click beside the form keeps what has been typed.
  await box.fill('Something broke.');
  await page.mouse.click(20, 880);
  await expect(dialog).toBeVisible();
  await expect(box).toHaveValue('Something broke.');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a signed-in teacher sends a report from the account menu', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await serveHelp(page);
  await gotoApp(page, '/gradebook');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.locator('.tb-user-dropdown').getByRole('button', { name: 'Report a Problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog.locator('#report-attached')).toContainText('Page: Gradebook');
  const send = dialog.getByRole('button', { name: 'Send' });
  await expect(send).toBeDisabled();
  await dialog.getByLabel('Describe the Problem').fill('Print Grades does nothing.');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(dialog).toContainText('The report has been sent.');
  await expect
    .poll(() => page.evaluate(() => (window.__e2eRpcLog || []).filter(c => c.name === 'submit_support_report')))
    .toHaveLength(1);
  const call = await page.evaluate(() => window.__e2eRpcLog.find(c => c.name === 'submit_support_report'));
  expect(call.params.p_page).toBe('Gradebook');
  expect(call.params.p_message).toBe('Print Grades does nothing.');
  expect(call.params.p_browser).toMatch(/^Chrome \d+ on /);
  expect(call.params.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});

test('/dashboard?report=1 opens the form once, for the help site, and drops the parameter', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await serveHelp(page);
  await gotoApp(page, '/dashboard?report=1');
  const dialog = page.getByRole('dialog', { name: 'Report a Problem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#report-attached')).toContainText('Page: Help site');
  await expect(page).toHaveURL(/\/dashboard$/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  // Moving between pages does not open it again.
  await page.evaluate(() => window.Router.navigate('/assignments'));
  await page.evaluate(() => window.Router.navigate('/dashboard'));
  await expect(dialog).toHaveCount(0);
});

test('Tab stays inside the form', async ({ page }) => {
  await serveHelp(page);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.locator('.tb-user-dropdown').getByRole('button', { name: 'Report a Problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a Problem' });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#report-problem'))).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused();
});
