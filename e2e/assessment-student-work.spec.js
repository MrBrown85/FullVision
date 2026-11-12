import { test, expect } from '@playwright/test';

/* S5-F1: the assessment form's Student Work card and Class Settings ›
   Student Page's Send Work and Keep Photos Until, in Demo Mode, behind the
   build switch and Send Work (docs/plans/student-page-build-plan.md S5).
   Board "Teacher: Student Work Settings on an Assessment" and "Teacher:
   Class Settings, Student Page". */

const SHOTS = process.env.NIGHT_SHOTS || '';

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function editForm(page, aid) {
  await page.goto('/assignments?course=sci8');
  await page.waitForSelector('#ac-' + aid);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('#af-title')).toBeVisible();
}

test('with Send Work off the form has no Student Work card; on, it does, and its choices are kept', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await demo(page);
  const aid = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Science Fair Proposal').id);

  // The build switch on, Send Work still off: no card.
  await page.evaluate(() => setStudentPageSwitch('sci8', true));
  await editForm(page, aid);
  await expect(page.locator('.af-card-work')).toHaveCount(0);

  // Send Work on (Class Settings › Student Page).
  await page.goto('/dashboard?manage=student-page&course=sci8');
  const sw = page.locator('#sp-send-switch');
  await expect(sw).not.toBeChecked();
  // The sample has photos kept, so Keep Photos Until shows with Send Work off too (ruling 108's follow-up).
  await expect(page.locator('#sp-keep-hint')).toContainText('Photos of student work in this class are deleted on');
  await sw.check();
  await expect(page.locator('#sp-keep-hint')).toContainText('Photos of student work in this class are deleted on');
  await expect(page.locator('#sp-keep-end_of_year')).toHaveAttribute('aria-checked', 'true');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/S5-F1-class-settings-1366.png', fullPage: true });

  await editForm(page, aid);
  const card = page.locator('.af-card-work');
  await expect(card).toBeVisible();
  await expect(card.locator('.af-card-title')).toHaveText('Student Work');
  // One question until students send something (Colin, Nov 11).
  await expect(card.locator('.af-work-q')).toHaveText(['Do Students Send You Their Work?']);
  const on = field => card.locator(`[data-field="${field}"][aria-checked="true"]`);
  await expect(on('students_send')).toHaveText('No');
  await expect(card).not.toContainText('Keep Photos Until');
  await expect(card.locator('.af-work-peek')).toContainText('Science Fair Proposal');

  // The late question needs a due date to ask about.
  await page.locator('#af-due').fill('2026-11-20');
  await page.locator('#af-due').dispatchEvent('change');
  await card.locator('[data-field="students_send"][data-value="photos_files"]').click();
  await expect(card.locator('.af-work-q')).toHaveText([
    'Do Students Send You Their Work?',
    /^Can Students Send After /,
    'Do Students See What You Write on Their Work?',
  ]);
  // Who Sends the Work? is for pairs and groups only.
  await expect(card.locator('[data-field="group_work"]')).toHaveCount(0);
  await expect(on('after_due')).toHaveText('Yes, Marked Late');
  await expect(on('students_see_markup')).toHaveText('Yes, When You Return It');
  await expect(card.locator('.af-work-peek')).toContainText('Choose a File');
  await card.locator('[data-field="after_due"][data-value="until"]').click();
  await expect(card.locator('#af-accept-until')).toBeVisible();
  await card.locator('#af-accept-until').fill('2026-12-04');
  await card.locator('#af-accept-until').dispatchEvent('change');
  await expect(on('after_due')).toHaveText(/^Until Dec\.? 4/);
  await card.locator('[data-field="students_see_markup"][data-value="no"]').click();
  if (SHOTS) await page.screenshot({ path: SHOTS + '/S5-F1-assessment-form-1366.png', fullPage: true });
  await page.locator('[data-action="saveEditAssess"]').click();
  await expect(page.locator('#af-title')).toHaveCount(0);

  const kept = await page.evaluate(a => getAssessmentStudentWork('sci8', a), aid);
  expect(kept).toMatchObject({
    students_send: 'photos_files',
    after_due: 'until',
    accept_until: '2026-12-04',
    group_work: 'each',
    students_see_markup: false,
  });
  // Not on the assessment, so a copy starts at Nothing.
  expect(await page.evaluate(a => JSON.stringify(getAssessments('sci8').find(x => x.id === a)), aid)).not.toMatch(
    /students_send|photos_files/,
  );
  await page.waitForSelector('#ac-' + aid);
  await page.evaluate(id => document.querySelector(`[data-action="dupeAssess"][data-aid="${id}"]`).click(), aid);
  await page.waitForFunction(() => getAssessments('sci8').some(x => x.title === 'Science Fair Proposal (Copy)'));
  const copy = await page.evaluate(
    a => getAssessments('sci8').find(x => x.title === 'Science Fair Proposal (Copy)').id,
    aid,
  );
  expect(await page.evaluate(c => getAssessmentStudentWork('sci8', c).students_send, copy)).toBe('nothing');

  // Send Work off again: the card goes, the choices stay kept.
  await page.evaluate(() => {
    const w = getCourseSubmissions('sci8');
    w.course.send_work = false;
    saveDemoStudentWork('sci8', w);
  });
  await editForm(page, aid);
  await expect(page.locator('.af-card-work')).toHaveCount(0);
  expect(await page.evaluate(a => getAssessmentStudentWork('sci8', a).students_send, aid)).toBe('photos_files');
});

test('Delete Assessment names the students whose photos go with it, only when there are any', async ({ page }) => {
  await demo(page);
  await page.goto('/assignments?course=sci8');
  await page.waitForSelector('#ac-sci8a1');
  const ask = async aid => {
    await page.evaluate(id => document.querySelector(`[data-action="deleteAssess"][data-aid="${id}"]`).click(), aid);
    const msg = await page.locator('.confirm-overlay .confirm-message').textContent();
    await page.locator('.confirm-overlay').getByRole('button', { name: 'Cancel' }).click();
    return msg;
  };
  // Cell Microscope Lab: nine students sent pages; Ethan handed in paper.
  expect(await ask('sci8a1')).toBe(
    "Delete this assessment and all its scores? The photos 9 students sent for it are deleted too. Deleted photos can't come back.",
  );
  const other = await page.evaluate(() => getAssessments('sci8').find(a => a.id !== 'sci8a1').id);
  expect(await ask(other)).toBe('Delete this assessment and all its scores?');
  expect(await page.evaluate(() => getAssessments('sci8').some(a => a.id === 'sci8a1'))).toBe(true);
});
