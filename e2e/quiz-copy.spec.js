import { test, expect } from '@playwright/test';

/* A quiz goes with its copy (docs/plans/quizzes-plan.md, slice Q7), in Demo
   Mode with the quizzes switch on: Copy to Another Class on the sample
   quiz's card puts the quiz, key and settings in the other class, each
   question's competency matched by name, and none of it is a student's. */

test.use({ serviceWorkers: 'block' });

test('Copy to Another Class takes the sample quiz, its key and its settings along', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  const aid = await page.evaluate(() => {
    localStorage.setItem('fv-build-quizzes', '1');
    COURSES.sci8b = Object.assign(structuredClone(COURSES.sci8), { id: 'sci8b', name: 'Science 8', block: 'B' });
    saveCourses(COURSES);
    saveLearningMap('sci8b', Object.assign(structuredClone(getLearningMap('sci8')), { _customized: true }));
    ['sci8', 'sci8b'].forEach(cid => setStudentPageSwitch(cid, true));
    return DEMO_QUIZ_AID;
  });
  await page.goto('/assignments?course=sci8');
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await page.waitForSelector('[data-action="showNewForm"]');
  const was = await page.evaluate(id => QuizData.get('sci8', id), aid);
  expect(was.questions.length).toBeGreaterThan(2);

  // Copy to Another Class: the form opens at its Classes row; choose Science 8 B and save.
  await page.evaluate(id => {
    document.querySelector('[data-action="copyAssessToClass"][data-aid="' + id + '"]').click();
  }, aid);
  const chip = page.locator('button.af-copy-chip[data-cid="sci8b"]');
  await expect(chip).toBeVisible();
  await chip.click();
  await page.locator('[data-action="saveEditAssess"]').first().click();
  // Check Before Adding, when the other class needs a choice.
  const ok = page.locator('[data-copy-ok]');
  if (await ok.isVisible({ timeout: 1500 }).catch(() => false)) await ok.click();

  const title = await page.evaluate(id => getAssessments('sci8').find(a => a.id === id).title, aid);
  await page.waitForFunction(t => getAssessments('sci8b').some(a => a.title === t), title);
  const got = await page.evaluate(t => {
    const copy = getAssessments('sci8b').find(a => a.title === t);
    return { copy: copy.id, quiz: QuizData.get('sci8b', copy.id), tags: copy.tagIds };
  }, title);
  expect(got.quiz.quiz).toMatchObject({
    tries: was.quiz.tries,
    counts: was.quiz.counts,
    shows: was.quiz.shows,
    shuffle_questions: was.quiz.shuffle_questions,
  });
  expect(got.quiz.questions.map(q => [q.kind, q.prompt, q.points, q.key.answer])).toEqual(
    was.questions.map(q => [q.kind, q.prompt, q.points, q.key.answer]),
  );
  // Questions of its own, never the first class's.
  const ids = new Set(was.questions.map(q => q.id));
  got.quiz.questions.forEach(q => expect(ids.has(q.id)).toBe(false));
  // Matched by name: each competency is one the copy holds.
  got.quiz.questions.forEach(q => {
    if (q.tag_id) expect(got.tags).toContain(q.tag_id);
  });
  // The first class's quiz is as it was.
  const after = await page.evaluate(id => QuizData.get('sci8', id), aid);
  expect(after.questions.map(q => q.id)).toEqual(was.questions.map(q => q.id));
  expect(errors).toEqual([]);
});
