/**
 * The phone's grading screen always shows what is being graded: the
 * assessment's title in the bar with "N of 27" under it, with no scrolling.
 * Bars over a large title still fade their title in on scroll. Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

test('the grading bar shows the title and the student count, and follows a thumbnail tap', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="grade"]').click();

  // The Grade list has a large title, so its bar title waits for a scroll.
  await expect(page.locator('#m-nav-bar-grade-picker .m-nav-bar-title-inline')).toHaveCSS('opacity', '0');

  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell', { hasText: 'Science Fair Proposal' }).click();
  const title = page.locator('#m-nav-bar-grade-swiper .m-nav-bar-title-inline');
  await expect(title).toHaveCSS('opacity', '1');
  await expect(title).toContainText('Science Fair Proposal');
  await expect(title.locator('div')).toHaveText('1 of 27');

  await page.locator('#m-thumb-strip .m-thumb').nth(4).click();
  await expect(title.locator('div')).toHaveText('5 of 27');
  await expect(title).toHaveCSS('opacity', '1');
});

test('the student page keeps its bar title hidden at rest and fades it in on scroll', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('[data-action="m-set-view"][data-mode="list"]').click();
  await page.locator('[data-action="m-student-detail"]').first().click();
  const title = page.locator('#m-nav-bar-student-detail .m-nav-bar-title-inline');
  await expect(title).toHaveCSS('opacity', '0');
  // The scroll handler is bound once the page has slid in, so scroll until it fades in.
  await expect(async () => {
    await page.locator('#m-screen-student-detail .m-screen-content').evaluate(el => {
      el.scrollTop = 200;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(title).toHaveCSS('opacity', '1', { timeout: 500 });
  }).toPass();
});
