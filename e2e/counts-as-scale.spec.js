import { test, expect } from '@playwright/test';

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
}

// A Counts As change asks first when a Demo Mode term has already ended.
async function confirmIfAsked(page) {
  const ok = page.locator('#confirm-ok-btn');
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

test('BC Letter Bands markers don’t overlap', async ({ page }) => {
  await openGrading(page);
  await page.locator('[data-action="cmPointsScaleBc"]').click();
  await confirmIfAsked(page);
  await expect(page.locator('#cm-pts-ruler')).toHaveClass(/is-two-rows/);

  const boxes = await page
    .locator('.cm-pts-pill')
    .evaluateAll(els => els.map(el => el.getBoundingClientRect()).map(r => [r.left, r.top, r.right, r.bottom]));
  expect(boxes).toHaveLength(10);
  const overlaps = [];
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b, j) => {
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) overlaps.push([i, i + 1 + j]);
    }),
  );
  expect(overlaps).toEqual([]);
});
