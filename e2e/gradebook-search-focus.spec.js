import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp } from './helpers.js';

// Each letter filters the gradebook, which redraws the page; typing must
// carry on in the search box, spaces and capitals included.
test('gradebook search keeps the focus and the text as typed', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await gotoApp(page, '/gradebook');

  const search = page.locator('.gb-search-input');
  await search.click();
  await page.keyboard.type('Alice ');

  await expect(search).toHaveValue('Alice ');
  await expect(search).toBeFocused();
  await expect(page.locator('.gb-grid-rowhead')).toHaveCount(1);
  await expect(page.locator('.gb-grid-rowhead')).toContainText('Alice');

  // The caret stays where it was: delete the first letter, then put it back.
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await expect(search).toHaveValue('lice ');
  await page.keyboard.type('A');
  await expect(search).toHaveValue('Alice ');
  await expect(search).toBeFocused();
});
