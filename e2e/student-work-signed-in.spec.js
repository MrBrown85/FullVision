/**
 * Student work in a signed-in class (S5-W1, S6-W1), against a stand-in
 * server: Send Work turned on in Class Settings goes to the server; a
 * student's photos show in the grader from storage (a signed link, shown
 * from a blob: address); Add Work for a student with nothing in uploads to
 * the paths the server named and hands them in; a grade and Return go as
 * they always have, as return_work (return_grades and Mark Up's marks).
 *
 * helpers.js `mockAuth` answers the class load. This file adds Batch B's
 * teacher RPCs and Storage, with what they hold in localStorage under
 * e2e-work-server so it lasts across reloads.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { mockAuth } from './helpers.js';

test.use({ viewport: { width: 1366, height: 900 } });

const id = n => 'e2e00000-0000-4000-8000-' + String(n).padStart(12, '0');
const CID = id(1);
const ALICE = id(11);
const BOB = id(12);
const LAB = id(31);
const SUBJECT = id(40);
const SECTION = id(41);
const TAG = id(51);
const PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');

const student = (sid, first, last) => ({
  id: sid,
  firstName: first,
  lastName: last,
  preferred: first,
  pronouns: '',
  studentNumber: '',
  email: '',
  dateOfBirth: '',
  designations: [],
  enrolledDate: '',
  attendance: [],
  sortName: last + ' ' + first,
});

const SEED = {
  cid: CID,
  course: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' },
  students: [student(ALICE, 'Alice', 'Anderson'), student(BOB, 'Bob', 'Baker')],
  assessments: [
    {
      id: LAB,
      title: 'Lab Report 1',
      date: '2026-11-03',
      type: 'summative',
      tagIds: [TAG],
      evidenceType: '',
      notes: '',
      coreCompetencyIds: [],
      rubricId: '',
      scoreMode: '',
      maxPoints: 0,
      weight: 1,
      dueDate: '',
      collaboration: 'individual',
      moduleId: '',
      pairs: [],
      groups: [],
      excludedStudents: [],
    },
  ],
  learningMap: {
    _flatVersion: 2,
    subjects: [{ id: SUBJECT, name: 'Science 8', color: '#0891b2' }],
    sections: [
      {
        id: SECTION,
        subject: SUBJECT,
        name: 'Questioning and Predicting',
        shortName: 'Questioning',
        color: '#0891b2',
        tags: [{ id: TAG, label: 'Question and Predict', text: '', color: '#0891b2', subject: SUBJECT }],
      },
    ],
  },
  // Alice sent two photos; Lab Report 1 takes photos.
  alice: {
    id: id(61),
    assessment_id: LAB,
    enrollment_id: ALICE,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    is_late: false,
    note: 'Page two is the graph.',
    created_at: '2026-11-05T17:40:00Z',
    sent_at: '2026-11-05T17:41:09Z',
    files: [1, 2].map(n => ({
      id: id(70 + n),
      page: n,
      path: [CID, LAB, ALICE, id(61), id(70 + n)].join('/') + '.jpg',
      thumb_path: [CID, LAB, ALICE, id(61), id(70 + n)].join('/') + '-thumb.jpg',
      sha256: String(n).repeat(64),
      added_by: 'student',
    })),
  },
};

async function server(page) {
  await mockAuth(page);
  await page.addInitScript(seed => {
    const KEY = 'e2e-work-server';
    if (!localStorage.getItem(KEY)) {
      const cid = seed.cid;
      localStorage.setItem('gb-courses', JSON.stringify({ [cid]: seed.course }));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-lastActiveCourse', cid);
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(seed.learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(seed.students));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(seed.assessments));
      localStorage.setItem('gb-scores-' + cid, JSON.stringify({}));
      localStorage.setItem(
        KEY,
        JSON.stringify({
          course: { student_page_enabled: true, return_grades: 'on_return', send_work: false },
          rows: {},
          submissions: [seed.alice],
          uploads: {},
          stored: [],
          n: 0,
        }),
      );
    }
    const read = () => JSON.parse(localStorage.getItem(KEY));
    const write = s => localStorage.setItem(KEY, JSON.stringify(s));
    const ok = data => Promise.resolve({ data, error: null });
    const log = (name, params) => window.__e2eRpcLog.push({ name, params, at: Date.now() });
    const client = window._supabase;
    const real = client.rpc;
    const fresh = s => 'e2e00000-0000-4000-9000-' + String(++s.n).padStart(12, '0');

    client.rpc = function (name, params) {
      params = params || {};
      const s = read();
      if (name === 'get_class_bundle') {
        return real(name, { p_course_id: params.p_course_id, p_if_version: null }).then(res => {
          if (res.data && res.data.gradebook) Object.assign(res.data.gradebook.course, s.course);
          return res;
        });
      }
      if (name === 'list_course_grade_returns') return (log(name, params), ok(s.rows));
      if (name === 'list_course_submissions') {
        log(name, params);
        return ok({
          bucket: 'student-photos',
          course: { send_work: s.course.send_work, keep_photos_until: 'end_of_year' },
          assessments: [
            {
              id: seed.assessments[0].id,
              students_send: 'photos',
              after_due: 'keep',
              accept_until: null,
              group_work: 'each',
              students_see_markup: true,
            },
          ],
          submissions: s.submissions,
          uploads: [],
        });
      }
      if (name === 'set_course_send_work') {
        log(name, params);
        Object.assign(s.course, params.p_patch);
        write(s);
        return ok({ send_work: s.course.send_work, keep_photos_until: 'end_of_year' });
      }
      if (name === 'start_work_upload') {
        log(name, params);
        const sub = fresh(s);
        const files = params.p_pages.map((_, i) => {
          const f = fresh(s);
          const base = [seed.cid, params.p_assessment_id, params.p_enrollment_id, sub, f].join('/');
          return { file_id: f, page: i + 1, path: base + '.jpg', thumb_path: base + '-thumb.jpg' };
        });
        s.uploads[sub] = { aid: params.p_assessment_id, sid: params.p_enrollment_id, files };
        write(s);
        return ok({ result: 'ready', submission_id: sub, mode: params.p_mode, bucket: 'student-photos', files });
      }
      if (name === 'finish_work_upload') {
        log(name, params);
        const up = s.uploads[params.p_submission_id];
        const missing = up.files.filter(f => s.stored.indexOf(f.path) < 0 || s.stored.indexOf(f.thumb_path) < 0);
        if (missing.length) return ok({ result: 'missing_pages', missing: missing.map(f => f.file_id) });
        const sub = {
          id: params.p_submission_id,
          assessment_id: up.aid,
          enrollment_id: up.sid,
          version: 1,
          state: 'sent',
          sent_by: 'teacher',
          on_paper: false,
          is_late: false,
          note: null,
          created_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          files: up.files.map((f, i) => ({
            id: f.file_id,
            page: f.page,
            path: f.path,
            thumb_path: f.thumb_path,
            sha256: params.p_files[i].sha256,
            added_by: 'teacher',
          })),
        };
        s.submissions.push(sub);
        delete s.uploads[params.p_submission_id];
        write(s);
        return ok({ result: 'sent', submission: sub });
      }
      if (/^upsert_(tag_)?score$/.test(name)) {
        const of = s.rows[params.p_assessment_id] || (s.rows[params.p_assessment_id] = {});
        of[params.p_enrollment_id] = { is_draft: true };
        write(s);
        return real(name, params);
      }
      if (name === 'return_grades' || name === 'return_work') {
        log(name, params);
        const at = new Date().toISOString();
        (params.p_enrollment_ids || []).forEach(sid => {
          const row = (s.rows[params.p_assessment_id] || {})[sid];
          if (row) Object.assign(row, { is_draft: false, returned_at: at });
        });
        write(s);
        return ok({
          returned: (params.p_enrollment_ids || []).length,
          enrollment_ids: params.p_enrollment_ids,
          returned_at: at,
        });
      }
      return real(name, params);
    };

    client.storage = {
      from: bucket => ({
        upload: (p, blob, opts) => {
          const s = read();
          log('storage.upload', { bucket, path: p, contentType: opts.contentType, upsert: opts.upsert });
          s.stored.push(p);
          write(s);
          return Promise.resolve({ data: { path: p }, error: null });
        },
        createSignedUrl: (p, seconds) => {
          log('storage.sign', { bucket, path: p, seconds });
          return Promise.resolve({ data: { signedUrl: 'https://fake.supabase.co/storage/sign/' + p }, error: null });
        },
      }),
    };
  }, SEED);
  // The signed links serve a real photo; the sweep route answers ok.
  await page.route('https://fake.supabase.co/storage/sign/**', route =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', path: PHOTO }),
  );
  await page.route('https://fake.supabase.co/functions/v1/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
}

const log = page => page.evaluate(() => window.__e2eRpcLog.map(c => ({ name: c.name, params: c.params })));
const calls = async (page, name) => (await log(page)).filter(c => c.name === name).map(c => c.params);

async function openGrader(page, sid) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + sid + '"][data-aid="' + LAB + '"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Send Work on, a student’s photos in the grader, Add Work, a grade and Return', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);

  // Send Work: off, then on in Class Settings, sent to the server.
  await page.goto('/dashboard?manage=student-page');
  const send = page.getByRole('switch', { name: 'Send Work' });
  await expect(send).not.toBeChecked();
  // Send Work's own row (Reflect on Feedback's and Show My Learning's rows are drawn the same way beside it).
  await page.locator('.sp-send:not(.sp-reflect):not(.sp-learning) .gpd-switch').click();
  await expect(send).toBeChecked();
  await expect.poll(async () => (await calls(page, 'set_course_send_work')).length).toBe(1);
  expect((await calls(page, 'set_course_send_work'))[0].p_patch).toEqual({ send_work: true });

  // Alice's photos, from storage through a 300-second link.
  let dialog = await openGrader(page, ALICE);
  await expect(dialog).toHaveClass(/has-work/);
  await expect(dialog.locator('.grader-work-at')).toHaveText('1 of 2');
  const img = dialog.locator('.grader-work-img');
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  expect(await img.getAttribute('src')).toMatch(/^blob:/);
  const sign = (await calls(page, 'storage.sign'))[0];
  expect(sign).toEqual({ bucket: 'student-photos', path: SEED.alice.files[0].path, seconds: 300 });

  // A grade, then Return, as always.
  await dialog.locator('[data-action="graderTagLevel"][data-tag="' + TAG + '"][data-level="3"]').click();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');
  await dialog.locator('.grader-return [data-grader="return"]').click();
  await expect(dialog.locator('.grader-returned')).toHaveText(/^Returned /);
  // Return in a class with Send Work on is return_work (S9-W1): return_grades, and the marks.
  await expect.poll(async () => (await calls(page, 'return_work')).length).toBe(1);
  expect((await calls(page, 'return_work'))[0].p_enrollment_ids).toEqual([ALICE]);
  expect(await calls(page, 'return_grades')).toEqual([]);
  await dialog.locator('.grader-done').click();

  // Bob sent nothing: Add Work, a real photo, to the paths the server named.
  dialog = await openGrader(page, BOB);
  const pane = dialog.locator('.grader-addwork');
  await expect(pane).toBeVisible();
  await pane.locator('.grader-work-files').setInputFiles(PHOTO);
  await expect(dialog.locator('.grader-work-what')).toHaveText(/^Added by you .* · 1 photo$/, { timeout: 15000 });
  await expect.poll(async () => (await calls(page, 'finish_work_upload')).length, { timeout: 15000 }).toBe(1);
  const start = (await calls(page, 'start_work_upload'))[0];
  expect(start).toMatchObject({ p_assessment_id: LAB, p_enrollment_id: BOB, p_mode: 'new' });
  const ups = await calls(page, 'storage.upload');
  expect(ups).toHaveLength(2);
  expect(ups.every(u => u.bucket === 'student-photos' && u.contentType === 'image/jpeg' && u.upsert === false)).toBe(
    true,
  );
  expect(ups.map(u => u.path).every(p => p.startsWith([CID, LAB, BOB].join('/') + '/'))).toBe(true);
  expect((await calls(page, 'finish_work_upload'))[0].p_files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  // Handed in: the photo queue is empty and the work is the server's.
  await expect
    .poll(() =>
      page.evaluate(a => (getStudentSubmission(a.cid, a.sid, a.aid).files[0] || {}).path, {
        cid: CID,
        sid: BOB,
        aid: LAB,
      }),
    )
    .toMatch(/\.jpg$/);
  expect(errors).toEqual([]);
});
