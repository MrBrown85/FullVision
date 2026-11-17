import { test, expect } from '@playwright/test';

/* The assessment form's Type (Colin, Nov 17): the ten kinds of task, and
   Add a Type… for a class's own. Demo Mode, Science 8
   (teacher/assessment-type-field.js). */

async function openForm(page) {
  await page.getByRole('button', { name: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await openForm(page);
});

test('Type offers Oral and Presentation, not media types', async ({ page }) => {
  await expect(page.locator('label[for="af-evidence"]')).toHaveText('Type');
  const labels = await page.locator('#af-evidence option').allTextContents();
  expect(labels).toEqual(expect.arrayContaining(['Oral', 'Presentation', 'Test', 'Add a Type…']));
  expect(labels).not.toContain('Audio');
  expect(labels).not.toContain('Video');
  expect(labels).not.toContain('Photo');
});

test('a teacher adds a type, it saves, and the next assessment offers it under This Class', async ({ page }) => {
  await page.fill('#af-title', 'Debate on Ecosystems');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.selectOption('#af-evidence', '__add__');
  const box = page.locator('#af-type-new');
  await expect(box).toBeFocused();
  await expect(page.locator('#af-evidence')).toBeHidden();
  await box.fill('Debate');
  await box.press('Enter');
  // Enter adds the word; the form stays open.
  await expect(page.locator('#af-evidence')).toBeVisible();
  await expect(page.locator('#af-evidence')).toHaveValue('Debate');
  await expect(page.locator('#af-title')).toBeVisible();

  await page.locator('[data-action="saveNewAssess"]:not([data-draft])').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Debate on Ecosystems'));
  expect(saved.evidenceType).toBe('Debate');

  await openForm(page);
  await expect(page.locator('#af-type-added option')).toHaveText(['Debate']);
});

test('a typed word already in the list is chosen, and Escape closes only the box', async ({ page }) => {
  await page.selectOption('#af-evidence', 'test');
  await page.selectOption('#af-evidence', '__add__');
  await page.locator('#af-type-new').fill('oral');
  await page.locator('#af-type-add-btn').click();
  await expect(page.locator('#af-evidence')).toHaveValue('oral');
  await expect(page.locator('#af-type-added')).toHaveCount(0);

  await page.selectOption('#af-evidence', '__add__');
  await page.locator('#af-type-new').fill('Never Mind');
  await page.locator('#af-type-new').press('Escape');
  await expect(page.locator('#af-evidence')).toHaveValue('oral');
  await expect(page.locator('#af-type-added')).toHaveCount(0);
  await expect(page.locator('#af-title')).toBeVisible();
});
