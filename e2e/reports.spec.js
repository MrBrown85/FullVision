import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp } from './helpers.js';

async function openProgressReports(page) {
  const progressTab = page.getByRole('tab', { name: 'Progress Reports' });
  await expect(progressTab).toBeVisible();
  await page.locator('#report-output > *').first().waitFor();
  await progressTab.click();
}

test.describe('Reports — Page Studio', () => {
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

  test('the Studio offers a palette of blocks', async ({ page }) => {
    await gotoApp(page, '/reports');
    await openProgressReports(page);
    const blocks = page.locator('[data-action="studioBlock"]');
    expect(await blocks.count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator('#studio-inspector')).toContainText('Longest report in class');
  });

  test('shows student names with seeded data', async ({ page }) => {
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
      'stu-002': { 'assess-001': { QAP: 2 } },
    });
    await gotoApp(page, '/reports');

    const body = await page.locator('body').textContent();
    const hasStudents = body.includes('Alice') || body.includes('Bob') || body.includes('Charlie');
    expect(hasStudents).toBeTruthy();
  });

  test('questionnaire tab is accessible', async ({ page }) => {
    await seedStudents(page);
    await gotoApp(page, '/reports');

    const tab = page
      .locator(
        '[data-action*="questionnaire" i], [data-tab="questionnaire"], button:has-text("Questionnaire"), a:has-text("Questionnaire")',
      )
      .first();
    await expect(tab).toBeVisible();
    await tab.click();
    await page.waitForTimeout(500);
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('print button exists when students are loaded', async ({ page }) => {
    await seedStudents(page);
    await gotoApp(page, '/reports');
    await openProgressReports(page);
    await openProgressReports(page);

    const printBtn = page
      .locator(
        '[data-action="printReports"], button:has-text("Print"), button:has-text("Export"), button:has-text("Generate")',
      )
      .first();
    await expect(printBtn).toBeVisible();
  });
});
