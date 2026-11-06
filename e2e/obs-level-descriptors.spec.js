import { test, expect } from '@playwright/test';

/* The observation capture's level menu (Nov 2 mockup, batch 2): with a
   competency picked, each level shows its descriptor under it, and the
   whole menu shows. Demo Mode, Science 8, on Data Patterns (PA4) from the
   curriculum bank. */
test.use({ viewport: { width: 1440, height: 900 } });

const click = (page, sel, i = 0) => page.evaluate(([s, n]) => document.querySelectorAll(s)[n].click(), [sel, i]);

test('each level shows its descriptor for the competency picked', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => RubricPrint.loadBankLevels());
  // The Observations card's "+" on a student's row.
  await click(page, '#dash-obs-card [data-action="obsAdd"]');
  await click(page, '[data-obsc="menu"][data-value="link"]');
  await click(page, '.obsc-menu [data-value="competency"]');
  await page.evaluate(() => document.querySelector('[data-obsc="setCompetency"][data-value="PA4"]').click());
  await click(page, '[data-obsc="menu"][data-value="level"]');
  const menu = page.locator('.obsc-menu[data-menu="level"]');
  await expect(menu.locator('[data-value="2"] .obsc-item-desc')).toHaveText(
    'Finds patterns and connections in data with growing consistency.',
  );
  await expect(menu.locator('.obsc-item-desc')).toHaveCount(4);
  // "No level" shows without scrolling.
  const list = menu.locator('.obsc-menu-list');
  expect(await list.evaluate(e => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
  // Picking a level still works.
  await click(page, '.obsc-menu[data-menu="level"] [data-obsc="setLevel"][data-value="3"]');
  await expect(page.locator('[data-obsc="menu"][data-value="level"]')).toContainText('Proficient');
});
