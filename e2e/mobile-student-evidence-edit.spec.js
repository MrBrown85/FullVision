/**
 * The phone student page's Evidence cards open the edit sheet, as the
 * Observe feed's do (Nov 3 sweep, step 4), and the list shows the change.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test('tapping an Evidence card opens the edit sheet; Save shows the fix in place', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-card-stack-item[data-depth="0"] [data-action="m-student-detail"]').click();
  const screen = page.locator('#m-screen-student-detail');
  await screen.locator('.m-st-tab[data-tab="evidence"]').click();
  const card = screen.locator('#m-st-panel-evidence .m-obs-card').first();
  await expect(card.locator('.m-obs-chev')).toBeVisible();
  const obId = await card.getAttribute('data-obid');
  await card.locator('.m-obs-text').click();
  const sheet = page.locator('#m-obs-edit');
  await expect(sheet).toBeVisible();
  await page.locator('#m-obs-text').fill('Fixed the typo on the phone');
  await sheet.locator('[data-action="m-obs-save"], .m-edit-save').first().click();
  await expect(screen.locator('#m-st-panel-evidence .m-obs-card[data-obid="' + obId + '"] .m-obs-text')).toHaveText(
    'Fixed the typo on the phone',
  );

  // Delete Observation in the sheet takes the card off the list, with Undo.
  await screen.locator('#m-st-panel-evidence .m-obs-card[data-obid="' + obId + '"] .m-obs-text').click();
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-action="m-obs-delete"]').click();
  await expect(screen.locator('#m-st-panel-evidence .m-obs-card[data-obid="' + obId + '"]')).toHaveCount(0);
});
