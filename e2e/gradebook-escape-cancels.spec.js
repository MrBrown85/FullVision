import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

// Escape in a Scores cell throws away what was typed.
test('Escape in a Scores cell cancels the edit', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');

  const cell = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
  await cell.click();
  const input = cell.locator('.gb-scores-input');
  await input.fill('1');
  await input.press('Escape');

  await expect(input).toHaveCount(0);
  await expect(cell).toContainText('3.0');
  const stored = await page.evaluate(cid => {
    var all = JSON.parse(localStorage.getItem('gb-scores-' + cid) || '{}');
    return (all['stu-001'] || []).filter(e => e.assessmentId === 'assess-001').map(e => e.score);
  }, TEST_COURSE.id);
  expect(stored).toEqual([3]);
});
