/**
 * The phone's Students card (docs/plans/phone-look-plan.md, L5): the
 * student's My Learning. Demo Mode, Science 8. The name opens every
 * student; + Observe and Profile share a line; the newest pieces with a
 * result and All N Pieces; the card fits at 375 and 320 px wide, in the
 * page's font and a wide one.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

test.use({ viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true });

async function openPhone(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}
// The card on top of the stack.
const topCard = page => page.locator('.m-card-stack-item[data-depth="0"] .m-scard');

test('the card is the student’s My Learning: level, Observe, Profile, the newest pieces', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openPhone(page);
  const card = topCard(page);
  await expect(card).toBeVisible();
  const sid = await card.locator('.m-sc-profile').getAttribute('data-sid');
  const name = await page.evaluate(sid => displayName(getStudents('sci8').find(s => s.id === sid)), sid);
  await expect(card.locator('.m-sc-name')).toHaveText(name);
  await expect(card.locator('.m-sc-word')).not.toHaveText('');
  await expect(card.locator('.m-sc-bar')).toHaveCount(4);
  await expect(card.locator('.m-sc-observe')).toHaveText('+ Observe');
  await expect(card.locator('.m-sc-profile')).toHaveText('Profile');
  // The newest pieces with a result, at most five, then All N Pieces.
  const rows = card.locator('.m-sc-work .m-sc-row:not(.m-sc-all)');
  expect(await rows.count()).toBeLessThanOrEqual(5);
  await expect(rows.first().locator('.m-sc-pill')).not.toHaveText('');
  await expect(card.locator('.m-sc-all')).toHaveText(/^All \d+ Pieces$/);
  // None of the old card's widgets.
  await expect(card.locator('.m-scard-sec-row, .m-wdg-tile, .m-scard-hero')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the name opens every student, and a piece opens the grader on this student', async ({ page }) => {
  await openPhone(page);
  const card = topCard(page);
  await card.locator('.m-sc-who').click();
  await expect(page.locator('#m-sheet-container #m-student-list')).toBeVisible();
  await page
    .locator('#m-sheet-container [data-action="m-dismiss-sheet"], #m-sheet-backdrop')
    .first()
    .click({ force: true });
  await expect(page.locator('#m-sheet-container #m-student-list')).toHaveCount(0);
  await card.locator('.m-sc-work .m-sc-row').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
});

test('Observe opens the quick menu for this student, Profile opens the profile', async ({ page }) => {
  await openPhone(page);
  const card = topCard(page);
  const sid = await card.locator('.m-sc-observe').getAttribute('data-sid');
  await card.locator('.m-sc-observe').click();
  await expect(page.locator('#m-sheet-container .m-quick-title')).toBeVisible();
  await page.evaluate(() => MComponents.dismissSheet());
  await card.locator('.m-sc-profile').click();
  await expect(page.locator('#m-screen-student-detail .m-sp-observe')).toHaveAttribute('data-sid', sid);
});

// Nothing in `sel` runs past the left or right edge of `box`, less its padding.
const overflow = (page, box, sel) =>
  page.evaluate(
    ([box, sel]) => {
      const b = document.querySelector(box);
      const r = b.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(b).paddingLeft);
      return [...b.querySelectorAll(sel)]
        .filter(e => {
          const x = e.getBoundingClientRect();
          return x.width > 0 && (x.right > r.right - pad + 0.6 || x.left < r.left + pad - 0.6);
        })
        .map(e => String(e.className));
    },
    [box, sel],
  );

for (const width of [375, 320]) {
  for (const font of FONTS) {
    test(`the card fits at ${width} px, ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await openPhone(page);
      await useFont(page, font);
      await expect(topCard(page)).toBeVisible();
      expect(
        await overflow(
          page,
          '.m-card-stack-item[data-depth="0"] .m-scard',
          '.m-sc-who, .m-sc-level, .m-sc-acts > *, .m-sc-row, .m-sc-pill',
        ),
      ).toEqual([]);
      // Observe and Profile share one line, and each is a 44 px target.
      const acts = await topCard(page)
        .locator('.m-sc-acts > *')
        .evaluateAll(els =>
          els.map(e => [Math.round(e.getBoundingClientRect().top), e.getBoundingClientRect().height]),
        );
      expect(new Set(acts.map(a => a[0])).size).toBe(1);
      acts.forEach(a => expect(a[1]).toBeGreaterThanOrEqual(44));
    });
  }
}
