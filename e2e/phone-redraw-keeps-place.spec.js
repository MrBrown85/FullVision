/**
 * A phone screen drawn again from the data keeps its place
 * (teacher-mobile/screen-keep.js).
 *
 * The app redraws the open tab whenever the class's data changes under it:
 * another device's change, the class read again, and, in a class that holds
 * grades until they are returned, two seconds after the teacher stops
 * choosing levels, when it reads which grades are drafts
 * (_refreshGradeReturnsSoon in shared/data.js). Each of those ends in
 * _invalidateAndRerender, which these tests call as the app does.
 *
 * Colin, Nov 25 2026: "After a few clicks and scrolls, sometimes it resets
 * the student data and changes their grades." The grader came back by its
 * place in a list worked out again, so the student just graded, no longer
 * waiting, gave their place to the next student's empty card; a student
 * graded from paper had their criteria shut again; the profile came back at
 * its top with its rows shut; the Grade list went back to To Grade.
 */
import { test, expect } from '@playwright/test';
import { settled } from './phone-jump.js';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const CID = 'sci8';

async function enter(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}
// The redraw the app does when the class's data changes under the screen.
const redraw = async page => {
  await page.evaluate(() => _invalidateAndRerender());
  await expect(page.locator('#m-nav-stack .m-screen').first()).toBeAttached();
};
const title = page => page.locator('#m-nav-bar-grade-swiper .m-nav-title-text');
const labId = page => page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Light Refraction Lab').id);
const cardSids = page =>
  page.evaluate(() => [...document.querySelectorAll('#m-swiper .m-swiper-card')].map(c => c.dataset.sid));

async function openLab(page, seg) {
  await enter(page);
  const aid = await labId(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  if (seg) await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="' + seg + '"]').click();
  await page.locator('#m-grade-list .m-tg-row[data-aid="' + aid + '"]').click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  return aid;
}

test('grading only the work waiting: the student just graded stays on screen with their levels', async ({ page }) => {
  await openLab(page);
  const before = await cardSids(page);
  expect(before.length).toBeGreaterThan(2);
  // The third card, through the class list.
  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  await page.locator('#m-sheet-container .m-roster-row[data-idx="2"]').click();
  expect(await settled(page)).toBe(2);
  const name = await title(page).innerText();
  const card = page.locator('#m-swiper .m-swiper-card').nth(2);
  const n = await card.locator('.m-crit-group').count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++)
    await card.locator('.m-crit-group').nth(i).locator('.m-score-btn[data-score="2"]').click();
  await expect(card.locator('.m-crit-group[data-level="2"]')).toHaveCount(n);

  await redraw(page);

  // The same students in the same order, the same one on screen, their levels chosen.
  expect(await cardSids(page)).toEqual(before);
  expect(await settled(page)).toBe(2);
  await expect(title(page)).toHaveText(name);
  await expect(page.locator('#m-swiper .m-swiper-card').nth(2).locator('.m-crit-group[data-level="2"]')).toHaveCount(n);

  // Left and come back to, the tab is as it was left too.
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  expect(await cardSids(page)).toEqual(before);
  await expect(title(page)).toHaveText(name);
});

test('grading from paper: the criteria a tap opened stay open, with the level just chosen', async ({ page }) => {
  await openLab(page, 'all');
  // A student with nothing in: their criteria sit behind Grade From Paper.
  const idx = await page.evaluate(() =>
    [...document.querySelectorAll('#m-swiper .m-swiper-card')].findIndex(c => c.querySelector('.m-paper-crit')),
  );
  expect(idx).toBeGreaterThanOrEqual(0);
  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  await page.locator('#m-sheet-container .m-roster-row[data-idx="' + idx + '"]').click();
  expect(await settled(page)).toBe(idx);
  const name = await title(page).innerText();
  const card = page.locator('#m-swiper .m-swiper-card').nth(idx);
  await card.locator('.m-paper-crit').first().click();
  await expect(card.locator('.m-crit-group').first()).toBeVisible();
  await card.locator('.m-crit-group').first().locator('.m-score-btn[data-score="3"]').click();
  await expect(card.locator('.m-crit-group').first()).toHaveAttribute('data-level', '3');

  await redraw(page);

  expect(await settled(page)).toBe(idx);
  await expect(title(page)).toHaveText(name);
  const again = page.locator('#m-swiper .m-swiper-card').nth(idx);
  await expect(again.locator('.m-paper-crit')).toHaveCount(0);
  await expect(again.locator('.m-crit-group').first()).toBeVisible();
  await expect(again.locator('.m-crit-group').first()).toHaveAttribute('data-level', '3');
});

test('the profile keeps its open rows, an opened competency and long answer, and its scroll', async ({ page }) => {
  await enter(page);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  const screen = page.locator('#m-screen-student-detail');
  const name = await screen.locator('.m-nav-bar-title-inline, .m-nav-bar-title').first().innerText();
  const n = await screen.locator('details > summary').count();
  for (let i = 0; i < n; i++) await screen.locator('details > summary').nth(i).click();
  const openRows = await screen.locator('details[open]').count();
  expect(openRows).toBeGreaterThan(1);
  await screen.locator('.m-section-card').first().click();
  const sec = await screen.locator('.m-section-card').first().getAttribute('data-sec');
  const more = screen.locator('.m-sp-more:visible').first();
  const hasMore = (await more.count()) > 0;
  if (hasMore) await more.click();
  const content = screen.locator('.m-screen-content');
  await content.evaluate(el => (el.scrollTop = 700));
  const top = await content.evaluate(el => el.scrollTop);
  expect(top).toBeGreaterThan(300);

  await redraw(page);

  await expect(screen.locator('.m-nav-bar-title-inline, .m-nav-bar-title').first()).toHaveText(name);
  await expect(screen.locator('details[open]')).toHaveCount(openRows);
  await expect(screen.locator('.m-section-card[data-sec="' + sec + '"]')).toHaveAttribute('aria-expanded', 'true');
  if (hasMore) await expect(screen.locator('.m-sp-more[aria-expanded="true"]').first()).toHaveText('Less');
  await expect.poll(() => content.evaluate(el => el.scrollTop)).toBe(top);
});

test('the Grade list keeps its segment and scroll, and Bulletins its scroll', async ({ page }) => {
  await enter(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  const all = page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]');
  await all.click();
  const list = page.locator('#m-nav-stack .m-screen').first().locator('.m-screen-content');
  await list.evaluate(el => (el.scrollTop = 300));
  const top = await list.evaluate(el => el.scrollTop);
  expect(top).toBeGreaterThan(100);
  const rows = await page.locator('#m-grade-list .m-tg-row:visible').count();

  await redraw(page);

  await expect(all).toHaveClass(/m-seg-active/);
  expect(await page.locator('#m-grade-list .m-tg-row:visible').count()).toBe(rows);
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(top);

  await page.locator('.m-tab-item[data-tab="bulletins"]').click();
  const feed = page.locator('#m-screen-bulletins .m-screen-content');
  await expect(page.locator('#m-bulletin-feed .m-bulletin-card').first()).toBeVisible();
  // As far down as the feed goes (its pictures give it height as they load).
  await expect.poll(() => feed.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(20);
  await feed.evaluate(el => (el.scrollTop = 150));
  const at = await feed.evaluate(el => el.scrollTop);
  expect(at).toBeGreaterThan(20);
  await redraw(page);
  await expect.poll(() => feed.evaluate(el => el.scrollTop)).toBe(at);
});
