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

// The gradebook explains itself: an Overall heading over the grades, "Out of"
// on points work, a key under the grid, and a competency code's wording on
// hover.
const QUIZ = { ...TEST_ASSESSMENT, id: 'quiz-1', title: 'Quiz 1', scoreMode: 'points', maxPoints: 10 };
const HOMEWORK = { ...TEST_ASSESSMENT, id: 'hw-1', title: 'Homework', scoreMode: 'complete', maxPoints: 1 };

test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [TEST_ASSESSMENT, QUIZ, HOMEWORK]);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
});

test('Scores: Overall heading, Out of on points work, and the key', async ({ page }) => {
  await expect(page.locator('.gb-grid-corner')).toContainText('Overall');
  await expect(page.locator('.gb-grid-colhead[data-aid="quiz-1"] .gb-scores-assess-meta')).toContainText('Out of 10');
  // Complete/Incomplete work has no total.
  await expect(page.locator('.gb-grid-colhead[data-aid="hw-1"] .gb-scores-assess-meta')).toHaveText('Mar 20, 2026');
  await expect(page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]')).toHaveAttribute(
    'aria-label',
    /3\.0, Proficient$/,
  );
  const key = page.locator('.gb-key');
  for (const word of ['Emerging', 'Developing', 'Proficient', 'Extending', 'Missing', 'Excused', 'Late', 'No Score'])
    await expect(key).toContainText(word);
});

test('Competencies: the key, and a code shows its wording at once on hover', async ({ page }) => {
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  await expect(page.locator('.gb-key')).toBeVisible();
  const head = page.locator('.gb-grid-tag-header', { hasText: 'QAP' }).first();
  await head.hover();
  await expect(page.locator('#gb-tooltip')).toBeVisible();
  await expect(page.locator('#gb-tooltip')).toContainText('QAP');
});
