import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp } from './helpers.js';

// A student's name shows their overall grade, each section and coverage, on
// hover or keyboard focus, in either view; Escape closes it.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
});

for (const view of ['scores', 'detailed']) {
  test(`hovering a name in ${view} shows the student's grades`, async ({ page }) => {
    await page.locator(`[data-action="setView"][data-mode="${view}"]`).click();
    await page.locator('.gb-grid-rowheads a.gb-grid-rowhead-name', { hasText: 'Alice' }).hover();
    const tip = page.locator('#gb-tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Overall');
    await expect(tip).toContainText('Proficient (3.0)');
    await expect(tip).toContainText('Coverage');
  });
}

test('focusing a name shows the tooltip and Escape closes it', async ({ page }) => {
  await page.locator('.gb-grid-rowheads a.gb-grid-rowhead-name', { hasText: 'Alice' }).focus();
  const tip = page.locator('#gb-tooltip');
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});
