/**
 * The Dashboard row in a real-sized class (review of #1603): 30 students and
 * 11 more pieces with long names, five with 25 to 28 hand-ins
 * (e2e/dashboard-real-class.js). At four desktop sizes, in the page font and
 * the wide one:
 *  - in every Inbox view no row, name or caption is cut by the edge of the
 *    box that scrolls it or of the tile: each is wholly in or wholly out;
 *  - a mouse wheel turned over the assessment switch reaches its last piece;
 *  - Needs Support never says "+N more" while it has room for them.
 */
import { test, expect } from '@playwright/test';
import { useFont, FONTS } from './wide-font.js';
import { openRealClass } from './dashboard-real-class.js';

const SIZES = [
  [1280, 800],
  [1440, 900],
  [1680, 1000],
  [1920, 1080],
];

/* The boxes that are cut: for each element matching `sel` that shows, the
   nearest box that clips it (its scroll box, else the Inbox tile). An
   element is fine when it lies wholly inside that box or wholly outside it
   (scrolled away); `axis` 'y' checks top and bottom only (Side by Side's row
   is cut on its right edge by design: "the last one is cut by the edge"). */
const cutOnes = (page, sel, clipSel, axis = 'xy') =>
  page.evaluate(
    ([sel, clipSel, axis]) => {
      const out = [];
      document.querySelectorAll(sel).forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const clip = el.parentElement.closest(clipSel);
        if (!clip) return;
        const c = clip.getBoundingClientRect();
        const y = r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5;
        const yOut = r.bottom <= c.top + 0.5 || r.top >= c.bottom - 0.5;
        const x = r.left >= c.left - 0.5 && r.right <= c.right + 0.5;
        const xOut = r.right <= c.left + 0.5 || r.left >= c.right - 0.5;
        const okY = y || yOut;
        const okX = axis === 'y' || x || xOut || yOut;
        if (!okY || !okX)
          out.push(
            (el.textContent || el.className).trim().slice(0, 30) +
              ` [${Math.round(r.top)}-${Math.round(r.bottom)} in ${Math.round(c.top)}-${Math.round(c.bottom)}]`,
          );
      });
      return out;
    },
    [sel, clipSel, axis],
  );

const VIEWS = {
  assessment: [['#dash-inbox .dash-inbox-row, #dash-inbox .dash-inbox-fold', '#dash-inbox-list, #dash-inbox']],
  side: [['#dash-inbox .dash-inbox-side-name, #dash-inbox .dash-inbox-side-line', '#dash-inbox', 'y']],
  flip: [['#dash-inbox .dash-inbox-flip-cap, #dash-inbox .dash-inbox-flip-range', '#dash-inbox']],
  roll: [
    ['#dash-inbox .dash-inbox-roll-chip', '#dash-inbox-roll-grid'],
    ['#dash-inbox .dash-inbox-roll-foot', '#dash-inbox'],
  ],
};

for (const [w, h] of SIZES) {
  for (const view of Object.keys(VIEWS)) {
    test(`${w}x${h}, ${view}: nothing in the Inbox is cut by its edge`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openRealClass(page, { view });
      for (const font of FONTS) {
        await useFont(page, font);
        await page.waitForTimeout(200);
        for (const [sel, clip, axis] of VIEWS[view]) {
          expect(await cutOnes(page, sel, clip, axis), `${font}: ${sel}`).toEqual([]);
        }
        // Roll Call shows every name, or says how many more there are.
        if (view === 'roll') {
          const r = await page.evaluate(() => {
            const grid = document.getElementById('dash-inbox-roll-grid');
            const g = grid.getBoundingClientRect();
            const chips = [...grid.querySelectorAll('.dash-inbox-roll-chip')];
            const shown = chips.filter(c => c.getBoundingClientRect().bottom <= g.bottom + 0.5).length;
            const more = document.querySelector('[data-dash-roll="more"]');
            return {
              all: chips.length,
              shown,
              more: more && !more.hidden ? Number(more.textContent.replace(/\D/g, '')) : 0,
            };
          });
          expect(r.shown + r.more, font).toBe(r.all);
        }
      }
    });
  }

  test(`${w}x${h}: a mouse wheel over the assessment switch reaches its last piece`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openRealClass(page, { view: 'side' });
    for (const font of FONTS) {
      await useFont(page, font);
      await page.evaluate(() => {
        const m = document.getElementById('main');
        if (m) m.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      const strip = page.locator('#dash-inbox .dash-inbox-pick');
      const s = await strip.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(s.sw, font).toBeGreaterThan(s.cw);
      const b = await strip.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      // Turn the wheel until the switch is at its end (the page scrolls past it).
      for (let i = 0; i < 60; i++) {
        const left = await strip.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft);
        if (left <= 1) break;
        await page.mouse.wheel(0, 200);
      }
      await page.waitForTimeout(150);
      const end = await strip.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft);
      expect(end, font).toBeLessThanOrEqual(1);
      // The last piece is in view, and the page did not scroll instead.
      const last = await page
        .locator('#dash-inbox .dash-inbox-pick-btn')
        .last()
        .evaluate(el => {
          const r = el.getBoundingClientRect();
          const c = el.parentElement.getBoundingClientRect();
          return r.right <= c.right + 1;
        });
      expect(last, font).toBe(true);
      await strip.evaluate(el => (el.scrollLeft = 0));
    }
  });

  test(`${w}x${h}: Needs Support never says "+N more" while it has room for them`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openRealClass(page, { comp: 'below' });
    for (const font of FONTS) {
      await useFont(page, font);
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => {
        const list = document.querySelector('#dash-comp-page-curricular .dash-comp-rows');
        if (!list) return null;
        const rows = [...list.querySelectorAll('.dash-comp-row.is-student')].filter(
          r => getComputedStyle(r).display !== 'none',
        );
        const more = list.querySelector('.dash-comp-more');
        const shownMore = more && getComputedStyle(more).display !== 'none';
        const n = shownMore ? Number(more.textContent.replace(/\D/g, '')) : 0;
        const l = list.getBoundingClientRect();
        const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : l;
        const gap = l.bottom - (shownMore ? more.getBoundingClientRect().bottom : last.bottom);
        return {
          shown: rows.length,
          more: n,
          // Each row's share of the list, against the smallest row the view draws.
          each: rows.length ? (l.height - (shownMore ? more.offsetHeight : 0)) / rows.length : 0,
          room: gap,
          cut: rows.some(r => r.getBoundingClientRect().bottom > l.bottom + 0.5),
        };
      });
      expect(m, font).not.toBeNull();
      expect(m.cut, font).toBe(false);
      // With "+N more" on show there was no room for one more student at
      // the 36 px a Needs Support row takes (DashCompetencies.fit).
      if (m.more > 0) expect(m.each, font).toBeLessThan(36 * (1 + 1 / m.shown));
    }
  });
}
