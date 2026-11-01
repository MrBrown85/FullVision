/**
 * Pull to refresh on the phone app: a pull on a list at its top brings the
 * content down with the finger, a short one springs back, a long one holds
 * while the class reloads; the card stack and a scrolled list do not pull.
 * Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();
}

// A one-finger drag down on `selector` from y0 to y1; `lift` false keeps the
// finger down so the state mid-pull can be read.
async function pull(page, selector, y0, y1, lift) {
  await page.evaluate(
    ({ selector, y0, y1, lift }) => {
      const el = document.querySelector(selector);
      const fire = (type, y) => {
        const t = { identifier: 1, target: el, clientX: 180, clientY: y };
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
        Object.defineProperty(ev, 'changedTouches', { value: [t] });
        el.dispatchEvent(ev);
      };
      fire('touchstart', y0);
      fire('touchmove', y0 + 20);
      fire('touchmove', y1);
      if (lift) fire('touchend', y1);
    },
    { selector, y0, y1, lift },
  );
}

const lift = page =>
  page.evaluate(() => {
    const ev = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: [] });
    document.querySelector('#m-obs-feed-content .m-filter-strip').dispatchEvent(ev);
  });

const feed = '#m-obs-feed-content';
const pullState = page =>
  page.evaluate(() => {
    const c = document.querySelector('#m-obs-feed-content');
    const ind = document.querySelector('.m-pull-indicator');
    return {
      transform: c.style.transform,
      height: ind ? ind.style.height : '',
      ready: !!ind && ind.classList.contains('m-pull-ready'),
    };
  });

test('the card stack does not pull to refresh', async ({ page }) => {
  await enterDemo(page);
  await pull(page, '.m-card-stack-item[data-depth="0"]', 200, 400, true);
  expect(await page.locator('.m-pull-indicator').count()).toBe(0);
  expect(await page.locator('#m-screen-students-list .m-screen-content').evaluate(el => el.style.transform)).toBe('');
});

test('a short pull follows the finger and springs back; a long one holds while the class reloads', async ({ page }) => {
  await enterDemo(page);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await expect(page.locator(feed)).toBeVisible();

  await pull(page, feed + ' .m-filter-strip', 300, 380, false);
  expect(await pullState(page)).toEqual({ transform: 'translateY(40px)', height: '40px', ready: false });
  await lift(page);
  await expect.poll(() => pullState(page)).toEqual({ transform: '', height: '0px', ready: false });

  await pull(page, feed + ' .m-filter-strip', 300, 480, false);
  expect(await pullState(page)).toEqual({ transform: 'translateY(90px)', height: '90px', ready: true });
  await lift(page);
  // Held while the reload runs, then back in place.
  await expect.poll(() => pullState(page)).toEqual({ transform: 'translateY(48px)', height: '48px', ready: true });
  await expect.poll(() => pullState(page), { timeout: 10000 }).toEqual({ transform: '', height: '0px', ready: false });
});

test('a scrolled list does not pull', async ({ page }) => {
  await enterDemo(page);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await page.locator(feed).evaluate(el => {
    el.scrollTop = 200;
  });
  await pull(page, feed + ' .m-filter-strip', 300, 480, true);
  expect((await pullState(page)).transform).toBe('');
});
