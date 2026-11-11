import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { PHONE, KEY, TODAY, serve, fits, stored } from './student-card-fake.js';
import { CECE, CRITERIA, OMAR, WORK, fakeStudentSubmit, sampleCard } from '../tests/helpers/fake-student-submit.js';
import { C1, PAGE_JPEG } from '../tests/helpers/fake-send-world.js';

/* Revisions and group work from a real card (S11-W1, S12-W1), on a phone,
   against the built site with the live site's CSP: the student-submit
   function answered by its own handler and routes over a stand-in database
   and bucket, the bucket's links served here at the Supabase address.
   Cell Microscope Lab came back for revision: Needs Revision shows What to
   Fix and the first version from its own pages; a real JPEG goes up as the
   revision through revise-start and revise-finish; the card is Sent again.
   Science Fair Proposal is group work a group-mate sent: the card shows
   the group's counts and Add a Page. */

const PHOTO = resolve('assets/sample-work/cell-lab-cece-1.jpg');
const STORAGE = 'https://e2e-test.supabase.co/storage/v1';
const STORAGE_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
};

test.use(PHONE);

// A send handed in, with its page and thumbnail in the bucket.
function handIn(world, n, assessment, enrollment) {
  const id = `5a${n}00-0000-4000-8000-000000000000`;
  const file = `f1${n}00-0000-4000-8000-000000000000`;
  const base = `${C1}/${assessment}/${enrollment}/${id}/${file}`;
  world.subs.set(id, {
    id,
    course: C1,
    assessment,
    enrollment,
    state: 'sent',
    intent: 'new',
    sent_by: 'student',
    request_id: `9e${n}00-0000-4000-8000-000000000000`,
    note: null,
    sent_at: '2026-11-01T19:00:00+00:00',
    files: [{ id: file, page: 1, path: base + '.jpg', thumb_path: base + '-thumb.jpg', added_by: 'student' }],
  });
  for (const p of [base + '.jpg', base + '-thumb.jpg']) {
    world.objects.set(p, { bytes: PAGE_JPEG, type: 'image/jpeg', cache: 'private' });
  }
}

test('a real card sends a revision through the revise routes and sees its group work', async ({ page }) => {
  const fn = fakeStudentSubmit({
    cards: [sampleCard(TODAY)],
    sendWork: {
      [WORK.lab]: { students_send: 'photos', open: true },
      [WORK.fair]: { students_send: 'photos', open: true },
    },
    storeBase: STORAGE,
  });
  handIn(fn.world, '0001', WORK.lab, CECE);
  handIn(fn.world, '0002', WORK.fair, OMAR);
  fn.state.feedback = {
    ok: true,
    v: 1,
    reflect_on_feedback: false,
    show_my_learning: false,
    assessments: [
      {
        id: WORK.lab,
        marks: null,
        reflection: null,
        revision: {
          state: 'open',
          what_to_fix: 'Write the magnification beside each drawing, then send it again.',
          revise_by: TODAY,
          criterion_ids: [CRITERIA.drawing],
          keep_grade: true,
          grade_hidden: false,
          first_version: 1,
          first_sent_at: '2026-11-01T19:00:00+00:00',
          first_grade: null,
          revision_version: null,
          revision_sent_at: null,
          revision_note: null,
          revision_late: null,
          asked_at: '2026-11-10T18:00:00+00:00',
        },
      },
    ],
    last_plan: null,
  };
  fn.state.groupWork = {
    ok: true,
    assessments: [
      { id: WORK.fair, members: 3, sent: true, pages: 1, you_sent: false, first_sent_at: '2026-11-10T19:00:00+00:00' },
    ],
  };
  const posts = await serve(page, fn);
  await page.route(STORAGE + '/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: STORAGE_CORS });
    if (req.method() === 'PUT') {
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

  // Needs Revision, with the first version shown from this device's own copy of its page.
  const lab = page.locator('.sp-piece', { hasText: 'Cell Microscope Lab' });
  await expect(lab.locator('.sp-revise-fix')).toHaveText(
    'Write the magnification beside each drawing, then send it again.',
  );
  await expect(lab.locator('.sp-revise-crit-name')).toHaveText('Labelled Drawing');
  const first = lab.getByRole('img', { name: 'First version, page 1' });
  await expect.poll(() => first.evaluate(el => el.src.startsWith('blob:') && el.naturalWidth > 0)).toBe(true);
  await fits(page);

  await lab.getByRole('button', { name: 'Send My Revision' }).click();
  await expect(page.getByRole('heading', { name: 'Check and Send' })).toBeVisible();
  await page.locator('input.sp-send-input:not([capture])').setInputFiles(PHOTO);
  await page.getByRole('button', { name: 'Send 1 Photo' }).click();
  await expect(page.getByRole('heading', { name: 'Sent to Your Teacher' })).toBeVisible();
  const revision = [...fn.world.subs.values()].find(s => s.version === 2);
  expect(revision).toMatchObject({ state: 'sent', assessment: WORK.lab, enrollment: CECE });
  await page.getByRole('button', { name: 'Back to My Work' }).click();

  // The group's work: counts only, and Add a Page.
  await page.locator('[data-segment="sent"]').click();
  const fair = page.locator('.sp-piece', { hasText: 'Science Fair Proposal' });
  await expect(fair.locator('.sp-group-line')).toHaveText('3 in your group. Someone in your group sent it.');
  await expect(fair.getByRole('button', { name: 'Add a Page' })).toBeVisible();
  // The revision is Sent again.
  await expect(page.locator('.sp-piece', { hasText: 'Cell Microscope Lab' })).toBeVisible();
  await fits(page);

  const sent = posts.map(p => p.body.route).filter(r => r !== 'seen');
  expect(sent.slice(0, 8)).toEqual(['card', 'verify', 'page', 'work', 'forms', 'feedback', 'group-work', 'file-links']);
  expect(sent).toContain('revise-start');
  expect(sent).toContain('revise-finish');
  expect(sent).not.toContain('send-start');
  expect(sent).not.toContain('send-finish');
  const start = posts.find(p => p.body.route === 'revise-start').body;
  expect(start).toMatchObject({ assessment_id: WORK.lab, enrollment_id: CECE });
  expect(start).not.toHaveProperty('followed_plan');
  const token = JSON.parse((await stored(page)).local[KEY]).t;
  expect(start.session).toBe(token);
  posts.forEach(p => expect(p.url).not.toContain(token));
  expect(errors).toEqual([]);
});
