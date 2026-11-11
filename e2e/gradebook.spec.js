import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  seedScores,
  gotoApp,
  TEST_ASSESSMENT,
  TEST_COURSE,
  TEST_STUDENTS,
} from './helpers.js';

test.describe('Gradebook — Spreadsheet View', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
  });

  test('cell menu marks a score missing and excused', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-002': { 'assess-001': { QAP: 2 } },
    });
    await gotoApp(page, '/gradebook');
    await page.locator('[data-action="setView"][data-mode="scores"]').click();

    const cell = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
    const statuses = () =>
      page.evaluate(cid => JSON.parse(localStorage.getItem('gb-statuses-' + cid) || '{}'), TEST_COURSE.id);
    const pick = async label => {
      await cell.click({ button: 'right' });
      await page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: label }).click();
    };

    // A scored cell can't be Missing or Excused.
    const scored = page.locator('.gb-scores-cell[data-sid="stu-002"][data-aid="assess-001"]');
    await scored.click({ button: 'right' });
    await expect(page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Mark Missing' })).toHaveClass(/is-disabled/);
    await expect(page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Excuse' })).toHaveClass(/is-disabled/);
    // A disabled menu item (aria-disabled) does nothing when clicked.
    await page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Mark Missing' }).click({ force: true });
    expect((await statuses())['stu-002:assess-001']).toBeUndefined();
    await page.keyboard.press('Escape');

    await pick('Mark Missing');
    expect((await statuses())['stu-001:assess-001']).toBe('NS');
    await expect(cell).toHaveText('M');

    await pick('Excuse');
    expect((await statuses())['stu-001:assess-001']).toBe('EXC');
    await expect(cell).toContainText('EXC');

    await pick('Undo Excuse');
    expect((await statuses())['stu-001:assess-001']).toBeUndefined();
    await expect(cell).not.toContainText('EXC');
    // The other student's cell is untouched.
    expect((await statuses())['stu-002:assess-001']).toBeUndefined();
  });

  test('a Late score keeps its score and shows an L in both views', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, { 'stu-002': { 'assess-001': { QAP: 2 } } });
    await gotoApp(page, '/gradebook');
    await page.locator('[data-action="setView"][data-mode="scores"]').click();

    const cell = page.locator('.gb-scores-cell[data-sid="stu-002"][data-aid="assess-001"]');
    const statuses = () =>
      page.evaluate(cid => JSON.parse(localStorage.getItem('gb-statuses-' + cid) || '{}'), TEST_COURSE.id);

    await cell.click({ button: 'right' });
    await page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Mark Late' }).click();
    expect((await statuses())['stu-002:assess-001']).toBe('LATE');
    await expect(cell.locator('.gb-late')).toHaveText('L');
    await expect(cell).toContainText('2.0');
    await expect(cell).toHaveAttribute('aria-label', /, Late$/);

    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('#gb-data td.gb-score[data-sid="stu-002"][data-aid="assess-001"] .gb-late')).toHaveCount(
      1,
    );

    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    await cell.click({ button: 'right' });
    await page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Undo Late' }).click();
    expect((await statuses())['stu-002:assess-001']).toBeUndefined();
    await expect(cell.locator('.gb-late')).toHaveCount(0);
  });

  test('the Gradebook tab opens on Scores, even after Competencies was used', async ({ page }) => {
    await seedStudents(page);
    await page.addInitScript(() => localStorage.setItem('gb_viewMode', 'detailed'));
    await gotoApp(page, '/gradebook');
    await expect(page.locator('[data-action="setView"][data-mode="summary"]')).toHaveCount(0);
    await expect(page.locator('[data-action="setView"][data-mode="scores"]')).toHaveClass(/active/);
  });
});
