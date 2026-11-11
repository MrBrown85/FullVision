import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { PHONE, CHROMEBOOK, fits, named, contrast, shot } from './student-card-fake.js';
import { pagesPdf, lockedPdf } from '../tests/fixtures/pdf-fixtures.mjs';

/* Sending work from the student's page (S5-F2, S5-F3), in Demo Mode with
   Send Work on (#demo-card-send), against the built site with the live
   site's CSP: a real JPEG chosen, shrunk in the browser by
   shared/photo-shrink.js (fetched only when the send opens), shown from a
   blob: address, sent, and Unsend. Nothing leaves the browser. */

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
  await page.goto('/s/#demo-card-send');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  return { posts, errors };
}

for (const [where, device] of [
  ['on a phone', PHONE],
  ['on a Chromebook', CHROMEBOOK],
]) {
  test.describe(where, () => {
    test.use(device);

    test('Send My Work: a photo chosen, shrunk, shown, sent; then Unsend puts it back', async ({ page }) => {
      const { posts, errors } = await demo(page);
      const tag = where === 'on a phone' ? 'phone' : 'chromebook';
      const fair = page.locator('.sp-piece', { hasText: 'Science Fair Proposal' });
      if (tag === 'chromebook') await page.locator('.sp-side-row', { hasText: 'Science Fair Proposal' }).click();
      await fair.getByRole('button', { name: 'Send My Work' }).click();
      await expect(page.getByRole('heading', { name: 'Check and Send' })).toBeVisible();
      await fits(page);
      await named(page);
      await shot(page, tag + '-s5f2-check-empty');
      await page.locator('input.sp-send-input:not([capture])').setInputFiles(PHOTO);
      await expect(page.getByRole('button', { name: 'Send 1 Photo' })).toBeEnabled();
      const img = page.getByRole('img', { name: 'Photo of page 1' });
      await expect(img).toBeVisible();
      expect(await img.evaluate(el => el.src.startsWith('blob:') && el.naturalWidth > 0)).toBe(true);
      await page.getByLabel('Note for Your Teacher').fill('Page 2 has my answers.');
      await fits(page);
      await contrast(page);
      await shot(page, tag + '-s5f2-check-and-send');
      await page.getByRole('button', { name: 'Send 1 Photo' }).click();
      await expect(page.getByRole('heading', { name: 'Sent to Your Teacher' })).toBeVisible();
      await shot(page, tag + '-s5f2-sent');
      await page.getByRole('button', { name: 'Back to My Work' }).click();
      await page.getByRole('button', { name: 'Sent 1' }).click();
      await expect(page.getByText('Your teacher hasn’t started grading it. You can still change it.')).toBeVisible();
      await shot(page, tag + '-s5f3-sent-card');
      await page.getByRole('button', { name: 'Unsend' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Unsend Your Work?' })).toBeVisible();
      await shot(page, tag + '-s5f3-unsend');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Unsend' }).click();
      await expect(page.getByRole('button', { name: 'Sent 0' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('on a phone, late and closed', () => {
  test.use(PHONE);

  test('a piece past its due date says it will be marked Late; a closed piece says to hand it in on paper', async ({
    page,
  }) => {
    const { posts } = await demo(page);
    await expect(page.getByText('Hand this one in on paper')).toHaveCount(1);
    const poster = page.locator('.sp-piece', { hasText: 'Disease Research Poster' });
    await poster.getByRole('button', { name: 'Send My Work' }).click();
    await expect(page.getByText('This will be marked Late.')).toBeVisible();
    await page.locator('input.sp-send-input:not([capture])').setInputFiles(PHOTO);
    await expect(page.getByRole('button', { name: 'Send Late' })).toBeEnabled();
    await shot(page, 'phone-s5f2-sending-late');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.locator('.sp-piece', { hasText: 'Immune System Quick Check' }).scrollIntoViewIfNeeded();
    expect(posts).toEqual([]);
  });
});

test.describe('on a Chromebook, a PDF', () => {
  test.use(CHROMEBOOK);

  test('a two-page PDF becomes two pages; pdf.js is fetched only once a PDF is chosen; a locked PDF says so', async ({
    page,
  }) => {
    const pdfjs = [];
    page.on('request', req => {
      if (/\/vendor\/pdfjs\//.test(req.url())) pdfjs.push(req.url());
    });
    const { posts, errors } = await demo(page);
    await page.locator('.sp-side-row', { hasText: 'Science Fair Proposal' }).click();
    await page
      .locator('.sp-piece', { hasText: 'Science Fair Proposal' })
      .getByRole('button', { name: 'Send My Work' })
      .click();
    await expect(page.getByRole('heading', { name: 'Check and Send' })).toBeVisible();
    await page
      .locator('input.sp-send-input:not([capture])')
      .setInputFiles({ name: 'work.jpg', mimeType: 'image/jpeg', buffer: readFileSync(PHOTO) });
    await expect(page.getByRole('button', { name: 'Send 1 Photo' })).toBeEnabled();
    expect(pdfjs).toEqual([]);
    await page
      .locator('input.sp-send-input')
      .setInputFiles({ name: 'two.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pagesPdf(2)) });
    await expect(page.getByRole('button', { name: 'Send 3 Photos' })).toBeEnabled({ timeout: 20000 });
    expect(pdfjs.length).toBeGreaterThan(0);
    await page
      .locator('input.sp-send-input')
      .setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: Buffer.from(lockedPdf()) });
    await expect(page.getByText('This PDF has a password. Save a copy without one, then choose it here.')).toBeVisible({
      timeout: 20000,
    });
    expect(posts).toEqual([]);
    expect(errors).toEqual([]);
  });
});
