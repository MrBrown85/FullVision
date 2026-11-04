/**
 * Step 4 sweep, phone app (/teacher-mobile/) at 375x812, Demo Mode.
 * Each test names the finding it covers.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

async function openPhone(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
}

// Group 2 #31: search finds a student by legal first or last name.
test('All Students search finds a student by last name', async ({ page }) => {
  await openPhone(page);
  await page.locator('[data-action="m-all-students"]').click();
  const search = page.locator('[data-action="m-student-search"]');
  await search.fill('Adeyemi');
  const shown = page.locator('#m-student-list .m-cell:visible');
  await expect(shown).toHaveCount(1);
  await expect(shown.first()).toContainText('Cece');
  await expect(page.locator('#m-student-search-empty')).toHaveCount(0);
});

async function openGrading(page) {
  await openPhone(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-assess"]').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
}

// Group 2 #32: the grading screen shows the sync dot, kept current.
test('grading screen shows a visible sync dot', async ({ page }) => {
  await openGrading(page);
  const dot = page.locator('#m-screen-grade-swiper .tb-sync-dot');
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  expect(box.width).toBeGreaterThan(4);
  await expect(dot).toHaveAttribute('title', /.+/);
});
