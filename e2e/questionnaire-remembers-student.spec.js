import { test, expect } from '@playwright/test';

/* The Term Questionnaire opens the student it was on after the teacher
   leaves Reports for another page and comes back (page-reports.js,
   _tqOpen), in Demo Mode on Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

const onScreen = page =>
  page.evaluate(() => {
    const RQ = window.ReportQuestionnaire;
    return RQ.getTqStudents()[RQ.tqStudentIndex].id;
  });

test('Reports opens the questionnaire on the student it was on', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });

  // A student down the list, picked from the sidebar.
  const third = page.locator('#gb-sidebar .student-row[data-sid]').nth(2);
  const sid = await third.getAttribute('data-sid');
  expect(sid).toBeTruthy();
  expect(await onScreen(page)).not.toBe(sid);
  await third.click();
  await expect.poll(() => onScreen(page)).toBe(sid);

  // Off to the Gradebook, then back to Reports with no student named.
  await page.evaluate(r => window.Router.navigate(r), '/gradebook');
  await page.waitForURL(/\/gradebook/);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  expect(await onScreen(page)).toBe(sid);
  await expect(page.locator(`#gb-sidebar .student-row.selected[data-sid="${sid}"]`)).toHaveCount(1);
});
