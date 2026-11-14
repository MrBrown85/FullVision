/**
 * The grader's cards away from the screen are not laid out or painted
 * (docs/plans/speed-assessment.md, section 7, P4): a card's surface has
 * content-visibility: auto, so opening the grader and a tap lay out the
 * card on screen, not every student's. Counted with the browser's own
 * contentvisibilityautostatechange events. What the teacher sees is the
 * same: a card reached is drawn, a card keeps its scroll when the cards
 * move away and back, after a redraw and after a tab switch. Demo Mode, Science 8, Cell Microscope Lab, at 375 x 812.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const LAB = 'sci8a1';

async function openGrader(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    window._fvSkipped = {};
    document.addEventListener(
      'contentvisibilityautostatechange',
      e => {
        const card = e.target.closest && e.target.closest('.m-swiper-card');
        const sid = card && card.getAttribute('data-sid');
        if (sid) window._fvSkipped[sid] = e.skipped;
      },
      true,
    );
  });
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + LAB + '"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
}

const skipped = page => page.evaluate(() => Object.values(window._fvSkipped).filter(Boolean).length);
const drawn = page => page.evaluate(() => Object.values(window._fvSkipped).filter(s => !s).length);

test('opening the grader lays out the card on screen, not the class', async ({ page }) => {
  await openGrader(page);
  const total = await page.locator('.m-swiper-card').count();
  expect(total).toBeGreaterThan(10);
  // The card on screen and those within half a screen of it are drawn.
  await expect.poll(() => skipped(page)).toBeGreaterThanOrEqual(total - 3);
  expect(await drawn(page)).toBeLessThanOrEqual(3);
  // Its levels are there to tap.
  await expect(page.locator('.m-swiper-card').first().locator('.m-score-btn').first()).toBeVisible();
});

test('a card reached is drawn', async ({ page }) => {
  await openGrader(page);
  const far = (await page.locator('.m-swiper-card').count()) - 2;
  await page.locator('#m-thumb-strip .m-thumb').nth(far).click();
  const card = page.locator('.m-swiper-card').nth(far);
  await expect(card.locator('.m-score-btn').first()).toBeInViewport();
  const sid = await card.getAttribute('data-sid');
  await expect.poll(() => page.evaluate(s => window._fvSkipped[s], sid)).toBe(false);
});

test('a card keeps its scroll after a tab switch', async ({ page }) => {
  await openGrader(page);
  const far = (await page.locator('.m-swiper-card').count()) - 2;
  await page.locator('#m-thumb-strip .m-thumb').nth(far).click();
  const card = page.locator('.m-swiper-card').nth(far);
  await expect(card.locator('.m-score-btn').first()).toBeInViewport();
  const top = await card.evaluate(el => {
    el.scrollTop = 160;
    return el.scrollTop;
  });
  expect(top).toBeGreaterThan(0);
  // The card next to it was scrolled too, then the teacher went to Students and back.
  const next = page.locator('.m-swiper-card').nth(far + 1);
  await next.evaluate(el => (el.scrollTop = 120));
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.m-swiper-card')
        .nth(far)
        .evaluate(el => el.scrollTop),
    )
    .toBe(top);
  await page
    .locator('#m-thumb-strip .m-thumb')
    .nth(far + 1)
    .click();
  await expect
    .poll(() =>
      page
        .locator('.m-swiper-card')
        .nth(far + 1)
        .evaluate(el => el.scrollTop),
    )
    .toBe(120);
});

test('a card keeps its scroll when the cards move away and back', async ({ page }) => {
  await openGrader(page);
  const card = page.locator('.m-swiper-card').nth(1);
  await page.locator('#m-thumb-strip .m-thumb').nth(1).click();
  await expect(card.locator('.m-score-btn').first()).toBeInViewport();
  const top = await card.evaluate(el => {
    el.scrollTop = 300;
    return el.scrollTop;
  });
  expect(top).toBeGreaterThan(0);
  await page.locator('#m-thumb-strip .m-thumb').nth(6).click();
  const sid = await card.getAttribute('data-sid');
  await expect.poll(() => page.evaluate(s => window._fvSkipped[s], sid)).toBe(true);
  await page.locator('#m-thumb-strip .m-thumb').nth(1).click();
  await expect(card.locator('.m-grade-student-name')).toBeVisible();
  expect(await card.evaluate(el => el.scrollTop)).toBe(top);
});
