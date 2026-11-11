import { test, expect } from '@playwright/test';

/* S2-F2: in a class whose student page is on (the hidden build switch) and
   that returns grades When I Return Them, the Term Questionnaire and Sent
   to Phones show what a family reads: returned grades only. Cece's lab is
   changed to Emerging on every criterion and left as a draft. Her
   questionnaire's grade and the phone copy sent keep the grade she was
   given, while the same copy drawn on all work has moved. In an As Soon As
   I Save class the copy moves at once. (Returning it is held in
   tests/questionnaire-holds-drafts.test.js.) Demo Mode's Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function demoWithDraft(page, config) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  return page.evaluate(cfg => {
    var cid = 'sci8';
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), cfg));
    window.print = function () {};
    var st = getStudents(cid).find(function (s) {
      return s.id === 'st1';
    });
    var before = PhoneReports.snapshot(cid, st, { termId: 'term-1', termLabel: 'Report 1' }).overall.text;
    var lab = getAssessments(cid).find(function (a) {
      return a.id === 'sci8a4';
    });
    getRubricById(cid, lab.rubricId).criteria.forEach(function (c) {
      Grader.setLevel(cid, 'st1', lab.id, c.id, 1, 0);
    });
    clearProfCache();
    return {
      before: before,
      // The same copy drawn on all work (inside the grader's row, the teacher's own): the draft counts.
      now: ReportScores.withReportScores('grader', function () {
        return PhoneReports.snapshot(cid, st, { termId: 'term-1', termLabel: 'Report 1' }).overall.text;
      }),
      state: GradeState.stateOf(cid, 'st1', lab.id),
    };
  }, config);
}

async function readPhoneCopy(page) {
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await page.getByRole('button', { name: 'Sent to Phones' }).click();
  await page.getByRole('button', { name: 'Send to Phones and Print Slips' }).click();
  await expect(page.locator('.pp-row')).toHaveCount(27);
  // Read Report shows once a student has opened their copy: Cece's newest copy is marked opened.
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('gb-phone-reports-sci8'));
    list[0].students.find(s => s.enrollment_id === 'st1').opened_at = new Date().toISOString();
    localStorage.setItem('gb-phone-reports-sci8', JSON.stringify(list));
    PageReports.renderReports();
  });
  await page.locator('.pp-row', { hasText: 'Cece Adeyemi' }).getByRole('button', { name: 'Read Report' }).click();
  const phone = page.getByRole('dialog', { name: 'Report as the student sees it' });
  await expect(phone.locator('.pr-name')).toHaveText('Cece Adeyemi');
  await phone.getByRole('button', { name: 'Close' }).click();
  // The grade in the copy that was sent, as the phone has it.
  return page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('gb-phone-reports-sci8'));
    return list[0].students.find(s => s.enrollment_id === 'st1').data.overall.text;
  });
}

test('the questionnaire and the phone copy keep the grade Cece was given until her draft is returned', async ({
  page,
}) => {
  // The questionnaire's grade for Cece before anything changes.
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');
  const given = (await page.locator('.qn-grade-big').textContent()).trim();

  const at = await demoWithDraft(page, { student_page_enabled: true, return_grades: 'on_return' });
  expect(at.state).toBe('draft');
  // The teacher's own number has moved; what a family reads has not.
  expect(at.now).not.toBe(at.before);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');
  await expect(page.locator('.qn-grade-big')).toHaveText(given);
  expect(await readPhoneCopy(page)).toBe(at.before);
});

test('in an As Soon As I Save class they show the change at once', async ({ page }) => {
  const at = await demoWithDraft(page, { student_page_enabled: true, return_grades: 'on_save' });
  expect(at.state).toBe('returned');
  expect(await readPhoneCopy(page)).not.toBe(at.before);
});
