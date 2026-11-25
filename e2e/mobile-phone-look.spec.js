/**
 * The phone's new look (docs/plans/phone-look-plan.md) beyond the grader, which
 * has its own spec (e2e/phone-grader.spec.js): L2b the Write a Bulletin sheet,
 * the Bulletins tab, L5 the Students card, L6 the profile; each in Demo Mode,
 * the fit of each on a 375 and a 320 px phone in the page's font and a wide one.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

test('L2b: Write a Bulletin has no Posts To line, and Let Students React is a row with its switch at the right', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('fv-build-phoneLook', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('.m-tab-item[data-tab="bulletins"]').click();
  await page.locator('[data-m-bulletin="write"]').click();
  const row = page.locator('.m-bulletin-switch');
  await expect(row).toBeVisible();
  await expect(page.locator('.m-bulletin-to')).toBeHidden();
  for (const font of FONTS) {
    await useFont(page, font);
    const at = await row.evaluate(el => {
      const r = e => e.getBoundingClientRect();
      const box = r(el);
      const words = r(el.querySelector('span'));
      const sw = r(el.querySelector('input'));
      return {
        gap: sw.left - words.right,
        right: box.right - sw.right,
        mid: Math.abs((sw.top + sw.bottom) / 2 - (words.top + words.bottom) / 2),
      };
    });
    expect(at.gap, font).toBeGreaterThan(8);
    expect(at.right, font).toBeLessThanOrEqual(14);
    expect(at.mid, font).toBeLessThanOrEqual(2);
  }
  const box = row.locator('input');
  const was = await box.isChecked();
  await box.click();
  expect(await box.isChecked()).toBe(!was);
});

test('L2: Bulletins', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fv-build-phoneLook', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);

  // Bulletins: no large title; "8 Not Seen" is what the Seen line reads.
  await page.locator('.m-tab-item[data-tab="bulletins"]').click();
  const feed = page.locator('#m-bulletin-feed');
  await expect(feed.locator('.m-bulletin-card').first()).toBeVisible();
  await expect(page.locator('.m-bulletin-content > .m-title-large')).toBeHidden();
  const seen = feed.locator('.m-bulletin-seen', { has: page.locator('.m-bulletin-not-seen') }).first();
  await expect(seen.locator('.m-bulletin-not-seen')).toBeVisible();
  // "Seen by 19 of 27" is not shown, and is still read out.
  const quiet = seen.locator('.m-look-sr');
  await expect(quiet).toHaveText(/^Seen by \d+ of \d+ · $/);
  expect(await quiet.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  for (const font of FONTS) {
    await useFont(page, font);
    const out = await feed.evaluate(el =>
      [...el.querySelectorAll('.m-bulletin-card')].flatMap(card => {
        const box = card.getBoundingClientRect();
        return [...card.querySelectorAll('.m-bulletin-file-line, .m-bulletin-link, .m-bulletin-not-seen')]
          .filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > box.right + 0.6 || r.left < box.left - 0.6);
          })
          .map(e => String(e.className));
      }),
    );
    expect(out, font).toEqual([]);
  }
});
