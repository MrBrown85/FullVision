import { test, expect } from '@playwright/test';

/* Preview as Student shows a quiz and sends nothing (docs/plans/quizzes-plan.md Q3b), in Demo Mode with
   the quizzes switch on: the sample quiz, assigned, opened in the preview's device. */

test.use({ serviceWorkers: 'block' });

test('the preview shows the quiz, keeps the answers in the device, and sends and saves nothing', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fv-build-quizzes', '1');
    } catch (e) {
      /* about:blank has no storage */
    }
  });
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\/|\/rest\/v1\/rpc\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  const opened = await page.evaluate(() => {
    setStudentPageSwitch('sci8', true);
    const list = getAssessments('sci8');
    const quiz = list.find(a => a.title === 'Data Patterns Quick Check');
    if (!quiz) return 'no sample quiz';
    quiz.isDraft = false;
    quiz.dateAssigned = quiz.date = '2020-01-01';
    saveAssessments('sci8', list);
    const sid = getStudents('sci8')[0].id;
    return PreviewStudent.open('sci8', sid, null, null) ? 'ok' : 'not opened';
  });
  expect(opened).toBe('ok');
  const screen = page.locator('.ps-screen');
  // The sample is due in a week: on Upcoming, where a card still to do has its button.
  await screen.getByRole('button', { name: /^Upcoming/ }).click();
  await screen.locator('[data-act="quiz-open"]').click();
  await expect(screen.getByRole('heading', { level: 1, name: 'Data Patterns Quick Check' })).toBeVisible();
  const cards = screen.locator('.sp-quiz-q');
  expect(await cards.count()).toBeGreaterThan(3);
  // No right answer on the device: the teacher's key is not drawn.
  expect(await screen.innerHTML()).not.toMatch(/data-key|tolerance|correct/i);
  await cards.first().locator('[data-act="quiz-pick"]').first().click();
  await expect(screen.locator('#sp-quiz-count')).toContainText('1 of');
  await expect(screen.locator('#sp-quiz-saved')).toHaveText('This is a preview. Nothing is saved or sent.');
  await screen.locator('[data-act="quiz-send-ask"]').click();
  await expect(screen.locator('#sp-quiz-msg')).toHaveText('This is a preview. Nothing is sent.');
  await screen.locator('[data-act="quiz-back"]').click();
  await expect(screen.locator('[data-act="quiz-open"]')).toBeVisible();
  expect(posts).toEqual([]);
});
