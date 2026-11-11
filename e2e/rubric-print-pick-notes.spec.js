import { test, expect } from '@playwright/test';
import { cardMenuItem } from './card-menu.js';

// Print Rubrics: each name in the Pick Students list carries a note
// ("changed since Nov 2", "printed Nov 2"). The list is two columns, and a
// long name with its note once ran into the next column. Every note now stays
// inside its own column at the widths teachers use.
for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1024, 768],
]) {
  test(`Print Rubrics notes stay in their column at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => getAssessments('sci8').length > 0);
    // Every third student printed with a rubric that has since changed, the
    // rest printed as they are now.
    await page.evaluate(() => {
      var sids = sortStudents(getStudents('sci8'), 'lastName').map(s => s.id);
      setRubricPrints(
        'sci8',
        'sci8a19',
        sids.map((sid, i) => ({
          sid: sid,
          hash: i % 3 === 0 ? 'older' : RubricPrint.fingerprint('sci8', 'sci8a19', sid),
          at: '2026-11-02T18:00:00Z',
        })),
      );
      window.Router.navigate('/assignments?course=sci8');
    });
    const card = page.locator('#ac-sci8a19');
    await card.waitFor();
    if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
    await (await cardMenuItem(card, 'printRubrics')).click();
    await expect(page.locator('.rp-pick .rp-tag.is-changed').first()).toBeVisible();

    const spills = await page.locator('.rp-pick .rp-pick-row').evaluateAll(rows =>
      rows
        .map(row => {
          var label = row.querySelector('.rp-pick-option > span');
          var right = row.getBoundingClientRect().right;
          var parts = [label].concat(Array.from(label.querySelectorAll('.rp-tag, .rp-help')));
          var worst = Math.max.apply(
            null,
            parts.map(el => el.getBoundingClientRect().right),
          );
          return worst > right + 0.5 ? label.textContent.trim() : null;
        })
        .filter(Boolean),
    );
    expect(spills).toEqual([]);
    expect(await page.locator('.rp-pick .rp-tag.is-changed').count()).toBe(9);
  });
}
