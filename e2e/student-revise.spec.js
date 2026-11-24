import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { PHONE, CHROMEBOOK, fits, named, shot } from './student-card-fake.js';

/* Revisions on the student's page (S11-F2), in Demo Mode (#demo-card-revise:
   Send Work on, a class graded by both), against the built site with the
   live site's CSP: Needs Revision on the card, Send My Revision with a real
   JPEG, Sent on My Learning, Unsend; then Before and After on the revision already
   returned, with the board's Proficient − · 67% and Proficient · 75%. Nothing leaves the
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
  // The sample class has bulletins, so the page opens on them (B1g); Assignments is the next tab.
  await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
  // Outstanding: Cell Microscope Lab (Needs Revision), Immune System Quick Check (missing), Disease Research Poster (past due).
  await expect(page.getByRole('button', { name: 'Outstanding 4' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upcoming 1' })).toBeVisible();
  return { posts, errors };
}

for (const [where, device] of [
  ['on a phone', PHONE],
  ['on a Chromebook', CHROMEBOOK],
]) {
  test.describe(where, () => {
    test.use(device);

    test('Needs Revision first in Outstanding; Send My Revision; Sent on My Learning; Unsend puts it back', async ({
      page,
    }) => {
      const { posts, errors } = await demo(page);
      const tag = where === 'on a phone' ? 'phone' : 'chromebook';
      // A revision asked for is the first card of Outstanding (picked on a Chromebook).
      const lab = page.locator('.sp-deck .sp-piece', { hasText: 'Cell Microscope Lab' });
      await expect(page.locator('.sp-deck .sp-piece').first()).toContainText('Cell Microscope Lab');
      if (tag === 'chromebook') {
        await expect(page.locator('.sp-side-row').first()).toContainText('Cell Microscope Lab');
        await expect(page.locator('.sp-side-row').first()).toHaveAttribute('aria-pressed', 'true');
      }
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
      // The revision sent leaves Outstanding and is the first row of My Learning's Your Work.
      await expect(page.getByRole('button', { name: 'Outstanding 3' })).toBeVisible();
      await page.getByRole('button', { name: /^My Learning/ }).click();
      const row = page.locator('.sp-ml-work .sp-ml-row').first();
      await expect(row).toContainText('Cell Microscope Lab');
      await expect(row.locator('.sp-row-sub')).toHaveText(
        /^Sent \w{3} \d{1,2}, \d{1,2}:\d\d [ap]\.m\. · waiting for feedback$/,
      );
      await expect(row.locator('.sp-level')).toHaveText('Sent');
      await row.click();
      const sent = page.locator('.sp-deck .sp-piece', { hasText: 'Cell Microscope Lab' });
      await expect(sent.getByText('Your teacher hasn’t started grading it. You can still change it.')).toBeVisible();
      await shot(page, tag + '-s11f2-revision-sent');
      await sent.getByRole('button', { name: 'Unsend' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Unsend' }).click();
      // Unsent: the page goes to its card, Needs Revision again, first in Outstanding, its title focused.
      await expect(page.getByRole('button', { name: 'Outstanding 4' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.sp-deck .sp-piece').first().locator('.sp-flag-revise')).toHaveText(/^Revise by /);
      await expect(lab.locator('.sp-piece-title')).toBeFocused();
      await expect(lab.getByRole('button', { name: 'Send My Revision' })).toBeVisible();
      // And it is off My Learning.
      await page.getByRole('button', { name: /^My Learning/ }).click();
      await expect(page.locator('.sp-ml-row', { hasText: 'Cell Microscope Lab' })).toHaveCount(0);
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });

    // Before and After opens from the returned revision's Your Feedback, reached from its My Learning row.
    test('Before and After on the revision returned: Proficient − · 67% and Proficient · 75%', async ({ page }) => {
      const { posts, errors } = await demo(page);
      const tag = where === 'on a phone' ? 'phone' : 'chromebook';
      await page.getByRole('button', { name: /^My Learning/ }).click();
      await page.locator('.sp-ml-row', { hasText: 'How Vaccines Work' }).click();
      await page.getByRole('button', { name: 'Before and After' }).click();
      await expect(page.getByRole('heading', { name: 'Before and After' })).toBeVisible();
      const result = page.locator('.sp-ba-result');
      // The proficiency and the %, no figure out of 4 (DECISIONS, "Student-facing levels are proficiencies").
      await expect(result).toContainText('Proficient − · 67%');
      await expect(result).toContainText('Proficient · 75%');
      await expect(page.getByRole('img', { name: 'First Version, page 1' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Your Revision, page 1' })).toBeVisible();
      await expect(page.getByText('Your Teacher Asked')).toBeVisible();
      await expect(page.getByText('Rivera')).toHaveCount(0);
      await fits(page);
      await named(page);
      await shot(page, tag + '-s11f2-before-and-after');
      await page.locator('.sp-ba').getByRole('button', { name: 'See Your Feedback' }).click();
      await expect(page.locator('.sp-ba')).toHaveCount(0);
      await expect(page.locator('.sp-fb-big')).toHaveText('Proficient · 75%');
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
