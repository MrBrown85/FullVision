/**
 * Questions From Students in the teacher's three places (S10-F4): the
 * gradebook's yellow dot, the dashboard's Questions From Students and the
 * Learner Profile's Reflections on Feedback, from Demo Mode's sample
 * (Jordan's question on Cell Microscope Lab), with the build switch and
 * Reflect on Feedback on, at 1366 x 900. Answer in the Grader opens the
 * grader on Jordan's piece; one answer clears all three. With Reflect on
 * Feedback off none of it shows.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const JORDAN = 'st10';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openDemo(page, { on = true } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  return page.evaluate(async on => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    if (on) await setCourseFeedbackOptions(cid, { reflect_on_feedback: true }, 'e2e-questions-on');
    return cid;
  }, on);
}

async function gradebook(page) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  return page.locator('.gb-scores-cell[data-sid="' + JORDAN + '"][data-aid="' + LAB + '"]');
}

test('Reflect on Feedback off: no question anywhere', async ({ page }) => {
  const cid = await openDemo(page, { on: false });
  await page.goto('/dashboard');
  await expect(page.locator('.dash-glance')).toBeVisible();
  await expect(page.locator('#dash-questions')).toHaveCount(0);
  await gradebook(page);
  await expect(page.locator('.gb-question')).toHaveCount(0);
  await expect(page.locator('.gb-questions-btn')).toHaveCount(0);
  await page.goto('/student?id=' + JORDAN + '&course=' + cid + '&tab=profile');
  await expect(page.locator('.lp-layout')).toBeVisible();
  await expect(page.locator('#lp-feedback')).toHaveCount(0);
});

test('a question shows in three places and one answer clears all three', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cid = await openDemo(page);
  const question = await page.evaluate(cid => getQuestionsWaiting(cid)[0].question, cid);

  // The dashboard.
  await page.goto('/dashboard');
  const card = page.locator('#dash-questions');
  await expect(card).toBeVisible();
  await expect(card.locator('.dash-questions-count')).toHaveText('1');
  await expect(card.locator('.dash-questions-text')).toHaveText(question);
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'S10-F4-dashboard-questions-1366');
  // Answer in the Grader: the grader on Jordan's piece.
  await card.locator('.dash-questions-answer').click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.grader-student')).toContainText('Jordan');
  await dialog.locator('[data-grader="close"]').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await expect(card).toBeVisible();

  // The gradebook.
  const cell = await gradebook(page);
  await cell.scrollIntoViewIfNeeded();
  await expect(cell.locator('.gb-question')).toHaveCount(1);
  await expect(cell).toHaveAttribute('title', /^Asked you a question /);
  await expect(page.locator('.gb-questions-btn')).toHaveText('1 question');
  await shot(page, 'S10-F4-gradebook-question-1366');

  // The Learner Profile.
  await page.goto('/student?id=' + JORDAN + '&course=' + cid + '&tab=profile');
  await expect(page.locator('#stu-tab-profile .stu-tab-sub')).toHaveText('1 question to answer');
  const refl = page.locator('#lp-feedback');
  await expect(refl.locator('.rf-card .qw-b').first()).toHaveText(question);
  await shot(page, 'S10-F4-profile-question-1366');
  await refl.locator('.rf-answer').click();
  await expect(dialog).toBeVisible();

  // Answered (the grader's Send Answer, S10-F3, sends through answerReflection).
  await page.evaluate(async cid => {
    const r = getQuestionsWaiting(cid)[0];
    await answerReflection(cid, r.id, 'The onion cells sit in rows, like bricks.', 'e2e-answer-1');
  }, cid);
  await dialog.locator('[data-grader="close"]').click();
  await expect(refl.locator('.rf-answer')).toHaveCount(0);
  await expect(refl.locator('.rf-you')).toContainText('The onion cells sit in rows, like bricks.');
  await expect(page.locator('#stu-tab-profile .stu-tab-sub')).not.toHaveText('1 question to answer');
  await shot(page, 'S10-F4-profile-answered-1366');

  await gradebook(page);
  await expect(page.locator('.gb-scores-cell .gb-question')).toHaveCount(0);
  await expect(page.locator('.gb-questions-btn')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.locator('.dash-glance')).toBeVisible();
  await expect(page.locator('#dash-questions')).toHaveCount(0);

  // Liam's plan: Working On.
  await page.goto('/student?id=st4&course=' + cid + '&tab=profile');
  await expect(page.locator('.lp-working .qw-b')).toHaveText(
    "Next time I'll write the magnification beside each drawing.",
  );
  await shot(page, 'S10-F4-profile-plan-1366');
  expect(errors).toEqual([]);
});
