/**
 * Unsubmit (was Delete Work; Nov 17 2026): the teacher puts a student's
 * piece back to not handed in, on the desktop grader and the phone's
 * grading card. Demo Mode, Science 8, Cell Microscope Lab, with the student
 * page and Send Work on. Ethan (st6) is handed in on paper; Noor (st2) sent
 * two photos. The grade stays; the pane shows Add Work again, so a teacher
 * who added a poor photo can add it again without a reload.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { jumpTo } from './phone-jump.js';

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

// Turn the student page and Send Work on for Science 8.
async function turnOn(page) {
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
  });
}

async function openDesktop(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  await turnOn(page);
}

async function openGrader(page, sid) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + sid + '"][data-aid="' + LAB + '"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

const subOf = (page, sid) =>
  page.evaluate(({ sid, LAB }) => getStudentSubmission(getActiveCourse(), sid, LAB), { sid, LAB });
const scoresOf = (page, sid) =>
  page.evaluate(
    ({ sid, LAB }) => (getScores(getActiveCourse())[sid] || []).filter(e => e.assessmentId === LAB).length,
    { sid, LAB },
  );

test.describe('desktop grader', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('Unsubmit on work handed in on paper: a light confirm, then Add Work', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openDesktop(page);
    const graded = await scoresOf(page, 'st6');
    const dialog = await openGrader(page, 'st6');
    await expect(dialog.locator('.grader-work-what')).toHaveText('Handed in on paper');
    await expect(dialog.locator('.grader-work-empty')).toHaveText('Handed in on paper. Grade it from the paper.');
    const unsubmit = dialog.locator('[data-grader="work-unsubmit"]');
    await expect(unsubmit).toHaveText('Unsubmit');
    await unsubmit.click();
    const confirm = page.locator('.confirm-overlay');
    await expect(confirm.locator('.confirm-title')).toHaveText('Unsubmit Ethan’s Work?');
    await expect(confirm.locator('.confirm-message')).toHaveText(
      /^Ethan’s work on Cell Microscope Lab goes back to not handed in, and .+ can send it again\. .+ grade and your comments stay\.$/,
    );
    await expect(page.locator('#confirm-cancel-btn')).toHaveText('Keep It');
    await expect(page.locator('#confirm-ok-btn')).toHaveText('Unsubmit');
    await expect(page.locator('#confirm-ok-btn')).not.toHaveClass(/danger/);
    await shot(page, 'unsubmit-on-paper-1366');
    // Keep It changes nothing.
    await page.locator('#confirm-cancel-btn').click();
    expect(await subOf(page, 'st6')).not.toBeNull();
    await unsubmit.click();
    await page.locator('#confirm-ok-btn').click();
    await expect(dialog.locator('.grader-addwork')).toBeVisible();
    await expect(dialog.locator('.grader-work-what')).toHaveText(/^(Not In|Missing)/);
    expect(await subOf(page, 'st6')).toBeNull();
    expect(await scoresOf(page, 'st6')).toBe(graded);
    expect(errors).toEqual([]);
  });

  test('Unsubmit on photos: the photos go, Add Work shows, and a new photo goes in', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openDesktop(page);
    const graded = await scoresOf(page, 'st2');
    const dialog = await openGrader(page, 'st2');
    await expect(dialog.locator('.grader-work-at').first()).toHaveText('Page 1 of 2');
    await dialog.locator('[data-grader="work-unsubmit"]').click();
    const confirm = page.locator('.confirm-overlay');
    await expect(confirm.locator('.confirm-title')).toHaveText('Unsubmit Noor’s Work?');
    await expect(confirm.locator('.confirm-message')).toHaveText(
      /^Noor’s 2 photos for Cell Microscope Lab are deleted, and .+ can send it again\. .+ grade and your comments stay\. Deleted photos can’t come back\.$/,
    );
    await expect(page.locator('#confirm-ok-btn')).toHaveClass(/danger/);
    await shot(page, 'unsubmit-photos-1366');
    await page.locator('#confirm-ok-btn').click();
    const pane = dialog.locator('.grader-addwork');
    await expect(pane).toBeVisible();
    expect(await subOf(page, 'st2')).toBeNull();
    expect(await scoresOf(page, 'st2')).toBe(graded);
    // The retake, with no reload.
    await pane.locator('.grader-work-files').setInputFiles(PHOTO);
    await expect(dialog.locator('.grader-work-at')).toHaveText('Page 1 of 1', { timeout: 15000 });
    await expect(dialog.locator('.grader-work-what')).toHaveText(/^Added by you .* · 1 photo$/);
    await expect(dialog.locator('[data-grader="work-unsubmit"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('Unsubmit on the grading card: the sheet, then Add Work on the card', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/teacher-mobile\//);
    await page.waitForFunction(() => getAssessments('sci8').length > 0);
    await turnOn(page);
    await page.reload();
    await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
    await page.locator('.m-tab-item[data-tab="grade"]').click();
    await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
    await page.locator('.m-seg-btn[data-val="all"]').click();
    await page.locator('#m-grade-list .m-cell[data-aid="' + LAB + '"]').click();
    await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
    await jumpTo(page, 'st2');
    const card = page.locator('.m-swiper-card[data-sid="st2"]');
    // Unsubmit is under ⋯.
    await page.locator('#m-nav-bar-grade-swiper .m-grade-more').click();
    const unsubmit = page.locator('#m-sheet-container .m-more-sheet [data-action="m-work-unsubmit"]');
    await expect(unsubmit).toHaveText('Unsubmit');
    await unsubmit.click();
    const sheet = page.locator('#m-sheet-container .m-confirm-sheet');
    await expect(sheet.locator('#m-confirm-title')).toHaveText('Unsubmit Noor’s Work?');
    await expect(sheet.locator('#m-confirm-text')).toContainText('Deleted photos can’t come back.');
    await expect(sheet.locator('.m-group-sheet-cancel')).toHaveText('Keep It');
    await shot(page, 'unsubmit-phone-375');
    await sheet.locator('.m-confirm-ok').click();
    await expect(card.locator('[data-action="m-add-work"]')).toBeVisible();
    await expect(card.locator('[data-action="m-work-unsubmit"]')).toHaveCount(0);
    expect(await page.evaluate(LAB => getStudentSubmission('sci8', 'st2', LAB), LAB)).toBeNull();
    expect(errors).toEqual([]);
  });
});
