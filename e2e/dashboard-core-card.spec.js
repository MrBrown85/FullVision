/**
 * The dashboard's Core Competencies card (docs/plans/dashboard-cards-plan.md,
 * part C), Demo Mode, Science 8: Self-Assessment by default (the demo
 * class's Term 2 steps, shared/seed-data.js), "k of N" per row; the view
 * menu opens and picks from the keyboard; Evidence draws a square per tagged
 * assessment and observation; the card keeps its height; the pick is
 * remembered for the class.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-core-card').waitFor();
}

test('Self-Assessment, then Evidence from the keyboard, at one height', async ({ page }) => {
  await openDashboard(page);
  const card = page.locator('.dash-core-card');
  const pill = card.locator('.dash-view-btn');
  const menu = card.getByRole('menu');

  // Self-Assessment: a "k of N" per competency, a square per student.
  await expect(pill).toHaveText('Self-Assessment');
  await expect(card.getByRole('link', { name: 'Questionnaires →' })).toBeVisible();
  const vals = card.locator('.dash-core-val');
  await expect(vals).toHaveCount(7);
  const n = await page.evaluate(() => getStudents('sci8').length);
  for (const text of await vals.allTextContents()) expect(text).toMatch(new RegExp('^\\d+ of ' + n + '$'));
  await expect(card.locator('.dash-core-row').first().locator('.dash-core-sq')).toHaveCount(n);
  await expect(card.locator('.dash-core-val.is-amber').first()).toBeVisible();
  await expect(card.locator('.dash-core-gbar')).toHaveCount(3);
  const selfHeight = (await card.boundingBox()).height;

  // The menu from the keyboard: Enter opens it on the view in use, Down
  // moves, Enter picks and focus comes back to the pill.
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitemradio', { name: /Self-Assessment/ })).toBeFocused();
  await expect(menu.getByRole('menuitemradio', { name: /Self-Assessment/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: /Evidence/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(pill).toHaveText('Evidence');
  await expect(pill).toBeFocused();

  // Evidence: dark squares for tagged work, light ones for observations.
  await expect(card.getByRole('link', { name: 'Assignments →' })).toBeVisible();
  expect(await card.locator('.dash-core-sq.is-work').count()).toBeGreaterThan(0);
  expect(await card.locator('.dash-core-sq.is-obs').count()).toBeGreaterThan(0);
  expect((await card.boundingBox()).height).toBe(selfHeight);

  // Escape closes the menu without a pick.
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(pill).toBeFocused();
  await expect(pill).toHaveText('Evidence');

  // Remembered for the class on this device.
  await page.reload();
  await page.locator('.dash-core-card').waitFor();
  await expect(page.locator('.dash-core-card .dash-view-btn')).toHaveText('Evidence');
});

test('the row tip lists the steps and who has not self-assessed yet', async ({ page }) => {
  await openDashboard(page);
  const row = page.locator('.dash-core-card .dash-core-row').first();
  await row.hover();
  const tip = row.locator('.dist-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/Leading \d+ · Confident \d+ · Growing \d+ · Beginning \d+/);
  await expect(tip).toContainText('Not yet:');
  // It ends with the questionnaire, and the pointer can reach the link
  // (plan F.7b).
  const link = tip.getByRole('link', { name: 'Open the Questionnaire →' });
  await expect(link).toHaveAttribute('data-href', '/dashboard?course=sci8&manage=questionnaires');
  await link.hover();
  await expect(tip).toBeVisible();
});

test('with no self-assessment this term the card offers Evidence and Set Up a Reflection', async ({ page }) => {
  await openDashboard(page);
  await page.evaluate(() => {
    localStorage.setItem('gb-core-self-sci8', '{}');
    _cache.coreSelf.sci8 = {};
    PageDashboard.render();
  });
  const card = page.locator('.dash-core-card');
  await expect(card.locator('.dash-view-btn')).toHaveCount(0);
  await expect(card.locator('.dash-core-sub')).toHaveText('Evidence');
  await expect(card.getByRole('link', { name: 'Set Up a Reflection →' })).toHaveAttribute(
    'data-href',
    '/dashboard?course=sci8&manage=questionnaires',
  );
});
