import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

// A score entered in the Competencies view (click or keyboard) shows in the
// student's Overall and the Class Average at once, and Cmd+Z undoes it.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
});

const overall = page =>
  page.locator('.gb-grid-rowhead', { hasText: 'Alice' }).locator('.gb-grid-rowhead-overall').textContent();
const classAverage = page =>
  page.evaluate(() => {
    var cell = document.querySelector('#gb-data td.gb-score[data-sid="stu-001"][data-aid="assess-001"]');
    var i = Array.prototype.indexOf.call(cell.parentElement.children, cell);
    return document.querySelector('#gb-data tr.gb-stats-row').children[i].textContent;
  });
const stored = page =>
  page.evaluate(cid => {
    var all = JSON.parse(localStorage.getItem('gb-scores-' + cid) || '{}');
    return (all['stu-001'] || []).filter(e => e.score > 0).map(e => e.score);
  }, TEST_COURSE.id);

test('click and keyboard entries update Overall and Class Average, and undo', async ({ page }) => {
  const cell = page.locator('#gb-data td.gb-score[data-sid="stu-001"][data-aid="assess-001"]');
  expect(await overall(page)).toContain('3.0');

  // A click steps 3 to 4.
  await cell.click();
  await expect.poll(() => overall(page)).toContain('4.0');
  expect(await classAverage(page)).toContain('4.0');
  await expect(cell).toHaveClass(/gb-focus/);

  // The keyboard sets 2.
  await page.keyboard.press('2');
  await expect.poll(() => overall(page)).toContain('2.0');
  expect(await classAverage(page)).toContain('2.0');

  // Cmd+Z (Ctrl+Z) undoes the keyboard entry, then the click.
  await page.keyboard.press('Control+z');
  await expect.poll(() => stored(page)).toEqual([4]);
  await expect.poll(() => overall(page)).toContain('4.0');
  await page.keyboard.press('Control+z');
  await expect.poll(() => stored(page)).toEqual([3]);
  await expect.poll(() => overall(page)).toContain('3.0');
});
