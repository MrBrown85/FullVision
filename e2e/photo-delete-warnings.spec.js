import { test, expect } from '@playwright/test';

// S8-F1 (teacher deletes), in Demo Mode on its sample work (Cell Microscope
// Lab: nine students sent photos, one handed in on paper). The Gradebook's
// Delete Assessment, Delete Permanently for a withdrawn student, and Delete
// Class say plainly that photos go for good (Colin's ruling 102) once the
// class's build switch is on. Send Work is not asked: photos sent before it
// was turned off still go, so the dialogs say so with it off too. With the
// build switch off every dialog reads as it always has. Nothing reaches a
// server.

const CID = 'sci8';
const LAB = 'sci8a1';
const CECE = 'st1';

async function openDemo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(cid => getCourseSubmissions(cid).submissions.length === 10, CID, { timeout: 15000 });
}

// The hidden build switch on; Send Work as `send` (the sample starts it off).
async function turnOnBuildSwitch(page, send) {
  await page.evaluate(
    ([cid, send]) => {
      setStudentPageSwitch(cid, true);
      var all = getCourseSubmissions(cid);
      saveDemoStudentWork(cid, {
        course: Object.assign({}, all.course, { send_work: send }),
        assessments: all.assessments,
        submissions: all.submissions,
      });
    },
    [CID, send],
  );
}

async function deleteAssessDialog(page) {
  await page.goto('/gradebook');
  await page.waitForSelector('#gb-data td[data-aid="' + LAB + '"]', { timeout: 10000 });
  const title = page.locator('#gb-colheads .gb-grid-colhead[data-aid="' + LAB + '"] .gb-grid-colhead-label');
  await title.focus();
  await page.keyboard.press('Enter');
  await page.locator('.gb-ctx-menu [data-ctx="deleteAssess"]').click();
  return page.locator('.confirm-card');
}

async function openStudents(page) {
  await page.goto('/dashboard');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Students/ }).click();
  await expect(page.locator('.cm-student-list').first()).toBeVisible();
}

async function deleteCeceDialog(page) {
  await page.evaluate(([cid, sid]) => withdrawStudent(cid, sid), [CID, CECE]);
  await openStudents(page);
  await page.locator('#cm-withdrawn').getByRole('button', { name: 'Delete permanently' }).first().click();
  return page.locator('.confirm-card');
}

async function deleteClassDialog(page) {
  await page.evaluate(cid => updateCourse(cid, { archived: true }), CID);
  await openStudents(page);
  await page.getByRole('button', { name: /^Class Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Delete Class' }).click();
  return page.locator('.confirm-card');
}

test.describe('Photo warnings before a teacher deletes (Demo Mode)', () => {
  let requests;
  test.beforeEach(async ({ page }) => {
    requests = [];
    page.on('request', req => {
      if (/supabase\.co/.test(req.url())) requests.push(req.url());
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDemo(page);
  });
  test.afterEach(() => {
    expect(requests).toEqual([]);
  });

  test('with the build switch off, every dialog reads as it always has', async ({ page }) => {
    let dialog = await deleteAssessDialog(page);
    await expect(dialog.locator('.confirm-message')).toHaveText(
      'All scores, statuses, and observations linked to this assessment will be removed. You can undo this for a few seconds.',
    );
    await dialog.locator('#confirm-cancel-btn').click();

    dialog = await deleteCeceDialog(page);
    await expect(dialog.locator('.confirm-message')).toHaveText(
      'Their scores, observations, goals, reflections and reports in this class are deleted. This cannot be undone.',
    );
    await expect(dialog.locator('.cm-keep-copy-text')).not.toContainText('Photos');
    await dialog.locator('#confirm-cancel-btn').click();

    dialog = await deleteClassDialog(page);
    await expect(dialog.locator('.confirm-message')).toHaveText(
      /^Permanently delete .+ with all its students, assessments, and scores\? It disappears now and is erased for good after 30 days\.$/,
    );
  });

  test('with Send Work turned off after photos were sent, Delete Assessment still names them', async ({ page }) => {
    await turnOnBuildSwitch(page, false);
    const dialog = await deleteAssessDialog(page);
    await expect(dialog.locator('.confirm-message')).toContainText('the photos 9 students sent for it');
  });

  test('with Send Work on, each names the photos that go', async ({ page }) => {
    await turnOnBuildSwitch(page, true);
    let dialog = await deleteAssessDialog(page);
    await expect(dialog.locator('.confirm-message')).toHaveText(
      "All scores, statuses, and observations linked to this assessment will be removed, and the photos 9 students sent for it. You can undo this for a few seconds. After that, deleted photos can't come back.",
    );
    await dialog.locator('#confirm-cancel-btn').click();

    dialog = await deleteCeceDialog(page);
    await expect(dialog.locator('.confirm-message')).toHaveText(
      'Their scores, observations, goals, reflections, reports and photos of their work in this class are deleted. This cannot be undone.',
    );
    await expect(dialog.locator('.cm-keep-copy-text')).toContainText('Photos of their work are not in this file.');
    await expect(dialog.getByRole('button', { name: 'Download Records' })).toBeVisible();
    await dialog.locator('#confirm-cancel-btn').click();

    dialog = await deleteClassDialog(page);
    const name = await page.evaluate(cid => COURSES[cid].name, CID);
    await expect(dialog.locator('.confirm-message')).toHaveText(
      'Permanently delete ' +
        name +
        " with all its students, assessments, scores and photos of student work? It disappears now and is erased for good after 30 days. Deleted photos can't come back.",
    );
  });
});
