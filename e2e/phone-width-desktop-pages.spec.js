/**
 * Step 4 sweep: the desktop pages at phone width (375x812), Demo Mode.
 * Each test names the finding it covers.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

async function openDesktop(page, path) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\/|dashboard/);
  await page.goto(path);
  await expect(page.locator('#app-dock')).toBeVisible();
}

// What overlaps what in the top bar, and whether the page scrolls sideways.
async function dockAndPage(page) {
  return page.evaluate(() => {
    const box = s => document.querySelector(s).getBoundingClientRect();
    const seg = document.querySelector('.tb-seg');
    const left = box('.tb-left');
    const right = box('.tb-right');
    const segBox = seg.getBoundingClientRect();
    const active = seg.querySelector('.tb-seg-active').getBoundingClientRect();
    const main = document.getElementById('main');
    return {
      segLeft: segBox.left,
      segRight: segBox.right,
      leftEnd: left.width ? left.right : 0,
      rightStart: right.left,
      activeIn: active.left >= segBox.left - 1 && active.right <= segBox.right + 1,
      pageSideways: document.documentElement.scrollWidth > innerWidth || (main && main.scrollWidth > main.clientWidth + 1),
    };
  });
}

// Group 2 #40: the top tabs fit between the sidebar button and the sync dot
// and account button, the open tab shows, and the Dashboard doesn't scroll
// sideways.
for (const [path, tab] of [
  ['/dashboard', 'Dashboard'],
  ['/assignments', 'Assignments'],
  ['/observations', 'Observations'],
  ['/gradebook', 'Gradebook'],
  ['/reports', 'Reports'],
]) {
  test(`top tabs fit a phone on ${tab}`, async ({ page }) => {
    await openDesktop(page, path);
    await expect(page.locator('.tb-seg-active')).toHaveText(tab);
    const d = await dockAndPage(page);
    expect(d.segLeft).toBeGreaterThanOrEqual(d.leftEnd - 0.5);
    expect(d.segRight).toBeLessThanOrEqual(d.rightStart + 0.5);
    expect(d.activeIn).toBe(true);
    if (path === '/dashboard') expect(d.pageSideways).toBe(false);
  });
}
