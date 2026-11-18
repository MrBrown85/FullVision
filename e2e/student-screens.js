import { expect } from '@playwright/test';
import { resolve } from 'node:path';

/* Every student screen Demo Mode reaches, each with how to get there and a
   mark only that screen has (`marker`): a step that does not reach its
   screen fails, so a screen is never checked by mistake on the one before.
   Used by e2e/student-text-size-sweep.spec.js. The steps also work on the
   page before Settings (the class picker and the header's Log Out), so a
   copy of `main` can be photographed screen for screen beside this one.

   go(page, { base, desk, size }): base is '' under Playwright's own server;
   desk is true at Chromebook width; size is the Text Size to choose
   ('normal' chooses none). `gear` screens exist only with Settings.

   The sample class has bulletins, so the demo card opens on Bulletins
   (B1g); openDemo then presses Assignments, where every screen but the
   Bulletins ones starts, as it did before Bulletins. ctx.onBulletins
   leaves it there. */

const PHOTO = resolve('assets/sample-work/cell-lab-cece-1.jpg');

export async function openDemo(page, ctx, hash) {
  await page.goto('about:blank');
  await page.goto((ctx.base || '') + '/s/#' + hash);
  // No reflection's draft from the screen before: each screen starts fresh.
  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.locator('.sp-view').first().waitFor();
  if (!ctx.onBulletins && (await page.locator('.sp-tab-on[data-tab="bulletins"]').locator('visible=true').count()))
    await tab(page, 'assignments');
  if (ctx.size && ctx.size !== 'normal') {
    await page.locator('.sp-gear').click();
    await page.locator('.sp-set-size[data-size="' + ctx.size + '"]').click();
    await page.locator('.sp-set-done').click();
    await expect(page.locator('.sp-view.sp-text-' + ctx.size)).toBeVisible();
  }
}

const visible = (page, sel) => page.locator(sel).locator('visible=true').first();
const tab = (page, id) => visible(page, '.sp-tab[data-tab="' + id + '"]').click();

// Add Another Card: from Settings, or from the class picker before Settings.
async function openAddCard(page) {
  if (await page.locator('.sp-gear').count()) {
    await page.locator('.sp-gear').click();
    await page.locator('.sp-set [data-act="card-add"]').click();
  } else {
    await page.locator('.sp-head-switch').click();
    await page.locator('.sp-sheet [data-act="card-add"]').click();
  }
}

// A photo too soft to read: a flat grey page.
async function blurryJpeg(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#9a9a9a';
    g.fillRect(0, 0, 900, 1200);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

// A phone report's slip, answered here in the student-submit function's shapes.
async function mockReport(page) {
  await page.route('**/functions/v1/student-submit**', async route => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}');
    const replies = {
      card: { ok: false, error: 'not_found' },
      open: {
        ok: true,
        kind: 'report',
        token: 'c'.repeat(64),
        student: { first_name: 'Cece' },
        course: { name: 'Science 8', block: 'B' },
        report: { title: 'Report 1', expires_on: '2027-01-31' },
        has_birthday: true,
      },
      check: {
        ok: true,
        report: {
          name: 'Cece Okafor',
          first: 'Cece',
          course: 'Science 8',
          report: 'Report 1',
          overall: { mode: 'proficiency', text: '3.0', level: 3, word: 'Proficient' },
          comment: ['Cece is curious. She asks good questions in every lab and checks her work with a partner.'],
        },
      },
    };
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(replies[body.route]),
    });
  });
}

async function yourFeedback(p, c) {
  await openDemo(p, c, 'demo-card-send');
  await tab(p, 'learning');
  await p.locator('[data-act="feedback"]').locator('visible=true').nth(2).click();
}

async function sendWork(p, c) {
  await openDemo(p, c, 'demo-card-send');
  await p.getByRole('button', { name: 'Upcoming 1' }).click();
  if (c.desk) await p.locator('.sp-side-row', { hasText: 'Science Fair Proposal' }).click();
  await p
    .locator('.sp-piece', { hasText: 'Science Fair Proposal' })
    .getByRole('button', { name: 'Send My Work' })
    .click();
}

async function reflectCore(p, c) {
  await openDemo(p, c, 'demo-card-reflect');
  await tab(p, 'questionnaires');
  await visible(p, '[data-act="q-start"]').click();
}

export const SCREENS = [
  { name: 'assignments', marker: '.sp-deck', go: (p, c) => openDemo(p, c, 'demo-card') },
  {
    name: 'assignments, upcoming',
    marker: '.sp-segment[aria-pressed="true"][data-segment="upcoming"]',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await visible(p, '[data-act="segment"][data-segment="upcoming"]').click();
    },
  },
  { name: 'assignments, new work', marker: '.sp-deck', go: (p, c) => openDemo(p, c, 'demo-card-feed') },
  { name: 'assignments, revision', marker: '.sp-deck', go: (p, c) => openDemo(p, c, 'demo-card-revise') },
  { name: 'assignments, group', marker: '.sp-deck', go: (p, c) => openDemo(p, c, 'demo-card-group') },
  {
    name: 'carousel, page 2',
    marker: '.sp-car-track',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await visible(p, '.sp-car-track').evaluate(el => {
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = el.scrollWidth;
      });
    },
  },
  {
    name: 'a handout open',
    marker: '#sp-handout-title',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await visible(p, '.sp-car-slide').click();
    },
  },
  ...[
    ['my learning', 'demo-card'],
    ['my learning, letter and proficiency', 'demo-card-both'],
    ['my learning, letter', 'demo-card-letter'],
    ['my learning, group', 'demo-card-group'],
  ].map(([name, hash]) => ({
    name,
    marker: '.sp-ml-work',
    go: async (p, c) => {
      await openDemo(p, c, hash);
      await tab(p, 'learning');
    },
  })),
  { name: 'your feedback', marker: '#sp-fb-title', go: yourFeedback },
  {
    name: 'what the levels mean',
    phoneOnly: true, // a Chromebook shows them under Your Feedback, with no button
    marker: '.sp-fb-levels-btn[aria-expanded="true"]',
    go: async (p, c) => {
      await yourFeedback(p, c);
      await visible(p, '[data-act="levels"]').click();
    },
  },
  {
    name: 'the whole rubric',
    marker: '.sp-fb-whole',
    go: async (p, c) => {
      await yourFeedback(p, c);
      await visible(p, '[data-act="whole"]').click();
    },
  },
  {
    name: 'see your work',
    marker: '#sp-work-title',
    go: async (p, c) => {
      await yourFeedback(p, c);
      await visible(p, '[data-act="work"]').click();
    },
  },
  {
    name: 'before and after',
    marker: '.sp-ba-card',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card-revise');
      await tab(p, 'learning');
      await p.locator('[data-act="feedback"]').locator('visible=true').nth(1).click();
      await visible(p, '[data-act="compare"]').click();
    },
  },
  { name: 'send my work', marker: '.sp-send-head', go: sendWork },
  {
    name: 'send my work, a photo',
    marker: 'img[alt="Photo of page 1"]',
    go: async (p, c) => {
      await sendWork(p, c);
      await p.locator('input.sp-send-input:not([capture])').setInputFiles(PHOTO);
    },
  },
  {
    name: 'blurry photo',
    marker: '#sp-send-blurry-title',
    go: async (p, c) => {
      await sendWork(p, c);
      const buffer = await blurryJpeg(p);
      await p
        .locator('input.sp-send-input:not([capture])')
        .setInputFiles({ name: 'b.jpg', mimeType: 'image/jpeg', buffer });
    },
  },
  {
    name: 'unsend your work?',
    marker: '.sp-send-ask',
    go: async (p, c) => {
      await sendWork(p, c);
      await p.locator('input.sp-send-input:not([capture])').setInputFiles(PHOTO);
      await p.getByRole('button', { name: 'Send 1 Photo' }).click();
      await p.getByRole('button', { name: 'Back to My Work' }).click();
      await tab(p, 'learning');
      await p.locator('.sp-ml-work .sp-ml-row').first().click();
      await p.getByRole('button', { name: 'Unsend' }).click();
    },
  },
  {
    name: 'reflect',
    marker: '.sp-page-title',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await tab(p, 'questionnaires');
      await expect(visible(p, '.sp-page-title')).toHaveText('Reflect');
    },
  },
  { name: 'reflection, step 1', marker: '.sp-foot', go: reflectCore },
  {
    name: 'reflection, step 2',
    marker: '.sp-foot [data-act="send"]',
    go: async (p, c) => {
      await reflectCore(p, c);
      await visible(p, '[data-act="next"]').click();
    },
  },
  {
    name: 'reflect on feedback',
    marker: '.sp-reflect',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card-reflect');
      await tab(p, 'learning');
      await p.locator('[data-act="feedback"]').locator('visible=true').first().click();
      await visible(p, '[data-act="reflect-open"]').click();
    },
  },
  {
    name: 'add another card',
    marker: '.sp-card-add',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await openAddCard(p);
    },
  },
  {
    name: 'add another card, is this you',
    marker: '#sp-ident',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await openAddCard(p);
      await p.locator('#sp-code').fill('ABCD-EFGH');
      await p.getByRole('button', { name: 'Continue' }).click();
    },
  },
  {
    name: 'phone report',
    marker: '.pr-big',
    sized: false, // a slip's page: no Settings, so no Text Size
    go: async (p, c) => {
      await mockReport(p);
      await p.goto('about:blank');
      await p.goto((c.base || '') + '/s/#K7M-4QX');
      await p.getByLabel('Month').selectOption('5');
      await p.getByLabel('Day').selectOption('15');
      await p.getByLabel('Year').selectOption('2012');
      await p.getByRole('button', { name: 'Open My Report' }).click();
    },
  },
  {
    name: 'settings',
    gear: true,
    marker: '.sp-set',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await p.locator('.sp-gear').click();
    },
  },
  {
    name: 'settings, two classes',
    gear: true,
    marker: '.sp-set .sp-class',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await openAddCard(p);
      await p.locator('#sp-code').fill('ABCD-EFGH');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByLabel('Student Number').fill('1234567');
      await p.getByRole('button', { name: 'Yes, That’s Me' }).click();
      await p.locator('.sp-gear').click();
    },
  },
  {
    name: 'log out?',
    gear: true,
    marker: '.sp-logout',
    go: async (p, c) => {
      await openDemo(p, c, 'demo-card');
      await p.locator('.sp-gear').click();
      await p.locator('.sp-set-out').click();
    },
  },
];

/* Bulletins (docs/plans/bulletins-plan.md B1d; on since B1g): the demo card
   opens on them. They come last, and a copy of `main` from before Bulletins
   has none of them (`bulletins`). */
async function bulletinsDemo(p, c) {
  await openDemo(p, Object.assign({}, c, { onBulletins: true }), 'demo-card');
  await expect(p.locator('.sp-tab-on[data-tab="bulletins"]').locator('visible=true')).toBeVisible();
}

SCREENS.push(
  { name: 'bulletins, the new line', bulletins: true, marker: '#sp-bulletin-new', go: bulletinsDemo },
  {
    name: 'bulletins, a file’s pages',
    bulletins: true,
    marker: '.sp-bulletin-file-pdf .sp-bulletin-file-count',
    go: async (p, c) => {
      await bulletinsDemo(p, c);
      const track = p.locator('.sp-bulletin-file-pdf .sp-bulletin-file-track');
      await track.scrollIntoViewIfNeeded();
      await track.evaluate(el => el.scrollTo({ left: el.clientWidth, behavior: 'auto' }));
      await expect(p.locator('.sp-bulletin-file-pdf .sp-bulletin-file-count')).toHaveText('2 / 2');
    },
  },
  {
    name: 'bulletins, a page full size',
    bulletins: true,
    marker: '.sp-bulletin-viewer-img',
    go: async (p, c) => {
      await bulletinsDemo(p, c);
      await p.locator('.sp-bulletin-file-pdf .sp-bulletin-file-slide[data-page="0"]').click();
    },
  },
  {
    name: 'bulletins, the link question',
    bulletins: true,
    marker: '.sp-bulletin-ask',
    go: async (p, c) => {
      await bulletinsDemo(p, c);
      await p.locator('.sp-bulletin-link').click();
    },
  },
  {
    name: 'bulletins, the reminder bar',
    bulletins: true,
    marker: '.sp-bulletin-reminder',
    go: async (p, c) => {
      await bulletinsDemo(p, c);
      await p.locator('.sp-bulletin-pinbar').click();
      await expect(p.locator('.sp-bulletin-pinbar')).toBeInViewport();
      await expect(p.locator('.sp-bulletin-reminder')).toBeInViewport();
    },
  },
);

/* A quiz (docs/plans/quizzes-plan.md Q3b), behind the `quizzes` build switch: the sample
   quiz in Demo Mode, in every state a student sees it. A copy of `main` has none (`quizzes`). */
async function quizDemo(p, c) {
  await p.goto('about:blank');
  await p.goto((c.base || '') + '/s/');
  await p.evaluate(() => {
    localStorage.setItem('fv-build-quizzes', '1');
    // The sample's progress is kept on the device: each screen starts from a first try.
    localStorage.removeItem('gb-student-quiz-demo');
  });
  await openDemo(p, c, 'demo-card');
  await p.locator('[data-act="quiz-open"]').locator('visible=true').first().click();
  await expect(p.locator('.sp-quiz-q').first()).toBeVisible();
}
// One question answered, whatever its kind (the order is each try's own shuffle).
async function quizAnswer(q) {
  if (await q.locator('input[data-kind="number"]').count()) await q.locator('input').fill('10');
  else if (await q.locator('textarea').count()) await q.locator('textarea').fill('The line goes up each week.');
  else await q.locator('[data-act="quiz-pick"]').first().click();
}
async function quizAnswerAll(p) {
  for (const q of await p.locator('.sp-quiz-q').all()) await quizAnswer(q);
}
SCREENS.push(
  { name: 'quiz, taking it', quizzes: true, marker: '.sp-quiz-progress', go: quizDemo },
  {
    name: 'quiz, send check with questions left',
    quizzes: true,
    marker: '.sp-quiz-todo-list',
    go: async (p, c) => {
      await quizDemo(p, c);
      await p.locator('[data-act="quiz-send-ask"]').click();
    },
  },
  {
    name: 'quiz, ready to send',
    quizzes: true,
    marker: '.sp-quiz-check .sp-quiz-actions',
    go: async (p, c) => {
      await quizDemo(p, c);
      await quizAnswerAll(p);
      await p.locator('[data-act="quiz-send-ask"]').click();
    },
  },
  {
    name: 'quiz, sent',
    quizzes: true,
    marker: '#sp-quiz-sent',
    go: async (p, c) => {
      await quizDemo(p, c);
      await quizAnswerAll(p);
      await p.locator('[data-act="quiz-send-ask"]').click();
      await p.locator('[data-act="quiz-send"]').click();
    },
  },
  {
    name: 'quiz, pick up where you left off',
    quizzes: true,
    marker: '#sp-quiz-resume',
    go: async (p, c) => {
      await quizDemo(p, c);
      await quizAnswer(p.locator('.sp-quiz-q').first());
      await p.locator('[data-act="quiz-back"]').click();
      await p.locator('[data-act="quiz-open"]').locator('visible=true').first().click();
    },
  },
);

// Go to `screen` and wait for its mark, and for motion (sheets slide in for about 220 ms).
export async function reach(page, screen, ctx) {
  await screen.go(page, ctx);
  await expect(page.locator(screen.marker).locator('visible=true').first()).toBeVisible();
  await page.waitForTimeout(350);
}
