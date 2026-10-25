import { test, expect } from '@playwright/test';

/* The student phone page, /s/ (docs/STUDENT-VOICE-PLAN.md, PR 7), at
   phone size against the built site. The student-submit function is
   mocked: a scanned slip opens, the student answers both pages with taps
   and typing, and Send posts the answers to ca-central-1. Demo Mode makes
   no request at all. */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const OPEN = {
  ok: true,
  token: 'a'.repeat(64),
  student: { first_name: 'Cece' },
  course: { name: 'Science 8', block: 'B' },
  context: { course_goal: { text: 'Hand in labs on time.', at: '2026-09-15T12:00:00Z' } },
  parts: [
    {
      id: 'p1',
      kind: 'core_reflection',
      title: 'November Reflection',
      theme: 'Self-Awareness and Goal Setting',
      grade: 8,
      questions: [
        {
          id: '11111111-0000-4000-8000-000000000001',
          kind: 'short_set',
          prompt: 'My Personal Shield: write one word or symbol for each.',
          options: { labels: ['A strength', 'An interest', 'A goal', 'Something that is me'] },
          core_ids: [],
        },
        {
          id: '11111111-0000-4000-8000-000000000003',
          kind: 'scale4',
          prompt: 'How confident do you feel?',
          options: {},
          core_ids: ['PAR', 'PPI'],
        },
      ],
    },
    {
      id: 'p2',
      kind: 'goal_checkin',
      title: 'Goal Check-In',
      questions: [
        {
          id: '22222222-0000-4000-8000-000000000001',
          kind: 'goal_status',
          prompt: 'How is your goal going?',
          options: { choices: ['Not Started', 'Working On It', 'Mostly There', 'Done'] },
          core_ids: [],
        },
        {
          id: '22222222-0000-4000-8000-000000000002',
          kind: 'text',
          prompt: 'What will you do next?',
          options: {},
          core_ids: [],
        },
      ],
    },
  ],
};

async function mockFunction(page) {
  const posts = [];
  await page.route('**/functions/v1/student-submit**', async route => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}');
    posts.push({ url: req.url(), body });
    const reply = body.route === 'open' ? OPEN : { ok: true, submitted_at: '2026-11-04T10:00:00Z' };
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(reply),
    });
  });
  return posts;
}

test('a scanned slip opens, both pages are answered, and Send posts to ca-central-1', async ({ page }) => {
  const posts = await mockFunction(page);
  await page.goto('/s/#K7M-4QX');
  await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
  await expect(page.locator('.sp-head-title')).toHaveText('Science 8 · Block B');
  expect(posts[0].url).toContain('forceFunctionRegion=ca-central-1');
  expect(posts[0].body).toEqual({ route: 'open', code: 'K7M4QX' });

  await page.getByRole('button', { name: 'Yes, Start' }).tap();
  await page.getByLabel('A strength').fill('Curious');
  await page
    .getByRole('radiogroup', { name: 'Personal Awareness & Responsibility' })
    .getByRole('radio', { name: 'Growing' })
    .tap();
  await page.locator('textarea[data-core="PAR"]').fill('I set goals but forget to check them.');
  await expect(page.locator('#sp-count')).toHaveText('2 of 4 answered');

  await page.getByRole('button', { name: 'Next: My Goals' }).tap();
  await expect(page.getByRole('heading', { name: 'My Science 8 Goal' })).toBeVisible();
  await expect(page.getByText('Hand in labs on time.')).toBeVisible();
  await page.getByRole('radio', { name: 'Working On It' }).tap();
  await page.getByLabel('What will you do next?').fill('Ask for the lab sheet a day early.');

  await page.getByRole('button', { name: 'Send to My Teacher' }).tap();
  await expect(page.getByRole('heading', { name: 'Sent to Your Teacher' })).toBeVisible();
  const submit = posts.find(p => p.body.route === 'submit');
  expect(submit.body.token).toBe('a'.repeat(64));
  expect(submit.body.answers).toEqual({
    '11111111-0000-4000-8000-000000000001': ['Curious', '', '', ''],
    '11111111-0000-4000-8000-000000000003': {
      levels: { PAR: 2 },
      why: { PAR: 'I set goals but forget to check them.' },
    },
    '22222222-0000-4000-8000-000000000001': 'Working On It',
    '22222222-0000-4000-8000-000000000002': 'Ask for the lab sheet a day early.',
  });
  // The code leaves the address once it's used.
  await expect(page).toHaveURL(/\/s\/$/);
});

test('the page fits a phone: no sideways scroll, Send stays in reach', async ({ page }) => {
  await mockFunction(page);
  await page.goto('/s/#K7M-4QX');
  await page.getByRole('button', { name: 'Yes, Start' }).tap();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide).toBeLessThanOrEqual(0);
  const foot = await page.locator('.sp-foot').boundingBox();
  expect(foot.y + foot.height).toBeLessThanOrEqual(812);
});

test('Demo Mode answers About Me with no request', async ({ page }) => {
  const posts = await mockFunction(page);
  await page.goto('/s/#demo-about');
  await page.getByRole('button', { name: 'Yes, Start' }).tap();
  await expect(page.getByText('Only your teacher sees this')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).tap();
  await page.getByRole('button', { name: '+ Another' }).tap();
  await page.getByLabel('Another answer').fill('Igbo');
  await page.getByRole('button', { name: 'Add', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Igbo' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Send to My Teacher' }).tap();
  await expect(page.getByText('This was Demo Mode. Nothing was sent.')).toBeVisible();
  expect(posts).toHaveLength(0);
});

test('a report slip: birthday, the report as sent, a reply', async ({ page }) => {
  const posts = [];
  await page.route('**/functions/v1/student-submit**', async route => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}');
    posts.push(body);
    const replies = {
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
          comment: ['Cece is curious.'],
        },
        reply: {
          id: 'rq',
          kind: 'report_reply',
          title: 'Reply to Report 1',
          questions: [
            {
              id: '44444444-0000-4000-8000-000000000001',
              kind: 'text',
              prompt: 'What are you most proud of?',
              options: {},
              core_ids: [],
            },
          ],
        },
        replied_at: null,
      },
      submit: { ok: true, submitted_at: '2026-11-22T18:00:00Z' },
    };
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(replies[body.route]),
    });
  });
  await page.goto('/s/#K7M-4QX');
  await expect(page.getByRole('heading', { name: 'Your report is ready, Cece' })).toBeVisible();
  await page.getByLabel('Month').selectOption('5');
  await page.getByLabel('Day').selectOption('15');
  await page.getByLabel('Year').selectOption('2012');
  await page.getByRole('button', { name: 'Open My Report' }).tap();
  await expect(page.locator('.pr-big')).toHaveText('Proficient');
  expect(posts[1]).toEqual({ route: 'check', token: 'c'.repeat(64), birthday: '2012-05-15' });
  await page.getByRole('button', { name: 'Reply to Your Report' }).tap();
  await page.getByLabel('What are you most proud of?').fill('my biodiversity journal');
  await page.getByRole('button', { name: 'Send to My Teacher' }).tap();
  await expect(page.getByText('Your next step is saved with your goal.')).toBeVisible();
  expect(posts[2].answers).toEqual({ '44444444-0000-4000-8000-000000000001': 'my biodiversity journal' });
  await page.getByRole('button', { name: 'Back to My Report' }).tap();
  await expect(page.getByText('You replied on Nov 22. Thanks.')).toBeVisible();
});
