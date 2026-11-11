import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { PHONE, CHROMEBOOK, fits, named, shot } from './student-card-fake.js';

/* Revisions on the student's page (S11-F2), in Demo Mode (#demo-card-revise:
   Send Work on, a class graded by both), against the built site with the
   live site's CSP: Needs Revision on the card, Send My Revision with a real
   JPEG, Sent again, Unsend; then Before and After on the revision already
   returned, with the board's 2.7 · 67% and 3.0 · 75%. Nothing leaves the
   browser. */

const PHOTO = resolve('assets/sample-work/cell-lab-cece-1.jpg');

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
  await page.goto('/s/#demo-card-revise');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 4' })).toBeVisible();
  return { posts, errors };
}

for (const [where, device] of [
  ['on a phone', PHONE],
  ['on a Chromebook', CHROMEBOOK],
]) {
  test.describe(where, () => {
    test.use(device);

    test('Needs Revision, Send My Revision, Unsend; Before and After with 2.7 · 67% and 3.0 · 75%', async ({
      page,
    }) => {
      const { posts, errors } = await demo(page);
      const tag = where === 'on a phone' ? 'phone' : 'chromebook';
      const lab = page.locator('.sp-deck .sp-piece', { hasText: 'Cell Microscope Lab' });
      if (tag === 'chromebook') await page.locator('.sp-side-row', { hasText: 'Cell Microscope Lab' }).click();
      else await lab.scrollIntoViewIfNeeded();
      await expect(lab.locator('.sp-flag-revise')).toHaveText(/^Revise by /);
      await expect(lab.getByText('Write the magnification beside each drawing, then send it again.')).toBeVisible();
      await expect(lab.getByRole('img', { name: 'First version, page 1' })).toBeVisible();
      await fits(page);
      await named(page);
      await shot(page, tag + '-s11f2-needs-revision');

      await lab.getByRole('button', { name: 'Send My Revision' }).click();
      await expect(page.getByRole('heading', { name: 'Check and Send' })).toBeVisible();
      await page.locator('input.sp-send-input:not([capture])').setInputFiles(PHOTO);
      await expect(page.getByRole('button', { name: 'Send 1 Photo' })).toBeEnabled();
      await page.getByLabel('Note for Your Teacher').fill('I wrote 400x beside each drawing.');
      await page.getByRole('button', { name: 'Send 1 Photo' }).click();
      await expect(page.getByRole('heading', { name: 'Sent to Your Teacher' })).toBeVisible();
      await page.getByRole('button', { name: 'Back to My Work' }).click();
      await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
      await page.getByRole('button', { name: 'Sent 1' }).click();
      const sent = page.locator('.sp-deck .sp-piece', { hasText: 'Cell Microscope Lab' });
      await expect(sent.getByText('Your teacher hasn’t started grading it. You can still change it.')).toBeVisible();
      await shot(page, tag + '-s11f2-revision-sent');
      await sent.getByRole('button', { name: 'Unsend' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Unsend' }).click();
      await expect(page.getByRole('button', { name: 'To Do 4' })).toBeVisible();

      await page.getByRole('button', { name: /^Back \d/ }).click();
      if (tag === 'chromebook') await page.locator('.sp-side-row', { hasText: 'How Vaccines Work' }).click();
      const vaccine = page.locator('.sp-deck .sp-piece', { hasText: 'How Vaccines Work' });
      if (tag === 'phone') await vaccine.scrollIntoViewIfNeeded();
      await vaccine.getByRole('button', { name: 'Before and After' }).click();
      await expect(page.getByRole('heading', { name: 'Before and After' })).toBeVisible();
      const result = page.locator('.sp-ba-result');
      await expect(result).toContainText('2.7 · 67%');
      await expect(result).toContainText('3.0 · 75%');
      await expect(page.getByRole('img', { name: 'First Version, page 1' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Your Revision, page 1' })).toBeVisible();
      await expect(page.getByText('Your Teacher Asked')).toBeVisible();
      await expect(page.getByText('Rivera')).toHaveCount(0);
      await fits(page);
      await named(page);
      await shot(page, tag + '-s11f2-before-and-after');
      await page.locator('.sp-ba').getByRole('button', { name: 'See Your Feedback' }).click();
      await expect(page.locator('.sp-ba')).toHaveCount(0);
      await expect(page.locator('.sp-fb-big')).toHaveText('Proficient');
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
