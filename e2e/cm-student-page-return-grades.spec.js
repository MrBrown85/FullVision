import { test, expect } from '@playwright/test';

// S1-F4: Class Settings › Student Page has Return Grades, behind the build
// switch, in Demo Mode. The tab is there only for a class whose student page
// is on. Leaving When I Return Them with grades waiting asks first and names
// how many: Cancel and Escape change nothing; Return and Change returns
// them and saves the choice, which a reload keeps.

// The Demo class with a piece nobody is graded on yet.
async function demoWithNewPiece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The sample class is seeded a moment after the dashboard opens.
  await page.waitForFunction(
    () => {
      var cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0 && getAllTags(cid).length > 0;
    },
    null,
    { timeout: 15000 },
  );
  return page.evaluate(() => {
    var cid = getActiveCourse();
    var students = sortStudents(getStudents(cid), 'lastName');
    var tag = getAllTags(cid)[0];
    saveAssessments(
      cid,
      getAssessments(cid).concat([
        { id: 'e2e-return', title: 'Tide Pool Notes', date: courseToday(cid), type: 'summative', tagIds: [tag.id] },
      ]),
    );
    return { cid: cid, sid: students[0].id, other: students[1].id, tag: tag.id };
  });
}

async function openStudentPageTab(page) {
  await page.goto('/dashboard?manage=student-page');
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');
  return page.getByRole('radiogroup', { name: 'Return Grades' });
}

async function openGrader(page, at) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + at.sid + '"][data-aid="e2e-return"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

const waiting = (page, at) => page.evaluate(cid => GradeState.draftsWaiting(cid), at.cid);

test('Return Grades: the question on leaving When I Return Them, Cancel, then Return and Change', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const at = await demoWithNewPiece(page);
  // The hidden build switch, from the console.
  expect(await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid)).toBe(true);

  // The tab is there now, between Questionnaires and Grading, with the row
  // as the board words it.
  let group = await openStudentPageTab(page);
  await expect(page.locator('.cm-tabs [role="tab"]')).toHaveText([
    /^Details/,
    /^Students/,
    /^Questionnaires/,
    'Student Page',
    /^Grading/,
    /^Reporting Terms/,
    /^Competencies/,
  ]);
  const card = page.locator('.sp-card');
  await expect(card.getByRole('heading', { name: 'Student Page' })).toBeVisible();
  // Return Grades, then Send Work (S5-F1, Demo Mode), off: no Keep Photos
  // Until; then Reflect on Feedback (S10 follow-up, Demo Mode) and Show My
  // Learning (S13-F1, Demo Mode), and last Questionnaires and Reports (the board's).
  await expect(card.locator('.sp-row')).toHaveCount(5);
  await expect(card.locator('.sp-row-title')).toHaveText([
    'Return Grades',
    'Send Work',
    // Demo Mode's sample has photos, so Keep Photos Until shows with Send Work off (ruling 108's follow-up).
    'Keep Photos Until',
    'Reflect on Feedback',
    'Show My Learning',
    'Questionnaires and Reports',
  ]);
  await expect(card.locator('#sp-return-hint')).toHaveText(
    "When a grade shows on a student's page. Until then it's a draft only you can see.",
  );
  await expect(group.getByRole('radio')).toHaveText(['When I Return Them', 'As Soon As I Save']);
  await expect(group.getByRole('radio', { name: 'When I Return Them' })).toBeChecked();
  await expect(group.getByRole('radio', { name: 'As Soon As I Save' })).not.toBeChecked();
  await expect(card).toContainText(
    'A change to a returned grade follows the same rule, and the student sees it marked Updated.',
  );

  // Grade one piece in the gradebook's grader: it waits as a draft.
  const dialog = await openGrader(page, at);
  await dialog.locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="3"]').click();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');
  await dialog.locator('.grader-done').click();
  // And a second student's, so the question counts more than one.
  await page.evaluate(a => Grader.setLevel(a.cid, a.other, 'e2e-return', a.tag, 2, 0), at);
  expect(await waiting(page, at)).toBe(2);

  // Leaving When I Return Them asks first.
  group = await openStudentPageTab(page);
  const onSave = group.getByRole('radio', { name: 'As Soon As I Save' });
  const onReturn = group.getByRole('radio', { name: 'When I Return Them' });
  await onSave.click();
  const ask = page.getByRole('dialog', { name: 'Return 2 Grades Now?' });
  await expect(ask).toBeVisible();
  await expect(ask).toHaveAttribute('aria-modal', 'true');
  await expect(ask.locator('.confirm-message')).toHaveText(
    '2 grades are waiting as drafts. Changing this returns them to students now.',
  );
  await expect(ask.getByRole('button')).toHaveText(['Cancel', 'Return and Change']);
  await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
  // Nothing has changed while it asks.
  expect(await waiting(page, at)).toBe(2);
  expect(await page.evaluate(cid => getReturnSettings(cid).return_grades, at.cid)).toBe('on_return');

  // Cancel: the setting and both drafts are as they were.
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await expect(onReturn).toBeChecked();
  await expect(onSave).not.toBeChecked();
  await expect(onSave).toBeFocused();
  expect(await waiting(page, at)).toBe(2);
  expect(await page.evaluate(cid => getReturnSettings(cid).return_grades, at.cid)).toBe('on_return');

  // Escape is Cancel.
  await onSave.click();
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(onReturn).toBeChecked();
  expect(await waiting(page, at)).toBe(2);

  // Return and Change: both are returned and the choice is saved.
  await onSave.click();
  await ask.getByRole('button', { name: 'Return and Change' }).click();
  await expect(ask).toHaveCount(0);
  await expect(onSave).toBeChecked();
  await expect(onReturn).not.toBeChecked();
  await expect(onSave).toBeFocused();
  expect(await waiting(page, at)).toBe(0);
  expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.sid, 'e2e-return'), at)).toBe('returned');
  expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.other, 'e2e-return'), at)).toBe('returned');

  // A reload keeps the choice, on the same tab.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');
  group = page.getByRole('radiogroup', { name: 'Return Grades' });
  await expect(group.getByRole('radio', { name: 'As Soon As I Save' })).toBeChecked();
  await expect(group.getByRole('radio', { name: 'When I Return Them' })).not.toBeChecked();
  expect(await page.evaluate(cid => getReturnSettings(cid).return_grades, at.cid)).toBe('on_save');

  // The gradebook's draft is gone: the grader has no Draft mark, and the
  // student is given the grade.
  const after = await openGrader(page, at);
  await expect(after.locator('.grader-foot .grader-grade')).toContainText('Proficient');
  await expect(after.locator('.grader-draft')).toHaveCount(0);
  await expect(after.locator('.grader-draft-mark')).toHaveCount(0);
  await expect(after).not.toContainText('Not returned yet');
  expect(await waiting(page, at)).toBe(0);
  expect(await page.evaluate(a => getGradeReturn(a.cid, a.sid, 'e2e-return').is_draft, at)).toBe(false);
  expect(
    await page.evaluate(
      a =>
        getReturnedScores(a.cid)
          [a.sid].filter(e => e.assessmentId === 'e2e-return')
          .map(e => e.score),
      at,
    ),
  ).toEqual([3]);

  // Going back to When I Return Them asks nothing.
  group = await openStudentPageTab(page);
  await group.getByRole('radio', { name: 'When I Return Them' }).click();
  await expect(group.getByRole('radio', { name: 'When I Return Them' })).toBeChecked();
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with the switch off there is no Student Page tab and its address opens Details', async ({ page }) => {
  await demoWithNewPiece(page);
  await page.goto('/dashboard?manage=student-page');
  await expect(page.getByRole('tab', { name: /^Details/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.cm-tabs [role="tab"]')).toHaveCount(6);
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveCount(0);
  await expect(page.locator('.sp-card')).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\?manage=details$/);
});
