import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

// The grade beside each name in Scores follows the class's grading style:
// the proficiency alone in a Proficiency class, both stacked in a Both class.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
});

const gradeLines = page =>
  page.locator('.gb-grid-rowhead', { hasText: 'Alice' }).locator('.gb-grid-rowhead-grade > span').allTextContents();

test('a Proficiency class shows the proficiency, never a percentage', async ({ page }) => {
  expect(await gradeLines(page)).toEqual(['3.0']);
});

test('a Both class shows the proficiency and the letter grade', async ({ page }) => {
  await page.evaluate(cid => {
    COURSES[cid].gradingSystem = 'both';
    clearProfCache();
    PageGradebook.render();
  }, TEST_COURSE.id);
  const lines = await gradeLines(page);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe('3.0');
  expect(lines[1]).toMatch(/%$/);
});
