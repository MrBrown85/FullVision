/**
 * The Inbox's assessment switch stays inside the Inbox (live fault, Nov 18).
 * In a class whose pieces have long names, Roll Call's switch ran out of the
 * Inbox tile, was drawn over the Competencies tile's view pill and link, and
 * gave the page a sideways scrollbar. The switch scrolls inside the tile;
 * nothing in the row makes the page wider than the window, and the Inbox keeps
 * to its share of the row's height, in any Inbox view,
 * at any desktop size, in the page's font or the wide one.
 * Demo Mode, Science 8, Send Work on; the two pieces with work in are given
 * names as long as a real class's ("Current Events: Week of September 14").
 */
import { test, expect } from '@playwright/test';
import { useFont, FONTS } from './wide-font.js';

const SIZES = [
  [1900, 1100],
  [1680, 1000],
  [1440, 900],
  [1280, 800],
];
const VIEWS = ['assessment', 'side', 'flip', 'roll'];

async function open(page, view, fullColumn) {
  await page.addInitScript(v => {
    try {
      localStorage.setItem('fv-dash-inbox-view:sci8', v);
    } catch (e) {
      /* storage blocked */
    }
  }, view);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  await page.evaluate(full => {
    const cid = getActiveCourse();
    // The Inbox with the whole column, as on fullvision.ca before Bulletins
    // was released: the row drawn without the Bulletins tile.
    if (full) {
      const on = BuildFlags.on;
      window.BuildFlags = { on: n => n !== 'bulletins' && on(n) };
    }
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    const withWork = new Set(work.submissions.map(s => s.assessment_id));
    const long = [
      'Current Events: Week of September 14 and the Reading Response That Goes With It',
      '3.1 Imperial Demise and Restructuring: Jigsaw and the Gallery Walk That Follows',
    ];
    let i = 0;
    const list = getAssessments(cid).map(a => (withWork.has(a.id) && i < long.length ? { ...a, title: long[i++] } : a));
    saveAssessments(cid, list);
    PageDashboard.render();
  }, !!fullColumn);
  await page.locator('#dash-inbox').waitFor();
}

/** What runs past the Inbox tile or the window. */
const overflow = page =>
  page.evaluate(() => {
    const tile = document.getElementById('dash-inbox').getBoundingClientRect();
    const comp = document.querySelector('.dash-row-comp').getBoundingClientRect();
    const main = document.getElementById('main');
    // A chip is drawn where its scrolling strip shows it: clipped by the strip.
    const shown = [...document.querySelectorAll('#dash-inbox .dash-inbox-pick-btn')].map(b => {
      const r = b.getBoundingClientRect();
      const strip = b.closest('.dash-inbox-pick').getBoundingClientRect();
      return { left: Math.max(r.left, strip.left), right: Math.min(r.right, strip.right) };
    });
    const strip = document.querySelector('#dash-inbox .dash-inbox-pick');
    const sr = strip ? strip.getBoundingClientRect() : null;
    return {
      chips: shown.length,
      chipPastTile: shown.filter(c => c.right > c.left && (c.left < tile.left - 0.5 || c.right > tile.right + 0.5))
        .length,
      stripPastTile: sr ? sr.right > tile.right + 0.5 || sr.left < tile.left - 0.5 : false,
      stripOverComp: sr ? sr.right > comp.left : false,
      // The Inbox keeps to its share of the row in every view (Roll Call's
      // pages scroll inside it): it never grows the row.
      pastRow: tile.bottom - document.querySelector('.dash-row').getBoundingClientRect().bottom,
      pageWide: document.scrollingElement.scrollWidth - window.innerWidth,
      mainWide: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });

for (const view of VIEWS) {
  for (const [w, h] of SIZES) {
    for (const full of [false, true]) {
      test(`${view} at ${w}x${h}${full ? ', the whole column' : ''}: the switch stays in the Inbox and the page is no wider than the window`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: w, height: h });
        await open(page, view, full);
        if (full) await expect(page.locator('.dash-row-bulletins')).toHaveCount(0);
        for (const font of FONTS) {
          await useFont(page, font);
          const o = await overflow(page);
          if (view !== 'assessment') expect(o.chips, font).toBeGreaterThan(1);
          expect(o.chipPastTile, font).toBe(0);
          expect(o.stripPastTile, font).toBe(false);
          expect(o.stripOverComp, font).toBe(false);
          expect(o.pastRow, font).toBeLessThanOrEqual(0.5);
          expect(o.pageWide, font).toBeLessThanOrEqual(0);
          expect(o.mainWide, font).toBeLessThanOrEqual(0);
        }
      });
    }
  }
}

test('the switch still scrolls sideways to its last piece', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'roll');
  const strip = page.locator('#dash-inbox .dash-inbox-pick');
  const s = await strip.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(s.scroll).toBeGreaterThan(s.client);
  const last = page.locator('#dash-inbox .dash-inbox-pick-btn').last();
  await last.click();
  await expect(page.locator('#dash-inbox .dash-inbox-pick-btn').last()).toHaveAttribute('aria-pressed', 'true');
  const box = await page.locator('#dash-inbox .dash-inbox-pick-btn[aria-pressed="true"]').evaluate(el => {
    const r = el.getBoundingClientRect();
    const t = document.getElementById('dash-inbox').getBoundingClientRect();
    return { inside: r.left >= t.left - 0.5 && r.left < t.right };
  });
  expect(box.inside).toBe(true);
});
