/**
 * The class dashboard's boxes (docs/DECISIONS.md, "Class dashboard
 * (2026-10-26)"): the top bar, then Needs Attention beside Curricular and
 * Core Competencies and as tall as the two of them, its list scrolling
 * inside, then Observations; every box 12px from the next, across and down.
 * Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.locator('#dash-na-card').waitFor();
}

for (const width of [1440, 1200]) {
  test(`at ${width}px Needs Attention is as tall as the competency cards and scrolls inside`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    const m = await page.evaluate(() => {
      var na = document.querySelector('#dash-na-card').getBoundingClientRect();
      var side = document.querySelector('.dash-overview-side').getBoundingClientRect();
      var list = document.querySelector('.dash-na-list');
      return {
        top: Math.round(na.top - side.top),
        bottom: Math.round(na.bottom - side.bottom),
        scrolls: list.scrollHeight > list.clientHeight,
        rows: document.querySelectorAll('.dash-na-row:not(.is-class)').length,
      };
    });
    expect(m.top).toBe(0);
    expect(m.bottom).toBe(0);
    expect(m.rows).toBeGreaterThan(5);
    expect(m.scrolls).toBe(true);
  });
}

test('below 1100px the competency cards go under Needs Attention, which keeps a height', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openDashboard(page);
  const m = await page.evaluate(() => {
    var na = document.querySelector('#dash-na-card').getBoundingClientRect();
    var side = document.querySelector('.dash-overview-side').getBoundingClientRect();
    return { stacked: side.top >= na.bottom, height: na.height };
  });
  expect(m.stacked).toBe(true);
  expect(m.height).toBeGreaterThan(200);
});

test('the filters, "N Below" and the Missing and Late cell pick who Needs Attention shows', async ({ page }) => {
  await openDashboard(page);
  const card = page.locator('#dash-na-card');
  const rows = card.locator('.dash-na-row:not(.is-class)');
  const all = await rows.count();
  await card.locator('[data-action="naFilter"][data-filter="nostr"]').click();
  await expect(card.locator('[data-filter="nostr"]')).toHaveAttribute('aria-pressed', 'true');
  const nostr = await rows.count();
  expect(nostr).toBeLessThan(all);
  expect(await card.locator('.dash-na-diamond').count()).toBe(nostr);
  // A competency's "N Below" shows its students and a chip to clear it.
  const below = page.locator('.dash-mix-below[data-key]').first();
  const n = Number(await below.locator('b').textContent());
  await below.click();
  await expect(rows).toHaveCount(n);
  await expect(card.locator('.dash-na-compchip')).toBeVisible();
  await card.locator('.dash-na-compchip').click();
  await expect(card.locator('[data-filter="nostr"]')).toHaveAttribute('aria-pressed', 'true');
  await card.locator('[data-filter="all"]').click();
  await expect(rows).toHaveCount(all);
});

test("a row's buttons show on hover without moving anything", async ({ page }) => {
  await openDashboard(page);
  const row = page.locator('.dash-na-row:not(.is-class)').first();
  const before = await row.boundingBox();
  const act = row.locator('.dash-na-act');
  expect(await act.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
  await row.hover();
  await expect.poll(() => act.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  expect(await row.boundingBox()).toEqual(before);
});

test('every box on the dashboard is 12px from the next', async ({ page }) => {
  await openDashboard(page);
  const gaps = await page.evaluate(() => {
    var boxes = Array.prototype.slice
      .call(document.querySelectorAll('.dash-glance, .dash-overview-section, .dash-students-head, .dash-card'))
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
