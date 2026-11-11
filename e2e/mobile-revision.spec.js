/**
 * Return for Revision on the phone (S11-F1, the board "Phone: Return for
 * Revision"): For Revision beside Return and Next, the bottom sheet (no
 * Hide, Colin, Nov 11), and the Revising bar with Take Back. Demo Mode,
 * Science 8, the build switch and Send Work on, at 375 x 812.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const CHECK = 'sci8a10'; // Mid-Year Lab Skills Check: two competencies
const SHOTS = process.env.FV_SHOTS || process.env.NIGHT_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('For Revision, the sheet, then Revising with Take Back', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(CHECK => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    work.assessments = work.assessments.filter(a => a.id !== CHECK);
    work.assessments.push({ id: CHECK, students_send: 'photos' });
    saveDemoStudentWork(cid, work);
    return sortStudents(getStudents(cid), 'alpha')[0].id;
  }, CHECK);
  await page.reload();
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + CHECK + '"]').click();

  const act = page.locator('#m-grade-return-act');
  await expect(act.locator('[data-action="m-grade-revision"]')).toHaveText('For Revision');
  await act.locator('[data-action="m-grade-revision"]').click();
  const sheet = page.locator('#m-sheet-container .m-revision-sheet');
  await expect(sheet.locator('.m-revision-title')).toHaveText('Return for Revision');
  await expect(sheet).not.toContainText('Hide');
  await sheet.locator('.m-revision-fix').fill('Add a labelled diagram of the set-up.');
  await sheet.locator('.m-revision-by').fill('2026-11-20');
  await shot(page, 'S11-F1-phone-return-for-revision-375');
  await sheet.locator('.m-revision-send').click();
  await expect(page.locator('#m-grade-return-state')).toContainText('Returned for Revision · Revise by Fri, Nov 20');
  await expect(act.locator('[data-action="m-grade-revision-takeback"]')).toHaveText('Take Back');
  const state = await page.evaluate(
    ([sid, aid]) => getRevisionRequest(getActiveCourse(), sid, aid).state,
    [sid, CHECK],
  );
  expect(state).toBe('open');
  // The sheet has slid away before the picture.
  if (SHOTS) await page.waitForTimeout(600);
  await shot(page, 'S11-F1-phone-revising-375');
  expect(errors).toEqual([]);
});
