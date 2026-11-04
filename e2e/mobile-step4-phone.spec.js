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
  // The grading screen wires its fields 400 ms after it opens.
  await page.waitForTimeout(500);
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

// Group 2 #33: each tab's first screen names the open class.
test('every tab names the open class', async ({ page }) => {
  await openPhone(page);
  await expect(page.locator('#m-nav-bar-students-list .m-nav-bar-class')).toHaveText('Science 8');
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-nav-bar-grade-picker .m-nav-bar-class')).toBeVisible();
  await expect(page.locator('#m-nav-bar-grade-picker .m-nav-bar-class')).toHaveText('Science 8');
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await expect(page.locator('#m-nav-bar-obs-feed .m-nav-bar-class')).toHaveText('Science 8');
});

// Group 2 #34: the grading card has the Overall Comment, shows a saved one,
// and saves what is typed.
test('grading card has the Overall Comment', async ({ page }) => {
  await openGrading(page);
  const card = page.locator('.m-swiper-card').first();
  const box = card.locator('.m-overall-comment');
  await expect(card.locator('.m-overall-label')).toHaveText('Overall Comment');
  await box.scrollIntoViewIfNeeded();
  await box.fill('Clear labels on every graph.');
  await box.blur();
  const saved = await page.evaluate(() => {
    const el = document.querySelector('.m-swiper-card .m-overall-comment');
    return getScoreComment(getActiveCourse(), el.dataset.sid, el.dataset.aid);
  });
  expect(saved).toBe('Clear labels on every graph.');
  // Drawn again, the card shows the comment already saved.
  await page.locator('[data-action="m-back"]').click();
  await page.locator('[data-action="m-grade-assess"]').first().click();
  await expect(page.locator('#m-screen-grade-swiper .m-swiper-card').first().locator('.m-overall-comment')).toHaveValue(
    'Clear labels on every graph.',
  );
});

async function openAssessment(page, title) {
  await openPhone(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-assess"]', { hasText: title }).first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await page.waitForTimeout(500);
}

function pointsNow(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#m-screen-grade-swiper .m-pts-input');
    return getPointsScore(getActiveCourse(), el.dataset.sid, el.dataset.aid);
  });
}

// Group 2 #35: clearing a points score offers Undo; nonsense and Escape keep it.
test('clearing a points score offers Undo; Escape and nonsense keep it', async ({ page }) => {
  await openAssessment(page, 'Data Reading Quiz');
  const box = page.locator('#m-screen-grade-swiper .m-pts-input').first();
  const before = await pointsNow(page);
  expect(before).not.toBeNull();

  await box.fill('abc');
  await box.blur();
  expect(await pointsNow(page)).toBe(before);
  await expect(box).toHaveValue(String(before));

  await box.fill('3');
  await box.press('Escape');
  expect(await pointsNow(page)).toBe(before);
  await expect(box).toHaveValue(String(before));

  await box.fill('');
  await box.blur();
  expect(await pointsNow(page)).toBeNull();
  const toast = page.locator('#m-toast');
  await expect(toast).toContainText('Score cleared');
  await toast.locator('[data-action="m-toast-undo"]').click();
  expect(await pointsNow(page)).toBe(before);
  await expect(box).toHaveValue(String(before));
});
