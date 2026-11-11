/**
 * The phone's grading of student work in a signed-in class (S7-W1), against
 * a stand-in server: the To Grade list, the speed grader with the student's
 * photos (a signed link, shown from a blob: address), Return, Add Work for a
 * student who sent nothing, and the Not In pile. Same stand-in as
 * student-work-signed-in.spec.js, at 375 x 812.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { mockAuth } from './helpers.js';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

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
          course: { student_page_enabled: true, return_grades: 'on_return', send_work: true },
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
      if (name === 'list_assessment_markup') {
        log(name, params);
        return ok(Object.values(s.marks || {}));
      }
      if (name === 'save_markup') {
        log(name, params);
        const was = (s.marks || {})[params.p_file_id];
        const rev = was ? was.rev : 0;
        if (params.p_base_rev != null && params.p_base_rev !== rev) {
          return ok({ result: 'changed', file_id: params.p_file_id, rev, marks: was && was.marks });
        }
        s.marks = s.marks || {};
        s.marks[params.p_file_id] = {
          file_id: params.p_file_id,
          enrollment_id: seed.alice.enrollment_id,
          rev: rev + 1,
          marks: params.p_marks,
          given: null,
          given_rev: null,
          given_at: null,
          saved_at: new Date().toISOString(),
          waiting: true,
        };
        write(s);
        return ok({ result: 'saved', file_id: params.p_file_id, rev: rev + 1, given_rev: null, waiting: true });
      }
      if (name === 'list_course_feedback') {
        log(name, params);
        return ok({
          course: { reflect_on_feedback: false, show_my_learning: false },
          markup: Object.values(s.marks || {}).map(r => ({
            file_id: r.file_id,
            assessment_id: seed.assessments[0].id,
            enrollment_id: r.enrollment_id,
            rev: r.rev,
            given_rev: r.given_rev,
            given_at: r.given_at,
            waiting: true,
          })),
          revisions: s.revisions || [],
          reflections: [],
        });
      }
      if (name === 'return_for_revision') {
        log(name, params);
        const at = new Date().toISOString();
        const row = {
          id: fresh(s),
          assessment_id: params.p_assessment_id,
          enrollment_id: params.p_enrollment_id,
          what_to_fix: params.p_request.what_to_fix,
          revise_by: params.p_request.revise_by,
          criterion_ids: params.p_request.criterion_ids,
          keep_grade: true,
          grade_hidden: false,
          first_submission_id: seed.alice.id,
          first_version: 1,
          first_grade: null,
          first_returned_at: at,
          created_at: at,
          updated_at: at,
          closed_at: null,
          state: 'open',
          revision_submission_id: null,
          revision_version: null,
          revision_sent_at: null,
          revision_note: null,
          revision_late: null,
          revision_sent_by: null,
        };
        s.revisions = (s.revisions || []).concat([row]);
        const of = s.rows[params.p_assessment_id] || (s.rows[params.p_assessment_id] = {});
        of[params.p_enrollment_id] = { is_draft: false, returned_at: at };
        write(s);
        return ok({ result: 'made', request: row, returned: {}, hidden: false });
      }
      if (name === 'cancel_revision') {
        log(name, params);
        const r = (s.revisions || []).find(x => x.id === params.p_request_id);
        Object.assign(r, { state: 'cancelled', closed_at: new Date().toISOString() });
        write(s);
        return ok({ result: 'cancelled', request: r, unhidden: false });
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

async function openGradeTab(page) {
  await page.goto('/teacher-mobile/');
  await page.waitForSelector('.m-tab-item[data-tab="grade"]', { timeout: 15000 });
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
}

test('To Grade, the speed grader with the student’s photos, and Return', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);
  await openGradeTab(page);
  const seg = page.locator('.m-seg-btn[data-val="tograde"]');
  await expect(seg).toContainText('To Grade');
  const row = page.locator('.m-tg-row[data-aid="' + LAB + '"]');
  await expect(row).toBeVisible();
  await row.locator('[data-action="m-grade-row-menu"]').click();
  await page.locator('#m-sheet-container .m-tg-menu [data-only="tograde"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await expect(page.locator('#m-thumb-strip .m-thumb')).toHaveCount(1);
  const card = page.locator('.m-swiper-card').first();
  await expect(card.locator('.m-work-page img').first()).toHaveAttribute('src', /^blob:/);
  expect(errors).toEqual([]);
});

test('a grade, then Return on the phone is return_work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);
  await openGradeTab(page);
  await page.evaluate(a => Grader.setLevel(getActiveCourse(), a.sid, a.aid, a.tag, 3, 0), {
    sid: ALICE,
    aid: LAB,
    tag: TAG,
  });
  await page.locator('[data-action="m-grade-seg"][data-val="toreturn"]').click();
  await page.locator('[data-action="m-grade-assess"][data-open="draft"]').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await page.locator('[data-action="m-grade-return-next"]').click();
  await expect.poll(async () => (await calls(page, 'return_work')).length).toBe(1);
  expect((await calls(page, 'return_work'))[0].p_enrollment_ids).toEqual([ALICE]);
  expect(await calls(page, 'return_grades')).toEqual([]);
  expect(errors).toEqual([]);
});

test('Add Work from a Not In card: the photo goes to the server and the work is on the card', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);
  await openGradeTab(page);
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + LAB + '"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await page.locator('#m-thumb-strip .m-thumb[data-sid="' + BOB + '"]').click();
  const card = page.locator('.m-swiper-card[data-sid="' + BOB + '"]');
  await card.locator('[data-action="m-add-work"]').click();
  const screen = page.locator('#m-addwork');
  await screen.locator('.m-addwork-input').setInputFiles(PHOTO);
  await expect(screen.locator('.m-addwork-taken img')).toHaveCount(1);
  await screen.locator('.m-addwork-save').click();
  await expect.poll(async () => (await calls(page, 'finish_work_upload')).length, { timeout: 15000 }).toBe(1);
  const start = (await calls(page, 'start_work_upload'))[0];
  expect(start).toMatchObject({ p_assessment_id: LAB, p_enrollment_id: BOB, p_mode: 'new' });
  expect(start.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  const ups = await calls(page, 'storage.upload');
  expect(ups).toHaveLength(2);
  expect(ups.every(u => u.path.startsWith([CID, LAB, BOB].join('/') + '/'))).toBe(true);
  // Bob was the only one not in: Save closes the screen, and his card has the work.
  await expect(screen).toHaveCount(0);
  await expect(card.locator('[data-action="m-add-work"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('For Revision on the phone is return_for_revision, and Take Back is cancel_revision', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);
  await openGradeTab(page);
  await page.evaluate(a => Grader.setLevel(getActiveCourse(), a.sid, a.aid, a.tag, 3, 0), {
    sid: ALICE,
    aid: LAB,
    tag: TAG,
  });
  await page.locator('[data-action="m-grade-seg"][data-val="toreturn"]').click();
  await page.locator('[data-action="m-grade-assess"][data-open="draft"]').first().click();
  const act = page.locator('#m-grade-return-act');
  await act.locator('[data-action="m-grade-revision"]').click();
  const sheet = page.locator('#m-sheet-container .m-revision-sheet');
  await sheet.locator('.m-revision-fix').fill('Label the graph.');
  await sheet.locator('.m-revision-by').fill('2026-11-20');
  await sheet.locator('.m-revision-send').click();
  await expect(page.locator('#m-grade-return-state')).toContainText('Returned for Revision');
  await expect.poll(async () => (await calls(page, 'return_for_revision')).length).toBe(1);
  const made = (await calls(page, 'return_for_revision'))[0];
  expect(made).toMatchObject({
    p_assessment_id: LAB,
    p_enrollment_id: ALICE,
    p_request: { what_to_fix: 'Label the graph.', revise_by: '2026-11-20', criterion_ids: [], keep_grade: true },
  });
  expect(made.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  // The Return inside it went first, as return_work.
  expect((await calls(page, 'return_work')).map(c => c.p_enrollment_ids)).toEqual([[ALICE]]);
  await act.locator('[data-action="m-grade-revision-takeback"]').click();
  await expect.poll(async () => (await calls(page, 'cancel_revision')).length).toBe(1);
  expect((await calls(page, 'cancel_revision'))[0].p_request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(errors).toEqual([]);
});

test('Mark Up on the phone saves to the server when Done is pressed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);
  await openGradeTab(page);
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + LAB + '"]').click();
  await page.locator('#m-thumb-strip .m-thumb[data-sid="' + ALICE + '"]').click();
  const card = page.locator('.m-swiper-card[data-sid="' + ALICE + '"]');
  await card.locator('.m-work-full').click();
  await page.locator('#m-sheet-container [data-action="m-markup-open"]').first().click();
  const mk = page.locator('#m-markup');
  await expect(mk.locator('.m-markup-title')).toHaveText('Mark Up');
  // The piece's marks were read before drawing.
  await expect.poll(async () => (await calls(page, 'list_assessment_markup')).length).toBeGreaterThan(0);
  const box = await mk.locator('.m-markup-layer').boundingBox();
  await mk.getByRole('button', { name: 'Tick' }).click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await mk.getByRole('button', { name: 'Done' }).click();
  await expect(mk).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'save_markup')).length).toBe(1);
  const save = (await calls(page, 'save_markup'))[0];
  expect(save.p_file_id).toBe(SEED.alice.files[0].id);
  expect(save.p_base_rev).toBe(0);
  expect(save.p_marks.marks.map(m => m.type)).toEqual(['tick']);
  expect(errors).toEqual([]);
});
