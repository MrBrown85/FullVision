/**
 * One spacing across the app's pages (Colin, 2026-10-22: "they should be
 * consistent … as this is a cohesive app"): boxes sit 12px from the page's
 * edges and 12px from each other, and each toolbar's controls start 12px in,
 * in line with the boxes below. Demo Mode, 1440px wide. The dashboard's
 * boxes have their own test (dashboard-layout.spec.js).
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, hash) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), hash);
}

/* The page's boxes (rounded, filled, edged, not inside another box): their
   distance from the main area's sides, and every gap to the nearest box
   across and below. */
function measure(page, selector) {
  return page.evaluate(sel => {
    var main = document.getElementById('main').getBoundingClientRect();
    var els = Array.prototype.slice.call(document.querySelectorAll(sel)).slice(0, 12);
    var boxes = els.map(function (el) {
      var r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    });
    var gaps = [];
    boxes.forEach(function (a) {
      var right = boxes.filter(b => b !== a && b.l >= a.r - 0.5 && b.t < a.b && b.b > a.t);
      if (right.length)
        gaps.push(
          Math.round(
            Math.min.apply(
              null,
              right.map(b => b.l),
            ) - a.r,
          ),
        );
      var below = boxes.filter(b => b !== a && b.t >= a.b - 0.5 && b.l < a.r && b.r > a.l);
      if (below.length)
        gaps.push(
          Math.round(
            Math.min.apply(
              null,
              below.map(b => b.t),
            ) - a.b,
          ),
        );
    });
    return {
      left: Math.round(
        Math.min.apply(
          null,
          boxes.map(b => b.l),
        ) - main.left,
      ),
      right: Math.round(
        main.right -
          Math.max.apply(
            null,
            boxes.map(b => b.r),
          ),
      ),
      gaps: Array.from(new Set(gaps)),
    };
  }, selector);
}

const toolbarInset = (page, selector) =>
  page.evaluate(sel => parseFloat(getComputedStyle(document.querySelector(sel)).paddingLeft), selector);

test('Assignments: 12px edges, 12px between cards, toolbar in line', async ({ page }) => {
  await open(page, '/assignments');
  await page.locator('.assess-card').first().waitFor();
  const m = await measure(page, '.assess-card');
  expect([m.left, m.right]).toEqual([12, 12]);
  expect(m.gaps).toEqual([12]);
  expect(await toolbarInset(page, '.assess-toolbar')).toBe(12);
});

test('Observations: 12px edges, 12px between cards in a day, capture box in line', async ({ page }) => {
  await open(page, '/observations');
  await page.locator('.obs-card').first().waitFor();
  const m = await measure(page, '.obs-feed-date-group:nth-of-type(2) .obs-card');
  expect(m.left).toBe(12);
  expect(m.gaps).toEqual([12]);
  const lefts = await page.evaluate(() => [
    Math.round(document.querySelector('.obs-note-box').getBoundingClientRect().left),
    Math.round(document.querySelector('.obs-card').getBoundingClientRect().left),
  ]);
  expect(lefts[0]).toBe(lefts[1]);
  expect(await toolbarInset(page, '.obs-toolbar')).toBe(12);
});

test('Term Questionnaire: 12px edges and 12px between the strip and the cards', async ({ page }) => {
  await open(page, '/reports');
  await page.locator('.qn-strip').waitFor();
  const strip = await measure(page, '.qn-strip');
  expect([strip.left, strip.right]).toEqual([12, 12]);
  // The evidence column's first card is 12px in from the page and under the strip's divider.
  const card = await page.evaluate(() => {
    const main = document.getElementById('main').getBoundingClientRect();
    const c = document.querySelector('.qn-evidence .qn-card')?.getBoundingClientRect();
    const side = document.querySelector('.qn-comment-card').getBoundingClientRect();
    const sideCol = document.querySelector('.qn-side').getBoundingClientRect();
    return {
      left: c ? Math.round(c.left - main.left) : 12,
      sideRight: Math.round(sideCol.right - side.right),
    };
  });
  expect(card.left).toBe(12);
  expect(card.sideRight).toBe(12);
});

test('Dashboard: the toolbar is in line with the boxes', async ({ page }) => {
  await open(page, '/dashboard');
  await page.locator('.dash-toolbar').waitFor();
  expect(await toolbarInset(page, '.dash-toolbar')).toBe(12);
});

// The student page's header card has no counts (Colin, 2026-10-24). The Term
// Questionnaire has its own strip since DECISIONS 14.
test('Student page: 12px edges and gaps; no counts in its header', async ({ page }) => {
  await open(page, '/student?id=st27&tab=comps');
  await page.locator('.stu-panel').waitFor();
  const m = await measure(page, '.student-header-top, .stu-tabs, .stu-panel');
  expect([m.left, m.right]).toEqual([12, 12]);
  expect(m.gaps).toEqual([12]);
  expect(await toolbarInset(page, '.student-toolbar')).toBe(12);
  await expect(page.locator('.student-header-top .sh-stat')).toHaveCount(0);
});
