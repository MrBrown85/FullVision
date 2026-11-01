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

// Each grid is one Tab stop; the arrows move the selection, Return opens the
// grader, Shift+F10 the cell menu, and the selection comes back after either.
const SECOND = { ...TEST_ASSESSMENT, id: 'assess-002', title: 'Lab Report 2', date: '2026-03-10' };

test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [TEST_ASSESSMENT, SECOND]);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
});

const focusedCell = page =>
  page.evaluate(() => {
    var el = document.activeElement;
    return el && el.dataset ? el.dataset.sid + '|' + el.dataset.aid : null;
  });

test('Scores: Tab enters the grid, the arrows move, Return opens the grader', async ({ page }) => {
  // The first student's newest work is the grid's one Tab stop.
  const cells = page.locator('#gb-data td.gb-scores-cell[tabindex="0"]');
  await expect(cells).toHaveCount(1);
  await cells.focus();
  await page.keyboard.press('ArrowDown');
  expect(await focusedCell(page)).toBe('stu-002|assess-001');
  // The selected cell draws the blue ring.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#gb-data .gb-focus')).outlineStyle)).toBe(
    'solid',
  );
  await page.keyboard.press('ArrowRight');
  expect(await focusedCell(page)).toBe('stu-002|assess-002');
  await page.keyboard.press('ArrowUp');
  expect(await focusedCell(page)).toBe('stu-001|assess-002');
  await page.keyboard.press('ArrowLeft');
  expect(await focusedCell(page)).toBe('stu-001|assess-001');

  await page.keyboard.press('Enter');
  await expect(page.locator('#grader-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  expect(await focusedCell(page)).toBe('stu-001|assess-001');
  await expect(page.locator('#gb-data td.gb-scores-cell.gb-focus')).toHaveCount(1);
});

test('→ on a name goes to the first score and ← comes back', async ({ page }) => {
  const name = page.locator('#gb-rowheads .gb-grid-rowhead-name').nth(1);
  await name.focus();
  await page.keyboard.press('ArrowRight');
  expect(await focusedCell(page)).toBe('stu-002|assess-001');
  await page.keyboard.press('ArrowLeft');
  await expect(name).toBeFocused();
});

test('Scores: Shift+F10 opens the cell menu and Escape gives the cell its focus back', async ({ page }) => {
  await page.locator('#gb-data td.gb-scores-cell[tabindex="0"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('.gb-ctx-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gb-ctx-menu')).toHaveCount(0);
  expect(await focusedCell(page)).toBe('stu-002|assess-001');
});

test('Competencies: a click selects the cell, and typing on rubric work says how to score it', async ({ page }) => {
  await page.evaluate(() => {
    var cid = getActiveCourse();
    saveRubrics(cid, [
      {
        id: 'rub-k',
        name: 'K',
        criteria: [{ id: 'c1', name: 'One', tagIds: ['QAP'], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } }],
      },
    ]);
    var list = getAssessments(cid);
    list[0].rubricId = 'rub-k';
    saveAssessments(cid, list);
  });
  // Rubrics by Competency: a competency cell of rubric work is scored on the rubric.
  await page.evaluate(() => localStorage.setItem('gb_rubricColumns_' + getActiveCourse(), 'competencies'));
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  const rubricCell = page.locator('#gb-data td.gb-score[data-sid="stu-001"][data-aid="assess-001"]').first();
  await rubricCell.click();
  await page.keyboard.press('Escape');
  await expect(rubricCell).toHaveClass(/gb-focus/);
  await expect(rubricCell).toBeFocused();
  await page.keyboard.press('3');
  await expect(page.locator('#gb-tooltip')).toHaveText('Scored on the rubric. Press Return to open it.');
});
