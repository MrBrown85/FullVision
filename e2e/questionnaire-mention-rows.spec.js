import { test, expect } from '@playwright/test';

/* Picking an assignment or observation to mention only changes the row's
   colours: the row keeps its size and place, and the page doesn't move
   (Colin, 2026-10-24: "the entire row depresses and shifts"). */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports?tab=questionnaire&student=st1'));
  await page.locator('.tq-assignment-row').first().waitFor();
}

const rect = (page, sel) =>
  page.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return [r.top, r.height, r.width].map(n => Math.round(n * 10) / 10);
  }, sel);
const scroll = page => page.evaluate(() => document.getElementById('report-output').scrollTop);

test('an assignment row keeps its size and place when picked', async ({ page }) => {
  await open(page);
  const sel = '.tq-assignment-row[data-aid]:not(.selected)';
  const aid = await page.locator(sel).first().getAttribute('data-aid');
  const row = '.tq-assignment-row[data-aid="' + aid + '"]';
  await page.locator(row).scrollIntoViewIfNeeded();
  const before = await rect(page, row);
  const top = await scroll(page);
  await page.locator(row).click();
  expect(await rect(page, row)).toEqual(before); // straight after the click
  await expect(page.locator(row)).toHaveClass(/selected/);
  await page.waitForTimeout(200);
  expect(await rect(page, row)).toEqual(before);
  expect(await scroll(page)).toBe(top);
  // Picked and unpicked rows share their box; only colours animate.
  const box = await page.evaluate(() =>
    [...document.querySelectorAll('.tq-assignment-row[data-aid]')].slice(0, 4).map(r => {
      const cs = getComputedStyle(r);
      return [r.classList.contains('selected'), cs.padding, cs.borderTopWidth, cs.transitionProperty];
    }),
  );
  const shapes = new Set(box.map(b => b.slice(1).join('|')));
  expect(box.some(b => b[0]) && box.some(b => !b[0])).toBe(true);
  expect(shapes.size).toBe(1);
  expect(box[0][3]).not.toMatch(/all|padding|border-width/);
});

test('an observation row is picked in place, without redrawing the page', async ({ page }) => {
  await open(page);
  const row = page.locator('.tq-evidence-item').first();
  await row.scrollIntoViewIfNeeded();
  const top = await scroll(page);
  await page.evaluate(() => {
    document.querySelector('.tq-evidence-item').dataset.mark = 'same';
  });
  await row.click();
  await expect(page.locator('.tq-evidence-item').first()).toHaveClass(/selected/);
  await expect(page.locator('.tq-evidence-item').first()).toHaveAttribute('data-mark', 'same');
  expect(await scroll(page)).toBe(top);
});
