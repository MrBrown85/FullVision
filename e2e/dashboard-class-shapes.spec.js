/**
 * The Competencies tile holds whatever a class has. Three classes built in
 * Demo Mode with the New Class wizard's own functions (e2e/dashboard-shapes.js):
 * Career Education 8, 13 competencies and no folders; Social Studies 8 cut to
 * its first three; and Physics 12, 31 competencies in 6 folders. At 1440,
 * 1280 and 1024 wide, on both pages, in the page's font and in the wide
 * stand-in for CI's fonts: the tile is the row's height, nothing scrolls
 * sideways, no tick or name runs past the tile, every row is one height, a
 * folder's name heads its rows only where the class has folders, and a long
 * list scrolls inside the tile, never the page.
 */
import { test, expect } from '@playwright/test';
import { buildClass, showClass, measureTile } from './dashboard-shapes.js';
import { FONTS, useFont } from './wide-font.js';

const CLASSES = [
  { key: 'many', name: 'Career Education 8', tags: ['CAREE8'], self: true, rows: 13, folders: 0 },
  { key: 'few', name: 'Social Studies 8', tags: ['SS8'], keep: 3, students: 8, self: false, rows: 3, folders: 0 },
  { key: 'phys', name: 'Physics 12', tags: ['PHYS12'], students: 31, self: false, rows: 31, folders: 6 },
];

for (const shape of CLASSES) {
  test(`${shape.name}, ${shape.rows} competencies: the tile holds it on both pages`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.locator('.dash-comp-tile').waitFor();
    const cid = await buildClass(page, shape);
    await showClass(page, cid);
    // The year, so every competency has work in it whatever today's term.
    await page.evaluate(id => {
      localStorage.setItem('fv-dash-comp-span:' + id, 'year');
      PageDashboard.render();
    }, cid);
    await expect(page.locator('#dash-comp-page-curricular .dash-comp-it')).toHaveCount(shape.rows);
    await expect(page.locator('#dash-comp-page-curricular .dash-comp-fold')).toHaveCount(shape.folders);

    for (const font of FONTS) {
      await useFont(page, font);
      for (const width of [1440, 1280, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        for (const pg of ['curricular', 'core']) {
          await page.evaluate(
            ({ cid, pg }) => {
              localStorage.setItem('fv-dash-comp-page:' + cid, pg);
              PageDashboard.render();
            },
            { cid, pg },
          );
          await expect(page.locator('.dash-comp-tile')).toHaveAttribute('data-page', pg);
          const m = await measureTile(page);
          const at = `${font} font, ${width} ${pg}`;
          expect(m.tileH, at).toBe(m.rowH);
          expect(m.docOverflow, at).toBeLessThanOrEqual(0);
          expect(m.mainOverflow, at).toBeLessThanOrEqual(0);
          expect(m.listScrollsSideways, at).toBeLessThanOrEqual(0);
          expect(m.outside, 'something runs past the tile at ' + at).toBe(0);
          expect(m.pageScrolls, 'the page itself scrolls at ' + at).toBe(false);
          if (m.lines.length) expect(new Set(m.lines).size, 'row heights at ' + at + ': ' + m.lines).toBe(1);
          if (pg === 'curricular')
            expect(
              m.ticks.every(n => n === (shape.students || 28)),
              at,
            ).toBe(true);
        }
      }
    }
    await useFont(page, 'page');

    // A long list scrolls inside the tile with a fade at its foot, and the window does not move.
    if (shape.rows > 8) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(id => {
        localStorage.setItem('fv-dash-comp-page:' + id, 'curricular');
        PageDashboard.render();
      }, cid);
      const list = page.locator('#dash-comp-page-curricular .dash-comp-list');
      expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      const box = page.locator('#dash-comp-page-curricular .dash-comp-listbox');
      await expect(box).toHaveClass(/has-more/);
      const before = await page.evaluate(() => window.scrollY);
      await list.hover();
      await page.mouse.wheel(0, 5000);
      await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await expect(box).not.toHaveClass(/has-more/);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    }
  });
}
