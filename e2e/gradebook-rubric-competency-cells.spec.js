import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  gotoApp,
  TEST_ASSESSMENT,
  TEST_COURSE,
} from './helpers.js';

// A competency column of rubric work in the gradebook reads the criteria that
// feed it and is scored on the rubric (docs/DECISIONS.md, "Rubric criteria
// score on their own"): typed scores do nothing, Enter or a click opens the
// grader, and criteria that disagree show the lowest with a striped fill.
const RUBRIC = {
  id: 'rub-rc',
  name: 'Reading Questions',
  criteria: [
    { id: 'crit-q1', name: '1. A Question', tagIds: ['QAP'], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
    { id: 'crit-q2', name: '2. A Dialogue', tagIds: ['QAP'], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
  ],
};
const ASSESS = { ...TEST_ASSESSMENT, id: 'a-rq', title: 'Reading Questions', tagIds: ['QAP'], rubricId: 'rub-rc' };

test('rubric competency cells are read-only, open the grader and mark disagreeing criteria', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [ASSESS]);
  await page.addInitScript(({ cid, rubric }) => localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric])), {
    cid: TEST_COURSE.id,
    rubric: RUBRIC,
  });
  await gotoApp(page, '/gradebook');
  await page.evaluate(() => {
    const cid = getActiveCourse();
    upsertScore(cid, 'stu-001', 'a-rq', 'crit-q1', 4, '2026-03-20', 'summative', '');
    upsertScore(cid, 'stu-001', 'a-rq', 'crit-q2', 2, '2026-03-20', 'summative', '');
    clearProfCache();
  });
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  const cell = page.locator('td.gb-score[data-aid="a-rq"][data-tid="QAP"][data-sid="stu-001"]');
  await expect(cell).toHaveText('2');
  await expect(cell.locator('.gb-mixed')).toHaveCount(1);
  await expect(cell).toHaveAttribute('data-action', 'editScoreCell');

  const keys = () =>
    page.evaluate(() =>
      getScores(getActiveCourse())
        ['stu-001'].filter(e => e.assessmentId === 'a-rq')
        .map(e => e.tagId + ':' + e.score)
        .sort()
        .join(','),
    );
  const before = await keys();
  await cell.evaluate(td => td.classList.add('gb-focus'));
  for (const key of ['3', 'Backspace', '+']) await page.keyboard.press(key);
  expect(await keys()).toBe(before);

  await page.keyboard.press('Enter');
  await expect(page.locator('#grader-overlay .grader-dialog')).toBeVisible();
  await expect(page.locator('#grader-overlay .grdt-crit')).toHaveCount(2);
});
