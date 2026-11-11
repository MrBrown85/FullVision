/**
 * Grading group work (S12-F2): Cell Microscope Lab made a One per Group
 * piece in Demo Mode, its grades cleared, so four groups wait. The grader
 * shows each group's work once, Students in This Group and Change One
 * Student; To Grade says 4. 1366 x 900.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const GROUPS = [
  ['st1', 'st11', 'st12'],
  ['st2', 'st13', 'st14'],
  ['st3', 'st15', 'st16'],
  ['st4', 'st17', 'st18'],
];
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('four groups to grade, one pane a group, Change One Student', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  const counts = await page.evaluate(
    ({ LAB, GROUPS }) => {
      const cid = getActiveCourse();
      const members = GROUPS.flat();
      // Clear the groups' grades with the switch off, so no draft is made.
      const scores = getScores(cid);
      members.forEach(sid => {
        scores[sid] = (scores[sid] || []).filter(e => e.assessmentId !== LAB);
      });
      saveScores(cid, scores);
      const checks = Object.assign({}, getRubricChecks(cid));
      members.forEach(sid => delete checks[sid + ':' + LAB]);
      saveRubricChecks(cid, checks);
      const roster = getStudents(cid).map(s => s.id);
      const others = roster.filter(id => members.indexOf(id) < 0);
      saveAssessments(
        cid,
        getAssessments(cid).map(a =>
          a.id === LAB ? Object.assign({}, a, { collaboration: 'group', groups: GROUPS.concat([others]) }) : a,
        ),
      );
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      work.course.send_work = true;
      work.assessments = work.assessments.map(a => (a.id === LAB ? Object.assign({}, a, { group_work: 'group' }) : a));
      saveDemoStudentWork(cid, work);
      const c = GraderWork.workCounts(cid, LAB);
      return { tograde: c.tograde, groups: c.groups };
    },
    { LAB, GROUPS },
  );
  expect(counts).toEqual({ tograde: 4, groups: 4 });

  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="st11"][data-aid="' + LAB + '"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.grader-show [data-show="tograde"]')).toHaveText(/To Grade\s*4/);
  await expect(dialog.locator('.grader-work-what')).toHaveText(/ for the group, /);
  await expect(dialog.locator('.grader-work-strip button')).toHaveCount(4);
  await expect(dialog.locator('.grader-members-title')).toHaveText('Students in This Group');
  await expect(dialog.locator('.grader-member-same')).toHaveCount(3);
  await shot(page, 'S12-F2-grading-group-1366');
  await dialog.locator('.grader-change-one-btn').click();
  await dialog.locator('[data-grader="change-one"]').nth(2).click();
  await expect(dialog.locator('.grader-separate-line')).toHaveText(/Graded Separately From Group 1/);
  expect(errors).toEqual([]);
});
