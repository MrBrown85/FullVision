/**
 * The class dashboard's boxes (Colin, 2026-10-22): the Core Competencies
 * and Upcoming Birthdays row is as tall as Upcoming Birthdays with its title
 * and three birthdays, whatever Next Steps holds, and every box is 12px from
 * the next, across and down. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.locator('.dash-overview-second').waitFor();
}

test('the birthdays row is as tall as three birthdays and stays that size', async ({ page }) => {
  await openDashboard(page);
  const fit = () =>
    page.evaluate(() => {
      var card = document.querySelector('.dash-bday-card');
      var rows = card.children;
      var last = rows[rows.length - 1].getBoundingClientRect();
      var box = card.getBoundingClientRect();
      var pad = parseFloat(getComputedStyle(card).paddingBottom) + parseFloat(getComputedStyle(card).borderBottomWidth);
      return {
        birthdays: rows.length - 1,
        spare: Math.round(box.bottom - pad - last.bottom),
        row: Math.round(document.querySelector('.dash-overview-second').getBoundingClientRect().height),
        cc: Math.round(document.querySelector('.dash-cc-card').getBoundingClientRect().height),
      };
    });
  const before = await fit();
  expect(before.birthdays).toBe(3);
  expect(before.spare).toBe(0);
  expect(before.cc).toBe(before.row);

  // Many Next Steps scroll inside the card; the row keeps its height.
  await page.evaluate(() => {
    var list = document.querySelector('.dash-action-list');
    var item = list.querySelector('.dash-action-item');
    for (var i = 0; i < 6; i++) list.appendChild(item.cloneNode(true));
  });
  const after = await fit();
  expect(after.row).toBe(before.row);
  // The first Next Step shows in full.
  const first = await page.evaluate(() => {
    var list = document.querySelector('.dash-action-list').getBoundingClientRect();
    var item = document.querySelector('.dash-action-item').getBoundingClientRect();
    return Math.round(item.bottom - list.bottom);
  });
  expect(first).toBeLessThanOrEqual(0);
});

test('every box on the dashboard is 12px from the next', async ({ page }) => {
  await openDashboard(page);
  const gaps = await page.evaluate(() => {
    var boxes = Array.prototype.slice
      .call(document.querySelectorAll('.dash-overview-section, .dash-card'))
      .slice(0, 12)
      .map(function (el) {
        var r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom };
      });
    var out = [];
    boxes.forEach(function (a) {
      // The nearest box to the right on the same line, and the nearest below
      // that overlaps it across.
      var right = boxes.filter(function (b) {
        return Math.abs(b.t - a.t) < 1 && b.l > a.r;
      });
      if (right.length)
        out.push(
          Math.round(
            Math.min.apply(
              null,
              right.map(b => b.l),
            ) - a.r,
          ),
        );
      var below = boxes.filter(function (b) {
        return b.t > a.b && b.l < a.r && b.r > a.l;
      });
      if (below.length)
        out.push(
          Math.round(
            Math.min.apply(
              null,
              below.map(b => b.t),
            ) - a.b,
          ),
        );
    });
    return out;
  });
  expect(gaps.length).toBeGreaterThan(10);
  expect(new Set(gaps)).toEqual(new Set([12]));
});
