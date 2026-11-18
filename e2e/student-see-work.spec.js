import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, TODAY, serve, fits, named } from './student-card-fake.js';
import { CECE, OMAR, WORK, fakeStudentSubmit, sampleCard } from '../tests/helpers/fake-student-submit.js';
import { C1, PAGE_JPEG } from '../tests/helpers/fake-send-world.js';

/* See Your Work from My Learning (DECISIONS, "See Your Work from My
   Learning (2026-11-18)"), against the built site with the live site's
   CSP. Demo Mode (#demo-card-send): the quiz Ms. Rivera scanned in opens
   its two pages with no marks and no Show Marks; the lab keeps its marks,
   on the page; a piece with neither has no See Your Work; a press made up
   for a piece not on the page opens nothing. A real card: the teacher's
   scan of a returned piece is fetched from its own session's links and
   drawn from blob: addresses; another student's pages are refused. */

async function signInDemo(page, hash) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/' + hash);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.locator('.sp-tab[data-tab="learning"]').locator('visible=true').first().click();
  await expect(page.locator('.sp-ml-work')).toBeVisible();
  return { errors, posts };
}

// Back to My Learning's list: Your Feedback's My Learning on a phone, the tab on a Chromebook.
async function myLearning(page) {
  const back = page.locator('.sp-fb-back').locator('visible=true');
  if (await back.count()) return back.first().click();
  return page.locator('.sp-tab[data-tab="learning"]').locator('visible=true').first().click();
}
const mlRow = (page, id) => page.locator('.sp-ml-work .sp-ml-row[data-piece="' + id + '"]');

// Every mark on the page sits inside the picture of the page.
async function marksOnPage(page) {
  const box = await page.locator('.sp-work-img').boundingBox();
  for (const m of await page.locator('.sp-work-over .sp-work-pin, .sp-work-over .sp-work-mark').all()) {
    const b = await m.boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    expect(cx).toBeGreaterThan(box.x);
    expect(cx).toBeLessThan(box.x + box.width);
    expect(cy).toBeGreaterThan(box.y);
    expect(cy).toBeLessThan(box.y + box.height);
  }
}

for (const [where, device] of [
  ['on a phone', PHONE],
  ['on a Chromebook', CHROMEBOOK],
]) {
  test.describe(where, () => {
    test.use(device);

    test('pages with no marks, pages with marks, and neither', async ({ page }) => {
      const { errors, posts } = await signInDemo(page, '#demo-card-send');

      // The scanned quiz: Your Feedback, See Your Work "2 pages", its pages one at a time, no Show Marks.
      await mlRow(page, 'demo-quiz').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Cell Structure Quiz' })).toBeFocused();
      const see = page.getByRole('button', { name: /See Your Work/ });
      await expect(see).toContainText('2 pages');
      await see.click();
      await expect(page.locator('.sp-work .sp-fb-sub')).toHaveText('Page 1 of 2');
      const img = page.getByRole('img', { name: 'Your page 1', exact: true });
      await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
      await expect(page.getByRole('switch', { name: 'Show Marks' })).toHaveCount(0);
      await expect(page.locator('.sp-work-over > *')).toHaveCount(0);
      await fits(page);
      await named(page);
      await page.getByRole('button', { name: 'Next Page' }).click();
      await expect(page.locator('.sp-work .sp-fb-sub')).toHaveText('Page 2 of 2');
      await expect(page.getByRole('img', { name: 'Your page 2', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(see).toBeFocused();

      // The lab: its marks, on the page.
      await myLearning(page);
      await mlRow(page, 'demo-lab').click();
      await page.getByRole('button', { name: /See Your Work/ }).click();
      await expect(page.getByRole('switch', { name: 'Show Marks' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('.sp-work-over .sp-work-pin')).toHaveCount(3);
      await expect
        .poll(() => page.locator('.sp-work-img').evaluate(el => el.complete && el.naturalWidth > 0))
        .toBe(true);
      await marksOnPage(page);

      // Neither pages nor marks: Your Feedback as it was, no See Your Work.
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await myLearning(page);
      await mlRow(page, 'demo-kmt').click();
      await expect(page.getByRole('heading', { level: 1, name: 'KMT & States of Matter Lab' })).toBeVisible();
      await expect(page.getByRole('button', { name: /See Your Work/ })).toHaveCount(0);

      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('a press for a piece not on the page', () => {
  test.use(PHONE);

  test('opens nothing', async ({ page }) => {
    await signInDemo(page, '#demo-card-send');
    // A row whose piece id is changed by hand to one this student does not have.
    await mlRow(page, 'demo-quiz').evaluate(el => {
      el.setAttribute('data-act', 'work');
      el.setAttribute('data-piece', 'demo-someone-else');
    });
    await page.locator('.sp-ml-row[data-piece="demo-someone-else"]').click();
    await expect(page.locator('.sp-work')).toHaveCount(0);
    await expect(page.locator('.sp-ml-work')).toBeVisible();
  });
});

/* A real card. The teacher scanned Cece's Cell Structure Quiz in (Add Work
   for the Class): a submission sent by the teacher, on returned work. Omar
   has pages on the same piece. */
const STORAGE = 'https://e2e-test.supabase.co/storage/v1';
const STORAGE_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};
function handIn(world, enrollment, n, pages, by) {
  const id = `5c${n}00000-0000-4000-8000-000000000000`;
  const files = [];
  for (let i = 1; i <= pages; i++) {
    const file = `f3${n}0000${i}-0000-4000-8000-000000000000`;
    const base = `${C1}/${WORK.quiz}/${enrollment}/${id}/${file}`;
    files.push({ id: file, page: i, path: base + '.jpg', thumb_path: base + '-thumb.jpg', added_by: by });
    for (const p of [base + '.jpg', base + '-thumb.jpg']) {
      world.objects.set(p, { bytes: PAGE_JPEG, type: 'image/jpeg', cache: 'private' });
    }
  }
  world.subs.set(id, {
    id,
    course: C1,
    assessment: WORK.quiz,
    enrollment,
    state: 'sent',
    intent: 'new',
    sent_by: by,
    request_id: `9c${n}00000-0000-4000-8000-000000000000`,
    note: null,
    version: 1,
    sent_at: '2026-11-01T19:00:00+00:00',
    files,
  });
}

test.describe('a real card', () => {
  test.use(PHONE);

  test('the teacher’s scan opens from its own links as pictures on the phone; another student’s is refused', async ({
    page,
  }) => {
    const fn = fakeStudentSubmit({
      cards: [sampleCard(TODAY)],
      sendWork: { [WORK.quiz]: { students_send: 'nothing', open: false } },
      storeBase: STORAGE,
    });
    handIn(fn.world, CECE, '1', 2, 'teacher');
    handIn(fn.world, OMAR, '2', 1, 'student');
    const posts = await serve(page, fn);
    const downloads = [];
    await page.route(STORAGE + '/**', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: STORAGE_CORS });
      downloads.push(req.url());
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
    await page.locator('.sp-tab[data-tab="learning"]').locator('visible=true').first().click();
    await mlRow(page, WORK.quiz).click();
    const see = page.getByRole('button', { name: /See Your Work/ });
    await expect(see).toContainText('2 pages');
    await see.click();
    const img = page.getByRole('img', { name: 'Your page 1', exact: true });
    await expect.poll(() => img.evaluate(el => el.src.startsWith('blob:') && el.naturalWidth > 0)).toBe(true);
    await expect(page.locator('.sp-work .sp-fb-sub')).toHaveText('Page 1 of 2');
    await fits(page);

    // The links asked for name Cece and this piece; only her two pages were fetched.
    const asks = posts.filter(p => p.body.route === 'file-links').map(p => p.body);
    expect(asks).toEqual([expect.objectContaining({ enrollment_id: CECE, assessment_id: WORK.quiz })]);
    const pagesGot = downloads.filter(u => !/-thumb\.jpg/.test(u));
    expect(pagesGot).toHaveLength(2);
    expect(pagesGot.every(u => u.includes('/' + CECE + '/'))).toBe(true);

    // The same session asking for Omar's pages is refused by the function.
    const session = asks[0].session;
    const theirs = await fn.handle({ route: 'file-links', session, enrollment_id: OMAR, assessment_id: WORK.quiz });
    expect(theirs).toMatchObject({ ok: false, error: 'not_found' });
    expect(errors).toEqual([]);
  });
});
