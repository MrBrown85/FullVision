/**
 * Work to grade on the dashboard, the gradebook and the Assignments page
 * (S6-F4, S6-F5). Demo Mode, Science 8, the sample work of Cell Microscope
 * Lab with two students' grades cleared so their work waits, at 1366 x 900.
 * The three screens give the same number. With Send Work off none of it
 * shows.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openDemo(page, { on = true, clear = [] } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  await page.evaluate(() => saveDashboardPrefs({ closedModules: { sci8: [] } })); // these checks want every unit folder open
  return page.evaluate(
    ({ on, clear, LAB }) => {
      const cid = getActiveCourse();
      const a = getAssessments(cid).find(x => x.id === LAB);
      clear.forEach(sid => {
        const keys = [...new Set((getScores(cid)[sid] || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
        Grader.setOverallComment(cid, sid, LAB, '');
        getRubricCheckIds(cid, sid, LAB).forEach(id => Grader.setTick(cid, sid, LAB, id, false));
        if (keys.length) Grader.clearScore(cid, getScores(cid), sid, a, keys);
      });
      // The sample's Light Refraction Lab has work waiting too (ruling 115):
      // it gets an Overall Comment here, with the switch off (no draft), so
      // only this test's own work waits.
      getStudents(cid).forEach(s => {
        if (groupWorkIn(cid, s.id, 'sci8a21')) Grader.setOverallComment(cid, s.id, 'sci8a21', 'Seen.');
      });
      if (on) {
        setStudentPageSwitch(cid, true, 'on_return');
        const work = getCourseSubmissions(cid);
        work.course.send_work = true;
        saveDemoStudentWork(cid, work);
      }
      return { cid, total: GraderWork.classWorkCounts(cid).tograde };
    },
    { on, clear, LAB },
  );
}

test('Send Work off: no To Grade anywhere', async ({ page }) => {
  await openDemo(page, { on: false, clear: ['st2'] });
  await page.goto('/dashboard');
  await expect(page.locator('.dash-glance')).toBeVisible();
  await expect(page.locator('.dash-glance-tograde')).toHaveCount(0);
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  await expect(page.locator('.gb-to-grade-btn')).toHaveCount(0);
});

test('the dashboard, the gradebook and Assignments give the same number', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await openDemo(page, { clear: ['st2', 'st3'] });
  expect(at.total).toBe(2);

  await page.goto('/dashboard');
  const cellEl = page.locator('.dash-glance-tograde');
  await expect(cellEl).toBeVisible();
  await expect(cellEl.locator('.dash-glance-value')).toHaveText('2');
  await expect(cellEl.locator('.dash-glance-sub')).toHaveText(/Not Returned/);
  await shot(page, 'S6-F5-dashboard-to-grade-1366');

  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  await expect(page.locator('.gb-to-grade-btn')).toHaveText(/^2 to grade/);
  const waiting = page.locator('.gb-scores-cell[data-aid="' + LAB + '"] .gb-to-grade');
  await expect(waiting).toHaveCount(2);
  await shot(page, 'S6-F4-gradebook-to-grade-1366');

  // The dashboard's cell opens Assignments with To Grade on.
  await page.goto('/dashboard');
  await page.locator('.dash-glance-tograde').click();
  await expect(page).toHaveURL(/assignments/);
  await expect(page.locator('.assess-tograde-seg [data-show="tograde"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.assess-tograde-n')).toHaveText('2');
  await expect(page.locator('.assess-card')).toHaveCount(1);
  await shot(page, 'S6-F4-assignments-to-grade-1366');
  // Open the card: its buttons show on an open card.
  await page
    .locator('#ac-' + LAB + ' .assess-title, #ac-' + LAB + ' h3')
    .first()
    .click();
  await page.locator('.assess-grade-work-btn[data-aid="' + LAB + '"]').click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toHaveClass(/has-work/);
  await expect(dialog.locator('.grader-show [data-show="tograde"]')).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('[data-grader="close"]').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await page.locator('.assess-tograde-seg [data-show="all"]').click();
  await expect(page.locator('.assess-card').nth(1)).toBeVisible();
  expect(errors).toEqual([]);
});
