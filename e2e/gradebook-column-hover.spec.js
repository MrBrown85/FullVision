import { test, expect } from '@playwright/test';

/* Hovering a score cell highlights its column as well as its row, in both
   views, and nothing on the grid moves. Demo Mode, Science 8. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
}

const boxes = page =>
  page.locator('#gb-data td').evaluateAll(els =>
    els.slice(0, 60).map(el => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    }),
  );

async function checkColumn(page, cellSel, headSel) {
  const row = page.locator('#gb-data tbody tr:not(.gb-stats-row)').nth(2);
  const cell = row.locator(cellSel).nth(3);
  const idx = await cell.evaluate(td => td.cellIndex);
  const before = await boxes(page);
  await cell.hover();

  // Every student's cell in that column, and its header.
  const lit = await page.evaluate(
    idx =>
      Array.from(document.querySelectorAll('#gb-data tbody tr:not(.gb-stats-row)')).map(tr =>
        tr.children[idx].classList.contains('gb-col-hover'),
      ),
    idx,
  );
  expect(lit.length).toBeGreaterThan(3);
  expect(lit.every(Boolean)).toBe(true);
  await expect(page.locator(headSel).nth(idx)).toHaveClass(/gb-col-hover/);
  await expect(page.locator('#gb-data tbody tr:not(.gb-stats-row) .gb-col-hover')).toHaveCount(lit.length);
  // The column's blue is the row's blue.
  const bgOf = loc => loc.evaluate(td => getComputedStyle(td).backgroundColor);
  const rowMate = row.locator('td').nth(idx + 2);
  const colMate = page.locator('#gb-data tbody tr:not(.gb-stats-row)').nth(5).locator('td').nth(idx);
  await expect.poll(async () => (await bgOf(colMate)) === (await bgOf(rowMate))).toBe(true);
  expect(await boxes(page)).toEqual(before);

  // The next column over takes the highlight.
  await row.locator(cellSel).nth(4).hover();
  await expect(page.locator(headSel).nth(idx + 1)).toHaveClass(/gb-col-hover/);
  await expect(page.locator(headSel).nth(idx)).not.toHaveClass(/gb-col-hover/);

  // Leaving the grid clears it.
  await page.mouse.move(5, 5);
  await expect(page.locator('.gb-col-hover')).toHaveCount(0);
}

test.describe('Gradebook column hover', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
  });

  test('Scores view lights the hovered cell’s column', async ({ page }) => {
    await page.goto('/gradebook?course=sci8');
    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    await expect(page.locator('.gb-scores-cell').first()).toBeVisible();
    await checkColumn(page, 'td.gb-scores-cell', '#gb-colheads .gb-grid-colhead');
  });

  test('Competencies view lights the hovered cell’s column', async ({ page }) => {
    await page.goto('/gradebook?course=sci8');
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('.gb-grid-tag-header').first()).toBeVisible();
    await checkColumn(page, 'td.gb-score', '#gb-colheads .gb-grid-tag-header');
  });
});
