/**
 * Revisions on the desktop grader (S11-F1, S11-F3): Return for Revision,
 * the student's revision coming in through the Demo data layer, grading
 * both versions, and Return. The board's worked example holds on Before
 * and After: 2.7 · 67% before, 3.0 · 75% after. Demo Mode, Science 8, with
 * the build switch and Send Work on, at 1366 x 900. The piece is made here:
 * two competencies, graded Developing + and Proficient, in a class shown
 * as Both.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const PIECE = 'e2e-rev';
const SID = 'st2';
const FIX = 'Add a third reason from Bourassa to the letter.';
const SHOTS = process.env.FV_SHOTS || process.env.NIGHT_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openDemo(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  return page.evaluate(
    ({ PIECE, SID }) => {
      const cid = getActiveCourse();
      updateCourse(cid, { gradingSystem: 'both' });
      // A copy of Immune System Quick Check (two competencies), as the board's piece.
      const quiz = getAssessments(cid).find(a => a.id === 'sci8a2');
      saveAssessments(cid, [
        ...getAssessments(cid),
        { ...quiz, id: PIECE, title: '2.6 The Conscription Crisis', created: new Date().toISOString() },
      ]);
      const [first, second] = scoreTagIds(quiz, cid);
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      const lab = work.submissions.find(s => s.enrollment_id === SID && s.assessment_id === 'sci8a1');
      work.course.send_work = true;
      work.assessments = work.assessments.filter(a => a.id !== PIECE);
      work.assessments.push({ id: PIECE, students_send: 'photos' });
      work.submissions.push({
        ...lab,
        id: 'e2e-rev-v1',
        assessment_id: PIECE,
        note: 'I wasn’t sure if my headline counted as a reason.',
        files: lab.files.map((f, i) => ({ ...f, id: 'e2e-rev-v1-p' + (i + 1) })),
      });
      saveDemoStudentWork(cid, work);
      Grader.setLevel(cid, SID, PIECE, first, 3, 0);
      Grader.setLevel(cid, SID, PIECE, second, 2, 1);
      Grader.returnGrades(cid, PIECE, [SID]);
      return { cid, second, files: lab.files.map(f => ({ path: f.path, thumb_path: f.thumb_path })) };
    },
    { PIECE, SID },
  );
}

async function openGrader(page) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + SID + '"][data-aid="' + PIECE + '"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Return for Revision, the revision comes in, grade both versions, Return', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await openDemo(page);
  let dialog = await openGrader(page);
  const overlay = page.locator('#grader-overlay');

  await dialog.locator('[data-grader="revision-open"]').click();
  const sheet = overlay.locator('.grader-sheet');
  await expect(sheet.locator('.grader-sheet-title')).toHaveText('Return for Revision');
  await expect(sheet).not.toContainText('Hide');
  await sheet.locator('.grader-sheet-fix').fill(FIX);
  await sheet.locator('.grader-sheet-by').fill('2026-11-10');
  await shot(page, 'S11-F1-return-for-revision-sheet-1366');
  await sheet.locator('[data-rv="send"]').click();
  await expect(sheet).toHaveCount(0);
  const ret = dialog.locator('.grader-return');
  await expect(ret.locator('.grader-revising-mark')).toHaveText('Revising');
  await expect(ret.locator('.grader-draft-text')).toHaveText('Returned for Revision · Revise by Tue, Nov 10');
  await expect(ret.locator('[data-grader="revision-takeback"]')).toHaveText('Take Back');
  await shot(page, 'S11-F1-revising-1366');
  await dialog.locator('[data-grader="close"]').click();
  await expect(
    page.locator('.gb-scores-cell[data-sid="' + SID + '"][data-aid="' + PIECE + '"] .gb-revising'),
  ).toHaveText('Revising');

  // The student sends the revision (the Demo data layer, as the student page does).
  const sent = await page.evaluate(
    ({ cid, files, PIECE, SID }) =>
      sendStudentRevision(
        cid,
        SID,
        PIECE,
        files,
        'I added how conscription split families in Quebec as the third reason.',
        SID,
      ),
    { ...at, PIECE, SID },
  );
  expect(sent.error || null).toBeNull();

  dialog = await openGrader(page);
  await expect(dialog.locator('.grader-work-what')).toHaveText(/^Revised .+ · \d+ new pages?$/);
  await expect(dialog.locator('.grader-revision-title')).toHaveText(/^Revision, Sent /);
  const pi = dialog.locator('.grdl-card[data-tag="' + at.second + '"]');
  await expect(pi.locator('.grader-was-line')).toHaveText(/^Was Developing \+ on the .+ version$/);
  await expect(pi.locator('.grader-was-hint')).toHaveText('Pick the level for the new version.');
  await shot(page, 'S11-F3-grading-a-revision-1366');

  await pi.locator('[data-level="3"]').first().click();
  const result = dialog.locator('.grader-revision-ba .is-result');
  await expect(result.locator('.grader-revision-before')).toHaveText('2.7 · 67%');
  await expect(result.locator('.grader-revision-after')).toHaveText('3.0 · 75% Draft');
  await shot(page, 'S11-F3-before-and-after-draft-1366');
  await dialog.locator('[data-grader="return"]').click();
  await expect(result.locator('.grader-revision-after')).toHaveText('3.0 · 75%');
  expect(
    await page.evaluate(({ cid, PIECE, SID }) => getRevisionRequest(cid, SID, PIECE).state, { ...at, PIECE, SID }),
  ).toBe('returned');
  await shot(page, 'S11-F3-before-and-after-returned-1366');
  expect(errors).toEqual([]);
});
