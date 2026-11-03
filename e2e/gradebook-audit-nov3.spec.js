import { test, expect } from '@playwright/test';

/* Gradebook fixes from the Nov 3 UI audit: headers sit over their own
   columns, the student card fits the window and names the student, its
   counts don't read like scores, and the Filters button keeps its width.
   Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openGradebook(page, mode) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  if (mode) await page.evaluate(m => localStorage.setItem('gb_rubricColumns_sci8', m), mode);
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
}

for (const mode of ['criteria', 'competencies']) {
  test('each assessment header ends where its columns end (' + mode + ')', async ({ page }) => {
    await openGradebook(page, mode);
    // Every assessment header starts on a column edge, and the last one
    // ends with the last column.
    const drift = await page.evaluate(() => {
      const lefts = Array.from(document.querySelectorAll('.gb-grid-tag-header')).map(
        t => t.getBoundingClientRect().left,
      );
      const groups = Array.from(document.querySelectorAll('.gb-grid-assess-group'));
      const out = groups.map(g => {
        const l = g.getBoundingClientRect().left;
        return Math.min(...lefts.map(x => Math.abs(x - l)));
      });
      const lastTag = document.querySelectorAll('.gb-grid-tag-header');
      out.push(
        Math.abs(
          groups[groups.length - 1].getBoundingClientRect().right -
            lastTag[lastTag.length - 1].getBoundingClientRect().right,
        ),
      );
      return out;
    });
    expect(drift.length).toBeGreaterThan(3);
    expect(Math.max(...drift)).toBeLessThan(2);
  });
}

test('the student card names the student, fits the window, and counts assessments in words', async ({ page }) => {
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGradebook(page);
    await page.setViewportSize(vp);
    const name = page.locator('.gb-grid-rowhead a').first();
    await name.hover();
    const tip = page.locator('#gb-tooltip');
    await expect(tip).toBeVisible({ timeout: 3000 });
    await expect(tip.locator('.gb-tip-name')).not.toBeEmpty();
    const box = await tip.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    await expect(tip.locator('.gb-tip-grade')).toBeInViewport();
    await expect(tip).not.toContainText(/(Emerging|Developing|Proficient|Extending) \(\d+\)/);
    await page.mouse.move(5, 5);
  }
});

test('turning a filter on leaves the search box where it was', async ({ page }) => {
  await openGradebook(page);
  const search = page.locator('.gb-search-input');
  const before = (await search.boundingBox()).x;
  await page.locator('[data-action="toggleFilterStrip"]').click();
  await page
    .locator('.gb-filter-strip button, .gb-filter-strip [role="checkbox"], .gb-filter-strip input')
    .first()
    .click();
  await expect(page.locator('.gb-filter-trigger .filter-count:not(.is-empty)')).toBeVisible();
  expect(Math.abs((await search.boundingBox()).x - before)).toBeLessThan(1);
});
