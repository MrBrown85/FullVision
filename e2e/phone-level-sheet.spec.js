import { test, expect } from '@playwright/test';

/* The phone's Grade screen (Nov 2 mockup, batch 2): holding a level button
   opens a sheet with the competency, the level, its descriptor, what
   Proficient means and the next step; letting go doesn't score, and a quick
   tap still does. Demo Mode, Cece on Science 8's Forces & Motion Quick
   Check, on Unit Conversions (PC4) from the curriculum bank. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('holding a level opens its sheet without scoring; a tap still scores', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/teacher-mobile/, { timeout: 20000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('.m-tab-item', { hasText: 'Grade' }).click();
  // Not one of the recent ones.
  await page.locator('button', { hasText: /^All$/ }).click();
  await page.locator('text=Forces & Motion Quick Check').first().click();
  const group = page.locator('.m-score-group', { hasText: 'Unit Conversions' }).first();
  const two = group.locator('.m-score-btn[data-score="2"]');
  await two.waitFor();
  const active = () => group.locator('.m-score-btn.m-score-active').getAttribute('data-score');
  const before = await active();

  await two.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
  await page.waitForTimeout(600);
  const sheet = page.locator('#m-sheet-container .m-level-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.m-level-sheet-title')).toHaveText('Unit Conversions');
  await expect(sheet.locator('.m-level-sheet-level')).toHaveText('2 · Developing');
  await expect(sheet).toContainText('with growing consistency');
  await expect(sheet).toContainText('Proficient means:');
  await expect(sheet).toContainText('Next step:');
  await two.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
  await two.dispatchEvent('click', { bubbles: true });
  expect(await active()).toBe(before);

  await page.evaluate(() => MComponents.dismissSheet());
  await two.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
  await two.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
  await two.dispatchEvent('click', { bubbles: true });
  await expect(group.locator('.m-score-btn.m-score-active')).toHaveAttribute('data-score', '2');
});
