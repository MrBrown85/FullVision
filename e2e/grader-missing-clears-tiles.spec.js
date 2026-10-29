import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  seedScores,
  gotoApp,
  TEST_COURSE,
  TEST_ASSESSMENT,
} from './helpers.js';

// Missing clears a student's rubric levels; the grader dialog shows them
// cleared straight away, not the old levels until the next redraw.
test('Missing clears the rubric levels shown in the grader dialog', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [{ ...TEST_ASSESSMENT, rubricId: 'rubric-mc' }]);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await page.addInitScript(cid => {
    localStorage.setItem(
      'gb-rubrics-' + cid,
      JSON.stringify([
        {
          id: 'rubric-mc',
          name: 'Lab Report Rubric',
          criteria: [
            {
              id: 'crit-hyp',
              name: 'Hypothesis',
              tagIds: ['QAP'],
              levels: { 4: 'Bold, testable', 3: 'Clear and testable', 2: 'Partly testable', 1: 'Not testable' },
            },
          ],
        },
      ]),
    );
  }, TEST_COURSE.id);
  await gotoApp(page, '/gradebook');
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog.locator('.grdt-tile.is-chosen')).toContainText('Proficient');

  await dialog.locator('.grader-status [data-status="NS"]').click();
  await expect(dialog.locator('.grader-grade')).toHaveText('Missing');
  await expect(dialog.locator('.grdt-tile.is-chosen')).toHaveCount(0);

  // Taking Missing off leaves the levels cleared, as saved. A second press
  // within 300 ms is taken as a double click and ignored.
  await page.waitForTimeout(350);
  await dialog.locator('.grader-status [data-status="NS"]').click();
  await expect(dialog.locator('.grader-grade')).toHaveText('Not Graded');
  await expect(dialog.locator('.grdt-tile.is-chosen')).toHaveCount(0);
});
