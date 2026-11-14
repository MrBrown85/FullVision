/**
 * Mark Up and Reflect on Feedback in a signed-in class (S9-W1, S10-W1),
 * against a stand-in server: a teacher marks a student's photo, the marks go
 * up with save_markup (the rev the screen read, a key), and Return is
 * return_work in place of return_grades and gives the student those marks;
 * a student's question shows in the grader from list_course_feedback and
 * Send Answer goes up with answer_reflection.
 *
 * helpers.js `mockAuth` answers the class load. This file adds Batch B's work
 * RPCs and Batch C's feedback RPCs, with what they hold in localStorage under
 * e2e-feedback-server so it lasts across reloads.
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

const REFLECTION = id(90);

async function server(page, opts) {
  await mockAuth(page);
  await page.addInitScript(
    ({ seed, reflection, reflectOn }) => {
      const KEY = 'e2e-feedback-server';
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
            course: {
              student_page_enabled: true,
              return_grades: 'on_return',
              send_work: true,
              reflect_on_feedback: reflectOn,
              show_my_learning: false,
            },
            rows: {},
            marks: {},
            reflections: reflectOn
              ? [
                  {
                    id: reflection,
                    assessment_id: seed.assessments[0].id,
                    enrollment_id: seed.alice.enrollment_id,
                    makes_sense: 'not_sure',
                    question: 'Why a 3 and not a 4?',
                    plan: null,
                    went_well: null,
                    sent_at: '2026-11-09T18:00:00Z',
                    answer: null,
                    answered_at: null,
                    note: null,
                    noted_at: null,
                    sense_now: null,
                    follow_up: null,
                    follow_up_answer: null,
                    follow_up_note: null,
                    waiting: true,
                  },
                ]
              : [],
          }),
        );
      }
      const read = () => JSON.parse(localStorage.getItem(KEY));
      const write = s => localStorage.setItem(KEY, JSON.stringify(s));
      const ok = data => Promise.resolve({ data, error: null });
      const log = (name, params) => window.__e2eRpcLog.push({ name, params, at: Date.now() });
      const client = window._supabase;
      const real = client.rpc;
      const waiting = r => r.given_rev !== r.rev && r.marks.marks.length > 0;

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
        if (name === 'list_course_submissions_since') {
          log(name, params);
          return ok({
            bucket: 'student-photos',
            course: { send_work: true, keep_photos_until: 'end_of_year' },
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
            submissions: [seed.alice],
            uploads: [],
          });
        }
        if (name === 'list_course_feedback') {
          log(name, params);
          return ok({
            course: { reflect_on_feedback: s.course.reflect_on_feedback, show_my_learning: false },
            markup: Object.values(s.marks).map(r => ({
              file_id: r.file_id,
              assessment_id: seed.assessments[0].id,
              enrollment_id: r.enrollment_id,
              rev: r.rev,
              given_rev: r.given_rev,
              given_at: r.given_at,
              waiting: waiting(r),
            })),
            revisions: [],
            reflections: s.course.reflect_on_feedback ? s.reflections : [],
          });
        }
        if (name === 'list_assessment_markup') {
          log(name, params);
          return ok(Object.values(s.marks).map(r => Object.assign({ waiting: waiting(r) }, r)));
        }
        if (name === 'save_markup') {
          log(name, params);
          const was = s.marks[params.p_file_id];
          const rev = was ? was.rev : 0;
          if (params.p_base_rev != null && params.p_base_rev !== rev) {
            return ok({ result: 'changed', file_id: params.p_file_id, rev, marks: was && was.marks });
          }
          s.marks[params.p_file_id] = Object.assign(
            {
              file_id: params.p_file_id,
              enrollment_id: seed.alice.enrollment_id,
              given: null,
              given_rev: null,
              given_at: null,
            },
            was,
            { rev: rev + 1, marks: params.p_marks, saved_at: new Date().toISOString() },
          );
          write(s);
          const r = s.marks[params.p_file_id];
          return ok({
            result: 'saved',
            file_id: params.p_file_id,
            rev: r.rev,
            given_rev: r.given_rev,
            waiting: waiting(r),
          });
        }
        if (name === 'return_work' || name === 'return_grades') {
          log(name, params);
          const at = new Date().toISOString();
          (params.p_enrollment_ids || []).forEach(sid => {
            const row = (s.rows[params.p_assessment_id] || {})[sid];
            if (row) Object.assign(row, { is_draft: false, returned_at: at });
            Object.values(s.marks).forEach(r => {
              if (name === 'return_work' && r.enrollment_id === sid && waiting(r)) {
                Object.assign(r, { given: r.marks, given_rev: r.rev, given_at: at });
              }
            });
          });
          write(s);
          return ok({
            returned: (params.p_enrollment_ids || []).length,
            enrollment_ids: params.p_enrollment_ids,
            returned_at: at,
            marks_given: 0,
            marks_enrollment_ids: [],
          });
        }
        if (name === 'answer_reflection') {
          log(name, params);
          const r = s.reflections.find(x => x.id === params.p_reflection_id);
          Object.assign(r, { answer: params.p_answer, answered_at: new Date().toISOString(), waiting: false });
          write(s);
          return ok({ result: 'answered', reflection: r });
        }
        if (/^upsert_(tag_)?score$/.test(name)) {
          const of = s.rows[params.p_assessment_id] || (s.rows[params.p_assessment_id] = {});
          of[params.p_enrollment_id] = { is_draft: true };
          write(s);
          return real(name, params);
        }
        return real(name, params);
      };

      client.storage = {
        from: bucket => ({
          createSignedUrl: (p, seconds) => {
            log('storage.sign', { bucket, path: p, seconds });
            return Promise.resolve({ data: { signedUrl: 'https://fake.supabase.co/storage/sign/' + p }, error: null });
          },
        }),
      };
    },
    { seed: SEED, reflection: REFLECTION, reflectOn: !!(opts && opts.reflect) },
  );
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

test('Mark Up on a student’s photo is saved to the server, and Return is return_work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);
  const dialog = await openGrader(page, ALICE);
  await expect(dialog).toHaveClass(/has-work/);
  await dialog.locator('[data-action="graderTagLevel"][data-tag="' + TAG + '"][data-level="3"]').click();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');

  await dialog.locator('[data-grader="work-markup"]').first().click();
  const mk = page.locator('.markup-overlay');
  await expect(mk).toBeVisible();
  await expect(mk.locator('.markup-img')).toHaveJSProperty('complete', true);
  const box = await mk.locator('.markup-surface').boundingBox();
  await mk.locator('[data-mk-tool="tick"]').click();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await expect(mk.locator('.markup-layer .markup-tick')).toHaveCount(1);
  await expect.poll(async () => (await calls(page, 'save_markup')).length).toBe(1);
  const save = (await calls(page, 'save_markup'))[0];
  expect(save.p_file_id).toBe(SEED.alice.files[0].id);
  expect(save.p_base_rev).toBe(0);
  expect(save.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  expect(save.p_marks.marks.map(m => m.type)).toEqual(['tick']);
  await expect(mk.locator('.markup-msg')).toHaveText('');
  await mk.locator('[data-mk="done"]').click();
  await expect(mk).toHaveCount(0);
  // The marks lie over the page in the work pane; the student does not have them yet.
  await expect(dialog.locator('.grader-work-surface .markup-layer .markup-tick')).toHaveCount(1);
  expect(
    await page.evaluate(a => getStudentMarkup(a.cid, a.sid, a.aid).files, { cid: CID, sid: ALICE, aid: LAB }),
  ).toEqual([]);

  // Return: one return_work call for the student, and no return_grades.
  await dialog.locator('.grader-return [data-grader="return"]').click();
  await expect(dialog.locator('.grader-returned')).toHaveText(/^Returned /);
  await expect.poll(async () => (await calls(page, 'return_work')).length).toBe(1);
  expect((await calls(page, 'return_work'))[0]).toMatchObject({ p_assessment_id: LAB, p_enrollment_ids: [ALICE] });
  expect(await calls(page, 'return_grades')).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(a => getStudentMarkup(a.cid, a.sid, a.aid).files.length, { cid: CID, sid: ALICE, aid: LAB }),
    )
    .toBe(1);
  expect(errors).toEqual([]);
});

test('a student’s question shows in the grader, and Send Answer goes up as answer_reflection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page, { reflect: true });
  const dialog = await openGrader(page, ALICE);
  const card = dialog.locator('.grader-reflect');
  await expect(card).toContainText('Why a 3 and not a 4?');
  expect(await page.evaluate(cid => getQuestionsWaiting(cid).length, CID)).toBe(1);
  await card.locator('.grader-reflect-input').fill('A 3 names the cause. A 4 weighs two.');
  await card.locator('[data-grader="reflect-send"]').click();
  await expect(card.locator('.grader-reflect-input')).toHaveCount(0);
  await expect(card).toContainText('A 3 names the cause.');
  await expect.poll(async () => (await calls(page, 'answer_reflection')).length).toBe(1);
  const sent = (await calls(page, 'answer_reflection'))[0];
  expect(sent).toMatchObject({
    p_reflection_id: REFLECTION,
    p_answer: 'A 3 names the cause. A 4 weighs two.',
    p_only_me: false,
  });
  expect(sent.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  expect(await page.evaluate(cid => getQuestionsWaiting(cid).length, CID)).toBe(0);
  expect(errors).toEqual([]);
});
