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

// Missing and Excused are for work that wasn't handed in: the grader greys
// them out while the student has a score or feedback, and frees them again
// once both are gone. Late stays available.
test('Missing and Excused follow the score and feedback in the grader dialog', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [{ ...TEST_ASSESSMENT, rubricId: 'rubric-sl' }]);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await page.addInitScript(cid => {
    localStorage.setItem(
      'gb-rubrics-' + cid,
      JSON.stringify([
        {
          id: 'rubric-sl',
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
  const btn = key => dialog.locator('.grader-status [data-status="' + key + '"]');

  await expect(dialog.locator('.grdt-tile.is-chosen')).toContainText('Proficient');
  await expect(btn('NS')).toBeDisabled();
  await expect(btn('EXC')).toBeDisabled();
  await expect(btn('LATE')).toBeEnabled();

  // No level and no feedback: free again.
  await dialog.locator('.grdt-chosen-label').click();
  await expect(dialog.locator('.grdt-tile.is-chosen')).toHaveCount(0);
  await expect(btn('NS')).toBeEnabled();
  await expect(btn('EXC')).toBeEnabled();

  // A criterion note is feedback.
  const note = dialog.locator('textarea[data-action-blur="graderCritNote"]');
  await note.fill('Check your variables.');
  await dialog.locator('.grader-title').click();
  await expect(btn('NS')).toBeDisabled();
  await note.fill('');
  await dialog.locator('.grader-title').click();
  await expect(btn('NS')).toBeEnabled();

  await btn('NS').click();
  await expect(btn('NS')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.grader-grade')).toHaveText('Missing');
});
