/**
 * Back on the phone app: tapping Back drops the screen's history entry, the
 * browser's own back (Android button) pops the screen and never leaves the
 * app, a drag from the left edge goes back, and Back from a grading screen
 * opened on a student page slides back to that page. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();
}

const screens = page => page.locator('#m-nav-stack .m-screen');
const state = page => page.evaluate(() => JSON.stringify(history.state));

async function openTopStudent(page) {
  await page.locator('.m-card-stack-item[data-depth="0"] [data-action="m-student-detail"]').click();
  await expect(page.locator('#m-screen-student-detail')).toBeVisible();
  await expect(page.locator('#m-screen-student-detail')).not.toHaveClass(/m-push-enter-active/);
}

// A one-finger drag on the top screen from (x0, y) to (x1, y); `holdMs` is
// how long the finger rests before lifting (a quick lift is a flick).
async function drag(page, x0, x1, y, holdMs) {
  await page.evaluate(
    async ({ x0, x1, y, holdMs }) => {
      const el = document.querySelector('#m-nav-stack .m-screen:last-child');
      const fire = (type, x) => {
        const t = { identifier: 1, target: el, clientX: x, clientY: y };
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
        Object.defineProperty(ev, 'changedTouches', { value: [t] });
        el.dispatchEvent(ev);
      };
      fire('touchstart', x0);
      fire('touchmove', x0 + 12);
      fire('touchmove', x1);
      await new Promise(r => setTimeout(r, holdMs || 0));
      fire('touchend', x1);
    },
    { x0, x1, y, holdMs },
  );
}

test('tapping Back drops the history entry; the browser back pops a screen and stays in the app', async ({ page }) => {
  await enterDemo(page);
  expect(JSON.parse(await state(page))).toEqual({ m: 0, guard: true });

  await openTopStudent(page);
  expect(JSON.parse(await state(page))).toEqual({ m: 1 });
  await page.locator('#m-screen-student-detail [data-action="m-back"]').click();
  await expect(screens(page)).toHaveCount(1);
  await expect.poll(() => state(page)).toBe(JSON.stringify({ m: 0, guard: true }));

  await openTopStudent(page);
  await page.goBack();
  await expect(screens(page)).toHaveCount(1);
  await expect.poll(() => state(page)).toBe(JSON.stringify({ m: 0, guard: true }));

  // Back at the root stays on the app.
  await page.goBack();
  await expect.poll(() => state(page)).toBe(JSON.stringify({ m: 0, guard: true }));
  expect(page.url()).toMatch(/teacher-mobile\//);
  await expect(screens(page)).toHaveCount(1);
});

test('a drag from the left edge goes back; a short one springs back', async ({ page }) => {
  await enterDemo(page);
  await openTopStudent(page);
  await drag(page, 10, 200, 400);
  await expect(screens(page)).toHaveCount(1);
  await expect.poll(() => state(page)).toBe(JSON.stringify({ m: 0, guard: true }));

  await openTopStudent(page);
  await drag(page, 10, 50, 400, 600);
  await expect(screens(page)).toHaveCount(2);
  await expect(page.locator('#m-screen-student-detail')).toHaveCSS('transform', 'none');
  await expect(page.locator('#m-screen-students-list')).toBeHidden();
});

test('the screen under a pushed one dims, and Back from grading slides back to the student', async ({ page }) => {
  await enterDemo(page);
  await openTopStudent(page);
  const dimmed = await page.evaluate(() => {
    const list = document.getElementById('m-screen-students-list');
    return getComputedStyle(list, '::after').opacity;
  });
  // The push has ended: the dim is gone again and the screen is hidden.
  expect(Number(dimmed)).toBe(0);

  await page.locator('#m-screen-student-detail [data-action="m-student-grade"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await page.locator('#m-nav-bar-grade-swiper [data-action="m-back"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toHaveClass(/m-pop-exit-active/);
  await expect(page.locator('#m-screen-grade-swiper')).toHaveCount(0);
  await expect(page.locator('.m-tab-item[data-tab="students"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#m-screen-student-detail .m-hero-name')).toBeVisible();
});

// A class switch used to leave each tab's open screens saved, so the Grade
// tab reopened the old class's grading screen as a bare "Assessment not
// found" with no Back button.
test('after a class switch the Grade tab opens on its list, not the old class’s grading screen', async ({ page }) => {
  await enterDemo(page);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const other = await page.evaluate(() => createCourse({ name: 'Second Class' }).id);

  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('#m-grade-list .m-cell').first().click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  await page.waitForTimeout(500);

  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('#m-nav-stack [data-action="m-settings"]').first().click();
  await page.locator('#m-course-select').selectOption(other);
  await expect.poll(() => page.evaluate(() => getActiveCourse())).toBe(other);
  await expect(page.locator('#m-course-select')).toHaveCount(0);

  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-nav-stack')).not.toContainText('Assessment not found');
  await expect(page.locator('#m-screen-grade-swiper')).toHaveCount(0);
  await expect(page.locator('#m-nav-stack .m-screen')).toHaveCount(1);
});
