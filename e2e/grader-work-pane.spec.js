/**
 * The desktop grader with the student's work (S6-F1 to F3): the page
 * beside the scoring, Focus on Work, the Show bar with To Grade and Not
 * In, Add Work for a student with nothing in (a real photo, shrunk in the
 * browser and kept on the device), and Delete Work. Demo Mode, Science 8,
 * on the sample work of Cell Microscope Lab (shared/seed-data.js), at
 * 1366 x 900.
 *
 * The sample grades every piece, so a test clears two students' grades to
 * leave work waiting. With Send Work off the dialog is as it was.
 */
import { test, expect } from '@playwright/test';
import path from 'path';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1'; // Cell Microscope Lab: Students Send Photos
const SHOTS = process.env.FV_SHOTS || '';
const PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openDemo(page, { on = true, clear = [] } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  return page.evaluate(
    ({ on, clear, LAB }) => {
      const cid = getActiveCourse();
      const a = getAssessments(cid).find(x => x.id === LAB);
      // Clear the grades first, with the switch off: no draft is made.
      clear.forEach(sid => {
        const keys = [...new Set((getScores(cid)[sid] || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
        Grader.setOverallComment(cid, sid, LAB, '');
        getRubricCheckIds(cid, sid, LAB).forEach(id => Grader.setTick(cid, sid, LAB, id, false));
        if (keys.length) Grader.clearScore(cid, getScores(cid), sid, a, keys);
      });
      if (on) {
        setStudentPageSwitch(cid, true, 'on_return');
        const work = getCourseSubmissions(cid);
        work.course.send_work = true;
        saveDemoStudentWork(cid, work);
      }
      const c = GraderWork.workCounts(cid, LAB);
      return { cid, toGrade: c.ids.tograde, notIn: c.ids.notin };
    },
    { on, clear, LAB },
  );
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

test('with Send Work off the grader has no work pane', async ({ page }) => {
  const at = await openDemo(page, { on: false, clear: ['st2'] });
  const dialog = await openGrader(page, 'st2');
  await expect(dialog).not.toHaveClass(/has-work/);
  await expect(dialog.locator('.grader-work')).toHaveCount(0);
  expect(at.toGrade).toEqual([]);
});

test('the work beside the scoring, Focus on Work, and To Grade', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await openDemo(page, { clear: ['st2', 'st3'] });
  expect(at.toGrade.length).toBe(2);
  const dialog = await openGrader(page, at.toGrade[0]);
  await expect(dialog).toHaveClass(/has-work/);
  await expect(dialog.locator('.grader-show [data-show="tograde"]')).toHaveText(/To Grade\s*2/);
  await expect(dialog.locator('.grader-work-what')).toHaveText(/^(Submitted|Added by you|Handed in on paper)/);
  // Every page at once: the first is enough to look at here.
  const img = dialog.locator('.grader-work-img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await shot(page, 'S6-F1-grader-with-work-1366');
  await dialog.locator('[data-grader="work-focus"]').click();
  await expect(dialog).toHaveClass(/is-focus/);
  await shot(page, 'S6-F1-focus-on-work-1366');
  await dialog.locator('[data-grader="work-focus"]').click();
  // To Grade steps through the work waiting.
  await dialog.locator('.grader-show [data-show="tograde"]').click();
  await dialog.locator('[data-grader="next"]').click();
  await expect(dialog.locator('.grader-work-who[aria-current="true"]')).toHaveAttribute('data-sid', at.toGrade[1]);
  expect(errors).toEqual([]);
});

test('Add Work for a student with nothing in, then Delete Work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // A student who sent nothing, their sample grade cleared: Not In.
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  const none = await page.evaluate(LAB => {
    const cid = getActiveCourse();
    return sortStudents(getStudents(cid), 'lastName')
      .map(s => s.id)
      .find(sid => !getStudentSubmission(cid, sid, LAB) && getAssignmentStatus(cid, sid, LAB) !== 'EXC');
  }, LAB);
  const at = await openDemo(page, { clear: [none] });
  expect(at.notIn).toEqual([none]);
  const sid = at.notIn[0];
  const dialog = await openGrader(page, sid);
  const pane = dialog.locator('.grader-addwork');
  await expect(pane).toBeVisible();
  await expect(pane.locator('h3').first()).toHaveText(/^Add Work for /);
  await expect(pane).toContainText('Grade From Paper');
  await shot(page, 'S6-F2-nothing-in-1366');
  await pane.locator('.grader-work-files').setInputFiles(PHOTO);
  await expect(dialog.locator('.grader-work-at')).toHaveText('Page 1 of 1', { timeout: 15000 });
  await expect(dialog.locator('.grader-work-what')).toHaveText(/^Added by you .* · 1 photo$/);
  const img = dialog.locator('.grader-work-img');
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  // The photo was made smaller in the browser before it was kept.
  const size = await img.evaluate(el => Math.max(el.naturalWidth, el.naturalHeight));
  expect(size).toBeLessThanOrEqual(2000);
  await dialog.locator('[data-grader="work-delete"]').click();
  const confirm = page.locator('.confirm-overlay');
  await expect(confirm.locator('.confirm-title')).toHaveText(/^Delete .*’s Work\?$/);
  await expect(confirm.locator('.confirm-message')).toContainText('Deleted photos can’t come back.');
  await shot(page, 'S6-F3-delete-work-1366');
  await page.locator('#confirm-ok-btn').click();
  await expect(dialog.locator('.grader-addwork')).toBeVisible();
  expect(errors).toEqual([]);
});

/* The scoring column beside the work, at its widest and in Focus on Work,
   holds every kind of piece: label over control, nothing past its right
   edge, and a chosen rubric tile keeps its level's whole name. */
test('every kind of piece fits the scoring column, with and without Focus on Work', async ({ page }) => {
  // Five pieces, each opened and measured twice: 23 to 29 s on CI, too
  // near the 30 s default.
  test.setTimeout(60_000);
  await openDemo(page);
  // Rubric, single-point, points, Complete/Incomplete, competency levels.
  const pieces = ['sci8a3', 'sci8a18', 'sci8q1', 'sci8q4', 'sci8a2'];
  await page.evaluate(pieces => {
    const cid = getActiveCourse();
    const work = getCourseSubmissions(cid);
    work.assessments.forEach(e => {
      if (pieces.includes(e.id)) e.students_send = 'photos';
    });
    saveDemoStudentWork(cid, work);
  }, pieces);
  const past = col =>
    col.evaluate(el => {
      const edge = el.getBoundingClientRect().right + 1;
      return [...el.querySelectorAll('*')]
        .filter(x => x.getBoundingClientRect().width && x.getBoundingClientRect().right > edge)
        .map(x => String(x.className));
    });
  for (const aid of pieces) {
    await page.goto('/gradebook');
    await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
    const cell = page.locator('.gb-scores-cell[data-sid="st5"][data-aid="' + aid + '"]');
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    const dialog = page.locator('#grader-overlay .grader-dialog');
    await expect(dialog).toHaveClass(/has-work/);
    // Nothing in yet: add the photo, so Focus on Work is offered.
    const files = dialog.locator('.grader-work-files');
    if (await files.count()) {
      await files.setInputFiles(PHOTO);
      await expect(dialog.locator('.grader-work-img')).toBeVisible({ timeout: 10000 });
    }
    const col = dialog.locator('.grader-panel-col');
    expect(await past(col), aid).toEqual([]);
    const chosen = dialog.locator('.grdt-chosen-label').first();
    if (await chosen.count()) {
      await expect(chosen).toHaveText('Proficient');
      expect(await chosen.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await dialog.locator('[data-grader="work-focus"]').click();
    await expect(dialog).toHaveClass(/is-focus/);
    expect(await past(col), aid + ' in Focus on Work').toEqual([]);
    await page.keyboard.press('Escape');
  }
});
