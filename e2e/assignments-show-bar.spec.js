/**
 * The Show bar on the Assignments page (teacher/assign-show.js; Colin,
 * Nov 16). Demo Mode, Science 8 with its Student Page and Send Work on, at
 * 1366 x 900. One click on Submitted lists only the assessments with work
 * sent in, and a card the teacher opens shows only the students who sent
 * it; a second click lets go and puts back the scroll. To Grade and Not In
 * filter the same way. None of them opens or closes a card (Colin, Nov 17):
 * each keeps what the teacher gave it.
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

async function openDemo(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
  });
  await page.goto('/assignments');
  await expect(page.locator('.atb-show')).toBeVisible();
  // Per assessment, the students each mode counts, as GraderWork counts them on this page.
  return page.evaluate(() => {
    const cid = getActiveCourse();
    const ids = getStudents(cid).map(s => s.id);
    const out = { submitted: {}, tograde: {}, notin: {} };
    getAssessments(cid).forEach(a => {
      const lists = GraderWork.workCounts(cid, a.id, ids).ids;
      const sent = GraderWork.workInIds(cid, a.id, ids);
      if (sent.length) out.submitted[a.id] = sent.sort();
      if (lists.tograde.length) out.tograde[a.id] = lists.tograde.slice().sort();
      if (lists.notin.length) out.notin[a.id] = lists.notin.slice().sort();
    });
    return out;
  });
}

// The students an open card shows, by id.
const shownOn = card => card.evaluate(c => [...new Set([...c.querySelectorAll('[data-sid]')].map(e => e.dataset.sid))]);
// The ids of the cards drawn open.
const openIds = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('#main .assess-card')]
      .filter(c => c.querySelector('.assess-body > *'))
      .map(c => c.id),
  );
// Opens a card by its header, as the teacher does, and checks its students.
async function openAndCheck(page, aid, want) {
  const card = page.locator('#ac-' + aid);
  if (!(await openIds(page)).includes('ac-' + aid)) await card.locator('.assess-header').click();
  await expect(card.locator('.assess-body > *').first()).toBeVisible();
  // A long card draws its last rows a moment later.
  await expect.poll(async () => (await shownOn(card)).sort()).toEqual(want);
}

test('Submitted shows only the work sent in, and a second click puts the page back', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const want = (await openDemo(page)).submitted;
  const sentIds = Object.keys(want);
  expect(sentIds.length).toBeGreaterThan(0);
  const total = sentIds.reduce((n, aid) => n + want[aid].length, 0);

  const submitted = page.locator('.atb-show [data-show="submitted"]');
  // Submitted carries no number: it lists the work sent in, and the cards say how much.
  await expect(submitted).toHaveText('Submitted');
  expect(total).toBeGreaterThan(0);
  await expect(submitted).toHaveAttribute('aria-pressed', 'false');

  // Before: one card with no work in open, the list scrolled.
  const quizId = await page.evaluate(
    sent => [...document.querySelectorAll('#main .assess-card')].map(c => c.id).find(id => !sent.includes(id.slice(3))),
    sentIds,
  );
  const quiz = page.locator('#' + quizId);
  await quiz.locator('.assess-header').click();
  await expect(quiz.locator('.assess-body > *').first()).toBeVisible();
  await scrollTop(page, 400);
  // The open card settles a few pixels after the scroll is set.
  await page.waitForTimeout(300);
  const top = await scrollTop(page);
  expect(top).toBeGreaterThan(0);

  // On: only the work sent in, nothing opened; a card opened shows only the students who sent it.
  await submitted.click();
  await expect(submitted).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#main .assess-card')).toHaveCount(sentIds.length);
  expect(await openIds(page)).toEqual([]);
  for (const aid of sentIds) await openAndCheck(page, aid, want[aid]);
  await shot(page, 'assignments-submitted-on-1366');

  // Off: every card as the teacher left it, the scroll as it was.
  await submitted.click();
  await expect(submitted).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.atb-show [data-show="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#' + quizId + ' .assess-body > *').first()).toBeVisible();
  expect((await openIds(page)).sort()).toEqual([quizId, ...sentIds.map(aid => 'ac-' + aid)].sort());
  expect(await scrollTop(page)).toBe(top);
  expect(errors).toEqual([]);
});

test('To Grade and Not In list their cards, opened cards show only the students they count', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const want = await openDemo(page);
  for (const show of ['tograde', 'notin']) {
    const btn = page.locator('.atb-show [data-show="' + show + '"]');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const aids = Object.keys(want[show]);
    expect(aids.length).toBeGreaterThan(0);
    await expect(page.locator('#main .assess-card')).toHaveCount(aids.length);
    // A card opened under To Grade is still open under Not In; nothing else opens.
    const opened = (await openIds(page)).map(id => id.slice(3));
    expect(opened.every(aid => aids.includes(aid))).toBe(true);
    for (const aid of aids) await openAndCheck(page, aid, want[show][aid]);
    await shot(page, 'assignments-' + show + '-on-1366');
  }
  await page.locator('.atb-show [data-show="notin"]').click();
  await expect(page.locator('.atb-show [data-show="all"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
