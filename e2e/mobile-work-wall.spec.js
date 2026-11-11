/**
 * The Grade tab's row menu opens the Work Wall on the phone (S14 follow-up):
 * teacher/work-wall.js at 375 x 812, and Grade in This Order opens the
 * phone's grader on the students the wall shows, in its order. Demo Mode,
 * Science 8, Cell Microscope Lab.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openPhone(page, clear) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(
    ({ clear, LAB }) => {
      const cid = getActiveCourse();
      const a = getAssessments(cid).find(x => x.id === LAB);
      // The sample Lab has every grade returned; the students who sent nothing
      // get theirs taken off too, so they are Not In (GraderWork's count).
      const sentNothing = getStudents(cid)
        .map(s => s.id)
        .filter(sid => !getStudentSubmission(cid, sid, LAB) && clear.indexOf(sid) < 0);
      clear.concat(sentNothing).forEach(sid => {
        const keys = [...new Set((getScores(cid)[sid] || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
        Grader.setOverallComment(cid, sid, LAB, '');
        getRubricCheckIds(cid, sid, LAB).forEach(id => Grader.setTick(cid, sid, LAB, id, false));
        if (keys.length) Grader.clearScore(cid, getScores(cid), sid, a, keys);
      });
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      work.course.send_work = true;
      saveDemoStudentWork(cid, work);
    },
    { clear, LAB },
  );
  await page.reload();
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
}

test('the row menu’s Work Wall, then Grade in This Order on the phone', async ({ page }) => {
  await openPhone(page, ['st2', 'st3']);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  const row = page.locator('.m-tg-row[data-aid="' + LAB + '"]');
  await row.locator('[data-action="m-grade-row-menu"]').click();
  const menu = page.locator('#m-sheet-container .m-tg-menu');
  await expect(menu.locator('[data-action="m-work-wall"]')).toContainText('Work Wall');
  await expect(menu.locator('[data-action="m-work-wall"]')).toContainText('Everyone’s work side by side');
  await expect(menu.locator('[data-action="m-add-work"]')).toContainText(/Add Work for the \d+ Not In/);
  await shot(page, 'S14-phone-row-menu');
  await menu.locator('[data-action="m-work-wall"]').click();

  const wall = page.locator('#work-wall-overlay');
  await expect(wall.locator('.ww-title')).toHaveText('Work Wall');
  await expect(wall.locator('.ww-card').first()).toBeVisible();
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
  await expect(wall.locator('.ww-img[src]').first()).toBeVisible();
  // Nothing wider than the phone.
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(375);
  await shot(page, 'S14-phone-work-wall');

  // To Grade First: the two waiting come first, and the grader steps through the wall's order.
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('#work-wall-overlay .ww-card[data-sid]')].map(c => c.getAttribute('data-sid')),
  );
  await wall.locator('.ww-grade').first().click();
  await expect(wall).toHaveCount(0);
  const swiper = page.locator('#m-screen-grade-swiper');
  await expect(swiper).toBeVisible();
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('#m-swiper .m-swiper-card')].map(c => c.getAttribute('data-sid')),
  );
  expect(cards).toEqual(shown);
  await expect(swiper.locator('.m-nav-bar')).toContainText('1 of ' + shown.length);
  await expect(swiper.locator('.m-nav-bar')).not.toContainText('to grade');
  await shot(page, 'S14-phone-grade-in-order');
});
