import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp, TEST_STUDENTS } from './helpers.js';

// Saving a score redraws the gradebook; the table must stay where the
// teacher scrolled it, with the names still lined up with their rows.
const MANY_STUDENTS = Array.from({ length: 30 }, (_, i) => ({
  ...TEST_STUDENTS[0],
  id: 'stu-' + String(i + 1).padStart(3, '0'),
  firstName: 'Student' + (i + 1),
  preferred: 'Student' + (i + 1),
  lastName: 'L' + String(i + 1).padStart(2, '0'),
  sortName: 'L' + String(i + 1).padStart(2, '0') + ' Student' + (i + 1),
  studentNumber: String(2000 + i),
}));

test('saving a score keeps the table scrolled where it was', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page, MANY_STUDENTS);
  await seedAssessments(page);
  await gotoApp(page, '/gradebook');

  const data = page.locator('#gb-data');
  await data.evaluate(el => (el.scrollTop = 600));

  const cell = page.locator('.gb-scores-cell[data-sid="stu-025"][data-aid="assess-001"]');
  // A click opens the grader dialog; the typed editor is Edit score.
  await cell.click({ button: 'right' });
  await page.locator('.gb-ctx-item[data-ctx="editCell"]').click();
  await cell.locator('.gb-scores-input').fill('3');
  // Measured once the editor is open: focusing it may nudge the cell into view.
  const before = await data.evaluate(el => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.locator('.gb-toolbar').click({ position: { x: 5, y: 5 } });
  await expect(cell).toContainText('3.0');

  expect(await data.evaluate(el => el.scrollTop)).toBe(before);
  expect(await page.locator('#gb-rowheads').evaluate(el => el.scrollTop)).toBe(before);
});
