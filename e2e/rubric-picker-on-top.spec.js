import { test, expect } from '@playwright/test';

/* The + Competency picker in the Blank Rubric editor draws over everything
   in the form. Opened above its button near the form's end, it runs up over
   the rubric starts (Blank Rubric, Choose a Rubric), and the open start
   drew over it, hiding part of the list (Colin, Nov 17 2026). */
test.use({ viewport: { width: 1280, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.fill('#af-title', 'Density Lab');
  await expect(page.locator('#af-rubric-view .af-ge-card')).toBeVisible();
}

/* Points of the picker that something else in the form draws over. */
const coveredPoints = page =>
  page.evaluate(() => {
    const pop = document.querySelector('.af-ge-card .af-ge-picker');
    const form = document.querySelector('#new-assess-form');
    const r = pop.getBoundingClientRect();
    const bad = [];
    for (let y = Math.max(r.top + 2, 0); y < Math.min(r.bottom - 2, innerHeight); y += 8) {
      for (const x of [r.left + 8, r.left + r.width / 2, r.right - 8]) {
        const el = document.elementFromPoint(x, y);
        if (el && !pop.contains(el) && form.contains(el)) bad.push(Math.round(y) + ':' + (el.className || el.tagName));
      }
    }
    return bad;
  });

test('+ Competency opened above its button draws over the rubric starts', async ({ page }) => {
  await openForm(page);
  // The starts sit in view, just under the page's top bar.
  await page.locator('.af-rubric-starts').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.locator('#af-rubric-view [data-action="gePicker"][data-i="0"]').click();
  const pop = page.locator('.af-ge-card .af-ge-picker');
  await expect(pop).toBeVisible();
  // As near the form's end, where the picker opens above its button.
  await pop.evaluate(el => el.classList.add('is-up'));
  const overlap = await page.evaluate(() => {
    const p = document.querySelector('.af-ge-card .af-ge-picker').getBoundingClientRect();
    const s = document.querySelector('.af-rubric-start.is-open').getBoundingClientRect();
    return p.top < s.bottom && p.bottom > s.top && p.left < s.right && p.right > s.left;
  });
  expect(overlap).toBe(true);
  expect(await coveredPoints(page)).toEqual([]);
});

test('+ Competency opened below its button is not covered either', async ({ page }) => {
  await openForm(page);
  await page.locator('#af-rubric-view [data-action="gePicker"][data-i="0"]').click();
  await expect(page.locator('.af-ge-card .af-ge-picker')).toBeVisible();
  expect(await coveredPoints(page)).toEqual([]);
});
