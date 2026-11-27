import { test, expect } from '@playwright/test';
import { waitForRulerStill } from './helpers.js';

/* Grading > Points and Proficiency: one 0–100% ruler. The markers, the typed
   percent, the nudges and the course % rule are pinned in
   tests/grading-tab.test.js; this keeps the one check that needs layout:
   the pills on the BC Letter Bands ruler don't overlap. */

async function openGrading(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Grading/ }).click();
  await expect(page.locator('#cm-pts-ruler')).toBeVisible();
  await waitForRulerStill(page);
}

// Saving a Counts As change asks first when a Demo Mode term has already ended.
async function confirmIfAsked(page) {
  const ok = page.locator('#confirm-ok-btn');
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

async function overlaps(page, selector) {
  const boxes = await page
    .locator(selector)
    .evaluateAll(els => els.map(el => el.getBoundingClientRect()).map(r => [r.left, r.top, r.right, r.bottom]));
  expect(boxes).toHaveLength(10);
  const hits = [];
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b, j) => {
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) hits.push([i, i + 1 + j]);
    }),
  );
  return hits;
}

test('BC Letter Bands markers don’t overlap, in the draft or once saved', async ({ page }) => {
  await openGrading(page);
  await page.locator('[data-action="cmPtsEdit"]').click();
  await page.locator('[data-action="cmPointsScaleBc"]').click();
  await expect(page.locator('#cm-pts-ruler')).toHaveClass(/is-two-rows/);
  // The ghosts of the saved markers are not live markers and may sit under them.
  expect(await overlaps(page, '.cm-pts-marker:not(.cm-pts-ghost) .cm-pts-pill')).toEqual([]);

  await page.locator('[data-action="cmPtsSave"]').click();
  await confirmIfAsked(page);
  await expect(page.locator('.cm-pts-scroll')).toHaveClass(/is-rest/);
  await expect(page.locator('#cm-pts-ruler')).toHaveClass(/is-two-rows/);
  expect(await overlaps(page, '.cm-pts-pill')).toEqual([]);
});
