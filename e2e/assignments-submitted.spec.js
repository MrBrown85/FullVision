/**
 * Show: Submitted on the Assignments page (teacher/assign-show.js; Colin,
 * Nov 16). Demo Mode, Science 8 with its Student Page and Send Work on, at
 * 1366 x 900. One click lists only the assessments with work sent in, each
 * open, each showing only the students who sent it; a second click puts the
 * page back: the same card open, the same scroll.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

// The page scrolls in #main when it is a scroller, else the document. Sets
// the scroll when `to` is given; returns it.
const scrollTop = (page, to) =>
  page.evaluate(to => {
    const main = document.getElementById('main');
    const el = /auto|scroll/.test(getComputedStyle(main).overflowY) ? main : document.scrollingElement;
    if (to != null) el.scrollTop = to;
    return el.scrollTop;
  }, to);

test('Submitted shows only the work sent in, and a second click puts the page back', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  // The students with work in, per assessment, as GraderWork counts them.
  const want = await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    const ids = getStudents(cid).map(s => s.id);
    const out = {};
    getAssessments(cid).forEach(a => {
      const sent = GraderWork.workInIds(cid, a.id, ids);
      if (sent.length) out[a.id] = sent.sort();
    });
    return out;
  });
  const sentIds = Object.keys(want);
  expect(sentIds.length).toBeGreaterThan(0);
  const total = sentIds.reduce((n, aid) => n + want[aid].length, 0);

  await page.goto('/assignments');
  const submitted = page.locator('.assess-tograde-seg [data-show="submitted"]');
  await expect(submitted).toHaveText('Submitted ' + total);
  await expect(submitted).toHaveAttribute('aria-pressed', 'false');

  // Before: one card open, the list scrolled.
  const quiz = page.locator('.assess-card').filter({ hasNotText: 'Microscope Lab' }).first();
  const quizId = await quiz.getAttribute('id');
  await quiz.locator('.assess-header').click();
  await expect(quiz.locator('.assess-body > *').first()).toBeVisible();
  await scrollTop(page, 400);
  // The open card settles a few pixels after the scroll is set.
  await page.waitForTimeout(300);
  const top = await scrollTop(page);
  expect(top).toBeGreaterThan(0);

  // On: only the work sent in, every card open, only the students who sent it.
  await submitted.click();
  await expect(submitted).toHaveAttribute('aria-pressed', 'true');
  const cards = page.locator('#main .assess-card');
  await expect(cards).toHaveCount(sentIds.length);
  for (const aid of sentIds) {
    const card = page.locator('#ac-' + aid);
    await expect(card.locator('.assess-body > *').first()).toBeVisible();
    const shown = await card.evaluate(c => [...new Set([...c.querySelectorAll('[data-sid]')].map(e => e.dataset.sid))]);
    expect(shown.sort()).toEqual(want[aid]);
  }
  await shot(page, 'assignments-submitted-on-1366');

  // Off: the page as it was.
  await submitted.click();
  await expect(submitted).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.assess-tograde-seg [data-show="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#' + quizId + ' .assess-body > *').first()).toBeVisible();
  const openNow = await page.evaluate(
    () => [...document.querySelectorAll('#main .assess-card')].filter(c => c.querySelector('.assess-body > *')).length,
  );
  expect(openNow).toBe(1);
  expect(await scrollTop(page)).toBe(top);
  expect(errors).toEqual([]);
});
