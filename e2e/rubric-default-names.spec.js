import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp } from './helpers.js';

// Nov 3 sweep (step 4 group 3 #16): "New Rubric" and "Criterion 2" are real
// names with the caret at the start, so typing gave "Lab Report RubricNew
// Rubric". The default name is selected when its box gets the focus.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
});

test('typing replaces New Rubric and a clicked Criterion 1', async ({ page }) => {
  await gotoApp(page, '/assignments');
  await page.locator('[data-action="openRubricBank"]').click();
  await page.getByRole('dialog', { name: 'Rubric Bank' }).locator('[data-rb="new"]').first().click();
  const editor = page.locator('#rubric-modal');
  const name = editor.locator('#re-name');
  await expect(name).toBeFocused();
  await page.keyboard.type('Lab Report Rubric');
  await expect(name).toHaveValue('Lab Report Rubric');

  const crit = editor.locator('.rubric-criterion-name').first();
  await expect(crit).toHaveValue('Criterion 1');
  await crit.click();
  await page.keyboard.type('Hypothesis');
  await expect(crit).toHaveValue('Hypothesis');
});

test('typing replaces Criterion 2 on the Blank Rubric', async ({ page }) => {
  await gotoApp(page, '/assignments');
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.locator('[data-action="geAddCrit"]').click();
  const crit = page.locator('.af-ge-crit-name[data-i="1"]');
  await expect(crit).toBeFocused();
  await page.keyboard.type('Visual Design');
  await expect(crit).toHaveValue('Visual Design');
});
