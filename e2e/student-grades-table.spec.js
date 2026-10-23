/**
 * The student page's Assessment Grades table shows each score the way the
 * gradebook does: points as points (not as a level), and a level with its
 * + or −.
 */
import { test, expect } from '@playwright/test';

async function openCece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.goto(page.url().replace(/#.*/, '#/student?id=' + sid));
  await page.locator('.grades-table').waitFor();
}

function row(page, title) {
  return page.locator('.gt-row', { has: page.locator('.gt-title-text', { hasText: title }) });
}

test('a points assessment shows its points and the level it counts as', async ({ page }) => {
  await openCece(page);
  const exam = row(page, 'Mid-Year Comprehensive Exam');
  await expect(exam.locator('.gt-cell-avg')).toHaveText('65/80 · 81%');
  const pips = exam.locator('.gt-score-pip');
  await expect(pips.first()).toHaveText('3');
  await expect(pips.first()).toHaveAttribute('title', '65 of 80 points (81%), counted as 3');
  await expect(page.locator('.grades-table')).not.toContainText('65.0');
});

test('a level keeps its + or −', async ({ page }) => {
  await openCece(page);
  await expect(row(page, 'Science Fair Proposal').locator('.gt-score-pip').first()).toHaveText('3−');
  await expect(row(page, 'Chemical Reactions Lab').locator('.gt-score-pip').first()).toHaveText('3+');
  await expect(row(page, 'Chemical Reactions Lab').locator('.gt-cell-avg')).toHaveText('3.3');
});
