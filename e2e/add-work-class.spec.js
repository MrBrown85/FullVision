/**
 * Add Work for the Class (B1, docs/plans/add-work-for-class-plan.md). Demo
 * Mode, Science 8, Cell Microscope Lab (shared/seed-data.js), at 1366 x 900.
 *
 * From the assessment card's menu: a photo chosen for each of two students
 * with nothing in, Add Work for 2 Students, the summary, Done, and the Work
 * Wall shows both students' pages. A real photo, shrunk in the browser and
 * kept on the device, as the grader's Add Work keeps it.
 */
import { test, expect } from '@playwright/test';
import path from 'path';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('a photo for each of two students, added with one button, shows on the Work Wall', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  // Send Work on, and two students with nothing in.
  const two = await page.evaluate(LAB => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    const a = getAssessments(cid).find(x => x.id === LAB);
    return AddWorkClass.students(cid, a)
      .filter(st => !getStudentSubmission(cid, st.id, LAB))
      .slice(0, 2)
      .map(st => st.id);
  }, LAB);
  expect(two.length).toBe(2);

  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  const card = page.locator('#ac-' + LAB);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/open/);
  const more = card.locator('.assess-more-btn');
  await more.click();
  const item = card.locator('.assess-add-class-btn');
  await expect(item).toHaveText('Add Work for the Class');
  await item.click();

  const awc = page.locator('#add-work-class-overlay');
  await expect(awc.locator('.awc-title')).toHaveText('Add Work for the Class');
  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 0 Students');
  await expect(awc.locator('.awc-primary')).toBeDisabled();

  for (const sid of two) {
    await awc.locator('.awc-file[data-sid="' + sid + '"]').setInputFiles(PHOTO);
    const row = awc.locator('.awc-row[data-awc-target="' + sid + '"]');
    await expect(row.locator('.awc-chip')).toHaveCount(1, { timeout: 15000 });
    await expect(row.locator('.awc-file-name')).toHaveText('cell-lab-cece-1.jpg');
    await expect(row.locator('.awc-pages')).toHaveText('1 page');
  }
  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 2 Students');
  await shot(page, 'add-work-class-placed');
  await awc.locator('.awc-primary').click();

  await expect(awc.locator('.awc-done-title')).toHaveText('Added Work for 2 Students', { timeout: 15000 });
  await shot(page, 'add-work-class-done');
  await awc.locator('[data-awc="done"]').click();
  await expect(awc).toHaveCount(0);
  await expect(more).toBeFocused();

  // Each student's page, kept with no file name, shows on the Work Wall.
  const kept = await page.evaluate(
    ({ two, LAB }) =>
      two.map(sid => {
        const sub = getStudentSubmission(getActiveCourse(), sid, LAB);
        return { n: sub ? sub.files.length : 0, by: sub && sub.sent_by };
      }),
    { two, LAB },
  );
  expect(kept).toEqual([
    { n: 1, by: 'teacher' },
    { n: 1, by: 'teacher' },
  ]);
  await more.click();
  await card.locator('.assess-work-wall-btn').click();
  const wall = page.locator('#work-wall-overlay');
  for (const sid of two) {
    const pic = wall.locator('.ww-card[data-sid="' + sid + '"] img');
    await expect(pic).toHaveCount(1);
    await expect.poll(() => pic.evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  }
  // The wall's own Add Work opens the same page over it.
  await wall.locator('.ww-add-work').click();
  await expect(awc.locator('.awc-title')).toHaveText('Add Work for the Class');
  await page.keyboard.press('Escape');
  await expect(awc).toHaveCount(0);
  await expect(wall).toHaveCount(1);
  await expect(wall.locator('.ww-add-work')).toBeFocused();
  expect(errors).toEqual([]);
});
