/**
 * Observe on the phone draws the newest 30 observations, then 30 more on
 * Show More (speed, P7). Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

test('Observe shows the newest 30, and Show More adds the next ones under them', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  const cards = page.locator('#m-obs-cards .m-obs-card');
  await expect(cards.first()).toBeVisible();
  const total = await page.evaluate(() => getAllQuickObs(getActiveCourse()).length);
  test.skip(total <= 30, 'Demo Mode has 30 or fewer observations');
  await expect(cards).toHaveCount(30);
  const firstText = await cards.first().locator('.m-obs-text').textContent();
  await page.getByRole('button', { name: 'Show More' }).click();
  await expect(cards).toHaveCount(Math.min(60, total));
  await expect(cards.first().locator('.m-obs-text')).toHaveText(firstText);
  // A filter starts again at the first 30.
  await page.locator('.m-filter-pill[data-filter="all"]').click();
  await expect(cards).toHaveCount(30);
});
