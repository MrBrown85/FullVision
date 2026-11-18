import { test, expect } from '@playwright/test';

/* A quiz's results and Confirm (docs/plans/quizzes-plan.md, slice Q4; board
   "Quizzes Artboard", Board 3), in Demo Mode with the quizzes switch on and
   the sample quiz's seeded tries (Plant Growth Quick Check): the card's line
   opens the results; By Competency's suggestions are dashed and a picked one
   steps and is marked Changed; a short answer is assessed down one column;
   Best of 2 Tries shows which try counts and both; Confirm asks in the plan's
   words, writes the levels, and Undo puts back exactly what was there;
   Reopen for One Student asks first. Hidden at rest means hidden. With the
   switch off the card has no line. */

test.use({ serviceWorkers: 'block', colorScheme: process.env.QUIZ_SCHEME === 'dark' ? 'dark' : 'light' });

const AID = 'sci8-quiz-plant-growth';
// For a reviewer's pictures: QUIZ_SHOTS=<folder> QUIZ_SCHEME=dark.
const SHOTS = process.env.QUIZ_SHOTS || '';
async function shot(page, name) {
  if (SHOTS)
    await page.screenshot({
      path: SHOTS + '/' + name + '-' + (process.env.QUIZ_SCHEME || 'light') + '.png',
      animations: 'disabled',
    });
}

async function demo(page, quizzes) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  await page.evaluate(on => {
    if (on) localStorage.setItem('fv-build-quizzes', '1');
    else localStorage.removeItem('fv-build-quizzes');
    setStudentPageSwitch('sci8', true);
  }, quizzes);
  await page.goto('/assignments?course=sci8');
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await page.waitForSelector('[data-action="showNewForm"]');
}

async function openResults(page) {
  const line = page.locator('[data-action="openQuizResults"][data-aid="' + AID + '"]');
  await expect(line).toHaveText('18 Answered · Confirm Levels');
  await line.click();
  await expect(page.locator('.quiz-results-overlay')).toBeVisible();
  await expect(page.locator('#quiz-results-title')).toHaveText('Plant Growth Quick Check');
}
const tagOf = (page, code) => page.evaluate(c => getAllTags('sci8').find(t => t.code === c || t.id === c).id, code);

test('By Competency: dashed suggestions, a step marked Changed, Best of 2 Tries, a short answer assessed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, true);
  await openResults(page);
  await expect(page.locator('.quiz-results-sub')).toHaveText('18 of 27 sent · 3 short answers to assess · Science 8');
  await expect(page.locator('[data-quiz-view="competency"]')).toHaveAttribute('aria-pressed', 'true');
  // Hidden at rest means hidden: no question up, no Undo.
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  await expect(page.locator('.quiz-undo')).toHaveCount(0);
  await shot(page, 'results-competency');

  // Cece: PA3 3 of 4 points (75%) suggests Proficient, dashed.
  const pa3 = await tagOf(page, 'PA3');
  const ceceRow = page.locator('table.quiz-rt tbody tr').filter({ hasText: 'Cece Adeyemi' }).first();
  await expect(ceceRow.locator('[data-tag="' + pa3 + '"] .quiz-lv')).toHaveText('Extending');
  await expect(ceceRow.locator('[data-tag="' + pa3 + '"] .quiz-lv')).toHaveClass(/is-suggested/);
  await expect(ceceRow.locator('.quiz-of').first()).toHaveText('4 / 4');
  await ceceRow.locator('[data-tag="' + pa3 + '"]').click();
  await page.locator('[data-quiz-act="step"][data-by="-1"]').click();
  await expect(ceceRow.locator('[data-tag="' + pa3 + '"] .quiz-lv')).toHaveText('Extending −');
  await expect(ceceRow.locator('[data-tag="' + pa3 + '"] .quiz-lv-dot')).toHaveCount(1);
  await page.locator('[data-quiz-act="step"][data-by="-1"]').click();
  await expect(ceceRow.locator('[data-tag="' + pa3 + '"] .quiz-lv')).toHaveText('Proficient +');
  await expect(page.locator('.quiz-stepper + .quiz-hint')).toContainText('Suggested: Extending from 4 of 4 points.');

  // Sam sent two tries: Best of 2, Try 2 counts, and both rows show.
  const samRow = page.locator('table.quiz-rt tbody tr').filter({ hasText: 'Sam Blackwood' }).first();
  await expect(samRow).toContainText('Best of 2 Tries');
  await expect(samRow).toContainText('Try 2 Counts');
  await expect(page.locator('.quiz-try-row')).toHaveCount(2);
  await expect(page.locator('.quiz-try-row.is-counted')).toContainText('Try 2');

  // Noor's short answer waits; her PA5 says so. Assess it in her answers.
  const noorRow = page.locator('table.quiz-rt tbody tr').filter({ hasText: 'Noor' }).first();
  await noorRow.locator('.quiz-wait').click();
  await expect(page.locator('#quiz-who-title')).toHaveText('Noor Al-Rashid · Answers');
  await page.locator('.quiz-aside [data-quiz-act="assess"][data-points="2"]').click();
  await expect(noorRow.locator('.quiz-wait')).toHaveCount(0);
  await expect(page.locator('.quiz-results-sub')).toHaveText('18 of 27 sent · 2 short answers to assess · Science 8');
  await shot(page, 'results-stepped');
});

test('By Question assesses short answers down one column; By Student shows one student in their own order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, true);
  await openResults(page);
  await page.locator('[data-quiz-view="question"]').click();
  await expect(page.locator('.quiz-q')).toHaveCount(10);
  // Question 8 is the short answer: every student's words, assessed down one column.
  const q8 = page.locator('.quiz-q').nth(7);
  await expect(q8.locator('.quiz-col-row')).toHaveCount(19);
  const waiting = q8.locator('.quiz-col-row').filter({ hasText: 'Mateo' });
  await waiting.locator('[data-points="1"]').click();
  await expect(waiting.locator('[data-points="1"]')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'results-question');
  await page.locator('[data-quiz-view="student"]').click();
  await page.locator('.quiz-who-list [data-sid]').filter({ hasText: 'Sam Blackwood' }).click();
  await expect(page.locator('.quiz-tries')).toContainText('Best of 2 Tries: Try 2 counts.');
  await expect(page.locator('.quiz-ans')).toHaveCount(10);
  await page.locator('[data-quiz-act="try"][data-try="1"]').click();
  await expect(page.locator('[data-quiz-act="try"][data-try="1"]')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'results-student');
});

test('Confirm asks first, naming what moves; Cancel sends nothing; Undo puts back exactly what was there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, true);
  const before = await page.evaluate(() => JSON.stringify(getScores('sci8')));
  const gradesBefore = await page.evaluate(() => getStudents('sci8').map(s => studentGradeSummary('sci8', s.id).text));
  await openResults(page);
  const confirm = page.locator('[data-quiz-act="confirm"]');
  await expect(confirm).toHaveText(/^Confirm \d+ Suggested Levels$/);
  const n = Number((await confirm.textContent()).match(/\d+/)[0]);
  await confirm.click();
  await expect(page.locator('#confirm-title')).toHaveText('Confirm ' + n + ' Levels');
  await expect(page.locator('.confirm-message')).toHaveText(
    new RegExp(
      '^Confirm ' +
        n +
        ' levels for 18 students on Plant Growth Quick Check\\? They count toward each student’s grade\\. ',
    ),
  );
  await expect(page.locator('.confirm-card')).toBeVisible();
  if (process.env.QUIZ_SHOTS) console.log('ASK: ' + (await page.locator('.confirm-message').textContent()));
  await shot(page, 'results-ask');
  await page.locator('#confirm-cancel-btn').click();
  expect(await page.evaluate(() => JSON.stringify(getScores('sci8')))).toBe(before);
  await confirm.click();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('.quiz-undo')).toBeVisible();
  await expect(page.locator('.quiz-undo span')).toHaveText(n + ' levels confirmed as drafts.');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('Nothing to Confirm Yet');
  // Solid now: the confirmed cells hold scores and are no longer suggestions to step.
  const ceceRow = page.locator('table.quiz-rt tbody tr').filter({ hasText: 'Cece Adeyemi' }).first();
  await expect(ceceRow.locator('[data-quiz-act="cell"]')).toHaveCount(0);
  await expect(ceceRow.locator('.quiz-lv:not(.is-suggested)')).toHaveCount(3);
  const set = await page.evaluate(aid => {
    let c = 0;
    Object.values(getScores('sci8')).forEach(list =>
      list.forEach(e => (c += e.assessmentId === aid && e.score > 0 ? 1 : 0)),
    );
    return c;
  }, AID);
  expect(set).toBe(n);
  await shot(page, 'results-confirmed');
  await page.locator('[data-quiz-act="undo"]').click();
  await expect(page.locator('.quiz-undo')).toHaveCount(0);
  const gradesAfter = await page.evaluate(() => getStudents('sci8').map(s => studentGradeSummary('sci8', s.id).text));
  expect(gradesAfter).toEqual(gradesBefore);
  const left = await page.evaluate(aid => {
    let c = 0;
    Object.values(getScores('sci8')).forEach(list =>
      list.forEach(e => (c += e.assessmentId === aid && e.score > 0 ? 1 : 0)),
    );
    return c;
  }, AID);
  expect(left).toBe(0);
  // Escape closes the screen and the page is drawn again.
  await page.keyboard.press('Escape');
  await expect(page.locator('.quiz-results-overlay')).toHaveCount(0);
});

test('Reopen for One Student asks first', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, true);
  await openResults(page);
  const tyler = page.locator('table.quiz-rt tbody tr').filter({ hasText: 'Tyler Rowe' });
  await tyler.locator('[data-quiz-act="reopen"]').click();
  await expect(page.locator('#confirm-title')).toHaveText('Reopen for Tyler Rowe?');
  await expect(page.locator('.confirm-message')).toHaveText(
    'Tyler Rowe gets one more try, even after the quiz closes. It stays open until they send it.',
  );
  await page.locator('#confirm-ok-btn').click();
  await expect(tyler.locator('[data-quiz-act="reopen"]')).toHaveCount(0);
  await expect(tyler).toContainText('Reopened');
});

test('with the quizzes switch off the card has no line and nothing quiz is kept', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, false);
  await expect(page.locator('[data-action="openQuizResults"]')).toHaveCount(0);
  await expect(page.locator('#ac-' + AID)).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => /quiz/.test(k)));
  expect(keys).toEqual([]);
});

/* Nothing runs out of its box, in the page's font and a wider stand-in, at 1280 and 769. */
const WIDE_FONT =
  "* { font-family: Verdana, 'DejaVu Sans', sans-serif !important; letter-spacing: 0.04em !important; }";
test.describe('fit', () => {
  test.use({ bypassCSP: true });
  test('the results fit in the page font and in a wide font, at 1280 and 769', async ({ page }) => {
    await demo(page, true);
    await openResults(page);
    const wide = on =>
      page.evaluate(
        ([css, add]) => {
          const had = document.getElementById('quiz-wide-font');
          if (had) had.remove();
          if (!add) return;
          const tag = document.createElement('style');
          tag.id = 'quiz-wide-font';
          tag.textContent = css;
          document.head.appendChild(tag);
        },
        [WIDE_FONT, on],
      );
    const overflow = () =>
      page.evaluate(() => {
        const out = [];
        const sel =
          '.quiz-results-head, .quiz-results-tools, .quiz-panel, .quiz-aside, .quiz-undo, .quiz-stepper, .quiz-assess, .quiz-who-head, .quiz-tries, .quiz-q-bar, .quiz-col-row, .quiz-ans';
        document.querySelectorAll(sel).forEach(el => {
          if (el.closest('.quiz-table-wrap')) return;
          if (el.scrollWidth > el.clientWidth + 1)
            out.push(el.className + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
        });
        // The page itself never scrolls sideways; only the table's own box may.
        const o = document.querySelector('.quiz-results-overlay');
        if (o.scrollWidth > o.clientWidth + 1) out.push('the screen scrolls sideways');
        // Each level chip and button label on one line: one line box for its words.
        document.querySelectorAll('.quiz-lv, .quiz-results .btn, .quiz-results .seg-btn').forEach(el => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = new Set(Array.from(range.getClientRects()).map(r => Math.round(r.top)));
          if (lines.size > 1) out.push(el.textContent.trim() + ' wraps');
        });
        return out;
      });
    for (const view of ['competency', 'question', 'student']) {
      await page.locator('[data-quiz-view="' + view + '"]').click();
      for (const width of [1280, 769]) {
        await page.setViewportSize({ width, height: 800 });
        await wide(false);
        expect(await overflow(), view + ' ' + width + ' in the page font').toEqual([]);
        await wide(true);
        expect(await overflow(), view + ' ' + width + ' in a wide font').toEqual([]);
      }
      await wide(false);
    }
  });
});
