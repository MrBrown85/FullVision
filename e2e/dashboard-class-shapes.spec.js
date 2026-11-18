/**
 * The Competencies tile holds whatever a class has (plan F, after the Nov 5
 * stress test; the tile since D9). Two classes built in Demo Mode with the
 * New Class wizard's own functions (e2e/dashboard-shapes.js): Career
 * Education 8, 13 competencies and no folders, whose codes were all "CE";
 * and Social Studies 8 cut to its first three competencies, whose codes
 * were "SIG, SIG". At 1440, 1280 and 1024 wide, in every view of both
 * pages: the tile is the row's height, nothing scrolls sideways, every
 * Level Mix and Self-Assessment row is one height, and the codes are
 * unique. Past 12 rows a list scrolls inside the page, never the page.
 */
import { test, expect } from '@playwright/test';
import { buildClass, showClass, measureTile } from './dashboard-shapes.js';

const CLASSES = [
  { key: 'many', name: 'Career Education 8', tags: ['CAREE8'], self: true, rows: 13 },
  { key: 'few', name: 'Social Studies 8', tags: ['SS8'], keep: 3, students: 8, self: false, rows: 3 },
];

for (const shape of CLASSES) {
  test(`${shape.name}, ${shape.rows} competencies: the tile holds it in every view, unique codes`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.locator('.dash-comp-tile').waitFor();
    const cid = await buildClass(page, shape);
    await showClass(page, cid);
    await page.evaluate(id => {
      localStorage.setItem('fv-dash-comp-view:' + id, 'avg');
      PageDashboard.render();
    }, cid);
    await expect(page.locator('.dash-comp-card .dash-comp-row')).toHaveCount(shape.rows);

    const codes = await page.evaluate(id => Object.values(DashInsights.columnCodes(id)), cid);
    expect(codes).toHaveLength(shape.rows);
    expect(new Set(codes).size, codes.join(',')).toBe(codes.length);

    const views = [
      ['curricular', 'avg'],
      ['curricular', 'mix'],
      ['curricular', 'below'],
      ['curricular', 'trend'],
    ];
    for (const core of shape.self ? ['self', 'evidence'] : ['evidence']) views.push(['core', core]);
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [pg, view] of views) {
        await page.evaluate(
          ({ cid, pg, view }) => {
            localStorage.setItem('fv-dash-comp-page:' + cid, pg);
            localStorage.setItem(pg === 'core' ? 'fv-dash-core-view:' + cid : 'fv-dash-comp-view:' + cid, view);
            PageDashboard.render();
          },
          { cid, pg, view },
        );
        await expect(page.locator('.dash-comp-tile')).toHaveAttribute('data-page', pg);
        if (pg === 'curricular') await expect(page.locator('.dash-comp-card')).toHaveAttribute('data-view', view);
        const m = await measureTile(page);
        const at = `${width} ${pg}/${view}`;
        expect(m.tileH, at).toBe(m.rowH);
        expect(m.docOverflow, at).toBeLessThanOrEqual(0);
        expect(m.mainOverflow, at).toBeLessThanOrEqual(0);
        expect(m.pageScrolls, 'the page itself scrolls at ' + at).toBe(false);
        if (m.lines.length) expect(new Set(m.lines).size, 'row heights at ' + at + ': ' + m.lines).toBe(1);
        if (m.codes.length) expect(new Set(m.codes).size, at).toBe(m.codes.length);
      }
    }

    // Past 12 rows Class Average's list scrolls inside the card, with "+N more".
    if (shape.rows > 12) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(id => {
        localStorage.setItem('fv-dash-comp-page:' + id, 'curricular');
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
