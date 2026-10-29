/**
 * The Students card stack fits between the search field and the tab bar on
 * every phone size, and a swipe moves the next card up in place (it eases to
 * full size) instead of rebuilding the stack. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-view-toggle-btn[data-mode="cards"]').click();
  await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();
}

// A one-finger swipe left across the top card.
async function swipeTopCard(page) {
  await page.evaluate(async () => {
    const stack = document.getElementById('m-student-card-stack');
    const card = stack.querySelector('.m-card-stack-item[data-depth="0"]');
    const r = card.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const fire = (type, x) => {
      const t = { identifier: 1, target: card, clientX: x, clientY: y };
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
      Object.defineProperty(ev, 'changedTouches', { value: [t] });
      card.dispatchEvent(ev);
    };
    fire('touchstart', r.right - 30);
    for (let x = r.right - 50; x > r.left - 40; x -= 30) {
      fire('touchmove', x);
      await new Promise(f => setTimeout(f, 16));
    }
    fire('touchend', r.left - 40);
  });
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 393, height: 852 },
]) {
  test(`the card and its count sit above the tab bar at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterDemo(page);
    const m = await page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      const content = document.querySelector('#m-screen-students-list .m-screen-content');
      return {
        actionsBottom: box('.m-card-stack-item[data-depth="0"] .m-scard-actions').bottom,
        counterBottom: box('.m-card-counter').bottom,
        tabTop: box('#m-tab-bar').top,
        pageScrolls: content.scrollHeight > content.clientHeight,
      };
    });
    expect(m.actionsBottom).toBeLessThan(m.counterBottom);
    expect(m.counterBottom).toBeLessThanOrEqual(m.tabTop);
    expect(m.pageScrolls).toBe(false);
  });
}

test('a swipe moves the next card up in place and keeps the stack', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 659 });
  await enterDemo(page);
  const fullWidth = (await page.locator('.m-card-stack-item[data-depth="0"]').boundingBox()).width;
  await page.evaluate(() => {
    document.querySelector('.m-card-stack-item[data-depth="1"]').dataset.testNext = '1';
  });

  await swipeTopCard(page);
  await expect(page.locator('.m-card-counter')).toHaveText('2 of 27');
  // The card that was behind is now on top: the same element, not a rebuild.
  const top = page.locator('.m-card-stack-item[data-depth="0"]');
  await expect(top).toHaveAttribute('data-test-next', '1');
  await expect.poll(async () => Math.round((await top.boundingBox()).width)).toBe(Math.round(fullWidth));
  await expect(page.locator('.m-card-stack-item')).toHaveCount(3);
});
