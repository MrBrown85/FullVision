import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

// Clicking a Scores cell opens the Assignments page's grader for that
// student and assessment in a dialog; a change there saves and shows in the
// gradebook once the dialog closes.
test('a Scores cell opens the grader dialog', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');

  const cell = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.grader-foot')).toContainText('Proficient');

  await dialog.locator('[data-action="toggleStudentStatus"][data-status="NS"]').click();
  await expect(dialog.locator('.grader-foot')).toContainText('Missing');

  await page.keyboard.press('Escape');
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await expect(cell).toHaveText('M');
  const status = await page.evaluate(cid => {
    var all = JSON.parse(localStorage.getItem('gb-statuses-' + cid) || '{}');
    return all['stu-001:assess-001'] || null;
  }, TEST_COURSE.id);
  expect(status).toBe('NS');
});
