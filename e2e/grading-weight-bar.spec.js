import { test, expect } from '@playwright/test';

/* Grading › Course Percentage: the line between two categories drags (mouse
   or touch) and moves by the arrow keys, the weight boxes follow, and Save
   Categories saves what the drag set. The math and the save are pinned in
   tests/grading-bars.test.js; this checks the drag on a real page. */

async function openGrading(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Grading/ }).click();
  await expect(page.locator('#cm-weight-bar')).toBeVisible();
}

const box = i => `.cm-cat-weight[data-idx="${i}"]`;

test('dragging a line moves weight between two categories and saves', async ({ page }) => {
  await openGrading(page);
  // The presets and their sentences show once Edit is pressed.
  await page.locator('[data-action="cmPtsEdit"]').click();
  await expect(page.locator('.cm-pts-preset-text').first()).toContainText('Extending counts as 100% (A)');
  await page.locator('[data-action="cmPtsCancel"]').click();
  await expect(page.locator(box(0))).toHaveValue('40');
  await expect(page.locator(box(1))).toHaveValue('35');

  await page.locator('#cm-weight-bar').scrollIntoViewIfNeeded();
  const bar = await page.locator('#cm-weight-bar').boundingBox();
  const grip = await page.locator('.cm-weight-grip').first().boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.55, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator(box(0))).toHaveValue('55');
  await expect(page.locator(box(1))).toHaveValue('20');
  await expect(page.locator(box(2))).toHaveValue('25');
  await expect(page.locator('.cm-weight-grip').first()).toHaveAttribute('aria-valuenow', '55');

  // The arrow keys on the focused line: 1% each.
  await page.locator('.cm-weight-grip').first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(box(0))).toHaveValue('54');
  await expect(page.locator(box(1))).toHaveValue('21');
  await expect(page.locator('.cm-weight-grip').first()).toBeFocused();

  await page.locator('[data-action="cmCatSave"]').click();
  await expect.poll(() => page.evaluate(() => getCategories('sci8').map(c => c.weight))).toEqual([54, 21, 25]);
});
