import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp } from './helpers.js';

// A score this device can't keep is said on the sync dot only: no message,
// and the gradebook keeps showing what the teacher entered.
test('a score the device cannot keep turns the sync dot red, with no message', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');

  await page.evaluate(() => {
    var real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (/^gb-scores-/.test(key)) {
        var err = new Error('full');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return real.call(this, key, value);
    };
  });

  const cell = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
  // A click opens the grader dialog; the typed editor is Edit score.
  await cell.click({ button: 'right' });
  await page.locator('.gb-ctx-item[data-ctx="editCell"]').click();
  await cell.locator('.gb-scores-input').fill('2');
  await cell.locator('.gb-scores-input').press('Enter');

  await expect(page.locator('#sync-indicator-dot')).toHaveClass(/error/);
  await expect(page.locator('#sync-indicator-dot')).toHaveAttribute('title', /storage is full/);
  await expect(page.locator('.sync-toast')).toHaveCount(0);
  await expect(cell).toContainText('2.0');
});
