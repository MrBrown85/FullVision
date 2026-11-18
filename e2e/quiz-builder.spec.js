import { test, expect } from '@playwright/test';

/* The Quiz card on the assessment form (docs/plans/quizzes-plan.md, slice
   Q2b; board "Quizzes Artboard", Board 1), in Demo Mode with the quizzes
   switch on: a teacher builds the board's quiz with the keyboard alone and
   it is kept, key and all, apart from anything students are sent. With the
   switch off the form is today's. */

test.use({ serviceWorkers: 'block', colorScheme: process.env.QUIZ_SCHEME === 'dark' ? 'dark' : 'light' });

// For a reviewer's pictures: QUIZ_SHOTS=<folder> QUIZ_WIDTH=769 QUIZ_SCHEME=dark.
const SHOTS = process.env.QUIZ_SHOTS || '';
const WIDTH = Number(process.env.QUIZ_WIDTH) || 1280;
async function shot(page, name) {
  if (!SHOTS) return;
  const tag = WIDTH + '-' + (process.env.QUIZ_SCHEME || 'light');
  await page.locator('#quiz-mount').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: SHOTS + '/' + name + '-' + tag + '.png' });
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

/* Tab forward (or back) until the `nth` element matching `sel` has the focus
   (with `any`, whichever matches): it is reachable by the keyboard. */
async function tabTo(page, sel, back, nth, any) {
  for (let i = 0; i < 400; i++) {
    const there = await page.evaluate(
      ([s, n, a]) => {
        const el = document.activeElement;
        return a ? !!el && el.matches(s) : document.querySelectorAll(s)[n || 0] === el;
      },
      [sel, nth, any],
    );
    if (there) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error('Tab never reached ' + sel);
}

const open = '.quiz-edit';

async function write(page, text) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
}

/* One question, by the keyboard: its type, words, choices, right answer, why, competency and points. */
async function question(page, q, first) {
  if (!first) {
    await tabTo(page, '[data-quiz-act="add"]', true);
    await page.keyboard.press('Enter');
    await expect(page.locator(open + ' .quiz-prompt')).toBeFocused();
  }
  if (q.kind !== 'Choice') {
    await tabTo(page, open + ' .rb-kind', true);
    // Type to find: "Te" goes past True or False to Text.
    await page.keyboard.type(q.kind === 'Text' ? 'Te' : q.kind);
    await expect(page.locator(open + ' .rb-kind')).toBeFocused();
    await expect(page.locator(open + ' .rb-kind')).toHaveValue(KIND[q.kind]);
  }
  await tabTo(page, open + ' .quiz-prompt');
  await write(page, q.prompt);
  if (q.choices) {
    await tabTo(page, open + ' .quiz-choice-text');
    for (let i = 0; i < q.choices.length; i++) {
      await page.keyboard.type(q.choices[i]);
      // Enter adds the next choice; the two a question starts with are there already.
      if (i < q.choices.length - 1) {
        if (i >= 1) await page.keyboard.press('Enter');
        else await tabTo(page, open + ' .quiz-choice-text', false, 1);
      }
    }
    if (q.right.length > 1) {
      await tabTo(page, open + ' [data-quiz-act="multiple"]');
      await page.keyboard.press('Space');
      for (const r of q.right) {
        await tabTo(page, open + ' .quiz-key', true, r);
        await page.keyboard.press('Space');
      }
    } else {
      // A radio group takes the Tab once, at whichever radio it enters by; the arrows choose within it.
      await tabTo(page, open + ' .quiz-key', true, 0, true);
      const at = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.quiz-edit .quiz-key')).indexOf(document.activeElement),
      );
      await page.keyboard.press('Space');
      for (let i = at; i < q.right[0]; i++) await page.keyboard.press('ArrowDown');
      for (let i = at; i > q.right[0]; i--) await page.keyboard.press('ArrowUp');
      await expect(page.locator(open + ' .quiz-key').nth(q.right[0])).toBeChecked();
    }
  }
  if (q.kind === 'True or False') {
    await tabTo(page, open + ' [data-quiz-tf="True"]');
    await page.keyboard.press('Space');
    if (q.right === false) await page.keyboard.press('ArrowRight');
    await expect(page.locator(open + ' [data-quiz-tf="' + (q.right ? 'True' : 'False') + '"]')).toBeChecked();
  }
  if (q.kind === 'Number') {
    await tabTo(page, open + ' [data-quiz-f="answer"]');
    await page.keyboard.type(q.answer);
    await tabTo(page, open + ' [data-quiz-f="within"]');
    await page.keyboard.type(q.within);
    await expect(page.locator(open + ' .quiz-range')).toHaveText('Any answer from 12.4 to 12.6 is right.');
  }
  if (q.why) {
    await tabTo(page, open + ' [data-quiz-f="why"]');
    await page.keyboard.type(q.why);
  }
  await tabTo(page, open + ' [data-quiz-f="tag"]');
  await page.keyboard.type(q.tag || 'Counts');
  await tabTo(page, open + ' [data-quiz-f="points"]');
  await write(page, String(q.points));
  await tabTo(page, open + ' [data-quiz-act="done"]');
  await page.keyboard.press('Enter');
  await expect(page.locator(open)).toHaveCount(0);
}

// The board's quiz (window.QUIZ's ten questions), in its order.
const BOARD = [
  {
    tag: 'PA3',
    kind: 'Choice',
    points: 1,
    prompt: 'Which graph best shows how plant height changed over six weeks?',
    choices: ['A line graph', 'A pie chart', 'A table only'],
    right: [0],
  },
  {
    tag: 'PA3',
    kind: 'Number',
    points: 2,
    prompt: 'From the table, what was the average height at week 4?',
    answer: '12.5',
    within: '0.1',
    why: 'Add the four trays at week 4 and divide by 4.',
  },
  {
    tag: 'PA3',
    kind: 'Choice',
    points: 1,
    prompt: 'Which axis should the weeks go on?',
    choices: ['The horizontal axis', 'The vertical axis'],
    right: [0],
  },
  {
    tag: 'PA4',
    kind: 'Choice',
    points: 2,
    prompt: "Which two readings don't fit the pattern?",
    choices: ['Tray C, week 3', 'Tray A, week 5', 'Tray D, week 2', 'Tray B, week 4'],
    right: [0, 2],
  },
  {
    tag: 'PA4',
    kind: 'True or False',
    points: 1,
    prompt: 'The pattern held for every plant.',
    right: false,
    why: 'Tray C at week 3 and Tray D at week 2 broke the pattern.',
  },
  {
    tag: 'PA4',
    kind: 'Choice',
    points: 1,
    prompt: 'Which pattern does the data show?',
    choices: ['Plants grew the same in every tray', 'More hours of light, taller plants', 'More water, taller plants'],
    right: [1],
  },
  {
    tag: 'PA5',
    kind: 'Choice',
    points: 1,
    prompt: 'Which conclusion does the data support?',
    choices: [
      'Light is the only thing that affects growth',
      'More light, up to 8 hours, means taller plants',
      'Plants need water to grow',
    ],
    right: [1],
  },
  {
    tag: 'PA5',
    kind: 'Text',
    points: 2,
    prompt: 'What would you test next to be more sure? Explain in one or two sentences.',
  },
  {
    tag: 'PA5',
    kind: 'Choice',
    points: 1,
    prompt: 'Which conclusion goes further than the data?',
    choices: [
      'Light helped these plants grow taller',
      'All plants everywhere need 8 hours of light',
      'The 8-hour trays grew most',
    ],
    right: [1],
  },
  {
    tag: null,
    kind: 'Choice',
    points: 1,
    prompt: 'Which unit is plant height measured in?',
    choices: ['Centimetres', 'Grams', 'Litres'],
    right: [0],
  },
];
const KIND = { Choice: 'choice', 'True or False': 'true_false', Number: 'number', Text: 'text' };

test('builds the board’s quiz with the keyboard alone, and it is kept with its key apart', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: WIDTH, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await demo(page, true);

  await tabTo(page, '[data-action="showNewForm"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#af-title')).toBeFocused();
  await page.keyboard.type('Data Patterns Check');
  await tabTo(page, '#af-category');
  await page.keyboard.type('Quizzes');
  await tabTo(page, '#af-comp-choose');
  await page.keyboard.press('Enter');
  for (const code of ['PA3', 'PA4', 'PA5']) {
    const box = page.locator('.af-tag-cb[value="' + code + '"]');
    await tabTo(page, '.af-tag-cb[value="' + code + '"]');
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
  }
  await tabTo(page, '[data-action="closeCompPicker"]');
  await page.keyboard.press('Enter');
  // They Answer a Quiz: Send Work is off in the sample class, so the card's own answers.
  await tabTo(page, '#quiz-mount [data-quiz-act="answer"][data-value="quiz"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('.quiz-card')).toBeVisible();
  await expect(page.locator('#af-scoremode')).toHaveValue('competencies');
  await expect(page.locator(open + ' .quiz-prompt')).toHaveCount(1);

  for (let i = 0; i < BOARD.length; i++) {
    await question(page, BOARD[i], i === 0);
    if (i === 3) await shot(page, 'q2b-building');
  }

  await expect(page.locator('#quiz-head')).toHaveText('Quiz · 10 Questions · 13 Points');
  await expect(page.locator('.quiz-row')).toHaveCount(10);
  await expect(page.locator('.quiz-row-bad')).toHaveCount(0);
  const ev = page.locator('#quiz-evidence');
  await expect(ev).toContainText('3 questions · 4 points');
  await expect(ev).not.toContainText('more question');
  await expect(ev).toContainText('No Competency');

  // Quiz Settings as they start, and Counts only with more than one try.
  await expect(page.locator('[data-quiz-set="shuffle_questions"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-quiz-set="shuffle_choices"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-quiz-set="tries"][aria-checked="true"]')).toHaveText('One');
  await expect(page.locator('[data-quiz-set="counts"]')).toHaveCount(0);
  await expect(page.locator('[data-quiz-sees="answers"]')).toBeChecked();
  await expect(page.locator('#quiz-settings')).toContainText('You can reopen it for one student.');
  await shot(page, 'q2b-built');
  await tabTo(page, '.quiz-row', true, 3);
  await page.keyboard.press('Enter');
  await shot(page, 'q2b-open-multiple');
  await tabTo(page, open + ' [data-quiz-act="done"]');
  await page.keyboard.press('Enter');
  await page.locator('#quiz-settings').evaluate(el => el.scrollIntoView({ block: 'center' }));
  // The rows below finish their 200 ms glide first.
  if (SHOTS) await page.waitForTimeout(300);
  if (SHOTS)
    await page.screenshot({
      path: SHOTS + '/q2b-settings-' + WIDTH + '-' + (process.env.QUIZ_SCHEME || 'light') + '.png',
    });

  // Preview as a Student: no right answer on it, nothing to press.
  await tabTo(page, '[data-quiz-act="preview"]', true);
  await page.keyboard.press('Enter');
  await expect(page.locator('.quiz-preview')).toContainText('9. Which conclusion goes further than the data?');
  await shot(page, 'q2b-preview');
  await expect(page.locator('.quiz-preview input')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.quiz-preview')).toHaveCount(0);

  await tabTo(page, '.af-actions [data-action="saveNewAssess"]:not([data-draft])');
  await page.keyboard.press('Enter');
  await expect(page.locator('#new-assess-form')).toBeHidden();

  const kept = await page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.title === 'Data Patterns Check');
    return {
      a,
      work: getAssessmentStudentWork('sci8', a.id),
      quiz: QuizData.get('sci8', a.id),
      questionsStore: localStorage.getItem('gb-quizzes-sci8'),
    };
  });
  expect(kept.a.scoreMode).toBeUndefined(); // Competencies: proficiency work with no rubric
  expect(kept.work.students_send).toBe('nothing');
  expect(kept.quiz.questions).toHaveLength(10);
  kept.quiz.questions.forEach((q, i) => {
    const b = BOARD[i];
    expect(q.kind).toBe(KIND[b.kind]);
    expect(q.prompt).toBe(b.prompt);
    expect(q.points).toBe(b.points);
    expect(q.tag_id).toBe(b.tag);
    if (b.choices) {
      expect(q.choices.map(c => c.text)).toEqual(b.choices);
      expect(q.key.answer.slice().sort()).toEqual(b.right.map(r => q.choices[r].id).sort());
    }
    if (b.kind === 'True or False') expect(q.key.answer).toBe(false);
    if (b.kind === 'Number') expect(q.key).toEqual({ answer: 12.5, tolerance: 0.1, why: b.why });
  });
  // The key is not in the questions' store.
  expect(kept.questionsStore).not.toContain('Add the four trays');
  expect(kept.questionsStore).not.toContain('"answer"');
  expect(errors).toEqual([]);
});

test('a save with a Choice that has no right answer stops beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, true);
  await page.locator('[data-action="showNewForm"]').first().click();
  await page.locator('#af-title').fill('Quick Check');
  await page.locator('#af-category').selectOption({ label: 'Quizzes & Checks' });
  await page.locator('#af-comp-choose').click();
  await page.locator('.af-tag-cb[value="PA3"]').check();
  await page.locator('[data-action="closeCompPicker"]').click();
  const answer = page.locator('#quiz-mount [data-quiz-act="answer"][data-value="quiz"]');
  // Clear of the footer that stays at the bottom of the window.
  await answer.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await answer.click();
  await page.locator(open + ' .quiz-prompt').fill('Which axis?');
  await page
    .locator(open + ' .quiz-choice-text')
    .nth(0)
    .fill('Across');
  await page
    .locator(open + ' .quiz-choice-text')
    .nth(1)
    .fill('Up');
  const n = await page.evaluate(() => getAssessments('sci8').length);
  await page.locator('.af-actions [data-action="saveNewAssess"]:not([data-draft])').click();
  await expect(page.locator(open + ' .quiz-err')).toHaveText('Choose the right answer.');
  await expect(page.locator(open + ' .quiz-key').first()).toBeFocused();
  expect(await page.evaluate(() => getAssessments('sci8').length)).toBe(n);
  // Hidden at rest means hidden: no confirm is up.
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
});

test('the sample quiz opens on its Draft piece, with the board’s ten questions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, true);
  await page.evaluate(() =>
    document.querySelector('[data-action="editAssess"][data-aid="sci8-quiz-data-patterns"]').click(),
  );
  await expect(page.locator('#quiz-head')).toHaveText('Quiz · 10 Questions · 13 Points');
  await expect(page.locator('#quiz-mount [data-value="quiz"]')).toHaveAttribute('aria-checked', 'true');
  // A Delete on a question with words asks first, and its button is not under the click.
  await page.locator('.quiz-row').first().click();
  const del = page.locator(open + ' [data-action="quizDelete"]');
  const at = await del.boundingBox();
  await del.click();
  await expect(page.locator('#confirm-title')).toHaveText('Delete This Question?');
  const ok = await page.locator('#confirm-ok-btn').boundingBox();
  const cx = at.x + at.width / 2;
  const cy = at.y + at.height / 2;
  expect(cx >= ok.x && cx <= ok.x + ok.width && cy >= ok.y && cy <= ok.y + ok.height).toBe(false);
  await page.locator('#confirm-cancel-btn').click();
  await expect(page.locator('.quiz-row')).toHaveCount(9);
});

test('with the quizzes switch off the form is today’s: no fourth answer, no Quiz card, no quiz key', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await demo(page, false);
  await page.evaluate(() => setCourseSendWork('sci8', { send_work: true }));
  await page.goto('/assignments?course=sci8');
  await page.locator('[data-action="showNewForm"]').first().click();
  await expect(page.locator('#af-title')).toBeVisible();
  await expect(page.locator('[data-field="students_send"]')).toHaveText(['No', 'Yes, Photos', 'Yes, Photos or PDFs']);
  await expect(page.locator('#quiz-mount')).toHaveCount(0);
  await expect(page.locator('[data-aid="sci8-quiz-data-patterns"]')).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => /quiz/.test(k)));
  expect(keys).toEqual([]);
});
