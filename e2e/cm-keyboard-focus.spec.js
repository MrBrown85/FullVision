import { test, expect } from '@playwright/test';

/* Class Management redraws itself when a box is ticked. Keyboard focus must
   come back to the box that was ticked, or a keyboard user is sent to the top
   of the page after every tick: Competencies select mode, and the Re-link and
   CSV review (its checkboxes and Keep Mine / Use the Curriculum Version
   radios). Demo Mode, Science 8. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
}

async function openCompetencies(page) {
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.locator('[data-action="cmSetTab"][data-tab="competencies"]').click();
}

test('select mode: Space ticks a row and focus stays on it, so the next row is one Tab away', async ({ page }) => {
  await enterDemo(page);
  await openCompetencies(page);
  await page.locator('[data-action="cmCompSelectStart"]').click();
  const boxes = page.locator('.cm-comp-select-row input');
  await boxes.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(boxes.nth(0)).toBeFocused();
  await expect(boxes.nth(0)).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(boxes.nth(1)).toBeFocused();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(page.locator('.cm-comp-selected')).toHaveText('2 Selected');
});

test('Re-link review: ticks and Keep Mine / Use the Curriculum Version keep focus', async ({ page }) => {
  await enterDemo(page);
  await openCompetencies(page);
  // A removed competency to add back, and a renamed one to choose between.
  await page.evaluate(() => {
    const cid = 'sci8';
    const map = ensureCustomLearningMap(cid);
    map.sections[0].tags[0].label = 'Questioning';
    saveLearningMap(cid, map);
    removeCompetencies(cid, [map.sections[1].id]);
  });
  await page.locator('[data-action="cmSetTab"][data-tab="competencies"]').click();
  await page.locator('[data-action="cmStartRelink"]').click();
  await page.locator('[data-action="cmRelinkNext"]').click();
  const add = page.locator('[data-action-change="cmCompReviewToggle"]').first();
  await add.focus();
  await page.keyboard.press('Space');
  await expect(add).toBeFocused();
  await expect(add).not.toBeChecked();
  const mine = page.locator('[data-action-change="cmCompReviewPick"][data-group="changed"][data-pick="mine"]').first();
  await mine.focus();
  await page.keyboard.press('ArrowRight');
  const theirs = page
    .locator('[data-action-change="cmCompReviewPick"][data-group="changed"][data-pick="theirs"]')
    .first();
  await expect(theirs).toBeFocused();
  await expect(theirs).toBeChecked();
});

test('Add Competency opens the new card with its Title ready to type over', async ({ page }) => {
  await enterDemo(page);
  await openCompetencies(page);
  await page.getByRole('button', { name: 'Add Competency' }).click();
  const card = page.locator('.cm-std-card.open', { hasText: 'New Competency' });
  await expect(card).toBeVisible();
  const title = card.locator('.cm-std-title-input');
  await expect(title).toBeFocused();
  await page.keyboard.type('Lab Safety');
  await expect(title).toHaveValue('Lab Safety');
});
