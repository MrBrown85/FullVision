/**
 * Mark Up on the desktop (S9-F1): from the grader's work pane, draw on a
 * page, erase a mark, write a note, Done, and Return gives the student the
 * marks left. Demo Mode, Science 8, Cell Microscope Lab (Jordan's page 1
 * has the sample's three notes, a tick and a pen line), at 1366 x 900.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const JORDAN = 'st10';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openDemo(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  return page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    return cid;
  });
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

const givenTypes = (page, cid) =>
  page.evaluate(
    ({ cid, LAB, JORDAN }) =>
      getStudentMarkup(cid, JORDAN, LAB)
        .files.flatMap(f => f.marks.marks)
        .map(m => m.type),
    { cid, LAB, JORDAN },
  );

test('draw, erase and write on a page; Return gives the student what is left', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cid = await openDemo(page);
  const dialog = await openGrader(page, JORDAN);
  // The sample's marks lie over the page in the work pane.
  const paneLayer = dialog.locator('.grader-work-surface .markup-layer');
  await expect(paneLayer.locator('.markup-pin')).toHaveCount(3);
  const before = await givenTypes(page, cid);
  expect(before.sort()).toEqual(['note', 'note', 'note', 'pen', 'tick']);

  await dialog.locator('[data-grader="work-markup"]').click();
  const mk = page.locator('.markup-overlay');
  await expect(mk).toBeVisible();
  await expect(mk.locator('.markup-sub')).toHaveText(/^Jordan .+ · Cell Microscope Lab · Page 1 of \d+$/);
  await expect(mk.locator('.markup-note')).toHaveCount(3);
  await expect(mk.locator('.markup-sees')).toHaveText('Jordan sees these marks and notes when you return the work.');
  const img = mk.locator('.markup-img');
  await expect(img).toHaveJSProperty('complete', true);
  await shot(page, 'S9-F1-mark-up-1366');

  const box = await mk.locator('.markup-surface').boundingBox();
  // A pen line across the lower page.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.88, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.9, { steps: 5 });
  await page.mouse.up();
  await expect(mk.locator('.markup-layer .markup-pen')).toHaveCount(2);
  // A cross, then the Eraser takes it out again.
  await mk.locator('[data-mk-tool="cross"]').click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await expect(mk.locator('.markup-layer .markup-cross')).toHaveCount(1);
  await mk.locator('[data-mk-tool="eraser"]').click();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await expect(mk.locator('.markup-layer .markup-cross')).toHaveCount(0);
  // A fourth note.
  await mk.locator('[data-mk-tool="note"]').click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await mk.locator('.markup-note-input').fill('Label the nucleus.');
  await mk.locator('[data-mk="note-save"]').click();
  await expect(mk.locator('.markup-note')).toHaveCount(4);
  await shot(page, 'S9-F1-mark-up-drawn-1366');

  await mk.locator('[data-mk="done"]').click();
  await expect(mk).toHaveCount(0);
  await expect(paneLayer.locator('.markup-pin')).toHaveCount(4);
  // The student still has the marks they were given; Return gives the rest.
  expect((await givenTypes(page, cid)).sort()).toEqual(before.sort());
  const row = dialog.locator('.grader-return');
  await expect(row.locator('.grader-draft-text')).toHaveText(/Not returned yet\./);
  await shot(page, 'S9-F1-grader-marks-waiting-1366');
  await row.locator('[data-grader="return"]').click();
  const after = await givenTypes(page, cid);
  expect(after.filter(t => t === 'pen').length).toBe(2);
  expect(after.filter(t => t === 'note').length).toBe(4);
  expect(after).not.toContain('cross');
  expect(errors).toEqual([]);
});
