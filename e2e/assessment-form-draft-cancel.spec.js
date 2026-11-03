import { test, expect } from '@playwright/test';

/* Draft and Cancel safety (audit, 2026-11-02): a written Blank rubric is
   kept while another start is open and shows again when Blank reopens; the
   editor's Cancel asks first. The form's Cancel asks whenever the form
   differs from how it opened, for new and edited work, and its dialog
   starts on Keep Editing. Demo Mode, Science 8. */
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
async function openEdit(page, aid) {
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
}
const dialog = page => page.locator('#af-dialog-title');
const cell = page => page.locator('[data-ge="level"][data-i="0"][data-level="3"]');

test('a written Blank draft is kept across Choose and shows again', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-ge-name', 'Kept Draft');
  await cell(page).fill('Keeps its words');
  await page.locator('.af-rubric-start[data-start="choose"]').click();
  await expect(page.locator('#af-start-search')).toBeVisible();
  await page.locator('.af-rubric-start[data-start="blank"]').click();
  await expect(page.locator('#af-ge-name')).toHaveValue('Kept Draft');
  await expect(cell(page)).toHaveValue('Keeps its words');
});

test('the Blank tab again folds the draft away and keeps it', async ({ page }) => {
  await openNew(page);
  await cell(page).fill('Still here');
  await page.locator('.af-rubric-start[data-start="blank"]').click();
  await expect(page.locator('.af-ge-card')).toHaveCount(0);
  await page.locator('.af-rubric-start[data-start="blank"]').click();
  await expect(cell(page)).toHaveValue('Still here');
});

test('the editor Cancel asks first on a written draft', async ({ page }) => {
  await openNew(page);
  await cell(page).fill('Words');
  await page.locator('.af-ge-card [data-action="closeStart"]').click();
  await expect(dialog(page)).toHaveText('Discard This Rubric?');
  await expect(page.locator('.af-dialog-card button', { hasText: 'Keep Editing' })).toBeFocused();
  await page.locator('.af-dialog-card button', { hasText: 'Keep Editing' }).click();
  await expect(cell(page)).toHaveValue('Words');
  await page.locator('.af-ge-card [data-action="closeStart"]').click();
  await page.locator('.af-dialog-card button', { hasText: 'Discard' }).click();
  await expect(page.locator('.af-ge-card')).toHaveCount(0);
  await page.locator('.af-rubric-start[data-start="blank"]').click();
  await expect(cell(page)).toHaveValue('');
});

test('the editor Cancel on an untouched draft closes without asking', async ({ page }) => {
  await openNew(page);
  await page.locator('.af-ge-card [data-action="closeStart"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.af-ge-card')).toHaveCount(0);
});

test('Cancel on an untouched new form closes without asking', async ({ page }) => {
  await openNew(page);
  await page.locator('[data-action="cancelAssessForm"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('#af-title')).toBeHidden();
});

test('Cancel on a new form with only a description asks', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-desc', 'Just a description');
  await page.locator('[data-action="cancelAssessForm"]').click();
  await expect(dialog(page)).toHaveText('Discard This Assessment?');
  await expect(page.locator('.af-dialog-card button', { hasText: 'Keep Editing' })).toBeFocused();
});

test('Cancel on a new form with only points settings asks', async ({ page }) => {
  await openNew(page);
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.locator('#af-maxpoints-picks [data-value="25"]').click();
  await page.locator('[data-action="cancelAssessForm"]').click();
  await expect(dialog(page)).toHaveText('Discard This Assessment?');
});

test('Cancel on an edit with no changes closes without asking', async ({ page }) => {
  await openList(page);
  await openEdit(page, 'sci8a20');
  await page.locator('[data-action="cancelAssessForm"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('#af-title')).toBeHidden();
});

test('Cancel on an edit with changes asks, and Discard keeps the stored work', async ({ page }) => {
  await openList(page);
  await openEdit(page, 'sci8a20');
  await page.fill('#af-title', 'Science Fair Proposal EDITED');
  await page.locator('[data-action="cancelAssessForm"]').click();
  await expect(dialog(page)).toHaveText('Discard Your Changes?');
  await expect(page.locator('.af-dialog-card button', { hasText: 'Keep Editing' })).toBeFocused();
  await page.locator('.af-dialog-card button', { hasText: 'Discard' }).click();
  await expect(page.locator('#af-title')).toBeHidden();
  expect(await page.evaluate(() => getAssessments('sci8').find(a => a.id === 'sci8a20').title)).toBe(
    'Science Fair Proposal',
  );
});
