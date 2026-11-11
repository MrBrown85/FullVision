/**
 * The student page shows each score the way the gradebook does: points as
 * points (not as a level), and a level with its + or −.
 */
import { test, expect } from '@playwright/test';

async function openCece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&tab=comps');
  await page.locator('.stu-tabs').waitFor();
}

function row(page, title) {
  return page.locator('.stu-gr .stu-ov-row', {
    has: page.locator('.stu-ov-row-title', { hasText: new RegExp('^' + title + '$') }),
  });
}

test('a points assessment shows its percent and its points out of the most', async ({ page }) => {
  await openCece(page);
  await page.locator('#stu-tab-grades').click();
  const exam = row(page, 'Mid-Year Comprehensive Exam');
  await expect(exam.locator('.stu-ov-row-main-score')).toHaveText('81%');
  await expect(exam.locator('.stu-ov-row-sub')).toHaveText('65 / 80');
  await expect(row(page, 'Data Reading Quiz').locator('.stu-ov-row-sub')).toHaveText('8 / 10');
  await expect(page.locator('.stu-panel')).not.toContainText('65.0');
  // Missing narrows the list to missing work only.
  await page.locator('[data-action="stuGrFilter"][data-filter="missing"]').click();
  await expect(row(page, 'Data Reading Quiz')).toHaveCount(0);
});

test('a level keeps its + or −', async ({ page }) => {
  await openCece(page);
  // The Competencies tab names the latest score as teachers write it, in
  // the open row's facts.
  const observation = page.getByRole('button', { name: /^Observation / });
  await observation.click();
  await expect(observation.locator('~ .stu-comp-facts .stu-comp-latest')).toContainText('3− on Science Fair Proposal');
  await page.locator('#stu-tab-grades').click();
  await expect(row(page, 'Chemical Reactions Lab').locator('.stu-ov-row-main-score')).toHaveText('3.3');
});
