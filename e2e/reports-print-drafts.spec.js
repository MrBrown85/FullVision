import { test, expect } from '@playwright/test';
import { findLowContrastText } from './contrast-check.js';
import { cardMenuItem } from './card-menu.js';

/* S2-F1: a family never sees a draft, and the teacher is asked, not
   surprised. In a class whose student page is on (the hidden build switch)
   and that returns grades When I Return Them, Print Reports and Print
   Rubrics ask first when a student in the print has a draft: "N Grades
   Aren't Returned Yet", each piece with its drafts line, and Return Them,
   Then Print / Print Without Them / Cancel (Return It / Print Without It on
   a rubric handout). Demo Mode's Science 8; window.print is counted, not
   opened. */
test.use({ viewport: { width: 1440, height: 900 } });

/* Demo Mode, the class holding grades (or `config`), and two drafts on
   returned grades: a lab level and a quiz score. Gives what was changed. */
async function demoWithDrafts(page, config) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(
    () => typeof getAssessments === 'function' && getAssessments('sci8').length > 0 && getStudents('sci8').length > 0,
    null,
    { timeout: 15000 },
  );
  return page.evaluate(
    cfg => {
      var cid = 'sci8';
      saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), cfg));
      window.__prints = 0;
      window.print = function () {
        window.__prints++;
      };
      var roster = sortStudents(getStudents(cid), 'lastName');
      // The lab: a scored student's first criterion moves a level.
      var lab = getAssessments(cid).find(function (a) {
        return a.id === 'sci8a4';
      });
      var crit = getRubricById(cid, lab.rubricId).criteria[0];
      var labSid = roster.find(function (s) {
        return (getScores(cid)[s.id] || []).some(function (e) {
          return e.assessmentId === lab.id && e.tagId === crit.id && e.score > 0 && e.score < 4;
        });
      }).id;
      var was = (getScores(cid)[labSid] || []).find(function (e) {
        return e.assessmentId === lab.id && e.tagId === crit.id;
      }).score;
      Grader.setLevel(cid, labSid, lab.id, crit.id, was + 1, 0);
      // The quiz: a points score changes.
      var quiz = getAssessments(cid).find(function (a) {
        return a.id === 'sci8q2';
      });
      var quizSid = roster.find(function (s) {
        return s.id !== labSid && getPointsScore(cid, s.id, quiz.id) > 1;
      }).id;
      Grader.setPoints(cid, quizSid, quiz.id, getPointsScore(cid, quizSid, quiz.id) - 1);
      var name = function (sid) {
        var st = roster.find(function (s) {
          return s.id === sid;
        });
        return displayNameFirst(st);
      };
      return {
        cid: cid,
        lab: lab.id,
        labTitle: lab.title,
        labSid: labSid,
        labName: name(labSid),
        quiz: quiz.id,
        quizTitle: quiz.title,
        quizSid: quizSid,
        quizName: name(quizSid),
        waiting: GradeState.draftsWaiting(cid),
      };
    },
    config || { student_page_enabled: true, return_grades: 'on_return' },
  );
}

async function openProgress(page) {
  await page.evaluate(() => window.Router.navigate('/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('.report-sheet').first()).toBeVisible();
}

const waiting = page => page.evaluate(() => GradeState.draftsWaiting('sci8'));
const prints = page => page.evaluate(() => window.__prints);
const drafts = page => page.locator('#drafts-print-overlay');

async function printReports(page) {
  await page.getByRole('button', { name: 'Print Reports' }).click();
  await expect(page.locator('#issue-overlay')).toBeVisible();
  await page.locator('#issue-overlay [data-issue="go"]').click();
}

test.describe('Print Reports with drafts', () => {
  test('names the drafts and who, and Cancel prints nothing and returns nothing', async ({ page }) => {
    const at = await demoWithDrafts(page);
    expect(at.waiting).toBe(2);
    await openProgress(page);
    await printReports(page);
    const dialog = drafts(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(dialog.locator('.confirm-title')).toHaveText('2 Grades Aren’t Returned Yet');
    const items = dialog.locator('.drafts-print-list li');
    await expect(items).toHaveCount(2);
    await expect(dialog).toContainText(at.labTitle);
    await expect(dialog).toContainText('1 draft: ' + at.labName + ' can’t see it yet.');
    await expect(dialog).toContainText(at.quizTitle);
    await expect(dialog).toContainText('1 draft: ' + at.quizName + ' can’t see it yet.');
    await expect(dialog).toContainText(
      'A progress report shows grades to families, so it leaves drafts out unless you return them.',
    );
    const buttons = dialog.locator('.drafts-print-actions button');
    await expect(buttons).toHaveText(['Return Them, Then Print', 'Print Without Them', 'Cancel']);
    // The keyboard starts on Cancel: a Return cannot be undone.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // Tab stays in the question, not the Print dialog under it.
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Return Them, Then Print' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    // Back in the Print dialog, nothing printed, nothing returned.
    await expect(page.locator('#issue-overlay')).toBeVisible();
    expect(await prints(page)).toBe(0);
    expect(await waiting(page)).toBe(2);

    // Escape is Cancel too, and leaves the Print dialog open.
    await page.locator('#issue-overlay [data-issue="go"]').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#issue-overlay')).toBeVisible();
    expect(await prints(page)).toBe(0);
    expect(await waiting(page)).toBe(2);
  });

  test('Print Without Them prints the returned grades and leaves the drafts waiting', async ({ page }) => {
    await demoWithDrafts(page);
    await openProgress(page);
    await printReports(page);
    await drafts(page).getByRole('button', { name: 'Print Without Them' }).click();
    await expect(drafts(page)).toHaveCount(0);
    await expect(page.locator('#issue-overlay')).toHaveCount(0);
    await expect.poll(() => prints(page)).toBe(1);
    expect(await waiting(page)).toBe(2);
  });

  test('Return Them, Then Print returns exactly those drafts, then prints', async ({ page }) => {
    const at = await demoWithDrafts(page);
    await openProgress(page);
    await printReports(page);
    await drafts(page).getByRole('button', { name: 'Return Them, Then Print' }).click();
    await expect(drafts(page)).toHaveCount(0);
    await expect.poll(() => prints(page)).toBe(1);
    expect(await waiting(page)).toBe(0);
    const states = await page.evaluate(
      a => [GradeState.stateOf(a.cid, a.labSid, a.lab), GradeState.stateOf(a.cid, a.quizSid, a.quiz)],
      at,
    );
    expect(states).toEqual(['returned', 'returned']);
    // The next print has nothing to ask.
    await printReports(page);
    await expect(drafts(page)).toHaveCount(0);
    await expect.poll(() => prints(page)).toBe(2);
  });

  test('in a class that does not hold grades nothing is asked', async ({ page }) => {
    await demoWithDrafts(page, { student_page_enabled: true, return_grades: 'on_save' });
    expect(await waiting(page)).toBe(0);
    await openProgress(page);
    await printReports(page);
    await expect.poll(() => prints(page)).toBe(1);
    await expect(drafts(page)).toHaveCount(0);
  });
});

test.describe('Print Rubrics with a draft, from each door', () => {
  const rubricPrint = page => page.getByRole('dialog', { name: 'Print Rubrics' });

  async function printThere(page) {
    await expect(rubricPrint(page)).toBeVisible();
    await rubricPrint(page).locator('[data-rp="print"]').click();
  }

  test('the Assignments card: asks, Cancel goes back, Print Without It leaves the draft', async ({ page }) => {
    const at = await demoWithDrafts(page);
    await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
    const card = page.locator('#ac-sci8a4');
    await card.waitFor();
    if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
    await (await cardMenuItem(card, 'printRubrics')).click();
    await printThere(page);
    const dialog = drafts(page);
    await expect(dialog.locator('.confirm-title')).toHaveText('1 Grade Isn’t Returned Yet');
    await expect(dialog).toContainText('1 draft: ' + at.labName + ' can’t see it yet.');
    await expect(dialog).toContainText(
      'A rubric handout shows grades to students, so it leaves drafts out unless you return them.',
    );
    await expect(dialog.locator('.drafts-print-actions button')).toHaveText([
      'Return It, Then Print',
      'Print Without It',
      'Cancel',
    ]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(rubricPrint(page)).toBeVisible();
    expect(await prints(page)).toBe(0);
    await printThere(page);
    await dialog.getByRole('button', { name: 'Print Without It' }).click();
    await expect.poll(() => prints(page)).toBe(1);
    expect(await waiting(page)).toBe(2);
  });

  test('Class Results: Return It, Then Print returns the draft and prints', async ({ page }) => {
    const at = await demoWithDrafts(page);
    await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
    await page.waitForSelector('#gb-data .gb-stats-row td[data-aid="sci8a4"]');
    await page.evaluate(() => ClassResults.open('sci8', 'sci8a4'));
    await page.locator('#class-results [data-cr="print"]').click();
    await printThere(page);
    await drafts(page).getByRole('button', { name: 'Return It, Then Print' }).click();
    await expect.poll(() => prints(page)).toBe(1);
    expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.labSid, a.lab), at)).toBe('returned');
    // The quiz's draft is another piece: still waiting.
    expect(await waiting(page)).toBe(1);
  });

  test('the gradebook’s column menu asks the same', async ({ page }) => {
    await demoWithDrafts(page);
    await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
    await page.waitForSelector('#gb-colheads .gb-grid-colhead[data-aid="sci8a4"]');
    await page.locator('#gb-colheads .gb-grid-colhead[data-aid="sci8a4"] .gb-grid-colhead-label').focus();
    await page.keyboard.press('Enter');
    await page.locator('.gb-ctx-menu [data-ctx="printRubrics"]').click();
    await printThere(page);
    await expect(drafts(page)).toBeVisible();
    await expect(drafts(page).locator('.confirm-title')).toHaveText('1 Grade Isn’t Returned Yet');
    await drafts(page).getByRole('button', { name: 'Cancel' }).click();
    expect(await prints(page)).toBe(0);
    expect(await waiting(page)).toBe(2);
  });
});

for (const colorScheme of ['light', 'dark']) {
  test.describe(`the question's text contrast, ${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test('every word in the question can be read', async ({ page }) => {
      await demoWithDrafts(page);
      await openProgress(page);
      await printReports(page);
      await expect(drafts(page)).toBeVisible();
      // Fades settle first, as in e2e/contrast.spec.js.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
            .map(a => a.finished.catch(() => {})),
        ),
      );
      // Only the question: the page and the Print dialog under it are covered.
      await page.evaluate(() => {
        document.body.querySelectorAll(':scope > *:not(#drafts-print-overlay)').forEach(el => {
          el.style.visibility = 'hidden';
        });
      });
      const failures = await findLowContrastText(page, { fillTokens: ['--active'] });
      expect(failures, JSON.stringify(failures, null, 1)).toEqual([]);
    });
  });
}
