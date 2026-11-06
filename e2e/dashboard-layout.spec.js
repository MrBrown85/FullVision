/**
 * The class dashboard's boxes (docs/plans/dashboard-cards-plan.md, part F):
 * the top bar, then Curricular and Core Competencies side by side at one
 * height (stacked below 900 px), then the students, then Observations;
 * every box 12px from the next. The Needs Attention card is gone; the top
 * bar's Missing and Late opens the gradebook. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-comp-card .dash-comp-row').first().waitFor();
}

// Draws a pair of views without the menu (the menu is tested elsewhere).
async function showViews(page, comp, core) {
  await page.evaluate(
    ([comp, core]) => {
      localStorage.setItem('fv-dash-comp-view:sci8', comp);
      localStorage.setItem('fv-dash-core-view:sci8', core);
      PageDashboard.render();
    },
    [comp, core],
  );
  await expect(page.locator('.dash-comp-card')).toHaveAttribute('data-view', comp);
}

function measure(page) {
  return page.evaluate(() => {
    const a = document.querySelector('.dash-comp-card').getBoundingClientRect();
    const b = document.querySelector('.dash-core-card').getBoundingClientRect();
    const main = document.getElementById('main');
    return {
      compH: Math.round(a.height),
      coreH: Math.round(b.height),
      sideBySide: Math.abs(a.top - b.top) < 1 && b.left > a.right,
      docX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mainX: main.scrollWidth - main.clientWidth,
    };
  });
}

test('there is no Needs Attention card', async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator('#dash-na-card, .dash-na-row, [data-action="naFilter"]')).toHaveCount(0);
});

for (const width of [1440, 1280, 1024]) {
  test(`at ${width}px the competency cards share one height in every view, and nothing scrolls sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    for (const comp of ['avg', 'mix', 'below', 'trend']) {
      for (const core of ['self', 'evidence']) {
        await showViews(page, comp, core);
        const m = await measure(page);
        expect(m.sideBySide, `${comp}/${core}`).toBe(true);
        expect(m.compH, `${comp}/${core}`).toBe(m.coreH);
        expect(m.compH).toBeGreaterThanOrEqual(300);
        expect(m.docX, `sideways at ${width} ${comp}/${core}`).toBeLessThanOrEqual(0);
        expect(m.mainX, `sideways at ${width} ${comp}/${core}`).toBeLessThanOrEqual(0);
      }
    }
  });
}

test('below 900px the competency cards stack, each at least 300px', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openDashboard(page);
  const m = await page.evaluate(() => {
    const a = document.querySelector('.dash-comp-card').getBoundingClientRect();
    const b = document.querySelector('.dash-core-card').getBoundingClientRect();
    return { stacked: b.top >= a.bottom, a: a.height, b: b.height };
  });
  expect(m.stacked).toBe(true);
  expect(m.a).toBeGreaterThanOrEqual(300);
  expect(m.b).toBeGreaterThanOrEqual(300);
});

test("the class's competency codes are unique, on the cards and in Needs Support", async ({ page }) => {
  await openDashboard(page);
  await showViews(page, 'below', 'self');
  const codes = await page.evaluate(() => Object.values(DashInsights.columnCodes('sci8')));
  expect(new Set(codes).size).toBe(codes.length);
  await expect(page.locator('.dash-comp-card .dash-comp-code')).toHaveText(codes);
  const chips = await page
    .locator('.dash-grid .dash-card')
    .first()
    .locator('button.dash-card-seg')
    .evaluateAll(els => els.map(el => el.firstChild.textContent));
  expect(chips).toEqual(codes);
});

test('Missing and Late opens the gradebook', async ({ page }) => {
  await openDashboard(page);
  // Something missing (new work with no score), so the cell is a link.
  await page.evaluate(() => {
    const today = getTodayStr();
    saveAssessments(
      'sci8',
      getAssessments('sci8').concat([{ id: 'zz-missing', title: 'Late Lab', date: today, dueDate: today, tagIds: [] }]),
    );
    const st = getStudents('sci8')[0];
    const statuses = Object.assign({}, getAssignmentStatuses('sci8'));
    statuses[st.id + ':zz-missing'] = 'NS';
    saveAssignmentStatuses('sci8', statuses);
    PageDashboard.render();
  });
  const cell = page.locator('.dash-glance-missing');
  await expect(cell).toHaveAttribute('data-href', '/gradebook?course=sci8');
  await cell.click();
  await expect(page).toHaveURL(/\/gradebook\?course=sci8/);
});

test('pointing at a competency lights its chip on every student card, and only then', async ({ page }) => {
  await openDashboard(page);
  await showViews(page, 'avg', 'self');
  const row = page.locator('.dash-comp-card .dash-comp-row').nth(1);
  const key = await row.getAttribute('data-key');
  const cards = await page.locator('.dash-grid > .dash-card').count();
  const lit = page.locator('.dash-grid .dash-card-seg.is-lit');
  await row.hover();
  await expect(lit).toHaveCount(cards);
  expect(await lit.evaluateAll(els => els.every(el => el.dataset.key))).toBe(true);
  expect(new Set(await lit.evaluateAll(els => els.map(el => el.dataset.key)))).toEqual(new Set([key]));
  // An outline only: no card re-sorted, no chip faded.
  await expect(page.locator('.dash-card-strip.has-focus')).toHaveCount(0);
  await page.locator('.dash-students-title').hover();
  await expect(lit).toHaveCount(0);
  // With the competency filter set, pointing lights nothing.
  await row.click();
  await expect(page.locator('.dash-comp-chip')).toBeVisible();
  await page.locator('.dash-comp-card .dash-comp-row').nth(2).hover();
  await expect(lit).toHaveCount(0);
});

test('a student card has the flag at its foot and the full name in a title', async ({ page }) => {
  await openDashboard(page);
  const card = page.locator('.dash-grid > .dash-card').first();
  await expect(card.locator('.dash-card-header .dash-flag-btn')).toHaveCount(0);
  const flag = card.locator('.dash-card-footer > .dash-flag-btn');
  await expect(flag).toHaveAttribute('aria-label', 'Flag student');
  const box = await flag.boundingBox();
  expect(Math.round(box.width)).toBe(22);
  await flag.click();
  await expect(card.locator('.dash-card-footer > .dash-flag-btn')).toHaveAttribute('aria-label', 'Unflag student');
  const name = card.locator('.dash-card-name');
  await expect(name).toHaveAttribute('title', (await name.textContent()).trim());
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
