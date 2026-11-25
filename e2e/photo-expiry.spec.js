/**
 * A warning before the year runs out (shared/photo-expiry.js), in Demo Mode
 * with a seeded class: the demo has no class whose photos are due, so the
 * test adds a second class and seeds it under 'fv-demo-photo-expiry' as
 * last opened 350 days ago. The Dashboard, and the phone's Students screen,
 * show its one line with Open Class; opening the class clears it.
 */
import { test, expect } from '@playwright/test';

const SHOTS = process.env.FV_SHOTS || '';

async function enterDemo(page, phone) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(phone ? /teacher-mobile\// : /\/dashboard/);
}

// A second class, last opened 350 days ago with photos: due in 15 days.
async function seedDueClass(page) {
  return page.evaluate(() => {
    const cid = createCourse({ name: 'Social Studies 10' }).id;
    const opened = new Date(Date.now() - 350 * 86400000).toISOString();
    localStorage.setItem(PhotoExpiry.SEED_KEY, JSON.stringify([{ course_id: cid, last_opened_at: opened, photos: 6 }]));
    const at = PhotoExpiry.deletionAt(opened, Date.now());
    const day =
      at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');
    return { cid, date: formatShortDate(day) };
  });
}

const sentence = date =>
  'Photos in Social Studies 10 will be deleted on ' +
  date +
  " because the class hasn't been opened for a year. Open it to keep them.";

test.describe('Photo warning on a computer', () => {
  test('the Dashboard shows the line; Open Class opens the class and the line goes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterDemo(page);
    await page.goto('/dashboard?course=sci8');
    await expect(page.locator('.page-dashboard .photo-expiry')).toBeAttached();
    await expect(page.locator('.photo-expiry-line')).toHaveCount(0); // none in the demo by default
    const { cid, date } = await seedDueClass(page);
    await page.goto('/dashboard?course=sci8');
    const line = page.locator('.page-dashboard .photo-expiry-line');
    await expect(line).toHaveCount(1);
    await expect(line.locator('.photo-expiry-text')).toHaveText(sentence(date));
    await expect(line.getByRole('button')).toHaveText('Open Class');
    if (SHOTS) await page.waitForTimeout(1200);
    if (SHOTS) await page.locator('#main').screenshot({ path: SHOTS + '/photo-expiry-desktop.png' });
    await line.getByRole('button', { name: 'Open Class' }).click();
    await expect.poll(() => page.evaluate(() => getActiveCourse())).toBe(cid);
    await expect(page.locator('.photo-expiry-line')).toHaveCount(0);
    // Back on the first class, and after a reload: the line stays gone.
    await page.goto('/dashboard?course=sci8');
    await expect(page.locator('.page-dashboard .photo-expiry')).toBeAttached();
    await expect(page.locator('.photo-expiry-line')).toHaveCount(0);
  });
});

test.describe('Photo warning on the phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the Students screen shows the line; Open Class switches to the class and the line goes', async ({ page }) => {
    await enterDemo(page, true);
    await expect(page.locator('#m-screen-students-list')).toBeVisible();
    const { cid, date } = await seedDueClass(page);
    await page.reload();
    const line = page.locator('#m-screen-students-list .photo-expiry-line');
    await expect(line).toHaveCount(1);
    await expect(line.locator('.photo-expiry-text')).toHaveText(sentence(date));
    const btn = line.getByRole('button', { name: 'Open Class' });
    const box = await btn.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (SHOTS) await page.waitForTimeout(1200);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/photo-expiry-phone.png' });
    await btn.click();
    await expect.poll(() => page.evaluate(() => getActiveCourse())).toBe(cid);
    await expect(page.locator('.m-tabbar-name').first()).toHaveText('Social Studies 10');
    await expect(page.locator('.photo-expiry-line')).toHaveCount(0);
  });
});
