import { test, expect } from '@playwright/test';
import { openDemo } from './student-screens.js';

/* A quiz that came back (docs/plans/quizzes-plan.md Q5b), the sample quiz in Demo Mode at 390 px with the live
   site's CSP. The student takes it and sends it; the demo teacher closes, confirms and returns it
   (StudentPage._test.quizDemoReturn); the student opens the page again and reads the returned view. Nothing is
   sent to a server: `quiz-result` is Q5a's route and is not on the deployed function yet. */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/* A wide face as a Chromebook, Android or CI's Linux draws it, forced on every element. Verdana, and 0.04em more
   between letters, so a layout that only just fits in the page's own font is caught. */
const WIDE =
  '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';
const FONTS = ['own', 'wide'];

async function useFont(page, font) {
  if (font !== 'wide') return;
  await page.addInitScript(css => {
    const put = () => {
      const t = document.createElement('style');
      t.textContent = css;
      document.documentElement.appendChild(t);
    };
    if (document.documentElement) put();
    else document.addEventListener('DOMContentLoaded', put);
  }, WIDE);
}

async function demo(page, font = 'own') {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await useFont(page, font);
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
async function answer(page, q) {
  if (await q.locator('input[data-kind="number"]').count()) await q.locator('input').fill('10');
  else if (await q.locator('textarea').count()) await q.locator('textarea').fill('The line goes up each week.');
  else await q.locator('[data-act="quiz-pick"]').first().click();
}

// Take the sample, send it, and have the demo teacher return it with these settings; open the page again.
async function takenAndReturned(page, opts) {
  await start(page).click();
  for (const q of await page.locator('.sp-quiz-q').all()) await answer(page, q);
  await page.locator('[data-act="quiz-send-ask"]').click();
  await page.locator('[data-act="quiz-send"]').click();
  await expect(page.locator('#sp-quiz-sent')).toBeVisible();
  expect(await page.evaluate(o => StudentPage._test.quizDemoReturn(o), opts)).toBe(true);
  await openDemo(page, {}, 'demo-card');
}
async function openReturned(page) {
  await page.locator('.sp-tab[data-tab="learning"]').locator('visible=true').first().click();
  await page
    .locator('.sp-ml-row[data-act="feedback"][data-piece="demo-quiz-check"]')
    .locator('visible=true')
    .first()
    .click();
  await start(page).click();
  await expect(page.locator('.sp-quiz[data-quiz-mode="returned"]')).toBeVisible();
}

test('the quiz comes back: the grade, each question right or not, the right answers and the why', async ({ page }) => {
  const { posts, errors } = await demo(page);
  await takenAndReturned(page, { shows: 'answers', addTotal: true });
  await page.locator('.sp-tab[data-tab="learning"]').locator('visible=true').first().click();
  await page
    .locator('.sp-ml-row[data-act="feedback"][data-piece="demo-quiz-check"]')
    .locator('visible=true')
    .first()
    .click();
  // Before the button: Your Feedback is the page's own, with the quiz offered.
  await expect(page.getByRole('button', { name: 'See Your Quiz' })).toBeVisible();
  const feedbackResult = await page.locator('.sp-fb-top').innerText();
  await start(page).click();
  const view = page.locator('.sp-quiz[data-quiz-mode="returned"]');
  await expect(view).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Data Patterns Quick Check' })).toBeVisible();
  // The grade is the page's own Your Result, in the class's words, and the teacher's comment.
  expect(await page.locator('.sp-quiz-top .sp-fb-top').innerText()).toBe(feedbackResult);
  await expect(page.locator('.sp-quiz-top')).toContainText('Look again at the question about cause and effect');
  // Each question has a word and a mark, in its own number.
  const rows = page.locator('.sp-quiz-ra');
  await expect(rows).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const row = rows.nth(i);
    await expect(row.locator('.sp-quiz-ra-n')).toContainText('Question ' + (i + 1) + ' ·');
    await expect(row.locator('.sp-quiz-mk')).toHaveText(/[✓✗½…]/);
  }
  // The total, "7 of 10"-style.
  await expect(page.locator('.sp-quiz-totalcard')).toContainText(/Your Total\s*6 of 10/);
  // A question not right shows the right answer; the short answer the teacher gave 2 of 3 is Partly Right.
  await expect(view).toContainText('Partly Right');
  const text = await view.innerText();
  expect(text).toContain('Right answer: Light, Water, Air');
  expect(text).toContain('Plants need light, water and air to grow.');
  // Nothing about an answer key anywhere in the HTML but what was shown.
  expect(await view.innerHTML()).not.toMatch(/data-key|tolerance/i);
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  // Back goes to Your Feedback, where it was opened from.
  await page.locator('[data-act="quiz-back"]').click();
  await expect(view).toHaveCount(0);
  await expect(page.locator('.sp-fb-title')).toHaveText('Data Patterns Quick Check');
});

test('Grade and Which Were Right shows no right answer; Look Again goes to the first one missed', async ({ page }) => {
  await demo(page);
  await takenAndReturned(page, { shows: 'right' });
  await openReturned(page);
  const text = await page.locator('.sp-quiz').innerText();
  expect(text).not.toMatch(/Right answer:/);
  expect(text).not.toContain('A line graph shows how something changes over time');
  expect(await page.locator('.sp-quiz-total').count()).toBe(0);
  const look = page.locator('[data-act="quiz-look"]');
  if (await look.count()) {
    const pos = await look.getAttribute('data-pos');
    await look.click();
    await expect(page.locator('.sp-quiz-ra[data-pos="' + pos + '"]')).toBeFocused();
  }
});

test('Grade Only shows no questions at all, and stops after the teacher’s comment', async ({ page }) => {
  await demo(page);
  await takenAndReturned(page, { shows: 'grade' });
  await openReturned(page);
  await expect(page.locator('.sp-quiz-gradeonly')).toHaveText(
    'Your teacher shows your result and comment for this quiz.',
  );
  await expect(page.locator('.sp-quiz-top')).toContainText('Look again at the question about cause and effect');
  await expect(page.locator('.sp-quiz-ra')).toHaveCount(0);
  await expect(page.locator('[data-act="quiz-look"]')).toHaveCount(0);
  await expect(page.getByText('Your Answers')).toHaveCount(0);
  // Hidden at rest means out of the page, not just out of sight.
  expect(await page.locator('.sp-quiz').innerHTML()).not.toMatch(/sp-quiz-ra|Prompt|plants need/i);
});

test('nothing of the result stays on the device after Log Out', async ({ page }) => {
  await demo(page);
  await takenAndReturned(page, { shows: 'answers' });
  await openReturned(page);
  await page.locator('[data-act="quiz-back"]').click();
  await page.locator('[data-act="feedback-close"]').locator('visible=true').first().click();
  await page.locator('.sp-gear').locator('visible=true').first().click();
  await page.locator('.sp-set-out').click();
  await page.waitForTimeout(500); // Log Out? takes no press for 400 ms
  await page
    .getByRole('button', { name: /^Log Out$/ })
    .last()
    .click();
  const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  expect(kept.replace('fv-build-quizzes', '')).not.toMatch(/quiz|Data Patterns|plants need/i);
});

for (const font of FONTS) {
  test(`every target is 44 px and it holds at 320 px Larger (246 px wide), in the ${font} font`, async ({ page }) => {
    await demo(page, font);
    await takenAndReturned(page, { shows: 'answers', addTotal: true });
    await openReturned(page);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.sp-quiz button')]
        .filter(el => el.offsetParent !== null)
        .map(el => [el.className, el.getBoundingClientRect().height])
        .filter(([, h]) => h < 44),
    );
    expect(small).toEqual([]);
    // 320 px at Larger lays out at 246 px: the Text Size zoom's narrowest page.
    await page.setViewportSize({ width: 246, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const spills = await page.evaluate(() =>
      [...document.querySelectorAll('.sp-quiz *')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
        })
        .map(el => el.className),
    );
    expect(spills).toEqual([]);
  });
}
