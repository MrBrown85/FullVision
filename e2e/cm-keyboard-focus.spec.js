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
  // The tab draws once more when its level wording has loaded. A key pressed and let go across that draw
  // reaches two different buttons and does nothing, which is not what these tests check, so they start after it.
  await page.waitForFunction(() => !!window.BANK_PROFICIENCY);
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

test('How Folders Count keeps the focus after Space, through its question, and a Grading menu keeps it after a change', async ({
  page,
}) => {
  await enterDemo(page);
  await openCompetencies(page);
  // A folder's Each choice moves grades, so it asks first.
  const each = () => page.locator('.cm-fc-seg[data-value="each"]').first();
  await expect(each()).toHaveAttribute('aria-checked', 'false');
  await each().focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
  await page.keyboard.press('Enter'); // Cancel
  await expect(each()).toBeFocused();
  await expect(each()).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Space');
  await page.locator('#confirm-ok-btn').click();
  await expect(each()).toHaveAttribute('aria-checked', 'true');
  await expect(each()).toBeFocused();

  await page.getByRole('tab', { name: /^Grading/ }).click();
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

/* Class Settings can be drawn again while a question is open: the Competencies tab draws once more when its
   level wording has loaded, and any tab does when the class's data arrives. The question then gave the focus
   back to a choice no longer on the page, and Cancel left it nowhere: the test above failed 18 times in 160,
   eight at a time (Nov 25, 2026). */
test('A question gives the focus back to the choice that opened it when Class Settings was drawn again under it', async ({
  page,
}) => {
  await enterDemo(page);
  await openCompetencies(page);
  const each = () => page.locator('.cm-fc-seg[data-value="each"]').first();
  const cancel = page.locator('#confirm-cancel-btn');
  const redraw = () => page.evaluate(() => DashClassManager.renderClassManager());
  await expect(each()).toHaveAttribute('aria-checked', 'false');

  // Cancel with Enter.
  await each().focus();
  await page.keyboard.press('Space');
  await expect(cancel).toBeFocused();
  await redraw();
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cancel).toHaveCount(0);
  await expect(each()).toBeFocused();
  await expect(each()).toHaveAttribute('aria-checked', 'false');

  // Escape.
  await page.keyboard.press('Space');
  await expect(cancel).toBeFocused();
  await redraw();
  await page.keyboard.press('Escape');
  await expect(cancel).toHaveCount(0);
  await expect(each()).toBeFocused();

  // Change: the choice is made and keeps the focus.
  await page.keyboard.press('Space');
  await expect(cancel).toBeFocused();
  await redraw();
  await page.locator('#confirm-ok-btn').click();
  await expect(each()).toHaveAttribute('aria-checked', 'true');
  await expect(each()).toBeFocused();
});

/* The same draw took the focus off whatever had it, so the next key went nowhere: Space pressed on a choice
   just after the Competencies tab opened did nothing (4 runs in 120 of the test above, Nov 25, 2026). */
test('A choice and a tab keep the focus when Class Settings is drawn again, so the next key reaches them', async ({
  page,
}) => {
  await enterDemo(page);
  await openCompetencies(page);
  const each = () => page.locator('.cm-fc-seg[data-value="each"]').first();
  const redraw = () => page.evaluate(() => DashClassManager.renderClassManager());

  await each().focus();
  await redraw();
  await expect(each()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(each()).toBeFocused();

  const tab = page.locator('#cm-tab-competencies');
  await tab.focus();
  await redraw();
  await expect(tab).toBeFocused();
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
