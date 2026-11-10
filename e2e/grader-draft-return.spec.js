import { test, expect } from '@playwright/test';

// S0-F2: in a class whose student page is on (the hidden build switch) and
// that returns grades When I Return Them, the desktop grader dialog says
// where a grade stands: the Draft mark and "Saved. Not returned yet." after
// a save, Return, "Returned" with its date, and the one line about what the
// student still sees when a returned grade is changed. Demo Mode only: no
// server knows the rule yet. With the switch off the dialog has none of it.

// A piece nobody is graded on yet, added to the Demo class.
async function demoWithNewPiece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  return page.evaluate(() => {
    var cid = getActiveCourse();
    var student = sortStudents(getStudents(cid), 'lastName')[0];
    var tag = getAllTags(cid)[0];
    saveAssessments(
      cid,
      getAssessments(cid).concat([
        { id: 'e2e-draft', title: 'Tide Pool Notes', date: courseToday(cid), type: 'summative', tagIds: [tag.id] },
      ]),
    );
    return { cid: cid, sid: student.id, first: student.preferred || student.firstName, tag: tag.id };
  });
}

async function openGrader(page, at) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + at.sid + '"][data-aid="e2e-draft"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

const level = (dialog, at, n) =>
  dialog.locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="' + n + '"]');

test('a grade is a draft until Return, a change to it waits, and the state is kept', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await demoWithNewPiece(page);
  // The hidden build switch, from the console.
  expect(await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid)).toBe(true);

  let dialog = await openGrader(page, at);
  // Nothing to return yet.
  await expect(dialog.locator('.grader-return [data-grader="return"]')).toBeDisabled();
  await expect(dialog.locator('.grader-draft')).toHaveCount(0);

  await level(dialog, at, 3).click();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');
  await expect(dialog.locator('.grader-draft-text')).toHaveText('Saved. Not returned yet.');
  await expect(dialog.locator('.grader-draft-still')).toHaveCount(0);
  const give = dialog.locator('.grader-return [data-grader="return"]');
  await expect(give).toHaveText('Return');
  await expect(give).toBeEnabled();
  expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.sid, 'e2e-draft'), at)).toBe('draft');
  // The student has been given nothing.
  expect(
    await page.evaluate(a => (getReturnedScores(a.cid)[a.sid] || []).filter(e => e.assessmentId === 'e2e-draft'), at),
  ).toEqual([]);

  await give.click();
  await expect(dialog.locator('.grader-returned')).toHaveText(/^Returned \S+ \d+$/);
  await expect(dialog.locator('[data-grader="return"]')).toHaveCount(0);
  await expect(dialog.locator('.grader-draft')).toHaveCount(0);
  expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.sid, 'e2e-draft'), at)).toBe('returned');

  // A change to the returned grade waits, and the line says what they still see.
  await level(dialog, at, 4).click();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');
  await expect(dialog.locator('.grader-draft-text')).toHaveText('Saved. Not returned yet.');
  const still = new RegExp('^' + at.first + ' still sees the grade you returned \\S+ \\d+\\.$');
  await expect(dialog.locator('.grader-draft-still')).toHaveText(still);
  expect(
    await page.evaluate(
      a =>
        getReturnedScores(a.cid)
          [a.sid].filter(e => e.assessmentId === 'e2e-draft')
          .map(e => e.score),
      at,
    ),
  ).toEqual([3]);

  // Reload: the state is kept.
  await dialog.locator('.grader-done').click();
  dialog = await openGrader(page, at);
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');
  await expect(dialog.locator('.grader-draft-still')).toHaveText(still);
  await dialog.locator('.grader-return [data-grader="return"]').click();
  await expect(dialog.locator('.grader-returned')).toHaveText(/^Returned /);
  expect(await page.evaluate(a => getGradeReturn(a.cid, a.sid, 'e2e-draft').is_draft, at)).toBe(false);
  expect(errors).toEqual([]);
});

test('with the switch off the dialog has no draft line and no Return button', async ({ page }) => {
  const at = await demoWithNewPiece(page);
  const dialog = await openGrader(page, at);
  await level(dialog, at, 3).click();
  await expect(dialog.locator('.grader-foot .grader-grade')).toContainText('Proficient');
  await expect(dialog.locator('.grader-return')).toHaveCount(0);
  await expect(dialog.locator('[data-grader="return"]')).toHaveCount(0);
  await expect(dialog).not.toContainText('Draft');
  await expect(dialog).not.toContainText('Not returned yet');
  // Nothing is kept for the class.
  expect(await page.evaluate(cid => localStorage.getItem('gb-grade-returns-' + cid), at.cid)).toBeNull();
});
