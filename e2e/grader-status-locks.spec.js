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

// Nov 3 sweep (step 4 group 3 #19): a greyed-out Missing looked like an
// enabled one and its tip didn't say what to do; Clear Score was offered on
// a cell with nothing to clear.
test('a locked Missing looks off and says to clear the score; Clear Score is off on an empty cell', async ({
  page,
}) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [{ ...TEST_ASSESSMENT, rubricId: '' }]);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').click();
  const ns = page.locator('#grader-overlay .grader-status [data-status="NS"]');
  const late = page.locator('#grader-overlay .grader-status [data-status="LATE"]');
  await expect(ns).toBeDisabled();
  await expect(ns).toHaveAttribute('title', /Clear it first to mark Missing or Excused/);
  const opacity = el => el.evaluate(b => Number(getComputedStyle(b).opacity));
  expect(await opacity(ns)).toBeLessThan(0.6);
  expect(await opacity(late)).toBe(1);
  await page.keyboard.press('Escape');

  await page.locator('.gb-scores-cell[data-sid="stu-002"][data-aid="assess-001"]').click({ button: 'right' });
  await expect(page.locator('.gb-ctx-item[data-ctx="clearCell"]')).toHaveClass(/is-disabled/);
  await page.keyboard.press('Escape');
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').click({ button: 'right' });
  await expect(page.locator('.gb-ctx-item[data-ctx="clearCell"]')).not.toHaveClass(/is-disabled/);
  await expect(page.locator('.gb-ctx-item[data-ctx="markMissing"]')).toHaveAttribute(
    'title',
    /Clear it first to mark Missing or Excused/,
  );
});

// Nov 3 sweep (step 4 group 3 #20): the grader greyed the Overall Comment
// for a Missing student while the Assignments row kept it open.
test('the grader keeps the Overall Comment open for a Missing student, as the rows do', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [{ ...TEST_ASSESSMENT, rubricId: '' }]);
  await page.addInitScript(cid => {
    localStorage.setItem('gb-statuses-' + cid, JSON.stringify({ 'stu-001:assess-001': 'NS' }));
  }, TEST_COURSE.id);
  await gotoApp(page, '/gradebook');
  await page.evaluate(cid => PageAssignments.openGrader(cid, 'assess-001', 'stu-001'), TEST_COURSE.id);
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog.locator('.grader-body')).toHaveClass(/is-locked/);
  const box = dialog.locator('.grdt-overall .grdt-note');
  expect(await box.evaluate(el => Number(getComputedStyle(el.closest('.grdt-overall')).opacity))).toBe(1);
  expect(await dialog.locator('.grdl-cards').evaluate(el => Number(getComputedStyle(el).opacity))).toBeLessThan(1);
  await box.click();
  await box.fill('Please hand this in by Friday.');
  await dialog.locator('.grader-student').click();
  expect(await page.evaluate(cid => getScoreComment(cid, 'stu-001', 'assess-001'), TEST_COURSE.id)).toBe(
    'Please hand this in by Friday.',
  );
});
