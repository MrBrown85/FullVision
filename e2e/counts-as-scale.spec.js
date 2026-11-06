import { test, expect } from '@playwright/test';

/* Grading > Points and Proficiency: one 0–100% ruler. Counts As markers sit
   at the percent each step counts as; Points to Proficiency is the bands
   behind them. Picking a marker opens one line to type its percent. */

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

function centreX(locator) {
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  });
}

test('typing a step’s percent moves its marker, and Proficient’s changes the course % rule', async ({ page }) => {
  await openGrading(page);
  const marker = page.locator('#cm-pts-step-3p');
  const before = await centreX(marker);

  await marker.click();
  await expect(page.locator('.cm-pts-edit')).toContainText('3+ counts as');
  const box = page.locator('#cm-pts-input');
  await expect(box).toHaveValue('83.3');
  await box.fill('85');
  await box.press('Enter');
  await confirmIfAsked(page);

  await expect(page.locator('.cm-pts-marker[data-key="3+"]')).toHaveAttribute('style', /left:\s*85%/);
  await expect(page.locator('#cm-pts-input')).toHaveValue('85');
  expect(await centreX(page.locator('#cm-pts-step-3p'))).toBeGreaterThan(before);
  expect(await page.evaluate(() => getGradingScale('sci8').percents['3+'])).toBe(85);

  const rule = page.locator('.cm-rule-text', { hasText: 'Proficient counts as' });
  await expect(rule).toContainText('Proficient counts as 75% now.');
  await page.locator('#cm-pts-step-3').click();
  await page.locator('#cm-pts-input').fill('80');
  await page.locator('#cm-pts-input').press('Enter');
  await confirmIfAsked(page);
  await expect(rule).toContainText('Proficient counts as 80% now.');
});

test('BC Letter Bands markers don’t overlap, and arrows nudge a marker', async ({ page }) => {
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

  await page.locator('#cm-pts-step-3p').focus();
  await page.keyboard.press('ArrowRight');
  await confirmIfAsked(page);
  await expect(page.locator('#cm-pts-input')).toHaveValue('86.1');
  await page.locator('#cm-pts-step-3p').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cm-pts-input')).toHaveCount(0);
});
