/**
 * The Competencies tile's two pages at one third of the row (D3 of
 * docs/plans/dashboard-inbox-plan.md): Level Mix and Self-Assessment as one
 * row per competency, the row's list, the other views fitting the tile, and
 * the view menus and hover tips showing whole. Demo Mode, Science 8, with the
 * dashRow switch on.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function openDashboard(page, { w = 1280, h = 800 } = {}) {
  await page.setViewportSize({ width: Math.max(w, 1024), height: h });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fv-build-dashRow', '1');
    } catch (e) {
      /* storage blocked */
    }
  });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-comp-tile').waitFor();
  // A phone-wide window gets the desktop page by being narrowed after it loads.
  if (w < 1024) await page.setViewportSize({ width: w, height: h });
}

const box = loc =>
  loc.first().evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });

const heights = (page, sel) => page.locator(sel).evaluateAll(els => els.map(e => e.getBoundingClientRect().height));

async function goCore(page) {
  await page.locator('#dash-comp-tab-core').click();
  await expect(page.locator('#dash-comp-page-core')).toHaveClass(/is-on/);
  await page.waitForTimeout(300);
}
async function goCurricular(page) {
  await page.locator('#dash-comp-tab-curricular').click();
  await expect(page.locator('#dash-comp-page-curricular')).toHaveClass(/is-on/);
  await page.waitForTimeout(300);
}

// How far the shown page scrolls sideways or down, and the page's own width.
const pageFit = page =>
  page.evaluate(() => {
    const el = document.querySelector('.dash-comp-page.is-on');
    return { sw: el.scrollWidth - el.clientWidth, sh: el.scrollHeight - el.clientHeight };
  });

const inWindow = (b, w, h) => b.left >= -0.5 && b.top >= -0.5 && b.right <= w + 0.5 && b.bottom <= h + 0.5;

async function pickView(page, menu, name) {
  await page.locator('#dash-view-btn-' + menu).click();
  await page
    .locator('#dash-view-menu-' + menu + ' .dash-view-item')
    .filter({ has: page.locator('.dash-view-name', { hasText: new RegExp('^' + name + '$') }) })
    .click();
  await page.waitForTimeout(250);
}

test('Level Mix: six rows of one height, a tile 510 px tall that does not scroll', async ({ page }) => {
  await openDashboard(page);
  const tile = await box(page.locator('.dash-comp-tile'));
  expect(Math.round(tile.height)).toBe(510);
  const rows = page.locator('.dash-comp-ln[data-comp-page="curricular"]');
  await expect(rows).toHaveCount(6);
  const hs = await heights(page, '.dash-comp-ln[data-comp-page="curricular"]');
  expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(0.5);
  const fit = await pageFit(page);
  expect(fit.sw).toBe(0);
  expect(fit.sh).toBeLessThanOrEqual(0);
  const list = await page
    .locator('.dash-comp-page.is-on .dash-comp-lines')
    .evaluate(el => el.scrollHeight - el.clientHeight);
  expect(list).toBeLessThanOrEqual(0);
  // Legend and column heading, in words.
  await expect(page.locator('.dash-comp-page.is-on .dash-comp-legend')).toContainText('Emerging');
  await expect(page.locator('.dash-comp-page.is-on .dash-comp-legend')).toContainText('Extending');
  await expect(page.locator('.dash-comp-page.is-on .dash-comp-colhead')).toContainText('Proficient or Above');
  // Each row names its counts.
  const label = await rows.first().getAttribute('aria-label');
  expect(label).toMatch(
    /: \d+ of \d+ Proficient or above\. Emerging \d+, Developing \d+, Proficient \d+, Extending \d+/,
  );
  // Nothing in the tile is wider than the tile.
  const t = await box(page.locator('.dash-comp-tile'));
  const over = await page.locator('.dash-comp-page.is-on *').evaluateAll(
    (els, right) =>
      els
        .filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right > right + 0.5;
        })
        .map(e => e.className),
    t.right,
  );
  expect(over).toEqual([]);
});

test('Self-Assessment: seven rows of one height, in the blues', async ({ page }) => {
  await openDashboard(page);
  await goCore(page);
  const hasSelf = await page.locator('#dash-comp-page-core .dash-comp-ln').count();
  test.skip(!hasSelf, 'the sample class has no self-assessments');
  const hs = await heights(page, '.dash-comp-ln[data-comp-page="core"]');
  expect(hs.length).toBeGreaterThan(0);
  expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(0.5);
  const fit = await pageFit(page);
  expect(fit.sw).toBe(0);
  expect(fit.sh).toBeLessThanOrEqual(0);
  await expect(page.locator('#dash-comp-page-core .dash-comp-colhead')).toContainText('Self-Assessed');
  await expect(page.locator('#dash-comp-page-core .dash-comp-legend')).toContainText('Beginning');
  await expect(page.locator('#dash-comp-page-core .dash-comp-legend')).toContainText('Leading');
  // Never the level colours.
  const bg = await page
    .locator('#dash-comp-page-core .dash-comp-ln-bar i:not(.is-none)')
    .first()
    .evaluate(e => getComputedStyle(e).backgroundColor);
  const self1 = await page.evaluate(() => {
    const d = document.createElement('i');
    d.style.background = 'var(--self-1)';
    document.body.appendChild(d);
    const a = getComputedStyle(d).backgroundColor;
    d.style.background = 'var(--self-2)';
    const b = getComputedStyle(d).backgroundColor;
    d.style.background = 'var(--self-3)';
    const c = getComputedStyle(d).backgroundColor;
    d.style.background = 'var(--self-4)';
    const e = getComputedStyle(d).backgroundColor;
    d.remove();
    return [a, b, c, e];
  });
  expect(self1).toContain(bg);
  const label = await page.locator('.dash-comp-ln[data-comp-page="core"]').first().getAttribute('aria-label');
  expect(label).toMatch(/self-assessed\. Beginning \d+, Growing \d+, Confident \d+, Leading \d+, Not yet \d+/);
});

test('the lists and menus are out of sight at rest', async ({ page }) => {
  await openDashboard(page);
  for (const sel of [
    '#dash-comp-pop',
    '#dash-comp-tipbox',
    '#dash-view-menu-comp',
    '#dash-view-menu-core',
    '.dash-comp-ln-tip',
  ]) {
    const n = await page.locator(sel).count();
    for (let i = 0; i < n; i++) {
      const s = await page
        .locator(sel)
        .nth(i)
        .evaluate(e => {
          const c = getComputedStyle(e);
          return c.display + '/' + c.visibility;
        });
      expect(s === 'none/visible' || s.endsWith('/hidden')).toBe(true);
    }
  }
});

test("a row's list opens by click and by Enter, filters the cards and closes with Escape", async ({ page }) => {
  await openDashboard(page);
  const rows = page.locator('.dash-comp-ln[data-comp-page="curricular"]');
  const pop = page.locator('#dash-comp-pop');
  // Find a row with students below Proficient.
  const n = await rows.count();
  let at = -1;
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click();
    await expect(pop).toBeVisible();
    if (await pop.locator('[data-comp-scroll]').count()) {
      at = i;
      break;
    }
    await page.keyboard.press('Escape');
  }
  expect(at).toBeGreaterThanOrEqual(0);
  const row = rows.nth(at);
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  // The list: the name, "N below Proficient", the students, both links.
  await expect(pop).toContainText(/\d+ below Proficient: /);
  expect(await pop.locator('.dash-ins-person').count()).toBeGreaterThan(0);
  await expect(pop.locator('[data-comp-scroll]')).toContainText(/Show These \d+ in Student Cards ↓/);
  await expect(pop).toContainText('Open in Gradebook →');
  const pb = await box(pop);
  expect(inWindow(pb, 1280, 800)).toBe(true);
  // The list is not cut off by the tile or the row.
  const clipped = await pop.evaluate(el => {
    const r = el.getBoundingClientRect();
    return [
      [r.left + 5, r.top + 5],
      [r.right - 5, r.top + 5],
      [r.left + 5, r.bottom - 5],
      [r.right - 5, r.bottom - 5],
    ].filter(([x, y]) => !el.contains(document.elementFromPoint(x, y))).length;
  });
  expect(clipped).toBe(0);
  // Escape closes it, focus back on the row.
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  // Enter opens it too.
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();
  // Show These N: the cards are filtered and scrolled to; the chip clears it.
  await pop.locator('[data-comp-scroll]').click();
  await expect(pop).toBeHidden();
  await expect(page.locator('.dash-comp-filter')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.dash-comp-filter')
        .evaluate(e => e.getBoundingClientRect().top < 400 && e.getBoundingClientRect().top >= -2),
    )
    .toBe(true);
  await page.locator('.dash-comp-chip').click();
  await expect(page.locator('.dash-comp-filter')).toHaveCount(0);
});

test('the open row survives a redraw', async ({ page }) => {
  await openDashboard(page);
  const row = page.locator('.dash-comp-ln[data-comp-page="curricular"]').first();
  await row.click();
  await expect(page.locator('#dash-comp-pop')).toBeVisible();
  await page.evaluate(() => PageDashboard.render());
  await expect(page.locator('#dash-comp-pop')).toBeVisible();
  await expect(page.locator('.dash-comp-ln[data-comp-page="curricular"]').first()).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('a Core row opens the students at each step', async ({ page }) => {
  await openDashboard(page);
  await goCore(page);
  const rows = page.locator('.dash-comp-ln[data-comp-page="core"]');
  test.skip(!(await rows.count()), 'the sample class has no self-assessments');
  await rows.first().click();
  const pop = page.locator('#dash-comp-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Beginning');
  expect(inWindow(await box(pop), 1280, 800)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(rows.first()).toBeFocused();
});

test('every item of every view menu shows whole, on both pages', async ({ page }) => {
  await openDashboard(page);
  for (const [which, menu] of [
    ['curricular', 'comp'],
    ['core', 'core'],
  ]) {
    if (which === 'core') await goCore(page);
    const btn = page.locator('#dash-view-btn-' + menu);
    if (!(await btn.count())) continue;
    await btn.click();
    const m = page.locator('#dash-view-menu-' + menu);
    await expect(m).toBeVisible();
    const items = m.locator('.dash-view-item');
    const n = await items.count();
    expect(n).toBeGreaterThan(1);
    for (let i = 0; i < n; i++) {
      const b = await box(items.nth(i));
      expect(inWindow(b, 1280, 800)).toBe(true);
      const hit = await items.nth(i).evaluate(el => {
        const r = el.getBoundingClientRect();
        return [
          [r.left + 2, r.top + 2],
          [r.right - 2, r.top + 2],
          [r.left + 2, r.bottom - 2],
          [r.right - 2, r.bottom - 2],
        ].filter(([x, y]) => !el.closest('.dash-view-menu').contains(document.elementFromPoint(x, y))).length;
      });
      expect(hit).toBe(0);
    }
    await page.keyboard.press('Escape');
  }
});

for (const w of [1440, 1280, 1024, 800, 390]) {
  test(`each other view fits the tile without scrolling sideways at ${w}`, async ({ page }) => {
    await openDashboard(page, { w, h: 800 });
    const views = ['Level Mix', 'Class Average', 'Needs Support', 'Change'];
    for (const v of views) {
      await pickView(page, 'comp', v);
      const fit = await pageFit(page);
      expect(fit.sw, `Curricular ${v} at ${w}`).toBe(0);
      const doc = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(doc, `page at ${w}`).toBeLessThanOrEqual(0);
    }
    await goCore(page);
    const menu = await page.locator('#dash-view-btn-core').count();
    if (menu) {
      for (const v of ['Evidence', 'Self-Assessment']) {
        await pickView(page, 'core', v);
        const fit = await pageFit(page);
        expect(fit.sw, `Core ${v} at ${w}`).toBe(0);
      }
    } else {
      expect((await pageFit(page)).sw).toBe(0);
    }
    // The head: the pill and the link on one line, the link not cut off.
    const head = await page.locator('.dash-comp-page.is-on .dash-section-title').evaluate(el => {
      const a = el.querySelector('a');
      const hr = el.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      return {
        fits: ar.right <= hr.right + 0.5 && ar.left >= hr.left,
        cut: a.scrollWidth > a.clientWidth,
        h: hr.height,
      };
    });
    expect(head.fits, `link at ${w}`).toBe(true);
    expect(head.cut, `link text cut at ${w}`).toBe(false);
  });
}

test('hover tips show whole on the first and last row of each view', async ({ page }) => {
  await openDashboard(page);
  const check = async (rows, label) => {
    const n = await rows.count();
    for (const i of [0, n - 1]) {
      await rows.nth(i).hover();
      const tip = page.locator('#dash-comp-tipbox');
      await expect(tip, label + ' row ' + i).toBeVisible();
      const b = await box(tip);
      expect(inWindow(b, 1280, 800), label + ' row ' + i + ' in window').toBe(true);
      const bad = await tip.evaluate(el => {
        const r = el.getBoundingClientRect();
        return [
          [r.left + 5, r.top + 5],
          [r.right - 5, r.top + 5],
          [r.left + 5, r.bottom - 5],
          [r.right - 5, r.bottom - 5],
        ].filter(([x, y]) => !el.contains(document.elementFromPoint(x, y))).length;
      });
      expect(bad, label + ' row ' + i + ' not clipped').toBe(0);
      await page.mouse.move(5, 5);
      await expect(tip).toBeHidden();
    }
  };
  await pickView(page, 'comp', 'Needs Support');
  const ns = page.locator('#dash-comp-page-curricular .dash-comp-row');
  if (await ns.count()) await check(ns, 'Needs Support');
  await pickView(page, 'comp', 'Change');
  await check(page.locator('#dash-comp-page-curricular .dash-comp-row'), 'Change');
  await goCore(page);
  if (await page.locator('#dash-view-btn-core').count()) await pickView(page, 'core', 'Evidence');
  await check(page.locator('#dash-comp-page-core .dash-core-row'), 'Evidence');
});

test('a 90-character competency name is cut and every row keeps one height', async ({ page }) => {
  await openDashboard(page);
  await page.evaluate(() => {
    const long = 'Processing and analyzing very long competency names that run past the width of the tile!!';
    const was = DashInsights.columns;
    DashInsights.columns = cid => was(cid).map((c, i) => (i === 2 ? { ...c, label: long, title: long } : c));
    PageDashboard.render();
  });
  await page.locator('.dash-comp-ln').first().waitFor();
  const hs = await heights(page, '.dash-comp-ln[data-comp-page="curricular"]');
  expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(0.5);
  const cut = await page
    .locator('.dash-comp-ln[data-comp-page="curricular"] .dash-comp-ln-name')
    .nth(2)
    .evaluate(e => e.scrollWidth > e.clientWidth);
  expect(cut).toBe(true);
  const label = await page.locator('.dash-comp-ln[data-comp-page="curricular"]').nth(2).getAttribute('aria-label');
  expect(label).toContain('very long competency names');
  expect((await pageFit(page)).sw).toBe(0);
});

test('screenshots', async ({ page }, info) => {
  const dir = process.env.SHOTS_DIR;
  test.skip(!dir, 'only when SHOTS_DIR is set');
  mkdirSync(dir, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openDashboard(page);
    await goCurricular(page);
    const tile = page.locator('.dash-comp-tile');
    await tile.screenshot({ path: `${dir}/curricular-${scheme}.png` });
    await page.locator('.dash-comp-ln[data-comp-page="curricular"]').nth(2).click();
    await page.screenshot({ path: `${dir}/curricular-list-${scheme}.png` });
    await page.keyboard.press('Escape');
    await goCore(page);
    await tile.screenshot({ path: `${dir}/core-${scheme}.png` });
    if (await page.locator('.dash-comp-ln[data-comp-page="core"]').count()) {
      await page.locator('.dash-comp-ln[data-comp-page="core"]').nth(2).click();
      await page.screenshot({ path: `${dir}/core-list-${scheme}.png` });
    }
  }
});
