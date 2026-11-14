/**
 * The phone's pull to refresh and swipe back listen to the finger's moves
 * only while a gesture of theirs is armed (speed assessment P5). A touch
 * move listener that is not passive makes the browser wait for the page's
 * script before it scrolls, so one left on the page for the whole time made
 * every scroll wait. Counted: the non-passive touchmove listeners on the
 * document and the screen stack, at rest, while a gesture is armed, and
 * after the finger lifts. The touches are sent the way a real finger's are
 * (CDP Input.dispatchTouchEvent), so a pull and a swipe back still stop the
 * scroll. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

// Before any script: keep a count of the live non-passive touchmove listeners per target.
function countListeners() {
  const live = new Map(); // target name -> Set of listeners
  const name = t => (t === document ? 'document' : t && t.id === 'm-nav-stack' ? 'stack' : null);
  const passive = o => !!(o && typeof o === 'object' && o.passive);
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    const n = name(this);
    if (type === 'touchmove' && n && !passive(opts)) {
      if (!live.has(n)) live.set(n, new Set());
      live.get(n).add(fn);
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const n = name(this);
    if (type === 'touchmove' && n && live.has(n)) live.get(n).delete(fn);
    return remove.call(this, type, fn, opts);
  };
  window.__blockingMoves = () => ({
    document: live.has('document') ? live.get('document').size : 0,
    stack: live.has('stack') ? live.get('stack').size : 0,
  });
}

async function enterDemo(page) {
  await page.addInitScript(countListeners);
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();
}

const counts = page => page.evaluate(() => window.__blockingMoves());

async function finger(page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    down: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
    move: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }),
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  };
}

test('no touch move listener blocks a scroll at rest', async ({ page }) => {
  await enterDemo(page);
  expect(await counts(page)).toEqual({ document: 0, stack: 0 });
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await expect(page.locator('#m-obs-feed-content')).toBeVisible();
  expect(await counts(page)).toEqual({ document: 0, stack: 0 });
});

test('a pull at the top of a list listens while the finger is down, and still pulls', async ({ page }) => {
  await enterDemo(page);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  const strip = page.locator('#m-obs-feed-content .m-filter-strip');
  await expect(strip).toBeVisible();
  const box = await strip.boundingBox();
  const x = box.x + 40;
  const y = box.y + box.height / 2;
  const f = await finger(page);
  await f.down(x, y);
  expect(await counts(page)).toEqual({ document: 1, stack: 0 });
  for (let d = 10; d <= 100; d += 10) await f.move(x, y + d);
  // The pull followed the finger: its move was not passive.
  await expect
    .poll(() => page.locator('#m-obs-feed-content').evaluate(el => el.style.transform))
    .toBe('translateY(50px)');
  await f.up();
  expect(await counts(page)).toEqual({ document: 0, stack: 0 });
  await expect.poll(() => page.locator('#m-obs-feed-content').evaluate(el => el.style.transform)).toBe('');
});

test('a touch away from the left edge does not arm the swipe back; one at the edge does, and still goes back', async ({
  page,
}) => {
  await enterDemo(page);
  // A second screen, so there is somewhere to swipe back to.
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  const row = page.locator('[data-action="m-grade-assess"]').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  const f = await finger(page);
  // On the title, away from the edge: nothing arms.
  await f.down(200, 60);
  expect((await counts(page)).stack).toBe(0);
  await f.up();
  await f.down(8, 600);
  expect((await counts(page)).stack).toBe(1);
  for (let x = 28; x <= 328; x += 20) await f.move(x, 600);
  await f.up();
  expect((await counts(page)).stack).toBe(0);
  // The swipe was not passive: it went back to the list.
  await expect(page.locator('#m-screen-grade-swiper')).toHaveCount(0);
});
