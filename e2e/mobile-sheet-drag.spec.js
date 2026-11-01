/**
 * Dragging a sheet on the phone app: the dim fades with the drag, a quick
 * flick down closes the sheet even when short, a slow short drag springs
 * back, and the Settings sheet has no Cancel button. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

async function openSettings(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('[data-action="m-settings"]').first().click();
  await expect(page.locator('#m-sheet-container .m-sheet.m-sheet-visible')).toBeVisible();
}

// A one-finger drag down on the sheet handle by `dy`, lifting after `holdMs`.
async function dragSheet(page, dy, holdMs) {
  return page.evaluate(
    async ({ dy, holdMs }) => {
      const handle = document.querySelector('#m-sheet-container .m-sheet-handle');
      const sheet = handle.closest('.m-sheet');
      const y0 = handle.getBoundingClientRect().top + 5;
      const fire = (type, y) => {
        const t = { identifier: 1, target: handle, clientX: 180, clientY: y };
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
        Object.defineProperty(ev, 'changedTouches', { value: [t] });
        handle.dispatchEvent(ev);
      };
      fire('touchstart', y0);
      fire('touchmove', y0 + 12);
      fire('touchmove', y0 + dy);
      const mid = {
        transform: sheet.style.transform,
        dim: document.getElementById('m-sheet-backdrop').style.opacity,
      };
      await new Promise(r => setTimeout(r, holdMs));
      fire('touchend', y0 + dy);
      return mid;
    },
    { dy, holdMs },
  );
}

test('the dim follows the drag; a flick closes the sheet, a slow short drag springs back', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#m-sheet-container')).not.toContainText('Cancel');

  const slow = await dragSheet(page, 40, 600);
  expect(slow.transform).toBe('translateY(40px)');
  expect(Number(slow.dim)).toBeLessThan(1);
  expect(Number(slow.dim)).toBeGreaterThan(0.5);
  await expect(page.locator('#m-sheet-container .m-sheet.m-sheet-visible')).toBeVisible();
  await expect(page.locator('#m-sheet-backdrop')).toHaveCSS('opacity', '1');

  await dragSheet(page, 40, 0);
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
  await expect(page.locator('#m-sheet-backdrop')).toHaveClass(/u-hidden/);
});
