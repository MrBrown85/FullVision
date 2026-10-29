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

  test('gradebook page renders', async ({ page }) => {
    await gotoApp(page, '/gradebook');
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('shows view mode tabs', async ({ page }) => {
    await gotoApp(page, '/gradebook');
    const body = await page.locator('body').textContent();
    // Should show Competencies and/or Scores tabs
    const hasViewTabs = body.includes('Competencies') || body.includes('Scores');
    expect(hasViewTabs).toBeTruthy();
  });

  test('displays student names when seeded', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await gotoApp(page, '/gradebook');

    const body = page.locator('body');
    await expect(body).toContainText('Alice');
    await expect(body).toContainText('Bob');
    await expect(body).toContainText('Charlie');
  });

  test('shows learning outcome columns', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await gotoApp(page, '/gradebook');

    const body = await page.locator('body').textContent();
    // Should show tag/section names in column headers
    const hasColumns =
      body.includes('Questioning') || body.includes('Planning') || body.includes('Processing') || body.includes('QAP');
    expect(hasColumns).toBeTruthy();
  });

  test('shows new assessment button in gradebook', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await gotoApp(page, '/gradebook');

    // Gradebook should have a "New Assessment" option or show assessments
    const body = await page.locator('body').textContent();
    const hasAssessmentUI =
      body.includes('New Assessment') || body.includes('Lab Report') || body.includes('assessment');
    expect(hasAssessmentUI).toBeTruthy();
  });

  test('filter button exists', async ({ page }) => {
    await gotoApp(page, '/gradebook');
    const filterBtn = page.locator('[data-action="toggleFilterStrip"]').first();
    await expect(filterBtn).toBeVisible();
  });

  test('search input exists', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await gotoApp(page, '/gradebook');

    const searchInput = page.locator('input[placeholder*="Search" i], input[data-action="onSearch"]').first();
    await expect(searchInput).toBeVisible();
  });

  test('clicking Scores tab renders Scores view without crashing', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
      'stu-002': { 'assess-001': { QAP: 2 } },
      'stu-003': { 'assess-001': { QAP: 4 } },
    });
    await gotoApp(page, '/gradebook');
    // Click the Scores tab
    const scoresBtn = page.locator('[data-action="setView"][data-mode="scores"]');
    await scoresBtn.click();
    await page.waitForTimeout(500);
    // Verify the view rendered — student names should still be visible
    const body = await page.locator('body').textContent();
    expect(body).toContain('Alice');
    // Verify the Scores tab is now active
    await expect(scoresBtn).toHaveClass(/active/);
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
    await expect(page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Mark missing' })).toHaveClass(/is-disabled/);
    await expect(page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Excuse' })).toHaveClass(/is-disabled/);
    await page.locator('.gb-ctx-menu .gb-ctx-item', { hasText: 'Mark missing' }).click();
    expect((await statuses())['stu-002:assess-001']).toBeUndefined();
    await page.keyboard.press('Escape');

    await pick('Mark missing');
    expect((await statuses())['stu-001:assess-001']).toBe('NS');
    await expect(cell).toHaveText('M');

    await pick('Excuse');
    expect((await statuses())['stu-001:assess-001']).toBe('EXC');
    await expect(cell).toContainText('EXC');

    await pick('Undo excuse');
    expect((await statuses())['stu-001:assess-001']).toBeUndefined();
    await expect(cell).not.toContainText('EXC');
    // The other student's cell is untouched.
    expect((await statuses())['stu-002:assess-001']).toBeUndefined();
  });

  test('the Gradebook tab opens on Scores, even after Competencies was used', async ({ page }) => {
    await seedStudents(page);
    await page.addInitScript(() => localStorage.setItem('gb_viewMode', 'detailed'));
    await gotoApp(page, '/gradebook');
    await expect(page.locator('[data-action="setView"][data-mode="summary"]')).toHaveCount(0);
    await expect(page.locator('[data-action="setView"][data-mode="scores"]')).toHaveClass(/active/);
  });

  test('switching between both tabs does not crash', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
      'stu-002': { 'assess-001': { QAP: 2 } },
      'stu-003': { 'assess-001': { QAP: 4 } },
    });
    await gotoApp(page, '/gradebook');
    // Scores → Competencies → Scores
    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#main')).not.toBeEmpty();
    // Scores → Competencies
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#main')).not.toBeEmpty();
    // Back to Scores one more time
    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    await page.waitForTimeout(300);
    const body = await page.locator('body').textContent();
    expect(body).toContain('Alice');
  });
});
