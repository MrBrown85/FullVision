/**
 * The Dashboard row in a real-sized class (review of #1603): 30 students and
 * 11 more pieces with long names, five with 25 to 28 hand-ins
 * (e2e/dashboard-real-class.js). At four desktop sizes, in the page font and
 * the wide one:
 *  - in both Inbox views no stack, student name or title is cut by the edge
 *    of the box that scrolls it or of the tile: each is wholly in or wholly out;
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
   (scrolled away); `axis` 'y' checks top and bottom only (the stacks' row
   scrolls sideways, so its last stack is cut on the right by design) and 'x'
   left and right only (Roll Call's grid scrolls down). */
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
        const okY = axis === 'x' || y || yOut;
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
  stacks: [['#dash-inbox .dash-inbox-stack-title, #dash-inbox .dash-inbox-stack-count', '#dash-inbox', 'y']],
  rollcall: [
    ['#dash-inbox .dash-inbox-rc-st', '#dash-inbox-rc-grid', 'x'],
    ['#dash-inbox .dash-inbox-rc-bar', '#dash-inbox'],
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
      }
    });
  }

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
