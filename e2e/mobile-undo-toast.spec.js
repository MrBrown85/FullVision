/**
 * On Observe, the "Observation deleted" toast sits above the + button, so
 * Undo restores the observation and the + button stays reachable. Runs in
 * Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

// A one-finger swipe left on the first card, the gesture that deletes it.
async function swipeFirstCard(page) {
  return page.evaluate(async () => {
    const card = document.querySelector('#m-obs-cards .m-obs-card[data-action]');
    const r = card.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const fire = (type, x) => {
      const t = { identifier: 1, target: card, clientX: x, clientY: y };
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
      Object.defineProperty(ev, 'changedTouches', { value: [t] });
      card.dispatchEvent(ev);
    };
    fire('touchstart', r.right - 20);
    for (let x = r.right - 40; x > r.left - 60; x -= 30) {
      fire('touchmove', x);
      await new Promise(f => setTimeout(f, 16));
    }
    fire('touchend', r.left - 60);
    return card.getAttribute('data-obid');
  });
}

const centre = box => [box.x + box.width / 2, box.y + box.height / 2];

test('Undo after a swipe delete sits above the + button and restores the observation', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await expect(page.locator('#m-obs-cards .m-obs-card').first()).toBeVisible();

  const obId = await swipeFirstCard(page);
  const undo = page.locator('#m-toast').getByRole('button', { name: 'Undo' });
  await expect(undo).toBeVisible();
  await expect(page.locator(`#m-obs-cards .m-obs-card[data-obid="${obId}"]`)).toHaveCount(0);

  const fab = page.locator('.m-fab');
  const fabBox = await fab.boundingBox();
  // The toast slides in, so wait for it to settle 12 px above the + button.
  await expect
    .poll(async () => {
      const b = await page.locator('#m-toast .m-toast-item').boundingBox();
      return Math.round(b.y + b.height);
    })
    .toBe(Math.round(fabBox.y - 12));

  // Nothing covers Undo or the + button.
  const hits = await page.evaluate(
    ([u, f]) => [
      document.elementFromPoint(u[0], u[1])?.closest('.m-toast-undo') !== null,
      document.elementFromPoint(f[0], f[1])?.closest('.m-fab') !== null,
    ],
    [centre(await undo.boundingBox()), centre(fabBox)],
  );
  expect(hits).toEqual([true, true]);

  await undo.click();
  await expect(page.locator(`#m-obs-cards .m-obs-card[data-obid="${obId}"]`)).toHaveCount(1);
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);

  await fab.click();
  await expect(page.locator('#m-sheet-container .m-sheet')).toBeVisible();
});
