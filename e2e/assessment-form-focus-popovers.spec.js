import { test, expect } from '@playwright/test';

/* Focus, popovers and validation (audit, 2026-11-02): a stopped save shows
   red even while focused, and the title's error clears as it's typed;
   focus lands somewhere after Use This Rubric, Esc and the ··· menu; the
   Blank editor's menu and picker close on an outside click, clear the
   sticky footer, and the picker works from the keyboard; the menu lists
   points in the grid's order. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openList(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await expect(page.locator('button', { hasText: 'New Assessment' }).first()).toBeVisible();
}
async function openNew(page) {
  await openList(page);
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}
const RED = 'rgb(211, 47, 47)';

test('New Assessment puts the cursor in the title', async ({ page }) => {
  await openNew(page);
  await expect(page.locator('#af-title')).toBeFocused();
});

test('a missing category shows red while focused, and the hint turns red', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-title', 'Needs A Category');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect(page.locator('#af-category')).toBeFocused();
  await expect(page.locator('#af-category')).toHaveCSS('border-top-color', RED);
  await expect(page.locator('#af-category-hint')).toHaveCSS('color', RED);
  await page.selectOption('#af-category', { index: 1 });
  await expect(page.locator('#af-category')).not.toHaveAttribute('aria-invalid', 'true');
});

test('a missing title shows red and clears as soon as one is typed', async ({ page }) => {
  await openNew(page);
  await page.locator('[data-action="saveNewAssess"]').click();
  const title = page.locator('#af-title');
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveCSS('border-top-color', RED);
  await page.keyboard.type('A');
  await expect(title).not.toHaveAttribute('aria-invalid', 'true');
});

test('Enter in Choose a Rubric uses it and focus stays on the card', async ({ page }) => {
  await openNew(page);
  await page.locator('.af-rubric-start[data-start="choose"]').click();
  await expect(page.locator('#af-start-search')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#af-rubric-view .af-rubric-card [data-action="chooseRubric"]')).toBeFocused();
});

test('Esc from Pick Another Rubric goes back to its button', async ({ page }) => {
  await openNew(page);
  await page.locator('.af-rubric-start[data-start="choose"]').click();
  await page.keyboard.press('Enter');
  await page.locator('#af-rubric-view [data-action="chooseRubric"]').click();
  await expect(page.locator('#af-start-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#af-rubric-view [data-action="chooseRubric"]')).toBeFocused();
});

test('Use This Rubric on the Competency Rubric keeps focus on the form', async ({ page }) => {
  await openNew(page);
  await page.locator('.af-ge-card [data-action="closeStart"]').click();
  await page.evaluate(() => document.querySelectorAll('.af-tag-cb')[0].click());
  await page.locator('[data-action="useCompetencyRubric"]').click();
  await expect(page.locator('#af-rubric-view [data-action="editRubricFromForm"]')).toBeFocused();
});

test('the ··· menu focuses its Weight, lists points in grid order, and closes outside', async ({ page }) => {
  await openNew(page);
  await page.locator('[data-action="geMenu"][data-i="0"]').click();
  await expect(page.locator('[data-ge="weight"][data-i="0"]')).toBeFocused();
  const menuOrder = await page
    .locator('.af-ge-menu [data-ge="value"]')
    .evaluateAll(els => els.map(e => e.dataset.level));
  const gridOrder = await page
    .locator('.af-ge-grid tbody tr')
    .first()
    .locator('[data-ge="level"]')
    .evaluateAll(els => els.map(e => e.dataset.level));
  expect(menuOrder).toEqual(gridOrder);
  await page.locator('[data-ge="level"][data-i="0"][data-level="2"]').click();
  await expect(page.locator('.af-ge-menu')).toHaveCount(0);
  await expect(page.locator('[data-action="geMenu"][data-i="0"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-ge="level"][data-i="0"][data-level="2"]')).toBeFocused();
});

test('the + Competency picker closes on an outside click', async ({ page }) => {
  await openNew(page);
  await page.locator('[data-action="gePicker"][data-i="0"]').click();
  await expect(page.locator('.af-ge-picker')).toHaveCount(1);
  await page.locator('#af-title').click();
  await expect(page.locator('.af-ge-picker')).toHaveCount(0);
});

test('the picker works from the keyboard', async ({ page }) => {
  await openNew(page);
  await page.locator('[data-action="gePicker"][data-i="0"]').click();
  await expect(page.locator('#af-ge-pick-search')).toBeFocused();
  const first = await page.locator('.af-ge-pick').first().getAttribute('data-tag');
  const second = await page.locator('.af-ge-pick').nth(1).getAttribute('data-tag');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.af-ge-pick').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.af-ge-pick').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#af-ge-pick-search')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.af-ge-chip')).toHaveCount(1);
  await page.locator('[data-action="gePicker"][data-i="0"]').click();
  await page.keyboard.type(await page.evaluate(id => getTagById('sci8', id).code, second));
  await page.keyboard.press('Enter');
  await expect(page.locator('.af-ge-chip')).toHaveCount(2);
  await expect(page.locator('.af-ge-chip b').first()).toHaveText(
    await page.evaluate(id => getTagById('sci8', id).code, first),
  );
});

test('at 1024 the picker clears the sticky footer', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openNew(page);
  await page.locator('[data-action="geAddCrit"]').click();
  await page.locator('[data-action="gePicker"][data-i="1"]').click();
  const picker = await page.locator('.af-ge-picker').boundingBox();
  const foot = await page.locator('#new-assess-form > .af-actions').boundingBox();
  expect(picker.y + picker.height).toBeLessThanOrEqual(foot.y);
});
