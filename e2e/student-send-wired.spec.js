import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { PHONE, KEY, TODAY, serve, fits, stored } from './student-card-fake.js';
import { WORK, fakeStudentSubmit, sampleCard } from '../tests/helpers/fake-student-submit.js';

/* Sending work from a real card (S5-W1), on a phone, against the built
   site with the live site's CSP: the student-submit function answered by
   its own handler and send routes over a stand-in database and bucket
   (tests/helpers/fake-student-submit.js with fake-send-world.js), and the
   bucket's upload and download links served here at the Supabase address.
   A real JPEG is chosen, shrunk in the browser, put to its upload links,
   read and checked by the route, handed in, shown again from blob:
   addresses, then unsent. */

const PHOTO = resolve('assets/sample-work/cell-lab-cece-1.jpg');
const STORAGE = 'https://e2e-test.supabase.co/storage/v1';
const STORAGE_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
};

test.use(PHONE);

test('a real card sends a photo, sees it Sent from its own pages, and unsends it', async ({ page }) => {
  const fn = fakeStudentSubmit({
    cards: [sampleCard(TODAY)],
    sendWork: { [WORK.fair]: { students_send: 'photos_files', open: true } },
    storeBase: STORAGE,
  });
  const posts = await serve(page, fn);
  const uploads = [];
  await page.route(STORAGE + '/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: STORAGE_CORS });
    if (req.method() === 'PUT') {
      uploads.push(req.headers()['content-type']);
      const status = fn.world.phoneUpload(
        req.url(),
        new Uint8Array(req.postDataBuffer()),
        req.headers()['content-type'],
      );
      return route.fulfill({ status, headers: { ...STORAGE_CORS, 'content-type': 'application/json' }, body: '{}' });
    }
    const got = fn.world.phoneDownload(req.url());
    return route.fulfill({
      status: got.status,
      headers: { ...STORAGE_CORS, 'content-type': 'image/jpeg' },
      body: Buffer.from(got.bytes || []),
    });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/s/#P3R8-WDK4');
  await page.getByLabel('Student Number').fill('0123456');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  const fair = page.locator('.sp-piece', { hasText: 'Science Fair Proposal' });
  await fair.getByRole('button', { name: 'Send My Work' }).click();
  await expect(page.getByRole('heading', { name: 'Check and Send' })).toBeVisible();
  await page.locator('input.sp-send-input:not([capture])').setInputFiles(PHOTO);
  await page.getByRole('button', { name: 'Send 1 Photo' }).click();
  await expect(page.getByRole('heading', { name: 'Sent to Your Teacher' })).toBeVisible();
  await fits(page);
  // The page and its thumbnail, each typed as a JPEG, read and checked by the route, handed in.
  expect(uploads).toEqual(['image/jpeg', 'image/jpeg']);
  expect([...fn.world.subs.values()].map(s => [s.state, s.files.length])).toEqual([['sent', 1]]);

  await page.getByRole('button', { name: 'Back to My Work' }).click();
  await page.getByRole('button', { name: 'Sent 1' }).click();
  await expect(page.getByText('Your teacher hasn’t started grading it. You can still change it.')).toBeVisible();
  const thumb = fair.getByRole('img', { name: 'Your page 1' });
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate(el => el.src.startsWith('blob:') && el.naturalWidth > 0)).toBe(true);
  await fits(page);

  await fair.getByRole('button', { name: 'Unsend' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Unsend' }).click();
  await expect(page.getByRole('button', { name: 'Sent 0' })).toBeVisible();
  expect(fn.world.subs.size).toBe(0);

  const token = JSON.parse((await stored(page)).local[KEY]).t;
  expect(posts.map(p => p.body.route).filter(r => r !== 'seen')).toEqual([
    'card',
    'verify',
    'page',
    'work',
    'send-start',
    'send-finish',
    'work',
    'file-links',
    'unsend',
    'work',
  ]);
  posts.forEach(p => expect(p.url).not.toContain(token));
  // Nothing the browser refused (the Content Security Policy included).
  expect(errors).toEqual([]);
});
