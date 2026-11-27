/**
 * The Dashboard's middle row (D2 of docs/plans/dashboard-inbox-plan.md, on
 * since D9): a left tile at two thirds and one Competencies tile at one
 * third, as tall as the window leaves, with the Students heading below the
 * first view. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import { FONTS, useFont } from './wide-font.js';

// The test with a question waiting wants the class as Demo Mode now starts it, with the Student Page on.
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.startsWith('with a question waiting')) await demoStudentPageOff(page);
});

async function openDashboard(page, { oldFlag = null, tile = true } = {}) {
  await page.addInitScript(
    ([oldFlag]) => {
      try {
        // What a browser that saw the row before D9 may still have kept.
        if (oldFlag != null) localStorage.setItem('fv-build-dashRow', oldFlag);
      } catch (e) {
        /* storage blocked */
      }
    },
    [oldFlag],
  );
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  // With no tile (Bulletins is on since B1g): a signed-in class whose server has not answered list_bulletins, or
  // whose read failed, draws no Bulletins slot (e2e/dashboard-bulletins-late.spec.js); Demo Mode always has one.
  if (!tile)
    await page.evaluate(() => {
      DashBulletins.html = () => '';
      PageDashboard.render();
    });
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

// The glance row's cards (Nov 26) are 19 px shorter than the old box, so where the window rules the row is 19 px taller.
for (const [w, h, rowH] of [
  [1280, 800, 529],
  [1440, 900, 629],
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
  expect(Math.round(before.row.height)).toBe(629);
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
  expect(Math.round(after.row.height)).toBeLessThan(629);
});

test("the old two-card row is gone, whatever an old 'fv-build-dashRow' says", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page, { oldFlag: '0' });
  for (const sel of ['.dash-row', '.dash-comp-tile', '.dash-recent', '.dash-row-left'])
    await expect(page.locator(sel)).toHaveCount(1);
  await expect(page.locator('.dash-overview-cards')).toHaveCount(0);
  // Each list is a page of the one tile, never a box of its own in the row.
  for (const pg of ['curricular', 'core'])
    expect(await page.locator('#dash-comp-page-' + pg).evaluate(el => !!el.closest('.dash-comp-tile'))).toBe(true);
});

test('at 800 wide the tiles stack and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await openDashboard(page);
  const left = await box(page, '.dash-row-left');
  const comp = await box(page, '.dash-comp-tile');
  expect(comp.top).toBeGreaterThanOrEqual(left.bottom + 11);
  // The Inbox, then the Bulletins tile under it (300 px, dashboard-bulletins-tile.spec.js), 12 px apart.
  expect(Math.round((await box(page, '.dash-row-inbox')).height)).toBe(450);
  expect(Math.round(left.height)).toBe(450 + 12 + 300);
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
  await expect(page.locator('#dash-comp-page-core .dash-comp-list')).toBeVisible();
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

test('with Bulletins built the Inbox takes at most 60% of the column and Bulletins the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page);
  // A stand-in for the tile (the real one is tried in dashboard-bulletins-tile.spec.js): define it, then draw again.
  await page.evaluate(() => {
    window.DashBulletins = {
      html: () => '<section class="dash-recent" id="stub-bulletins"><h2>Bulletins</h2></section>',
      destroy: () => {},
    };
    PageDashboard.render();
  });
  const inbox = await box(page, '.dash-row-inbox');
  const bull = await box(page, '.dash-row-bulletins');
  const col = await box(page, '.dash-row-left');
  expect(inbox.height).toBeLessThanOrEqual((col.height - 12) * 0.6 + 1);
  expect(bull.height).toBeGreaterThanOrEqual((col.height - 12) * 0.4 - 1);
  expect(Math.abs(inbox.height + 12 + bull.height - col.height)).toBeLessThanOrEqual(1);
  expect(Math.round(bull.top - inbox.bottom)).toBe(12);
});

test('with no Bulletins tile the Inbox slot has the whole column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page, { tile: false });
  await expect(page.locator('.dash-row-bulletins')).toHaveCount(0);
  const inbox = await box(page, '.dash-row-inbox');
  const left = await box(page, '.dash-row-left');
  expect(Math.round(inbox.height)).toBe(Math.round(left.height));
});

/* The period switch, the page's link and its column heading sit on one line
   inside the tile at its narrowest (329 px at 1024 wide, 335 at 1280), in the
   page's font and in the wide stand-in for CI's fonts. */
for (const [w, h] of [
  [1024, 768],
  [1280, 800],
  [1440, 900],
]) {
  test(`at ${w} wide each page's switch, link and heading share one line inside the tile, in both fonts`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    await openDashboard(page);
    for (const font of FONTS) {
      await useFont(page, font);
      for (const pg of ['curricular', 'core']) {
        await page.locator('#dash-comp-tab-' + pg).click();
        await page.waitForTimeout(300);
        const m = await page.evaluate(pg => {
          const tile = document.querySelector('.dash-comp-tile').getBoundingClientRect();
          const sub = document.querySelector('#dash-comp-page-' + pg + ' .dash-comp-sub');
          const parts = ['.dash-comp-span', '.dash-comp-sub-link', '.dash-comp-colhead'].map(s =>
            sub.querySelector(s).getBoundingClientRect(),
          );
          const lh = parseFloat(getComputedStyle(sub.querySelector('.dash-comp-sub-link')).lineHeight) || 20;
          return {
            inside: parts.every(r => r.right <= tile.right + 0.5 && r.left >= tile.left - 0.5),
            oneLine: parts.every(r => Math.abs(r.top + r.height / 2 - (parts[0].top + parts[0].height / 2)) < 8),
            linkOneLine: parts[1].height <= lh + 1,
            noOverlap: parts[0].right <= parts[1].left && parts[1].right <= parts[2].left,
          };
        }, pg);
        expect(m, `${w} ${font} ${pg}`).toEqual({ inside: true, oneLine: true, linkOneLine: true, noOverlap: true });
      }
    }
  });
}

/* With Questions From Students waiting (the front page's Demo Mode has one),
   that card sits above the top bar, so the row starts lower and its tiles run
   past the first view; the cards may sit below the fold (Colin). The page
   scrolls cleanly to the row's foot and nothing in the row is cut off. */
test('with a question waiting the row starts lower, the page scrolls to its foot, and nothing is cut off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/login.html?demo=1&student=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('#dash-inbox').waitFor();
  await expect(page.locator('.dash-questions')).toBeVisible();
  const before = await box(page, '.dash-row');
  expect(before.top).toBeGreaterThan(278);
  expect(Math.round(before.height)).toBe(510);
  await page.locator('.dash-row').evaluate(el => el.scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const row = document.querySelector('.dash-row').getBoundingClientRect();
    const tiles = ['#dash-inbox', '.dash-bulletins-tile', '.dash-comp-tile'].map(s =>
      Math.round(document.querySelector(s).getBoundingClientRect().height),
    );
    const main = document.getElementById('main');
    return {
      rowTop: row.top,
      rowBottom: row.bottom,
      tiles,
      winH: innerHeight,
      sideways: [
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        main.scrollWidth - main.clientWidth,
      ],
    };
  });
  // The whole row can be brought into view: the Inbox and the Bulletins tile under it share the left column
  // (the Inbox as tall as its stacks, 299 px at most; Bulletins the rest, 12 apart), and Competencies is the row's full height.
  expect(m.rowBottom).toBeLessThanOrEqual(m.winH + 0.5);
  expect(m.rowTop).toBeGreaterThanOrEqual(0);
  expect(m.tiles[0]).toBeLessThanOrEqual(300);
  expect(m.tiles[0] + 12 + m.tiles[1]).toBe(510);
  expect(m.tiles[2]).toBe(510);
  expect(m.sideways).toEqual([0, 0]);
  // The Students heading follows the row, 12 px under it.
  const heading = await box(page, '.dash-students-head');
  const row = await box(page, '.dash-row');
  expect(Math.round(heading.top - row.bottom)).toBe(12);
});

/* The tile's head: "Competencies" and Curricular | Core on one line when they
   fit; at 1100 wide (the roster beside the row) or in a wider font the switch
   goes under the title, whole, inside the tile. */
for (const [w, h] of [
  [1100, 800],
  [1024, 768],
  [1280, 800],
]) {
  test(`at ${w} wide the Competencies title and Curricular | Core stay whole inside the tile, in both fonts`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    await openDashboard(page);
    for (const font of FONTS) {
      await useFont(page, font);
      const m = await page.evaluate(() => {
        const tile = document.querySelector('.dash-comp-tile');
        const tb = tile.getBoundingClientRect();
        const cs = getComputedStyle(tile);
        const inner = { left: tb.left + parseFloat(cs.paddingLeft), right: tb.right - parseFloat(cs.paddingRight) };
        const parts = [
          '.dash-comp-tile-title',
          '.dash-comp-seg',
          '#dash-comp-tab-curricular',
          '#dash-comp-tab-core',
        ].map(s => {
          const el = document.querySelector(s);
          const r = el.getBoundingClientRect();
          return { s, left: r.left, right: r.right, cut: el.scrollWidth > el.clientWidth + 1 };
        });
        const t = document.querySelector('.dash-comp-tile-title').getBoundingClientRect();
        const seg = document.querySelector('.dash-comp-seg').getBoundingClientRect();
        return {
          outside: parts.filter(p => p.left < inner.left - 0.5 || p.right > inner.right + 0.5).map(p => p.s),
          cut: parts.filter(p => p.cut).map(p => p.s),
          overlap: !(seg.left >= t.right - 0.5 || seg.top >= t.bottom - 0.5),
          core: document.querySelector('#dash-comp-tab-core').textContent,
        };
      });
      expect(m, `${w} ${font}`).toEqual({ outside: [], cut: [], overlap: false, core: 'Core' });
    }
  });
}
