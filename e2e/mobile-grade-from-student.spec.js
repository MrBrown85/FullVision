/**
 * Grade on a student's page opens the newest assessment's grading screen on
 * the Grade tab, at that student's card, and Back returns to the page.
 * Runs in Demo Mode, where Science Fair Proposal is the newest assessment.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

// The card the swiper has scrolled to, once it stops.
async function currentCardName(page) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate(() => document.getElementById('m-swiper')?.scrollLeft ?? null);
    if (now !== null && now === last) break;
    last = now;
    await page.waitForTimeout(150);
  }
  return page.evaluate(() => {
    const sw = document.getElementById('m-swiper');
    const card = sw.querySelectorAll('.m-swiper-card')[Math.round(sw.scrollLeft / sw.clientWidth)];
    return card.querySelector('.m-grade-student-name').textContent.trim();
  });
}

for (const row of [0, 3]) {
  test(`Grade on student ${row + 1}'s page lands on their card for the newest assessment, and Back returns`, async ({
    page,
  }) => {
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/teacher-mobile\//);
    await page.locator('.m-tab-item[data-tab="students"]').click();
    await page.locator('[data-action="m-set-view"][data-mode="list"]').click();
    await page.locator('[data-action="m-student-detail"]').nth(row).click();
    const detail = page.locator('#m-screen-student-detail');
    const name = (await detail.locator('.m-hero-name').textContent()).trim();

    await detail.locator('[data-action="m-student-grade"]').click();
    await expect(page.locator('.m-tab-item[data-tab="grade"]')).toHaveAttribute('aria-selected', 'true');
    const bar = page.locator('#m-nav-bar-grade-swiper');
    await expect(bar).toContainText('Science Fair Proposal');
    await expect(bar.locator('.m-nav-bar-title-inline div')).toHaveText(`${row + 1} of 27`);
    expect(await currentCardName(page)).toBe(name);

    await bar.locator('[data-action="m-back"]').click();
    await expect(page.locator('.m-tab-item[data-tab="students"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#m-screen-student-detail .m-hero-name')).toHaveText(name);
    await expect(page.locator('#m-screen-grade-swiper')).toHaveCount(0);

    // Back again returns to the list, as from any student page.
    await page.locator('#m-screen-student-detail [data-action="m-back"]').click();
    await expect(page.locator('#m-screen-student-detail')).toHaveCount(0);
    await expect(page.locator('#m-student-list')).toBeVisible();
  });
}
