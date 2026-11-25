/**
 * Observe on the phone draws the newest 30 observations, then 30 more on
 * Show More (speed, P7). Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

test('Observe shows the newest 30, and Show More adds the next ones under them', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  const cards = page.locator('#m-obs-cards .m-obs-card');
  await expect(cards.first()).toBeVisible();
  const total = await page.evaluate(() => getAllQuickObs(getActiveCourse()).length);
  test.skip(total <= 30, 'Demo Mode has 30 or fewer observations');
  await expect(cards).toHaveCount(30);
  const firstText = await cards.first().locator('.m-obs-text').textContent();
  await page.getByRole('button', { name: 'Show More' }).click();
  await expect(cards).toHaveCount(Math.min(60, total));
  await expect(cards.first().locator('.m-obs-text')).toHaveText(firstText);
  // A filter starts again at the first 30.
  await page.locator('.m-obs-track .m-seg-btn[data-filter="all"]').click();
  await expect(cards).toHaveCount(30);
});

async function openObserve(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await expect(page.locator('#m-obs-cards .m-obs-card').first()).toBeVisible();
}

test('Observe as the board draws it: the tabs’ top bar, Sweep and the faces, one track, cards without a time', async ({
  page,
}) => {
  await openObserve(page);
  const bar = page.locator('#m-screen-obs-feed .m-tabbar');
  await expect(bar.locator('.m-tabbar-demo')).toBeVisible();
  await expect(bar.locator('.m-tabbar-name')).toHaveText('Science 8');
  await expect(bar.locator('#sync-indicator-dot')).toBeVisible();
  await expect(bar.locator('[data-action="m-settings"]')).toBeVisible();
  await expect(page.locator('#m-screen-obs-feed .m-nav-bar-title-inline')).toHaveCount(0);

  // The Sweep tile first, then the faces in alphabetical order, and they stay there.
  const faces = page.locator('.m-obs-face[data-action="m-obs-quick-menu"]');
  const order = () => faces.evaluateAll(a => a.map(f => f.dataset.sid));
  await expect(page.locator('.m-obs-face').first()).toHaveText('Sweep');
  const before = await order();
  const alpha = await page.evaluate(() => sortStudents(getStudents(getActiveCourse()).slice(), 'alpha').map(s => s.id));
  expect(before).toEqual(alpha);
  await faces.nth(3).click();
  await page.locator('.m-quick-row[data-action="m-obs-quick-post"]').first().click();
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
  expect(await order()).toEqual(before);

  // One track of five.
  const segs = page.locator('.m-obs-track .m-seg-btn');
  await expect(segs).toHaveText(['All', 'Strength', 'Growth', 'Concern', 'Note']);
  await segs.nth(1).click();
  await expect(segs.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(segs.nth(0)).toHaveAttribute('aria-pressed', 'false');
  const types = await page.locator('#m-obs-cards .m-obs-card .m-obs-type').allTextContents();
  expect(new Set(types)).toEqual(new Set(['Strength']));

  // The cards say no time; + Follow Up stays on them.
  await segs.nth(0).click();
  await expect(page.locator('#m-obs-cards .m-obs-card .m-obs-time')).toHaveCount(0);
  await expect(page.locator('#m-obs-cards .m-obs-card [data-fu-action="add"]').first()).toBeVisible();
  await expect(page.locator('.m-fab')).toBeVisible();
});

test('the class name in the top bar lists the classes; a pick switches, ⋯ holds Settings', async ({ page }) => {
  await openObserve(page);
  // One class: the name is a heading, not a button.
  await expect(page.locator('#m-screen-obs-feed button.m-tabbar-class')).toHaveCount(0);
  const other = await page.evaluate(() => createCourse({ name: 'Second Class' }).id);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  const name = page.locator('#m-screen-obs-feed button.m-tabbar-class');
  await expect(name).toHaveAttribute('aria-label', 'Science 8, choose a class');
  await name.click();
  const sheet = page.locator('#m-sheet-container .m-class-sheet');
  await expect(sheet.locator('.m-class-row')).toHaveCount(2);
  await expect(sheet.locator('.m-class-row[aria-current]')).toContainText('Science 8');
  await sheet.locator('.m-class-row[data-cid="' + other + '"]').click();
  await expect.poll(() => page.evaluate(() => getActiveCourse())).toBe(other);
  await expect(page.locator('#m-screen-obs-feed .m-tabbar-name')).toHaveText('Second Class');
  await expect(page.locator('#m-sheet-container .m-class-sheet')).toHaveCount(0);
  // ⋯ is the Settings sheet, without the old class picker.
  await page.locator('#m-screen-obs-feed [data-action="m-settings"]').click();
  const settings = page.locator('#m-sheet-container .m-sheet-visible');
  await expect(settings).toContainText('Switch to Desktop');
  await expect(settings.locator('#m-course-select')).toHaveCount(0);
});
