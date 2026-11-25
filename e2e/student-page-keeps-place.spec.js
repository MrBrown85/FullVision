/**
 * The student page keeps a student's place (Colin, Nov 25 2026: "it's
 * student facing and they will click and scroll around more").
 *
 * - Something opened over a list (Your Feedback, a handout, a bulletin's
 *   file) closes back to where the list was scrolled. It used to close to
 *   the top of the page, the row it was opened from out of sight
 *   (s/student.js, listScroll).
 * - A redraw the student did not ask for waits while a finger or the mouse
 *   is down, so the tap under way still lands (s/student.js, later).
 *
 * Demo Mode's sample card; nothing is sent. Writing a reflection counting
 * as activity is in tests/student-card-forms-wired.test.js.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 600 }, isMobile: true, hasTouch: true });

async function demo(page, tab) {
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page
    .locator('.sp-tab[data-tab="' + tab + '"]')
    .locator('visible=true')
    .first()
    .click();
  await expect(
    page.locator('.sp-tab[data-tab="' + tab + '"][aria-current="page"]').locator('visible=true'),
  ).toBeVisible();
}
const scrollY = page => page.evaluate(() => Math.round(window.scrollY));
const inView = locator =>
  locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });

/* The last `opener` on the tab, scrolled to; opened (the page goes to the
   top for what opens); closed: the list is where it was, the opener in view. */
async function opensAndClosesInPlace(page, opener, shows, closer) {
  const row = page.locator(opener).locator('visible=true').last();
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 40)); // not a place the focus alone would find
  const was = await scrollY(page);
  expect(was).toBeGreaterThan(100);
  expect(await inView(row)).toBe(true);
  await row.click();
  await expect(page.locator(shows).locator('visible=true').first()).toBeVisible();
  expect(await scrollY(page)).toBe(0);
  await page.locator(closer).locator('visible=true').first().click();
  await expect(page.locator(shows)).toHaveCount(0);
  await expect.poll(() => scrollY(page)).toBe(was);
  expect(await inView(page.locator(opener).locator('visible=true').last())).toBe(true);
}

test('Your Feedback closes back to where My Learning was scrolled', async ({ page }) => {
  await demo(page, 'learning');
  await opensAndClosesInPlace(page, '#app [data-act="feedback"]', '#sp-fb-title', '[data-act="feedback-close"]');
});

test('a handout closes back to where Assignments was scrolled', async ({ page }) => {
  await demo(page, 'assignments');
  await opensAndClosesInPlace(page, '#app [data-act="handout"]', '#sp-handout-title', '[data-act="handout-close"]');
});

test('a bulletin’s file closes back to where Bulletins was scrolled', async ({ page }) => {
  await demo(page, 'bulletins');
  await opensAndClosesInPlace(
    page,
    '#app [data-act="bulletin-page"]',
    '#sp-bulletin-viewer-title',
    '[data-act="bulletin-page-close"]',
  );
});

test('a move still starts at the top: another tab, after scrolling', async ({ page }) => {
  await demo(page, 'assignments');
  await page.evaluate(() => window.scrollTo(0, 600));
  expect(await scrollY(page)).toBeGreaterThan(300);
  await page.locator('.sp-tab[data-tab="learning"]').locator('visible=true').first().click();
  expect(await scrollY(page)).toBe(0);
});

test('a press held across a redraw still lands: the page is drawn again once it lifts', async ({ page }) => {
  await demo(page, 'assignments');
  const tab = page.locator('.sp-tabs-bottom .sp-tab[data-tab="learning"]');
  const box = await tab.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // An answer from the server arrives mid-press and asks for the page again.
  const waited = await page.evaluate(() => {
    window.__drawn = 0;
    return StudentPage.later(function again() {
      window.__drawn++;
      StudentPage.paint();
    });
  });
  expect(waited).toBe(true);
  expect(await page.evaluate(() => window.__drawn)).toBe(0);
  await page.mouse.up();
  // The tap landed on the button that was under the finger, and the redraw followed it.
  await expect(page.locator('.sp-tab[data-tab="learning"][aria-current="page"]').locator('visible=true')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__drawn)).toBe(1);
  // With nothing pressed, a redraw runs at once.
  expect(await page.evaluate(() => StudentPage.later(() => {}))).toBe(false);
});
