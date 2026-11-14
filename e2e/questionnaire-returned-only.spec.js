import { test, expect } from '@playwright/test';

/* S2-F2: in a class whose student page is on (the hidden build switch) and
   that returns grades When I Return Them, the Term Questionnaire and Print
   Reports show what a family reads: returned grades only. Each piece of
   Cece's rubric work is changed to Emerging on every criterion and left as
   a draft. Her questionnaire's grade and her overall proficiency in Print
   Reports' set of scores keep the grade she was given, while the same
   reading on all work has moved. In an As Soon As I Save class it moves at
   once. A family reads the proficiency word, not a figure (DECISIONS,
   "Student-facing levels are proficiencies"), so the drafts must move the
   word: one lab's draft moves her figure but leaves her Proficient; all of
   them take her to Developing. (Returning it is held in
   tests/questionnaire-holds-drafts.test.js.) Sent to Phones, which this
   also read, is retired (2026-11-13). Demo Mode's Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function demoWithDraft(page, config) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  // Reports' scripts load when Reports first opens: open it, then go back to the Dashboard.
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  // Drawn in full (its sentence bank loaded too) before it is left.
  await page.locator('#tq-narrative').waitFor();
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  return page.evaluate(cfg => {
    var cid = 'sci8';
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), cfg));
    window.print = function () {};
    var st = getStudents(cid).find(function (s) {
      return s.id === 'st1';
    });
    var family = function () {
      return ReportBlocks.profWord(getOverallProficiency(cid, st.id));
    };
    var before = ReportScores.withReportScores('progress', family);
    var work = getAssessments(cid).filter(function (a) {
      return a.rubricId && getRubricById(cid, a.rubricId);
    });
    work.forEach(function (a) {
      getRubricById(cid, a.rubricId).criteria.forEach(function (c) {
        Grader.setLevel(cid, 'st1', a.id, c.id, 1, 0);
      });
    });
    clearProfCache();
    return {
      before: before,
      // The same reading on all work (inside the grader's row, the teacher's own): the draft counts.
      now: ReportScores.withReportScores('grader', family),
      // One state for all of it: 'draft' or 'returned'.
      state: Array.from(
        new Set(
          work.map(function (a) {
            return GradeState.stateOf(cid, 'st1', a.id);
          }),
        ),
      ).join(),
    };
  }, config);
}

// What a family reads now: Cece's overall proficiency in Print Reports' set of scores.
function readFamily(page) {
  return page.evaluate(() => {
    clearProfCache();
    return ReportScores.withReportScores('progress', () => ReportBlocks.profWord(getOverallProficiency('sci8', 'st1')));
  });
}

test('the questionnaire and Print Reports keep the grade Cece was given until her draft is returned', async ({
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
  // The teacher's own grade has moved; what a family reads has not.
  expect(at.before).toBe('Proficient');
  expect(at.now).toBe('Developing');
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');
  await expect(page.locator('.qn-grade-big')).toHaveText(given);
  expect(await readFamily(page)).toBe(at.before);
});

test('in an As Soon As I Save class they show the change at once', async ({ page }) => {
  const at = await demoWithDraft(page, { student_page_enabled: true, return_grades: 'on_save' });
  expect(at.state).toBe('returned');
  expect(at.before).toBe('Proficient');
  expect(await readFamily(page)).toBe('Developing');
});
