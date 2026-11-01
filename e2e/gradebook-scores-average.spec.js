import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  seedScores,
  gotoApp,
  TEST_ASSESSMENT,
} from './helpers.js';

// The Scores view has a Class Average row, and a click on a column title
// opens the column's menu.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [TEST_ASSESSMENT]);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } }, 'stu-002': { 'assess-001': { QAP: 4 } } });
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
});

test('Scores shows a Class Average row under its columns', async ({ page }) => {
  await expect(page.locator('.gb-scores-stats-head')).toHaveText('Class Average');
  await expect(page.locator('#gb-data tr.gb-scores-stats td').first()).toHaveText('3.5');
  // The head and the row line up.
  const [head, row] = await page.evaluate(() => [
    document.querySelector('.gb-scores-stats-head').getBoundingClientRect().top,
    document.querySelector('#gb-data tr.gb-scores-stats').getBoundingClientRect().top,
  ]);
  expect(Math.abs(head - row)).toBeLessThan(1.5);
});

test('a click on a column title opens its menu', async ({ page }) => {
  // Just above the column's stripe, where its slanted title starts.
  const box = await page.locator('.gb-grid-colhead').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
  await expect(page.locator('.gb-ctx-menu')).toContainText('Grade This Assessment');
});
