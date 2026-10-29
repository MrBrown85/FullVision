/**
 * The sweep's first pick is named on screen: the panel scrolls so the
 * student's name sits just under the Sweep bar, not behind it. A Students
 * search with no match says so. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
}

// Once the smooth scroll has stopped: the name's top less the bar's bottom,
// positive when the name is below the bar.
async function nameBelowBar(page) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate(() => document.getElementById('m-sweep-content').scrollTop);
    if (now === last) break;
    last = now;
    await page.waitForTimeout(150);
  }
  return page.evaluate(() => {
    const name = document.querySelector('.m-sweep-panel-name').getBoundingClientRect();
    const bar = document.getElementById('m-nav-bar-obs-sweep').getBoundingClientRect();
    return Math.round(name.top - bar.bottom);
  });
}

test('the first student picked in a sweep is named just under the Sweep bar', async ({ page }) => {
  await enterDemo(page);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await page.getByRole('button', { name: 'Start a sweep' }).click();
  // Safari has no scroll anchoring, so Chromium's would hide the bug.
  await page.evaluate(() => (document.getElementById('m-sweep-content').style.overflowAnchor = 'none'));
  await page.locator('.m-sweep-tile[data-state=""]').first().click();
  const panel = page.locator('#m-sweep-panel');
  await expect(panel.locator('.m-sweep-panel-name')).toBeVisible();
  const below = await nameBelowBar(page);
  expect(below).toBeGreaterThanOrEqual(0);
  expect(below).toBeLessThanOrEqual(40);

  // Save and Next keeps the next name in the same place.
  await panel.locator('.m-sweep-starter').first().click();
  await panel.getByRole('button', { name: 'Save and Next' }).click();
  const next = await nameBelowBar(page);
  expect(next).toBeGreaterThanOrEqual(0);
  expect(next).toBeLessThanOrEqual(40);
});

test('a Students search with no match says so', async ({ page }) => {
  await enterDemo(page);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  const search = page.locator('.m-search-input');
  await search.fill('zz');
  await expect(page.locator('#m-student-search-empty')).toHaveText('No students match “zz”.');
  await search.fill('Cec');
  await expect(page.locator('#m-student-search-empty')).toHaveCount(0);
  await expect(page.locator('#m-student-list .m-cell:visible')).toHaveCount(1);
  await search.fill('');
  await expect(page.locator('#m-student-search-empty')).toHaveCount(0);
});
