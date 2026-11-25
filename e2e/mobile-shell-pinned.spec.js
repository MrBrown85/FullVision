/**
 * The phone app stays put like an app: the page itself never scrolls (only
 * each screen's content does), the tab bar sits on the screen's bottom edge
 * with nothing under it, a scrolled page (as iOS leaves it after a reload or
 * the keyboard) goes back to the top, and the large title scrolls away with
 * the content instead of collapsing. Runs in Demo Mode.
 *
 * Playwright's browsers are not iOS Safari: no home-screen mode, no real safe
 * areas, no rubber band. This checks the layout those depend on.
 */
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('#m-tab-bar')).toBeVisible();
}

const shell = page =>
  page.evaluate(() => {
    const se = document.scrollingElement;
    const app = document.getElementById('m-app').getBoundingClientRect();
    const bar = document.getElementById('m-tab-bar').getBoundingClientRect();
    return {
      innerHeight: window.innerHeight,
      scrollHeight: se.scrollHeight,
      scrollY: window.scrollY,
      appTop: app.top,
      appBottom: app.bottom,
      barBottom: bar.bottom,
    };
  });

for (const size of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`the page fits the screen exactly at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await enterDemo(page);
    const s = await shell(page);
    expect(s.scrollHeight).toBeLessThanOrEqual(s.innerHeight);
    expect(s.appTop).toBe(0);
    expect(s.appBottom).toBe(s.innerHeight);
    expect(s.barBottom).toBe(s.innerHeight);
  });
}

test('a scrolled page goes back to the top; a screen still scrolls in itself', async ({ page }) => {
  await enterDemo(page);
  // What iOS does on a reload or after the keyboard: the page itself scrolled.
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'visible';
    document.body.style.height = '2000px';
    document.body.style.position = 'static';
    window.scrollTo(0, 120);
    document.body.style.cssText = '';
    document.documentElement.style.overflow = '';
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const s = await shell(page);
  expect(s.barBottom).toBe(s.innerHeight);
});

// The new look has no large title on Bulletins (the tab names it): the list scrolls without a jump.
test('the list scrolls under the bar; the list does not jump', async ({ page }) => {
  await enterDemo(page);
  await page.locator('#m-tab-bar [data-tab="bulletins"]').click();
  const content = page.locator('#m-screen-bulletins .m-screen-content');
  await expect(content.locator('#m-bulletin-feed')).toBeVisible();
  await expect(content.locator('.m-title-large')).toBeHidden();
  // Enough below the title to scroll, whatever the demo class has posted.
  const before = await content.evaluate(c => {
    const pad = document.createElement('div');
    pad.style.height = '1200px';
    c.appendChild(pad);
    return c.scrollHeight;
  });
  await content.evaluate(c => {
    c.scrollTop = 30;
    c.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#m-nav-bar-bulletins')).toHaveClass(/m-nav-bar-scrolled/);
  const after = await content.evaluate(c => ({ h: c.scrollHeight, top: c.scrollTop }));
  expect(after.h).toBe(before);
  expect(after.top).toBe(30);
});
