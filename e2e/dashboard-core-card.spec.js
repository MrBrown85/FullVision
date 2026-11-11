/**
 * The dashboard's Core Competencies card (docs/plans/dashboard-cards-plan.md,
 * part C), Demo Mode, Science 8. The rows, the "k of N" counts, the squares,
 * the view menu's keys, the remembered pick, the tip's text and the empty
 * state are pinned in tests/dash-core-card.test.js and
 * tests/dash-view-menu.test.js. What stays here needs layout or a real
 * pointer: the card keeps one height across its views, and the pointer can
 * reach the link in a row's tip.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-core-card').waitFor();
}

test('the card keeps one height from Self-Assessment to Evidence', async ({ page }) => {
  await openDashboard(page);
  const card = page.locator('.dash-core-card');
  const pill = card.locator('.dash-view-btn');
  await expect(pill).toHaveText('Self-Assessment');
  const selfHeight = (await card.boundingBox()).height;

  await pill.click();
  await card.getByRole('menuitemradio', { name: /Evidence/ }).click();
  await expect(pill).toHaveText('Evidence');
  expect((await card.boundingBox()).height).toBe(selfHeight);
});

test('the pointer can reach the link in a row’s tip', async ({ page }) => {
  await openDashboard(page);
  const row = page.locator('.dash-core-card .dash-core-row').first();
  await row.hover();
  const tip = row.locator('.dist-tip');
  await expect(tip).toBeVisible();
  // It ends with the questionnaire, and the pointer can reach the link
  // (plan F.7b).
  const link = tip.getByRole('link', { name: 'Open the Questionnaire →' });
  await expect(link).toHaveAttribute('data-href', '/dashboard?course=sci8&manage=questionnaires');
  await link.hover();
  await expect(tip).toBeVisible();
});
