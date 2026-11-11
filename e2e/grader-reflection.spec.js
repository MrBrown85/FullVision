/**
 * A student's reflection in the grader (S10-F3): Jordan's question on Cell
 * Microscope Lab and Send Answer; Liam's plan and Save as Observation.
 * Demo Mode, Science 8, with the build switch and Reflect on Feedback on,
 * at 1366 x 900.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openDemo(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  return page.evaluate(async () => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    await setCourseFeedbackOptions(cid, { reflect_on_feedback: true }, 'e2e-reflect-on');
    return cid;
  });
}

async function openGrader(page, sid) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + sid + '"][data-aid="' + LAB + '"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a question answered with Send Answer; a plan saved as an observation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cid = await openDemo(page);
  expect(await page.evaluate(cid => getQuestionsWaiting(cid).length, cid)).toBe(1);

  let dialog = await openGrader(page, 'st10');
  const card = dialog.locator('.grader-reflect');
  await expect(card.locator('.grader-reflect-title')).toHaveText(/’s Reflection$/);
  await expect(card.locator('.grader-reflect-sense')).toHaveText('Not sure about the feedback');
  await expect(card).toContainText('How do I know which cell is which?');
  await card
    .locator('.grader-reflect-input')
    .fill('The onion cells sit in rows, like bricks. Cheek cells are rounder.');
  await shot(page, 'S10-F3-grader-question-1366');
  await card.locator('[data-grader="reflect-send"]').click();
  await expect(card.locator('.grader-reflect-input')).toHaveCount(0);
  await expect(card).toContainText('The onion cells sit in rows');
  expect(await page.evaluate(cid => getQuestionsWaiting(cid).length, cid)).toBe(0);
  await shot(page, 'S10-F3-grader-answered-1366');
  await dialog.locator('[data-grader="close"]').click();

  dialog = await openGrader(page, 'st4');
  const plan = dialog.locator('.grader-reflect');
  await expect(plan.locator('.grader-reflect-sense')).toHaveText('The feedback makes sense');
  await shot(page, 'S10-F3-grader-plan-1366');
  await plan.locator('[data-grader="reflect-observe"]').click();
  await expect(plan.locator('[data-grader="reflect-observe"]')).toHaveText('Saved as Observation');
  const saved = await page.evaluate(cid => (getQuickObs(cid).st4 || []).map(o => o.text), cid);
  expect(saved.some(t => t.indexOf('write the magnification') >= 0)).toBe(true);
  expect(errors).toEqual([]);
});
