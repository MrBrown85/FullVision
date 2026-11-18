/**
 * The Dashboard's middle row behind the dashRow switch (D2 of
 * docs/plans/dashboard-inbox-plan.md): a left tile at two thirds and one
 * Competencies tile at one third, as tall as the window leaves, with the
 * Students heading below the first view. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';

async function openDashboard(page, { flag = true, bulletins = false } = {}) {
  await page.addInitScript(
    ([flag, bulletins]) => {
      try {
        if (flag) localStorage.setItem('fv-build-dashRow', '1');
        if (bulletins) localStorage.setItem('fv-build-bulletins', '1');
      } catch (e) {
        /* storage blocked */
      }
    },
    [flag, bulletins],
  );
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
}

const box = (page, sel) =>
  page
    .locator(sel)
    .first()
    .evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });

async function row(page) {
  return {
    row: await box(page, '.dash-row'),
    heading: await box(page, '.dash-students-head'),
  };
}

for (const [w, h, rowH] of [
  [1280, 800, 510],
  [1440, 900, 610],
  [1280, 720, 510],
]) {
  test(`${w} x ${h}: the row is ${rowH} px and the Students heading starts below the first view`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openDashboard(page);
    const m = await row(page);
    expect(Math.round(m.row.height)).toBe(rowH);
    if (h - 12 - m.row.top > 510) {
      // The window's rule applies: the row ends 12 px above the window's bottom.
      expect(Math.abs(h - 12 - m.row.bottom)).toBeLessThanOrEqual(1);
      expect(m.heading.top).toBeGreaterThanOrEqual(h - 1);
    } else {
      // The floor: the window cuts the row's foot and the page scrolls.
      expect(m.row.bottom).toBeGreaterThan(h - 12);
    }
    // Two thirds and one third, 12 px apart.
    const left = await box(page, '.dash-row-left');
    const comp = await box(page, '.dash-comp-tile');
    expect(Math.round(comp.left - left.right)).toBe(12);
    expect(Math.abs(left.width - 2 * comp.width)).toBeLessThanOrEqual(1);
    expect(Math.round(comp.height)).toBe(rowH);
    expect(Math.round(left.height)).toBe(rowH);
  });
}

test('a photo-expiry line that arrives after the first draw: the row still ends 12 px above the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDashboard(page);
  const before = await row(page);
  expect(Math.round(before.row.height)).toBe(610);
  // The line arrives late, as it does for a signed-in teacher: the list comes
  // in and only the line's own box is drawn again. Nothing here measures the row.
  await page.evaluate(() => {
    const cid = createCourse({ name: 'Social Studies 10' }).id;
    const opened = new Date(Date.now() - 350 * 86400000).toISOString();
    PhotoExpiry._reset([{ course_id: cid, last_opened_at: opened, photos: 6 }]);
    PhotoExpiry.opened('none-such');
  });
  await expect(page.locator('.page-dashboard .photo-expiry-line')).toHaveCount(1);
  await expect
    .poll(async () => {
      const m = await row(page);
      return Math.round(m.row.top) > 278 ? Math.abs(Math.round(900 - 12 - m.row.bottom)) : 999;
    })
    .toBeLessThanOrEqual(1);
  const after = await row(page);
  expect(after.row.top).toBeGreaterThan(300);
  expect(Math.round(after.row.height)).toBeLessThan(610);
});

test('with the switch off the page has none of the new row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page, { flag: false });
  await expect(page.locator('.dash-comp-card')).toBeVisible();
  for (const sel of ['.dash-row', '.dash-comp-tile', '.dash-recent', '.dash-row-left']) {
    await expect(page.locator(sel)).toHaveCount(0);
  }
});

test('at 800 wide the tiles stack and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await openDashboard(page);
  const left = await box(page, '.dash-row-left');
  const comp = await box(page, '.dash-comp-tile');
  expect(comp.top).toBeGreaterThanOrEqual(left.bottom + 11);
  expect(Math.round(left.height)).toBe(450);
  expect(Math.round(comp.height)).toBe(520);
  const over = await page.evaluate(() => {
    const main = document.getElementById('main');
    return [
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main.scrollWidth - main.clientWidth,
    ];
  });
  expect(over).toEqual([0, 0]);
});

test('at 335 wide the tile does not scroll the page sideways', async ({ page }) => {
  await page.setViewportSize({ width: 335, height: 800 });
  await page.addInitScript(() => localStorage.setItem('fv-build-dashRow', '1'));
  // The phone app takes a phone-width window at sign-in; the desktop page is
  // opened by its address, as phone-width-desktop-pages.spec.js does.
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\/|dashboard/);
  await page.goto('/dashboard');
  await page.locator('.dash-comp-tile').waitFor();
  const over = await page.evaluate(() => {
    const main = document.getElementById('main');
    return [
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main.scrollWidth - main.clientWidth,
    ];
  });
  expect(over).toEqual([0, 0]);
  await page.locator('#dash-comp-tab-core').click();
  await expect(page.locator('#dash-comp-page-core')).toBeVisible();
  const again = await page.evaluate(() => {
    const main = document.getElementById('main');
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth +
      (main.scrollWidth - main.clientWidth)
    );
  });
  expect(again).toBe(0);
});

test('every Dashboard box is 12 px from the next', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page);
  const gaps = await page.evaluate(() => {
    const boxes = Array.from(
      document.querySelectorAll('.dash-glance, .dash-row-slot > *, .dash-comp-tile, .dash-students-head, .dash-card'),
    )
      .slice(0, 12)
      .map(el => {
        const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom };
      });
    const out = [];
    boxes.forEach(a => {
      const right = boxes.filter(b => Math.abs(b.t - a.t) < 1 && b.l > a.r);
      if (right.length) out.push(Math.round(Math.min(...right.map(b => b.l)) - a.r));
      const below = boxes.filter(b => b.t > a.b && b.l < a.r && b.r > a.l);
      if (below.length) out.push(Math.round(Math.min(...below.map(b => b.t)) - a.b));
    });
    return out;
  });
  expect(gaps.length).toBeGreaterThan(5);
  expect(new Set(gaps)).toEqual(new Set([12]));
});

test('Recent Assessments holds the left tile, newest first, with the Send Work line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page);
  const tile = page.locator('.dash-row-inbox .dash-recent');
  await expect(tile.locator('.dash-recent-title')).toHaveText('Recent Assessments');
  const rows = tile.locator('.dash-recent-row');
  expect(await rows.count()).toBeGreaterThan(2);
  await expect(rows.first().locator('.dash-recent-count')).toHaveText(/^\d+ of \d+ assessed$/);
  await expect(tile.locator('.dash-recent-link').first()).toHaveAttribute(
    'data-href',
    /^\/assignments\?course=.*&open=/,
  );
  await expect(tile.locator('> .dash-recent-head a')).toHaveAttribute('data-href', /^\/assignments\?course=/);
});

test('Curricular and Core switch by click and by arrow key, and the choice survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page);
  const cur = page.locator('#dash-comp-tab-curricular');
  const core = page.locator('#dash-comp-tab-core');
  await expect(cur).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.dash-comp-seg')).toHaveAttribute('role', 'tablist');
  await expect(page.locator('#dash-comp-page-core')).toBeHidden();
  await core.click();
  await expect(core).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#dash-comp-page-core')).toBeVisible();
  await expect(page.locator('#dash-comp-page-curricular')).toBeHidden();
  await expect(page.locator('.dash-core-card')).toBeVisible();
  await page.waitForTimeout(300);
  const at = await box(page, '#dash-comp-page-core');
  const tile = await box(page, '.dash-comp-pages');
  expect(Math.abs(at.left - tile.left)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => localStorage.getItem('fv-dash-comp-page:sci8'))).toBe('core');
  // Reload: still Core, and no Curricular flash.
  await page.reload();
  await page.locator('.dash-glance').waitFor();
  await expect(core).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#dash-comp-page-core')).toBeVisible();
  // Arrow keys move between the two.
  await core.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(cur).toHaveAttribute('aria-selected', 'true');
  await expect(cur).toBeFocused();
  await expect(page.locator('#dash-comp-page-curricular')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(core).toHaveAttribute('aria-selected', 'true');
  await expect(core).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('fv-dash-comp-page:sci8'))).toBe('core');
});

test('the view menu inside the tile opens, picks, and is hidden at rest', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page);
  const menu = page.locator('#dash-view-menu-comp');
  await expect(menu).toBeHidden();
  expect(await menu.evaluate(el => getComputedStyle(el).display)).toBe('none');
  await page.locator('#dash-view-btn-comp').click();
  await expect(menu).toBeVisible();
  const m = await box(page, '#dash-view-menu-comp');
  const t = await box(page, '.dash-comp-tile');
  expect(m.bottom).toBeLessThanOrEqual(t.bottom + 1);
  await page.locator('#dash-view-menu-comp [data-view="avg"]').click();
  await expect(page.locator('#dash-view-btn-comp')).toHaveText('Class Average');
  await expect(page.locator('#dash-view-menu-comp')).toBeHidden();
  // The tile is still on the Curricular page after the redraw.
  await expect(page.locator('#dash-comp-tab-curricular')).toHaveAttribute('aria-selected', 'true');
  // Core's menu, after the tile has been turned to Core.
  await page.locator('#dash-comp-tab-core').click();
  const core = page.locator('#dash-view-menu-core');
  if (await core.count()) {
    await expect(core).toBeHidden();
    await page.locator('#dash-view-btn-core').click();
    await expect(core).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(core).toBeHidden();
  }
});

test('clicking a competency in the tile still filters the student cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page);
  const before = await page.locator('.dash-grid > .dash-card').count();
  expect(before).toBeGreaterThan(0);
  // The tile opens on Level Mix (D3), where a row opens its list first; Class
  // Average keeps today's one-click filter.
  await page.locator('#dash-view-btn-comp').click();
  await page.locator('#dash-view-menu-comp [data-view="avg"]').click();
  await page.locator('.dash-comp-tile .dash-comp-row').first().click();
  await expect(page.locator('.dash-comp-filter')).toBeVisible();
  await expect(
    page.locator('.dash-comp-tile .dash-comp-row.is-picked, .dash-comp-tile [aria-pressed="true"]').first(),
  ).toBeVisible();
  // Still the Curricular page of the tile after the redraw.
  await expect(page.locator('#dash-comp-page-curricular')).toBeVisible();
});

test('with Bulletins on and built the left column splits 60 / 40', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page, { bulletins: true });
  // Neither module is built yet: define the stub, then draw again.
  await page.evaluate(() => {
    window.DashBulletins = {
      html: () => '<section class="dash-recent" id="stub-bulletins"><h2>Bulletins</h2></section>',
    };
    PageDashboard.render();
  });
  const inbox = await box(page, '.dash-row-inbox');
  const bull = await box(page, '.dash-row-bulletins');
  expect(Math.abs(inbox.height - 299)).toBeLessThanOrEqual(1);
  expect(Math.abs(bull.height - 199)).toBeLessThanOrEqual(1);
  expect(Math.round(bull.top - inbox.bottom)).toBe(12);
});

test('without Bulletins the Inbox slot has the whole column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page);
  await expect(page.locator('.dash-row-bulletins')).toHaveCount(0);
  const inbox = await box(page, '.dash-row-inbox');
  const left = await box(page, '.dash-row-left');
  expect(Math.round(inbox.height)).toBe(Math.round(left.height));
});
