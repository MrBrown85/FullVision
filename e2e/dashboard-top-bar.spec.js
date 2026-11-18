/**
 * Dashboard top bar, slice D1: when the class average has not changed since
 * the last report, the "No Change" line stays in the page (so the cell keeps
 * its height) and is not visible. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-comp-card .dash-comp-row').first().waitFor();
}

// Draws the Dashboard with the change forced, and reports the cell's state.
async function drawWith(page, change) {
  return page.evaluate(c => {
    window.classGradeChange = () => c;
    PageDashboard.render();
    const cell = document.querySelector('.dash-glance-avg');
    const el = cell.querySelector('.dash-glance-change');
    return {
      height: cell.getBoundingClientRect().height,
      present: !!el,
      visibility: el ? getComputedStyle(el).visibility : null,
      ariaHidden: el ? el.getAttribute('aria-hidden') : null,
    };
  }, change);
}

test('No Change is in the page, invisible, and the Class Average cell keeps its height', async ({ page }) => {
  await openDashboard(page);
  const none = await drawWith(page, { text: 'No Change', dir: 0, since: 'Report 1' });
  const up = await drawWith(page, { text: '▲ 0.3', dir: 1, since: 'Report 1' });
  const down = await drawWith(page, { text: '▼ 0.3', dir: -1, since: 'Report 1' });

  expect(none.present).toBe(true);
  expect(none.visibility).toBe('hidden');
  expect(none.ariaHidden).toBe('true');
  expect(up.visibility).toBe('visible');
  expect(up.ariaHidden).toBeNull();
  expect(down.visibility).toBe('visible');
  expect(none.height).toBe(up.height);
  expect(none.height).toBe(down.height);
});
