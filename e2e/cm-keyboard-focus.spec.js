import { test, expect } from '@playwright/test';

/* Class Settings redraws itself when a box is ticked. Keyboard focus must
   come back to the box that was ticked, or a keyboard user is sent to the top
   of the page after every tick: Competencies select mode, and the Re-link and
   CSV review (its checkboxes and Keep Mine / Use the Curriculum Version
   radios). Demo Mode, Science 8. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
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
  // The demo class comes from the bank, so the renamed one is under You
  // Changed These.
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

test('Escape closes the account menu and puts the focus on its button', async ({ page }) => {
  await enterDemo(page);
  const btn = page.locator('.tb-user-btn');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.tb-user-menu')).not.toHaveClass(/open/);
  await expect(btn).toBeFocused();
});

test('Grading tab: a switch keeps the focus after Space, through its question, and a menu keeps it after a change', async ({
  page,
}) => {
  await enterDemo(page);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Grading/ }).click();
  const sw = () => page.locator('#cm-folders-count');
  const before = await sw().isChecked();
  await sw().focus();
  await page.keyboard.press('Space');
  // Folders Count as One moves grades, so it asks first.
  await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
  await page.keyboard.press('Enter'); // Cancel
  await expect(sw()).toBeFocused();
  await expect(sw()).toBeChecked({ checked: before });
  await page.keyboard.press('Space');
  await page.locator('#confirm-ok-btn').click();
  await expect(sw()).toBeChecked({ checked: !before });
  await expect(sw()).toBeFocused();

  // A menu with no question keeps the focus after a change.
  const sel = page.locator('#cm-recent-limit');
  await sel.focus();
  const values = await sel.locator('option').evaluateAll(o => o.map(x => x.value));
  const now = await sel.inputValue();
  await sel.selectOption(values.find(v => v !== now));
  const confirm = page.locator('#confirm-ok-btn');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator('#cm-recent-limit')).toBeFocused();
});

test('Re-link with no changes shows Apply Changes greyed out', async ({ page }) => {
  await enterDemo(page);
  await openCompetencies(page);
  await page.locator('button', { hasText: 'Re-link Curriculum' }).first().click();
  await page.locator('[data-action="cmRelinkNext"]').click();
  await expect(page.locator('.cm-import-foot')).toContainText('No changes.');
  const apply = page.locator('[data-action="cmCompReviewApply"]');
  await expect(apply).toBeDisabled();
  expect(Number(await apply.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(0.6);
});
