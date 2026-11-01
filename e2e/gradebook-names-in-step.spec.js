import { test, expect } from '@playwright/test';

// A name that takes the focus far down the class scrolls the names; the
// scores scroll with them so each row stays beside its name.
test('focusing a name low in the class keeps names and scores in line', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.goto('/gradebook?course=sci8');
  const names = page.locator('#gb-rowheads .gb-grid-rowhead-name');
  await names.nth(24).focus();
  await expect
    .poll(() =>
      page.evaluate(() => {
        var name = document.querySelectorAll('#gb-rowheads .gb-grid-rowhead-name')[24].closest('.gb-grid-rowhead');
        var row = document.querySelectorAll('#gb-data tr.gb-scores-row')[24];
        return Math.abs(name.getBoundingClientRect().top - row.getBoundingClientRect().top);
      }),
    )
    .toBeLessThan(1.5);
});
