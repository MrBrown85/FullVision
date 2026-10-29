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

  await dialog.locator('.grader-status [data-status="NS"]').click();
  await expect(dialog.locator('.grader-foot')).toContainText('Missing');

  await dialog.locator('.grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await expect(cell).toHaveText('M');
  const status = await page.evaluate(cid => {
    var all = JSON.parse(localStorage.getItem('gb-statuses-' + cid) || '{}');
    return all['stu-001:assess-001'] || null;
  }, TEST_COURSE.id);
  expect(status).toBe('NS');
});

// A person holds the button down a moment. Focus leaving the dialog in that
// time must not redraw the status buttons and lose the click.
async function slowClick(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test('one click sets a status in the grader dialog', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await gotoApp(page, '/gradebook');
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').click();
  const status = page.locator('#grader-overlay .grader-status');
  await expect(status).toBeVisible();

  await slowClick(page, status.locator('[data-status="LATE"]'));
  await expect(status.locator('[data-status="LATE"]')).toHaveAttribute('aria-pressed', 'true');
  await slowClick(page, status.locator('[data-status="EXC"]'));
  await expect(status.locator('[data-status="EXC"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a click anywhere on a chosen rubric level clears it', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [
    {
      ...TEST_ASSESSMENT,
      rubricId: 'rubric-gd',
    },
  ]);
  await page.addInitScript(cid => {
    localStorage.setItem(
      'gb-rubrics-' + cid,
      JSON.stringify([
        {
          id: 'rubric-gd',
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

  await dialog.locator('.grdt-tile[data-level="3"]').click();
  const chosen = dialog.locator('.grdt-tile.is-chosen');
  await expect(chosen).toContainText('Proficient');
  // − | + fine-tunes without clearing.
  await chosen.locator('[data-mod="1"]').click();
  await expect(dialog.locator('.grdt-chosen-label')).toHaveText(/Proficient \+/);
  await slowClick(page, dialog.locator('.grdt-tile.is-chosen .grdt-words'));
  await expect(dialog.locator('.grdt-tile.is-chosen')).toHaveCount(0);
  await expect(dialog.locator('.grader-grade')).toHaveText('Not Graded');
});
