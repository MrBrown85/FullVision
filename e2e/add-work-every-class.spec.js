/**
 * Add Work for the Class, offered in every class (plan decision 2, Colin,
 * Nov 17 2026). Demo Mode, Science 8, at 1366 x 900.
 *
 * With the class's student page off (and so no Send Work), from a piece
 * with no work in: Add Work for the Class is on the card's menu; a photo
 * added for one student shows on the Work Wall and in the grader's work
 * pane; the class's student page is still off, and its sample work on the
 * other pieces stays hidden. Print Sticker Sheets is in Class Settings
 * with no Student Cards card.
 */
import { test, expect } from '@playwright/test';
import path from 'path';

test.use({ viewport: { width: 1366, height: 900 } });

const PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');

test('in a class with no student page: added work shows on the Work Wall and in the grader', async ({ page }) => {
  // The page reads and shrinks a real photo: about 20 s on CI's two cores.
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).length > 0 && !!window.AddWorkClass;
  });
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');

  const set = await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, false);
    // A piece with no work in, not a draft, not DIBELS; one with sample work in.
    const all = getAssessments(cid).filter(a => !a.isDraft && !isDibelsScored(a));
    const subs = getCourseSubmissions(cid).submissions;
    const has = id => subs.some(s => s.assessment_id === id && s.state === 'sent');
    const piece = all.find(a => !has(a.id) && a.collaboration !== 'pair' && a.collaboration !== 'group');
    const sample = all.find(a => has(a.id));
    const st = AddWorkClass.students(cid, piece)[2];
    PageAssignments.render();
    return {
      cid,
      aid: piece.id,
      sample: sample ? sample.id : null,
      sid: st.id,
      first: st.preferred || st.firstName,
      page: getReturnSettings(cid).student_page,
      shownBefore: GraderWork.workShown(cid, piece),
      sampleShown: sample ? GraderWork.workShown(cid, sample) : false,
    };
  });
  expect(set.page).toBe(false);
  expect(set.shownBefore).toBe(false);
  expect(set.sampleShown).toBe(false);

  const card = page.locator('#ac-' + set.aid);
  await card.scrollIntoViewIfNeeded();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const more = card.locator('.assess-more-btn');
  await more.click();
  // No Work Wall yet (nothing in), but Add Work for the Class is there.
  await expect(card.locator('.assess-work-wall-btn')).toHaveCount(0);
  await card.locator('.assess-add-class-btn').click();
  const awc = page.locator('#add-work-class-overlay');
  await expect(awc.locator('.awc-title')).toHaveText('Add Work for the Class');
  await awc.locator('.awc-file[data-sid="' + set.sid + '"]').setInputFiles(PHOTO);
  await expect(awc.locator('.awc-row[data-awc-target="' + set.sid + '"] .awc-chip')).toHaveCount(1, {
    timeout: 20000,
  });
  await awc.locator('.awc-primary').click();
  await expect(awc.locator('.awc-done-title')).toHaveText('Added Work for 1 Student', { timeout: 20000 });
  await awc.locator('[data-awc="done"]').click();
  await expect(awc).toHaveCount(0);

  // The Work Wall: the student's page.
  await more.click();
  await card.locator('.assess-work-wall-btn').click();
  const wall = page.locator('#work-wall-overlay');
  const pic = wall.locator('.ww-card[data-sid="' + set.sid + '"] img');
  await expect(pic).toHaveCount(1);
  await expect.poll(() => pic.evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  // The grader, from the wall: the work pane shows the page.
  await wall.locator('.ww-card[data-sid="' + set.sid + '"]').click();
  const grader = page.locator('#grader-overlay');
  await expect(grader.locator('.grader-student')).toContainText(set.first);
  await expect(grader.locator('.grader-work-page img').first()).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
  await expect(grader).toHaveCount(0);

  // Still no student page, and the sample work on other pieces still hidden.
  const after = await page.evaluate(set => {
    const sample = set.sample && getAssessments(set.cid).find(a => a.id === set.sample);
    return {
      page: getReturnSettings(set.cid).student_page,
      sampleShown: sample ? GraderWork.workShown(set.cid, sample) : false,
      files: getStudentSubmission(set.cid, set.sid, set.aid).files.length,
    };
  }, set);
  expect(after).toEqual({ page: false, sampleShown: false, files: 1 });

  // Print Sticker Sheets, in Class Settings with no Student Cards card.
  await page.goto('/dashboard?manage=student-page');
  await expect(page.locator('.sc-card')).toHaveCount(0);
  await page.locator('.sp-stickers').getByRole('button', { name: 'Print Sticker Sheets' }).click();
  await expect(page.getByRole('dialog', { name: 'Sticker Sheets for Scanning' })).toBeVisible();
  expect(errors).toEqual([]);
});
