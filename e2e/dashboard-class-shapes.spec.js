/**
 * The two competency cards hold whatever a class has (plan F, after the
 * Nov 5 stress test). Two classes built in Demo Mode with the New Class
 * wizard's own functions (e2e/dashboard-shapes.js): Career Education 8,
 * 13 competencies and no folders, whose codes were all "CE" and whose Core
 * card had a 122 px blank band; and Social Studies 8 cut to its first
 * three competencies, whose codes were "SIG, SIG" and whose Curricular
 * card had 100 px blank under its rows. In every view: the cards are one
 * height side by side, no blank band over 40 px inside either, nothing
 * scrolls sideways, and the codes are unique.
 */
import { test, expect } from '@playwright/test';
import { buildClass, showClass, measureCards } from './dashboard-shapes.js';

const CLASSES = [
  { key: 'many', name: 'Career Education 8', tags: ['CAREE8'], self: true, rows: 13 },
  { key: 'few', name: 'Social Studies 8', tags: ['SS8'], keep: 3, students: 8, self: false, rows: 3 },
];

for (const shape of CLASSES) {
  test(`${shape.name}, ${shape.rows} competencies: one height, no blank band, no sideways scroll, unique codes`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.locator('.dash-comp-card').waitFor();
    const cid = await buildClass(page, shape);
    await showClass(page, cid);
    await expect(page.locator('.dash-comp-card .dash-comp-row')).toHaveCount(shape.rows);

    const codes = await page.evaluate(id => Object.values(DashInsights.columnCodes(id)), cid);
    expect(codes).toHaveLength(shape.rows);
    expect(new Set(codes).size, codes.join(',')).toBe(codes.length);

    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ['avg', 'mix', 'below', 'trend']) {
        for (const core of shape.self ? ['self', 'evidence'] : ['evidence']) {
          await page.evaluate(
            ({ cid, view, core }) => {
              localStorage.setItem('fv-dash-comp-view:' + cid, view);
              localStorage.setItem('fv-dash-core-view:' + cid, core);
              PageDashboard.render();
            },
            { cid, view, core },
          );
          await expect(page.locator('.dash-comp-card')).toHaveAttribute('data-view', view);
          const m = await measureCards(page);
          const at = `${width} ${view}/${core}`;
          expect(m.sideBySide, at).toBe(true);
          expect(m.compH, at).toBe(m.coreH);
          expect(m.compBand, 'Curricular blank band at ' + at).toBeLessThanOrEqual(40);
          expect(m.coreBand, 'Core blank band at ' + at).toBeLessThanOrEqual(40);
          expect(m.docOverflow, at).toBeLessThanOrEqual(0);
          expect(m.mainOverflow, at).toBeLessThanOrEqual(0);
          if (m.codes.length) expect(new Set(m.codes).size, at).toBe(m.codes.length);
        }
      }
    }

    // Past 12 rows the list scrolls inside the card, with "+N more".
    if (shape.rows > 12) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(id => {
        localStorage.setItem('fv-dash-comp-view:' + id, 'avg');
        PageDashboard.render();
      }, cid);
      const list = page.locator('.dash-comp-rows.is-scroll');
      expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      const more = page.locator('.dash-comp-moreline');
      await expect(more).toHaveText('+' + (shape.rows - 12) + ' more');
      await more.click();
      await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await expect(more).toBeHidden();
    }
  });
}
