/**
 * The top bar's To Grade starts the grading (Colin, Nov 25 2026): the grader
 * opens on the first work waiting, with every assessment that has work to
 * grade behind it. With nothing to grade it shows the Inbox.
 * Demo Mode, Science 8, the student page and Send Work on.
 */
import { test, expect } from '@playwright/test';

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
    PageDashboard.render();
  });
  await page.locator('#dash-inbox').waitFor();
}

test.use({ viewport: { width: 1280, height: 800 } });

test('To Grade opens the grader on the first work waiting; closing it is the Dashboard again', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  const first = await page.evaluate(() => {
    const cid = getActiveCourse();
    const q = DashInboxQueue.order(cid)[0];
    const a = getAssessments(cid).find(x => x.id === q.aid);
    const st = getStudents(cid).find(s => s.id === q.studentIds[0]);
    return { title: a.title, name: displayNameWithLast(st), n: q.studentIds.length };
  });
  expect(first.n).toBeGreaterThan(0);
  // Enter on the focused cell, as a keyboard teacher would; a click is the same path.
  await page.locator('.dash-glance-tograde').evaluate(el => el.focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.grader-title')).toHaveText(first.title);
  await expect(dialog.locator('.grader-student')).toHaveText(first.name);
  // Still on the Dashboard: the link was not followed, and the Inbox was not rung as well.
  expect(new URL(page.url()).pathname).toBe('/dashboard');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#dash-inbox')).toBeVisible();
  expect(errors).toEqual([]);
});

test('with nothing to grade To Grade shows the Inbox and rings it; no grader opens', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const ids = getStudents(cid).map(s => s.id);
    getAssessments(cid).forEach(a =>
      GraderWork.workCounts(cid, a.id, ids).ids.tograde.forEach(sid =>
        Grader.setOverallComment(cid, sid, a.id, 'Seen.'),
      ),
    );
    PageDashboard.render();
  });
  await expect(page.locator('.dash-glance-tograde .dash-glance-value')).toHaveText('0');
  await page.locator('.dash-glance-tograde').click();
  await expect(page.locator('#dash-inbox')).toHaveClass(/is-ring/);
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/dashboard');
  await expect(page.locator('#dash-inbox')).not.toHaveClass(/is-ring/, { timeout: 2000 });
});
