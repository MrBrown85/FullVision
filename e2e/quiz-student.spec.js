import { test, expect } from '@playwright/test';
import { openDemo } from './student-screens.js';

/* A quiz on the student's page (docs/plans/quizzes-plan.md Q3b), the sample
   quiz in Demo Mode at 390 px, with the live site's CSP. Nothing is sent to a
   server; the three quiz routes are not on the deployed function yet. */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function demo(page, on = true) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (on)
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fv-build-quizzes', '1');
      } catch (e) {
        /* about:blank has no storage */
      }
    });
  await openDemo(page, {}, 'demo-card');
  return { posts, errors };
}

const start = page => page.locator('[data-act="quiz-open"]').locator('visible=true').first();
const prompts = page => page.locator('.sp-quiz-q .sp-q').allTextContents();

async function answer(page, q) {
  if (await q.locator('input[data-kind="number"]').count()) await q.locator('input').fill('10');
  else if (await q.locator('textarea').count()) await q.locator('textarea').fill('The line goes up each week.');
  else await q.locator('[data-act="quiz-pick"]').first().click();
}

test('take the quiz, leave part way, come back to the same order and answers, send', async ({ page }) => {
  const { posts, errors } = await demo(page);
  await start(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Data Patterns Quick Check' })).toBeVisible();
  await expect(page.locator('#sp-quiz-count')).toHaveText('0 of 6 answered');
  const order = await prompts(page);
  expect(order).toHaveLength(6);
  // Hidden at rest: no check, no Sent.
  await expect(page.locator('[data-act="quiz-send"]')).toHaveCount(0);
  const cards = page.locator('.sp-quiz-q');
  for (const i of [0, 1, 2]) await answer(page, cards.nth(i));
  await expect(page.locator('#sp-quiz-count')).toHaveText('3 of 6 answered');
  await expect(page.locator('#sp-quiz-saved')).toContainText('Saved');
  // No right answer anywhere on the screen.
  expect(await page.locator('.sp-quiz').innerHTML()).not.toMatch(/correct|right answer|data-key|tolerance/i);
  await page.locator('[data-act="quiz-back"]').click();
  await expect(start(page)).toHaveText('Carry On with the Quiz');
  await start(page).click();
  await expect(page.locator('#sp-quiz-resume')).toBeVisible();
  await page.getByRole('button', { name: /^Carry On at Question \d+$/ }).click();
  expect(await prompts(page)).toEqual(order);
  await expect(page.locator('#sp-quiz-count')).toHaveText('3 of 6 answered');
  await expect(page.locator('.sp-quiz-q [aria-checked="true"]').first()).toBeVisible();
  // Send asks first, and its primary button is not where the Send that opened it was.
  const send = page.locator('[data-act="quiz-send-ask"]');
  const tap = await send.boundingBox();
  await send.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Send Your Answers?' })).toBeVisible();
  await expect(page.getByText('You haven’t answered 3 questions.')).toBeVisible();
  const primary = await page.locator('.sp-quiz-primary').boundingBox();
  const cx = tap.x + tap.width / 2;
  const cy = tap.y + tap.height / 2;
  const hit = cx >= primary.x && cx <= primary.x + primary.width && cy >= primary.y && cy <= primary.y + primary.height;
  expect(hit).toBe(false);
  await page.getByRole('button', { name: 'Go Back and Answer' }).click();
  for (const i of [3, 4, 5]) await answer(page, cards.nth(i));
  await page.locator('[data-act="quiz-send-ask"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ready to Send' })).toBeVisible();
  await page.getByRole('button', { name: 'Send Answers' }).click();
  await expect(page.locator('#sp-quiz-sent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again (1 Left)' })).toBeVisible();
  await expect(page.locator('.sp-quiz-answers li')).toHaveCount(6);
  await page.getByRole('button', { name: 'Try Again (1 Left)' }).click();
  await expect(page.locator('#sp-quiz-count')).toHaveText('0 of 6 answered');
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});

test('every target is 44 px and nothing is cut off at 200% zoom', async ({ page }) => {
  await demo(page);
  await start(page).click();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.sp-quiz button, .sp-quiz input')]
      .filter(el => el.offsetParent !== null)
      .map(el => [el.className, el.getBoundingClientRect().height])
      .filter(([, h]) => h < 44),
  );
  expect(small).toEqual([]);
  await page.setViewportSize({ width: 195, height: 422 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.locator('[data-act="quiz-send-ask"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('Log Out leaves nothing of the answers on the device', async ({ page }) => {
  await demo(page);
  await start(page).click();
  await answer(page, page.locator('.sp-quiz-q').first());
  await page.locator('[data-act="quiz-back"]').click();
  await page.locator('.sp-gear').click();
  await page.locator('.sp-set-out').click();
  await page.waitForTimeout(500); // Log Out? takes no press for 400 ms
  await page
    .getByRole('button', { name: /^Log Out$/ })
    .last()
    .click();
  const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  // The build switch is the device's own; nothing else of a quiz is left.
  expect(kept.replace('fv-build-quizzes', '')).not.toMatch(/quiz/i);
});

test('Demo Mode keeps the sample progress on the device across a reload, and Log Out clears it', async ({ page }) => {
  await demo(page);
  await start(page).click();
  await answer(page, page.locator('.sp-quiz-q').first());
  await expect(page.locator('#sp-quiz-count')).toHaveText('1 of 6 answered');
  await page.locator('[data-act="quiz-back"]').click();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain('gb-student-quiz-demo');
  await openDemo(page, {}, 'demo-card');
  await expect(start(page)).toHaveText('Carry On with the Quiz');
  await start(page).click();
  await page.getByRole('button', { name: /^Carry On at Question \d+$/ }).click();
  await expect(page.locator('#sp-quiz-count')).toHaveText('1 of 6 answered');
  await page.locator('[data-act="quiz-back"]').click();
  await page.locator('.sp-gear').click();
  await page.locator('.sp-set-out').click();
  await page.waitForTimeout(500); // Log Out? takes no press for 400 ms
  await page
    .getByRole('button', { name: /^Log Out$/ })
    .last()
    .click();
  const left = await page.evaluate(() =>
    Object.keys(localStorage).filter(k => /quiz/.test(k) && k !== 'fv-build-quizzes'),
  );
  expect(left).toEqual([]);
});
