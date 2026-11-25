/**
 * The grader's queue (I3 of docs/plans/inbox-redesign-plan.md): opened with a
 * queue of two pieces, Next on the last student names the next piece, carries
 * on into it, and after the last piece shows All Caught Up.
 * Demo Mode, Science 8, the student page and Send Work on.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

test.use({ viewport: { width: 1024, height: 800 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    const [one, two] = getAssessments(cid);
    const ids = getStudents(cid)
      .slice(0, 2)
      .map(s => s.id);
    const queue = [
      { aid: one.id, studentIds: ids },
      { aid: two.id, studentIds: ids },
    ];
    window.__queue = queue;
    window.__titles = [one.title, two.title];
    window.__closed = 0;
    PageAssignments.openGrader(cid, one.id, ids[1], {
      studentIds: ids,
      queue,
      onClose: () => window.__closed++,
    });
  });
  await page.locator('#grader-overlay').waitFor();
}

for (const font of FONTS) {
  test('Next carries on into the next piece, then All Caught Up (' + font + ' font)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await open(page);
    await useFont(page, font);
    const titles = await page.evaluate(() => window.__titles);
    const next = page.locator('#grader-overlay [data-grader="next"]');
    const row = page.locator('#grader-overlay .grader-student-row');

    // The last student of the first piece: Next names the second.
    await expect(next).toBeEnabled();
    await expect(next).toContainText('Next: ' + titles[1]);
    await expect(next).toHaveAttribute('title', 'Next: ' + titles[1] + ' →');

    // The row keeps its shape: the button and the status control are inside the dialog, on one line.
    const fits = await page.evaluate(() => {
      const dialog = document.querySelector('.grader-dialog').getBoundingClientRect();
      const r = document.querySelector('.grader-student-row').getBoundingClientRect();
      const kids = Array.from(document.querySelector('.grader-student-row').children).filter(el => !el.hidden);
      const inside = kids.every(el => {
        const b = el.getBoundingClientRect();
        return !b.width || (b.left >= dialog.left - 1 && b.right <= dialog.right + 1);
      });
      return { inside, oneLine: r.height < 80 };
    });
    expect(fits).toEqual({ inside: true, oneLine: true });
    await expect(row).toBeVisible();

    // Cross over with the Right arrow.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#grader-overlay .grader-title')).toHaveText(titles[1]);
    const prev = page.locator('#grader-overlay [data-grader="prev"]');
    await expect(prev).toBeEnabled();
    // Previous on the first student goes back.
    await prev.click();
    await expect(page.locator('#grader-overlay .grader-title')).toHaveText(titles[0]);
    await next.click();
    await expect(page.locator('#grader-overlay .grader-title')).toHaveText(titles[1]);

    // Step to the end of the last piece: Finish, then All Caught Up.
    await next.click();
    await expect(next).toHaveText('Finish');
    await next.click();
    const panel = page.locator('#grader-overlay .grader-caught-up');
    await expect(panel.locator('h2')).toHaveText('All Caught Up');
    await expect(panel.locator('button').first()).toBeFocused();
    await expect(panel.getByRole('button', { name: 'Done' })).toBeVisible();
    await panel.locator('button').first().click();
    await expect(page.locator('#grader-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__closed)).toBe(1);
    expect(errors).toEqual([]);
  });
}
