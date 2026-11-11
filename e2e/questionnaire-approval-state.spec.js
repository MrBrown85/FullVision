import { test, expect } from '@playwright/test';

/* Approval and screen state (bug hunt, Nov 1 2026), in Demo Mode on
   Science 8's Report 2 (Term 2, from July 13). */
test.use({ viewport: { width: 1440, height: 900 } });

async function go(page, student) {
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
}
const saved = (page, sid) => page.evaluate(s => getStudentTermRating('sci8', s, 'term-2') || {}, sid);

/* The rest of the bug hunt's cases (changed marks, Write Your Own, IE) are pinned
   in tests/questionnaire-approval-state.test.js. This keeps the Escape key on the
   deadline calendar, which that file calls through the function, not the key. */
test('IE with no date: the calendar opens, nothing saves until a date; Escape keeps Letter Grade', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    COURSES.sci8.gradingSystem = 'letter';
    COURSES.sci8.gradeLevel = '10';
    // Cece has marks on only a few assignments, so IE is on offer.
    const keep = getScores('sci8').st1.slice(0, 2);
    getScores('sci8').st1 = keep;
    clearProfCache();
  });
  await go(page, 'st1');
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  const ie = page.locator('#tq-basis [data-basis="ie"]');
  test.skip(!(await ie.count()), 'IE is not on offer for this student in Demo Mode');
  await ie.click();
  await expect(page.locator('#tq-cal')).toBeVisible();
  await expect(ie).toHaveClass(/\bpending\b/);
  await expect(page.locator('#tq-basis')).toContainText('Pick the deadline to report IE.');
  expect((await saved(page, 'st1')).reportingBasis || 'grade').toBe('grade');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  await expect(page.locator('#tq-basis [data-basis="grade"]')).toHaveAttribute('aria-checked', 'true');
  expect((await saved(page, 'st1')).reportingBasis || 'grade').toBe('grade');
  // Again, and a date: IE and the deadline save together.
  await ie.click();
  await page.locator('#tq-cal .qn-cal-day:not([disabled])').first().click();
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  const r = await saved(page, 'st1');
  expect(r.reportingBasis).toBe('ie');
  expect(r.ieDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('#tq-basis [data-basis="ie"]')).toHaveAttribute('aria-checked', 'true');
});
