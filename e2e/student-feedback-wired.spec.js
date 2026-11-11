import { test, expect } from '@playwright/test';
import { PHONE, TODAY, serve } from './student-card-fake.js';
import { CECE, WORK, fakeStudentSubmit, sampleCard } from '../tests/helpers/fake-student-submit.js';

/* Reflect on Feedback from a real card (S10-W1), on a phone, against the
   built site with the live site's CSP: the student-submit function answered
   by its own handler over a stand-in database. Send Work and Reflect on
   Feedback are on; Energy Transfer Investigation came back with a result.
   Cece reflects: the page asked `feedback` once after `work`, `reflect`
   carries the session and her enrollment, and the screen shows Reflection
   Sent with her plan. */

test.use(PHONE);

test('a real card reflects on returned work through the server', async ({ page }) => {
  const fn = fakeStudentSubmit({
    cards: [sampleCard(TODAY)],
    sendWork: { [WORK.energy]: { students_send: 'photos', open: true } },
  });
  fn.state.feedback = {
    ok: true,
    v: 1,
    reflect_on_feedback: true,
    show_my_learning: false,
    assessments: [],
    last_plan: null,
  };
  const posts = await serve(page, fn);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/s/#P3R8-WDK4');
  await page.getByLabel('Student Number').fill('0123456');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.locator('[data-segment="back"]').click();
  await page.locator('.sp-piece[data-piece="' + WORK.energy + '"] [data-act="feedback"]').click();
  await page.locator('[data-act="reflect-open"]').click();
  await page.locator('[data-act="reflect-sense"][data-value="yes"]').click();
  await page.locator('#sp-reflect-plan').fill('Next time I’ll label every part first.');
  await page.locator('[data-act="reflect-send"]').click();
  await expect(page.locator('#sp-reflect-title')).toHaveText('Reflection Sent');
  await expect(page.locator('.sp-reflect-plan .sp-plan-words')).toHaveText('Next time I’ll label every part first.');

  const routes = posts.map(p => p.body.route);
  expect(routes.filter(r => r === 'feedback')).toHaveLength(1);
  expect(routes.indexOf('feedback')).toBeGreaterThan(routes.indexOf('work'));
  const sent = posts.find(p => p.body.route === 'reflect').body;
  expect(sent).toMatchObject({
    enrollment_id: CECE,
    assessment_id: WORK.energy,
    reflection: { makes_sense: 'yes', plan: 'Next time I’ll label every part first.' },
  });
  expect(sent.session).toMatch(/\S/);
  // The session is in the body only, never in an address.
  posts.forEach(p => expect(p.url).not.toContain(sent.session));
  expect(errors).toEqual([]);
});
