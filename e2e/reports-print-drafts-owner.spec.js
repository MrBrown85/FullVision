import { test, expect } from '@playwright/test';

/* S2-F1, the review's findings, held in the browser:
   - the question belongs to the dialog it is asked over: leaving the page
     closes it, and nothing is returned, printed or saved;
   - a Return that does not return every draft it named prints nothing,
     saves no copy and leaves the Print dialog open, saying so;
   - a render with no report data leaves no students behind for Print;
   - the question asks only about work the report counts (the year to
     date as of the report's term), and with Changed Since the Last Print
     only about the students who will print;
   - the Assignments page draws in a holding class whose Draft and Returned
     rows have not loaded, and its Printed marks come back once they load.
   Demo Mode's Science 8; window.print is counted, not opened. */
test.use({ viewport: { width: 1440, height: 900 } });

const HELD = { student_page_enabled: true, return_grades: 'on_return' };

async function demo(page, config) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(
    () => typeof getAssessments === 'function' && getAssessments('sci8').length > 0 && getStudents('sci8').length > 0,
    null,
    { timeout: 15000 },
  );
  await page.evaluate(cfg => {
    saveCourseConfig('sci8', Object.assign({}, getCourseConfig('sci8'), cfg));
    window.__prints = 0;
    window.print = function () {
      window.__prints++;
    };
  }, config || HELD);
}

/* A draft on a returned points score: the first student, by last name,
   with a score above 1 on `aid`. Gives the student's id. */
const draftOn = (page, aid) =>
  page.evaluate(id => {
    var cid = 'sci8';
    var st = sortStudents(getStudents(cid), 'lastName').find(function (s) {
      return getPointsScore(cid, s.id, id) > 1;
    });
    Grader.setPoints(cid, st.id, id, getPointsScore(cid, st.id, id) - 1);
    return st.id;
  }, aid);

/* A draft on the lab's first criterion for a student below Extending on it. */
const labDraft = page =>
  page.evaluate(() => {
    var cid = 'sci8';
    var lab = getAssessments(cid).find(a => a.id === 'sci8a4');
    var crit = getRubricById(cid, lab.rubricId).criteria[0];
    var sid = sortStudents(getStudents(cid), 'lastName').find(s =>
      (getScores(cid)[s.id] || []).some(
        e => e.assessmentId === lab.id && e.tagId === crit.id && e.score > 0 && e.score < 4,
      ),
    ).id;
    Grader.setLevel(cid, sid, lab.id, crit.id, 4, 0);
    return sid;
  });

async function openProgress(page) {
  await page.evaluate(() => window.Router.navigate('/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('.report-sheet').first()).toBeVisible();
}

const waiting = page => page.evaluate(() => GradeState.draftsWaiting('sci8'));
const prints = page => page.evaluate(() => window.__prints);
const copies = page => page.evaluate(() => ReportIssues.list('sci8').length);
const question = page => page.locator('#drafts-print-overlay');
const printDialog = page => page.locator('#issue-overlay');
const FAILED = 'Those grades couldn’t be returned, so nothing printed. Try again.';

async function printReports(page, who) {
  await page.getByRole('button', { name: 'Print Reports' }).click();
  await expect(printDialog(page)).toBeVisible();
  if (who)
    await printDialog(page)
      .locator('input[name="issue-who"][value="' + who + '"]')
      .check();
  await printDialog(page).locator('[data-issue="go"]').click();
}

test.describe('the question goes with the page it was asked on', () => {
  test('Back with the Print Reports question open: it closes, and nothing is returned, printed or saved', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    await draftOn(page, 'sci8q2');
    await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
    await page.waitForSelector('#gb-data');
    await openProgress(page);
    await printReports(page);
    await expect(question(page)).toBeVisible();
    const saved = await copies(page);
    await page.goBack();
    await page.waitForSelector('#gb-data');
    await expect(question(page)).toHaveCount(0);
    await expect(printDialog(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await prints(page)).toBe(0);
    expect(await waiting(page)).toBe(1);
    expect(await copies(page)).toBe(saved);
    expect(errors).toEqual([]);
  });

  test('Back with the Print Rubrics question open: it closes, and nothing is returned or printed', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    await labDraft(page);
    await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
    await page.waitForSelector('#gb-data');
    await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
    const card = page.locator('#ac-sci8a4');
    await card.waitFor();
    if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
    await card.locator('[data-action="printRubrics"]').first().click();
    await page.getByRole('dialog', { name: 'Print Rubrics' }).locator('[data-rp="print"]').click();
    await expect(question(page)).toBeVisible();
    await page.goBack();
    await page.waitForSelector('#gb-data');
    await expect(question(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await prints(page)).toBe(0);
    expect(await waiting(page)).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('a Return that does not return every draft it named', () => {
  const failTheRule = page =>
    page.evaluate(() => {
      GradeState.afterReturn = function () {
        throw new Error('the rule failed (a test)');
      };
    });

  test('Print Reports: nothing prints, no copy is saved, the Print dialog stays open and says so', async ({ page }) => {
    await demo(page);
    await draftOn(page, 'sci8q2');
    await openProgress(page);
    const saved = await copies(page);
    await failTheRule(page);
    await printReports(page);
    await question(page).getByRole('button', { name: 'Return Them, Then Print' }).click();
    await expect(question(page)).toHaveCount(0);
    await expect(printDialog(page)).toBeVisible();
    await expect(printDialog(page).locator('.drafts-print-failed')).toHaveText(FAILED);
    await page.waitForTimeout(500);
    expect(await prints(page)).toBe(0);
    expect(await copies(page)).toBe(saved);
    expect(await waiting(page)).toBe(1);
  });

  test('Print Rubrics: nothing prints or is marked printed, and the dialog stays open and says so', async ({
    page,
  }) => {
    await demo(page);
    const sid = await labDraft(page);
    await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
    const card = page.locator('#ac-sci8a4');
    await card.waitFor();
    if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
    await card.locator('[data-action="printRubrics"]').first().click();
    const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
    await failTheRule(page);
    await dialog.locator('[data-rp="print"]').click();
    await question(page).getByRole('button', { name: 'Return It, Then Print' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.drafts-print-failed')).toHaveText(FAILED);
    await page.waitForTimeout(500);
    expect(await prints(page)).toBe(0);
    expect(await page.evaluate(id => getRubricPrint('sci8', id, 'sci8a4'), sid)).toBe(null);
    expect(await waiting(page)).toBe(1);
  });
});

test('a class whose every grade is a draft has no report data: Print Reports opens nothing from the last render', async ({
  page,
}) => {
  await demo(page);
  await openProgress(page);
  await page.evaluate(() => {
    var cid = 'sci8';
    var rows = {};
    var scores = getScores(cid);
    Object.keys(scores).forEach(function (sid) {
      (scores[sid] || []).forEach(function (e) {
        rows[e.assessmentId] = rows[e.assessmentId] || {};
        rows[e.assessmentId][sid] = { is_draft: true };
      });
    });
    _saveGradeReturns(cid, rows);
    PageReports.renderReports();
  });
  await expect(page.locator('#rb-preview')).toContainText('No report data yet');
  await page.getByRole('button', { name: 'Print Reports' }).click();
  await page.waitForTimeout(300);
  await expect(printDialog(page)).toHaveCount(0);
  expect(await prints(page)).toBe(0);
});

test.describe('which drafts the question asks about', () => {
  test('only work the report counts: a draft dated after the report’s term is not asked about', async ({ page }) => {
    await demo(page);
    // Term 1 ends Jul 21; the Energy Forms Quiz is dated Sep 4, the Periodic Table Quiz May 29.
    await draftOn(page, 'sci8q8');
    await openProgress(page);
    await page.selectOption('#report-period', 'Report 1');
    await expect(page.locator('.report-sheet').first()).toBeVisible();
    await printReports(page);
    await expect.poll(() => prints(page)).toBe(1);
    await expect(question(page)).toHaveCount(0);
    // A draft on Term 1's work is asked about.
    await draftOn(page, 'sci8q2');
    await printReports(page);
    await expect(question(page)).toBeVisible();
    await expect(question(page)).toContainText('Periodic Table Quiz');
    await expect(question(page)).not.toContainText('Energy Forms Quiz');
  });

  test('Changed Since the Last Print: only the students who will print', async ({ page }) => {
    await demo(page);
    await openProgress(page);
    // A first print, with nothing in draft.
    await printReports(page);
    await expect.poll(() => prints(page)).toBe(1);
    // A draft for one student: their report does not change.
    await draftOn(page, 'sci8q2');
    // Another student's report changes at once: Late on a scored piece.
    await page.evaluate(() => {
      var cid = 'sci8';
      var drafted = GradeState.draftsIn(
        cid,
        'sci8q2',
        getStudents(cid).map(s => s.id),
      )[0];
      var other = sortStudents(getStudents(cid), 'lastName').find(function (s) {
        return (
          s.id !== drafted && getPointsScore(cid, s.id, 'sci8q3') != null && !getAssignmentStatus(cid, s.id, 'sci8q3')
        );
      });
      Grader.setStatus(cid, other.id, 'sci8q3', 'LATE');
      PageReports.renderReports();
    });
    // Everyone: the draft is asked about.
    await printReports(page, 'all');
    await expect(question(page)).toBeVisible();
    await expect(question(page)).toContainText('Periodic Table Quiz');
    await question(page).getByRole('button', { name: 'Cancel' }).click();
    // Changed Since the Last Print: the drafted student's report did not change, so nothing is asked.
    await printDialog(page).locator('input[name="issue-who"][value="changed"]').check();
    await printDialog(page).locator('[data-issue="go"]').click();
    await expect.poll(() => prints(page)).toBe(2);
    await expect(question(page)).toHaveCount(0);
    expect(await waiting(page)).toBe(1);
  });
});

test('the Assignments page draws while the Draft and Returned rows have not loaded, and its Printed marks come back', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await demo(page);
  const sid = await page.evaluate(() => {
    var cid = 'sci8';
    var sid = sortStudents(getStudents(cid), 'lastName').find(s =>
      (getScores(cid)[s.id] || []).some(e => e.assessmentId === 'sci8a4' && e.score > 0),
    ).id;
    RubricPrint.markPrinted(cid, 'sci8a4', [sid]);
    // What shared/data.js does for a signed-in holding class before its rows have loaded.
    window.__real = window.getReturnedScores;
    window.getReturnedScores = function () {
      throw new Error('which of its grades are returned has not loaded (a test)');
    };
    window.Router.navigate('/assignments?course=sci8');
    return sid;
  });
  const card = page.locator('#ac-sci8a4');
  await card.waitFor();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const mark = card.locator('[data-rp-mark-sid="' + sid + '"]').first();
  await expect(mark).toBeAttached();
  await expect(mark).toBeHidden();
  expect(errors).toEqual([]);
  // The rows load: the mark is drawn again without a redraw of the page.
  await page.evaluate(() => {
    window.getReturnedScores = window.__real;
    clearProfCache();
  });
  await expect(mark).toBeVisible({ timeout: 5000 });
  await expect(mark).toContainText('Printed');
  expect(errors).toEqual([]);
});
