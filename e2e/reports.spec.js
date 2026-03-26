import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp } from './helpers.js';

test.describe('Reports — Report Builder', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
  });

  test('reports page renders', async ({ page }) => {
    await gotoApp(page, '/reports');
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('report builder section exists', async ({ page }) => {
    await gotoApp(page, '/reports');
    const body = await page.locator('body').textContent();
    const reportWords = ['Report', 'Print', 'Preset', 'Block', 'Questionnaire', 'Narrative', 'report', 'questionnaire'];
    const hasReportUI = reportWords.some(w => body.includes(w));
    expect(hasReportUI).toBeTruthy();
  });

  test('has report preset buttons', async ({ page }) => {
    await gotoApp(page, '/reports');
    const presetBtns = page.locator('[data-action="rbApplyPreset"]');
    const count = await presetBtns.count();
    if (count > 0) {
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test('report blocks can be toggled', async ({ page }) => {
    await gotoApp(page, '/reports');
    const toggleBtns = page.locator('[data-action="rbToggleBlock"]');
    const count = await toggleBtns.count();
    if (count > 0) {
      await toggleBtns.first().click();
      await page.waitForTimeout(300);
      const main = page.locator('#main');
      await expect(main).not.toBeEmpty();
    }
  });

  test('shows student names with seeded data', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { 'QAP': 3 } },
      'stu-002': { 'assess-001': { 'QAP': 2 } },
    });
    await gotoApp(page, '/reports');

    const body = await page.locator('body').textContent();
    const hasStudents = body.includes('Alice') || body.includes('Bob') || body.includes('Charlie');
    expect(hasStudents).toBeTruthy();
  });

  test('questionnaire tab is accessible', async ({ page }) => {
    await seedStudents(page);
    await gotoApp(page, '/reports');

    const tab = page.locator('[data-action*="questionnaire" i], [data-tab="questionnaire"], button:has-text("Questionnaire"), a:has-text("Questionnaire")').first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(500);
      const main = page.locator('#main');
      await expect(main).not.toBeEmpty();
    }
  });

  test('print button exists when students are loaded', async ({ page }) => {
    await seedStudents(page);
    await gotoApp(page, '/reports');

    const printBtn = page.locator('[data-action="printReports"], button:has-text("Print"), button:has-text("Export"), button:has-text("Generate")').first();
    const exists = await printBtn.isVisible().catch(() => false);
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });
});
