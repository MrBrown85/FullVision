import { test, expect } from '@playwright/test';

/* The override dialog (Nov 2 mockup, batch 2): each level's descriptor
   beside its button, and the calculated level marked. Demo Mode, Cece in
   Science 8, with Identify Patterns given a curriculum bank id. */
test.use({ viewport: { width: 1440, height: 900 } });

test('each level shows its descriptor, and the calculated level is marked', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => {
    getTagById('sci8', 'IP').bank_id = 'bc.sci8.cc.14';
    window.Router.navigate('/student?id=st1&course=sci8');
  });
  await page.locator('.stu-comp-row[data-tagid="IP"]').click();
  await page.locator('[data-action="toggleOverridePanel"][data-secid="IP"]').click();
  const panel = page.locator('#override-panel-IP');
  const rows = panel.locator('.override-level-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1).locator('.override-level-desc')).toContainText(
    'Finds patterns and connections in data with growing consistency.',
  );
  await expect(panel.locator('.override-level-row.is-calc .override-level-btn')).toHaveText('3 Proficient');
  await expect(panel.locator('.override-level-row.is-calc')).toContainText('Calculated: 3.1');
  // Picking a level still works.
  await rows.nth(3).locator('.override-level-btn').click();
  await expect(rows.nth(3).locator('.override-level-btn')).toHaveClass(/selected/);
});
