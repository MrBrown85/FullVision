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

/* L5 and L6: the Students card as the student's My Learning, and the
   profile with the student's own words first. */
async function openPhone(page) {
  await page.addInitScript(() => localStorage.setItem('fv-build-phoneLook', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}
// The card on top of the stack.
const topCard = page => page.locator('.m-card-stack-item[data-depth="0"] .m-sl-card');
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

test('L5: the Students card is the student’s My Learning', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openPhone(page);
  const card = topCard(page);
  await expect(card).toBeVisible();
  const sid = await card.locator('.m-sl-profile').getAttribute('data-sid');
  const name = await page.evaluate(sid => displayName(getStudents('sci8').find(s => s.id === sid)), sid);
  await expect(card.locator('.m-sl-name')).toHaveText(name);
  await expect(card.locator('.m-sl-word')).not.toHaveText('');
  await expect(card.locator('.m-sl-bar')).toHaveCount(4);
  await expect(card.locator('.m-sl-observe')).toHaveText('+ Observe');
  await expect(card.locator('.m-sl-profile')).toHaveText('Profile');
  // The newest pieces with a result, at most five, then All N Pieces.
  const rows = card.locator('.m-sl-work .m-sl-row:not(.m-sl-all)');
  expect(await rows.count()).toBeLessThanOrEqual(5);
  await expect(rows.first().locator('.m-sl-pill')).not.toHaveText('');
  await expect(card.locator('.m-sl-all')).toHaveText(/^All \d+ Pieces$/);
  // The old card's competency rows are gone.
  await expect(card.locator('.m-scard-sec-row')).toHaveCount(0);
  // The name opens every student.
  await card.locator('.m-sl-who').click();
  await expect(page.locator('#m-sheet-container #m-student-list')).toBeVisible();
  expect(errors).toEqual([]);
});

test('L6: the profile puts the student’s words first; All Work and Competencies open in place', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openPhone(page);
  await topCard(page).locator('.m-sl-profile').click();
  const pageEl = page.locator('#m-screen-student-detail .m-sl-page');
  await expect(pageEl.locator('.m-sl-id .m-sl-id-name')).toBeVisible();
  await expect(pageEl.locator('.m-sl-observe')).toHaveText('+ Observe');
  // The tabs are gone; the rows open in place.
  await expect(page.locator('#m-screen-student-detail .m-st-tab')).toHaveCount(0);
  const work = pageEl.locator('details', { has: page.locator('summary', { hasText: 'All Work' }) });
  await expect(work).not.toHaveAttribute('open', '');
  await work.locator('summary').click();
  await expect(work).toHaveAttribute('open', '');
  await expect(work.locator('.m-assess-compact').first()).toBeVisible();
  const comps = pageEl.locator('details', { has: page.locator('summary', { hasText: 'Competencies' }) });
  await comps.locator('summary').click();
  await expect(comps.locator('.m-section-card, .m-group-header').first()).toBeVisible();
  // A piece in All Work opens the grader on this student.
  await work.locator('.m-assess-compact').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [375, 320]) {
  for (const font of FONTS) {
    test(`L5 and L6 fit at ${width} px, ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await openPhone(page);
      await useFont(page, font);
      await expect(topCard(page)).toBeVisible();
      expect(
        await overflow(
          page,
          '.m-card-stack-item[data-depth="0"] .m-sl-card',
          '.m-sl-who, .m-sl-level, .m-sl-acts > *, .m-sl-row, .m-sl-pill',
        ),
      ).toEqual([]);
      // Observe and Profile share one line.
      const acts = await topCard(page)
        .locator('.m-sl-acts > *')
        .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(acts).size).toBe(1);
      await topCard(page).locator('.m-sl-profile').click();
      await expect(page.locator('#m-screen-student-detail .m-sl-page')).toBeVisible();
      await page.locator('#m-screen-student-detail details summary').evaluateAll(s => s.forEach(x => x.click()));
      const out = await page.evaluate(() =>
        [...document.querySelectorAll('#m-screen-student-detail .m-sl-block')].flatMap(b => {
          const r = b.getBoundingClientRect();
          return [...b.querySelectorAll('.m-sl-bubble, .m-sl-chip, .m-sl-observe, summary, .m-obs-card')]
            .filter(e => {
              const x = e.getBoundingClientRect();
              return x.width > 0 && (x.right > r.right + 0.6 || x.left < r.left - 0.6);
            })
            .map(e => String(e.className || e.tagName));
        }),
      );
      expect(out).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
        0,
      );
    });
  }
}
