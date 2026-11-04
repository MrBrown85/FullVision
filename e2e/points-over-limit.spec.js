import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Nov 3 sweep (step 4 group 2 #17): extra credit goes up to twice the
// maximum (D4), and a higher score was cut to it without a word, so 45 typed
// for 4.5 became a perfect double. The toast now says what was saved, and
// Undo puts back the score before.
const QUIZ = {
  id: 'a-cap',
  title: 'Density Worksheet',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  rubricId: '',
  scoreMode: 'points',
  maxPoints: 10,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};
async function seed(page) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(({ list, cid }) => localStorage.setItem('gb-assessments-' + cid, JSON.stringify(list)), {
    list: [QUIZ],
    cid: TEST_COURSE.id,
  });
}
const saved = page => page.evaluate(cid => getPointsScore(cid, 'stu-001', 'a-cap'), TEST_COURSE.id);

test('the ledger says when a score over twice the maximum is cut, and Undo puts back the old one', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-a-cap');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const input = card.locator('.ldg-row[data-status-student="stu-001"] .ldg-pts-input');
  await input.fill('4');
  await input.press('Tab');
  expect(await saved(page)).toBe(4);
  await expect(page.locator('#undo-toast')).toHaveCount(0);

  await input.fill('45');
  await input.press('Tab');
  await expect(page.locator('#undo-toast')).toContainText(
    '45 is more than twice the 10-point maximum, so it was saved as 20.',
  );
  expect(await saved(page)).toBe(20);
  await page.locator('#undo-toast .undo-toast-btn').click();
  expect(await saved(page)).toBe(4);
  await expect(card.locator('.ldg-row[data-status-student="stu-001"] .ldg-pts-input')).toHaveValue('4');
});

test('the grader says so too', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/gradebook');
  await page.evaluate(cid => PageAssignments.openGrader(cid, 'a-cap', 'stu-001'), TEST_COURSE.id);
  const input = page.locator('#grader-overlay .grdp-input');
  await input.fill('25');
  await input.press('Tab');
  await expect(page.locator('#undo-toast')).toContainText('so it was saved as 20.');
  expect(await saved(page)).toBe(20);
  await page.locator('#undo-toast .undo-toast-btn').click();
  expect(await saved(page)).toBe(null);
});
