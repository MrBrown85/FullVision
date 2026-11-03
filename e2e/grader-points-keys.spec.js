import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// A points box in the grader (the gradebook's dialog and the Assignments
// page for one student) and in the class list: a typo never deletes the
// saved score, only a blank box clears; Escape puts the saved score back
// and leaves the box, and a second Escape closes the dialog; the box is
// focused with its text selected when it opens, and Enter moves to the next
// student's box.
const CID = TEST_COURSE.id;
const POINTS = {
  id: 'assess-pk',
  title: 'Points Quiz',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: '',
  scoreMode: 'points',
  maxPoints: 10,
  weight: 1,
  dueDate: '',
  collaboration: 'individual',
  moduleId: '',
  pairs: [],
  groups: [],
  excludedStudents: [],
  created: new Date('2026-03-21').toISOString(),
};

async function setup(page, route) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(({ list, cid }) => localStorage.setItem('gb-assessments-' + cid, JSON.stringify(list)), {
    list: [POINTS],
    cid: CID,
  });
  await gotoApp(page, route);
  await page.evaluate(cid => {
    setPointsScore(cid, 'stu-001', 'assess-pk', 6);
    setPointsScore(cid, 'stu-002', 'assess-pk', 8);
  }, CID);
}
const saved = (page, sid) => page.evaluate(({ cid, sid }) => getPointsScore(cid, sid, 'assess-pk'), { cid: CID, sid });

async function openDialog(page, sid) {
  await page.evaluate(() => window.Router.navigate('/gradebook'));
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await page.locator('.gb-scores-cell[data-sid="' + sid + '"][data-aid="assess-pk"]').click();
  return page.locator('#grader-overlay .grader-dialog');
}

test('dialog: a typo puts the saved points back; a blank box clears', async ({ page }) => {
  await setup(page, '/dashboard');
  const dialog = await openDialog(page, 'stu-001');
  const input = dialog.locator('.grdp-input');
  await input.fill('abc');
  await dialog.locator('.grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  expect(await saved(page, 'stu-001')).toBe(6);

  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-pk"]').click();
  await page.locator('#grader-overlay .grdp-input').fill('');
  await page.locator('#grader-overlay .grader-done').click();
  expect(await saved(page, 'stu-001')).toBeNull();
});

test('dialog: Escape puts back the saved points, a second Escape closes', async ({ page }) => {
  await setup(page, '/dashboard');
  const dialog = await openDialog(page, 'stu-001');
  const input = dialog.locator('.grdp-input');
  // Opens focused with the score selected, ready to type over.
  await expect(input).toBeFocused();
  expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 1]);
  await page.keyboard.type('1');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('6');
  await expect(input).not.toBeFocused();
  await expect(page.locator('#grader-overlay')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  expect(await saved(page, 'stu-001')).toBe(6);
});

test('dialog: Enter saves and moves to the next student with the box selected', async ({ page }) => {
  await setup(page, '/dashboard');
  const dialog = await openDialog(page, 'stu-001');
  const input = dialog.locator('.grdp-input');
  await input.fill('7');
  await input.press('Enter');
  await expect(dialog.locator('.grader-student')).toContainText('Bob');
  expect(await saved(page, 'stu-001')).toBe(7);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('8');
  expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 1]);
  // Typing replaces the selected score.
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  expect(await saved(page, 'stu-002')).toBe(9);
  await expect(dialog.locator('.grader-student')).toContainText('Charlie');
  await expect(input).toBeFocused();
});

test('Assignments focus card: Escape and typos keep the saved points', async ({ page }) => {
  await setup(page, '/dashboard');
  await page.evaluate(() => window.Router.navigate('/assignments'));
  await page.locator('#gb-roster-list .student-row[data-sid="stu-001"]').click();
  const input = page.locator('#ac-assess-pk .grader-inline .grdp-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('6');
  await expect(input).not.toBeFocused();
  expect(await saved(page, 'stu-001')).toBe(6);

  await input.fill('x');
  await input.press('Tab');
  await expect(input).toHaveValue('6');
  expect(await saved(page, 'stu-001')).toBe(6);

  await input.fill('5');
  await input.press('Enter');
  expect(await saved(page, 'stu-001')).toBe(5);
  await expect(page.locator('.focus-banner')).toContainText('Bob');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('8');
});

test('class list: a typo puts the saved points back; a blank box clears', async ({ page }) => {
  await setup(page, '/dashboard');
  await page.evaluate(() => window.Router.navigate('/assignments'));
  const card = page.locator('#ac-assess-pk');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const input = card.locator('.ldg-row[data-status-student="stu-001"] .ldg-pts-input');
  await input.fill('abc');
  await input.press('Tab');
  await expect(input).toHaveValue('6');
  expect(await saved(page, 'stu-001')).toBe(6);
  await input.fill('');
  await input.press('Tab');
  expect(await saved(page, 'stu-001')).toBeNull();
});
