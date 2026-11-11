import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* Reflect on Feedback (S10-F1 and S10-F2), in Demo Mode with Send Work and
   Reflect on Feedback on (#demo-card-reflect), against the built site with
   the live site's CSP: the three steps and Reflection Sent, the teacher's
   answer, the plan on the next piece, and Did You Do It? on Check and
   Send. Nothing leaves the browser. */

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/s/#demo-card-reflect');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  return { posts, errors };
}

async function showCard(page, title) {
  if (await page.locator('.sp-side').isVisible()) {
    await page.locator('.sp-side-row', { hasText: title }).click();
  } else {
    await page.locator('.sp-deck').evaluate((d, t) => {
      const card = [...d.querySelectorAll('.sp-piece')].find(c => c.textContent.includes(t));
      d.scrollTo({ left: card.offsetLeft - d.offsetLeft, behavior: 'auto' });
    }, title);
  }
}

async function openFeedback(page, title) {
  await page.getByRole('button', { name: /^Back \d+$/ }).click();
  await showCard(page, title);
  await page.locator('.sp-piece', { hasText: title }).getByRole('button', { name: 'See Your Feedback' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeFocused();
}

for (const [where, device] of [
  ['on a phone', PHONE],
  ['on a Chromebook', CHROMEBOOK],
]) {
  test.describe(where, () => {
    test.use(device);

    test('Reflect on Feedback: Yes, a plan, Reflection Sent; the plan is on the next piece', async ({ page }) => {
      const { posts, errors } = await demo(page);
      await openFeedback(page, 'Cell Microscope Lab');
      await page.getByRole('button', { name: 'Reflect on Feedback' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Reflect on Feedback' })).toBeFocused();
      const sense = page.getByRole('radiogroup', { name: 'Does the feedback make sense?' });
      await sense.getByRole('radio', { name: 'Yes' }).click();
      await expect(sense.getByRole('radio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('button', { name: 'Next time I’ll…' }).click();
      const plan = page.getByLabel('What will you do next time?');
      await expect(plan).toBeFocused();
      await plan.pressSequentially('label every part before I colour it.');
      await fits(page);
      await named(page);
      await contrast(page);
      await page.getByRole('button', { name: 'Send Reflection' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Reflection Sent' })).toBeFocused();
      await expect(page.getByText('Next time I’ll label every part before I colour it.')).toBeVisible();
      await page.getByRole('button', { name: 'Done', exact: true }).last().click();
      await expect(page.getByRole('button', { name: 'Your Reflection' })).toBeFocused();
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('the teacher answered; Does It Make Sense Now? Yes', async ({ page }) => {
      const { posts, errors } = await demo(page);
      await openFeedback(page, 'Energy Transfer Investigation');
      await page.getByRole('button', { name: 'Ms. Rivera Answered' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Ms. Rivera Answered' })).toBeFocused();
      await expect(
        page.getByText('A pattern is what keeps happening across your whole table.', { exact: false }),
      ).toBeVisible();
      await fits(page);
      await named(page);
      await contrast(page);
      await page
        .getByRole('radiogroup', { name: 'Does it make sense now?' })
        .getByRole('radio', { name: 'Yes' })
        .click();
      await expect(page.getByText('Then make your plan for next time.')).toBeVisible();
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('Check and Send asks Did You Do It? under the plan', async ({ page }) => {
      const { errors } = await demo(page);
      await showCard(page, 'Science Fair Proposal');
      const card = page.locator('.sp-piece', { hasText: 'Science Fair Proposal' });
      await expect(card.getByRole('heading', { name: 'Your Plan From Last Time' })).toBeVisible();
      await card.getByRole('button', { name: 'Send My Work' }).click();
      const ask = page.getByRole('radiogroup', { name: 'Did you follow your plan?' });
      await expect(ask.getByRole('radio')).toHaveText(['Yes', 'Partly', 'Not This Time']);
      await ask.getByRole('radio', { name: 'Partly' }).click();
      await expect(ask.getByRole('radio', { name: 'Partly' })).toHaveAttribute('aria-checked', 'true');
      await fits(page);
      await contrast(page);
      expect(errors).toEqual([]);
    });
  });
}
