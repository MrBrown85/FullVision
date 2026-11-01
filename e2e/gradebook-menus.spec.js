import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

// The cell and column menus close cleanly: the click that closes one does
// nothing else, Escape closes it, and the keyboard can pick an item.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-002': { 'assess-001': { QAP: 2 } } });
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
});

const menu = page => page.locator('.gb-ctx-menu');

test('the click that closes a cell menu does not open the grader', async ({ page }) => {
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  // The opened cell's own top-left corner sits outside the menu.
  const opened = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
  await opened.click({ position: { x: 3, y: 3 } });
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  // The next click works as usual.
  await page.locator('.gb-scores-cell[data-sid="stu-002"][data-aid="assess-001"]').click();
  await expect(page.locator('#grader-overlay')).toBeVisible();
});

test('Escape closes a menu, and the arrow keys and Return pick an item', async ({ page }) => {
  const cell = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
  await cell.click({ button: 'right' });
  await expect(menu(page)).toHaveAttribute('role', 'menu');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);

  await cell.click({ button: 'right' });
  // Edit Score, Clear Score, Mark Missing: the third item.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.gb-ctx-item[data-ctx="markMissing"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  const statuses = await page.evaluate(
    cid => JSON.parse(localStorage.getItem('gb-statuses-' + cid) || '{}'),
    TEST_COURSE.id,
  );
  expect(statuses['stu-001:assess-001']).toBe('NS');
});
