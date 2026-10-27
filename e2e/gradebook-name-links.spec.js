import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

// A student's name in either gradebook view opens their page, by mouse or
// by keyboard.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
});

test('clicking a name in Scores opens the student page', async ({ page }) => {
  await page.locator('.gb-grid-rowheads a.gb-grid-rowhead-name', { hasText: 'Alice' }).click();
  await expect(page).toHaveURL(/\/student\?id=stu-001&course=/);
});

test('in Competencies, Tab and Enter on a name belong to the link, not the grid', async ({ page }) => {
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  const storedScores = () =>
    page.evaluate(cid => {
      var all = JSON.parse(localStorage.getItem('gb-scores-' + cid) || '{}');
      return (all['stu-001'] || []).map(e => e.score);
    }, TEST_COURSE.id);
  // A score cell has the grid's keyboard focus first (clicking it also
  // steps its score, so compare against the score after the click).
  const cell = page.locator('#gb-data td.gb-score[data-sid="stu-001"][data-aid="assess-001"]');
  await cell.click();
  await expect(cell).toHaveClass(/gb-focus/);
  const before = await storedScores();

  const names = page.locator('.gb-grid-rowheads a.gb-grid-rowhead-name');
  await names.first().focus();
  await page.keyboard.press('Tab');
  await expect(names.nth(1)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/student\?id=stu-002&course=/);
  // Enter followed the link; it did not step the focused cell again.
  expect(await storedScores()).toEqual(before);
});
