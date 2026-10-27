/**
 * The student page shows each score the way the gradebook does: points as
 * points (not as a level), and a level with its + or −.
 */
import { test, expect } from '@playwright/test';

async function openCece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid);
  await page.locator('.stu-tabs').waitFor();
}

function row(page, title) {
  return page.locator('.stu-assess-row', { has: page.getByRole('link', { name: title, exact: true }) });
}

test('a points assessment shows its points out of the most', async ({ page }) => {
  await openCece(page);
  await page.locator('#stu-tab-assess').click();
  await expect(row(page, 'Mid-Year Comprehensive Exam').locator('.stu-assess-score')).toHaveText('65/80 · 81%');
  await expect(row(page, 'Data Reading Quiz').locator('.stu-assess-score')).toHaveText('8/10 · 80%');
  await expect(page.locator('.stu-panel')).not.toContainText('65.0');
  // The Points filter keeps only points work.
  await page.locator('.stu-chip[data-filter="points"]').click();
  await expect(row(page, 'Science Fair Proposal')).toHaveCount(0);
  await expect(row(page, 'Data Reading Quiz')).toHaveCount(1);
});

test('a level keeps its + or −', async ({ page }) => {
  await openCece(page);
  // The Competencies tab names the latest score as teachers write it.
  const questioning = page.locator('.stu-comp-row', { hasText: 'Questioning and Predicting' });
  await expect(questioning.locator('.stu-comp-latest')).toContainText('3− on Science Fair Proposal');
  await page.locator('#stu-tab-assess').click();
  await expect(row(page, 'Chemical Reactions Lab').locator('.stu-assess-score')).toHaveText('3.3');
});
