/**
 * The dashboard's Core Competencies card (docs/plans/dashboard-cards-plan.md,
 * part C), the Core page of the Competencies tile since D9. Demo Mode,
 * Science 8. The head, the view menu's keys, the remembered pick and the
 * empty state are pinned in tests/dash-core-card.test.js and
 * tests/dash-view-menu.test.js; Self-Assessment's rows, one bar each, in
 * tests/dash-competencies-pages.test.js and e2e/dashboard-competencies.spec.js.
 * What stays here needs layout or a real pointer: the tile keeps one height
 * across the page's views, and the questionnaire link is in reach.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openCore(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-comp-tile').waitFor();
  await page.locator('#dash-comp-tab-core').click();
  await expect(page.locator('#dash-comp-page-core')).toBeVisible();
}

test('the tile keeps one height from Self-Assessment to Evidence', async ({ page }) => {
  await openCore(page);
  const tile = page.locator('.dash-comp-tile');
  const pill = page.locator('#dash-view-btn-core');
  await expect(pill).toHaveText('Self-Assessment');
  const selfHeight = (await tile.boundingBox()).height;

  await pill.click();
  await page
    .locator('#dash-view-menu-core')
    .getByRole('menuitemradio', { name: /Evidence/ })
    .click();
  await expect(page.locator('#dash-view-btn-core')).toHaveText('Evidence');
  await expect(page.locator('#dash-comp-page-core .dash-core-row')).toHaveCount(7);
  expect((await tile.boundingBox()).height).toBe(selfHeight);
});

test('a row whose students have not all self-assessed offers the questionnaire, in reach', async ({ page }) => {
  await openCore(page);
  // Creative Thinking: 13 of 27 in the sample class.
  const row = page.locator('#dash-comp-page-core .dash-comp-ln').nth(2);
  await row.click();
  const pop = page.locator('#dash-comp-pop');
  await expect(pop).toBeVisible();
  const link = pop.getByRole('link', { name: 'Open the Questionnaire →' });
  await expect(link).toHaveAttribute('data-href', '/dashboard?course=sci8&manage=questionnaires');
  await link.hover();
  await expect(pop).toBeVisible();
  await expect(link).toBeInViewport();
});
