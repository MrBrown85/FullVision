import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers.js';

// S0-W1: Draft and Returned and student cards for a signed-in teacher, in
// the browser, against a stand-in server.
//
// - With the class's student page off, nothing new is asked of the server
//   and no screen shows any of it.
// - At the build address the switch turns it on: one update_course, then
//   the class's rows are read (list_course_grade_returns).
// - A grade saved in the dialog is a Draft at once; Return sends
//   return_grades for that student and that work, with a key.
// - Student Cards: Make Cards is issue_student_cards, Print All marks them
//   printed (mark_student_cards_printed), and no code is kept on the device.
//
// helpers.js `mockAuth` answers the class load. This file wraps it with the
// part of the server this build added: the two settings on the course row,
// the rows, Return and the cards. Its state is kept in localStorage under
// e2e-s0w1-server so it lasts across the test's reloads.

const id = n => 'e2e00000-0000-4000-8000-' + String(n).padStart(12, '0');
const CID = id(1);
const ALICE = id(11);
const BOB = id(12);
const CHARLIE = id(13);
const LAB = id(31);
const SUBJECT = id(40);
const SECTION = id(41);
const TAG = id(51);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEW_RPCS = /grade_return|return_grades|student_card|draft_count/;

const student = (sid, first, last, more) => ({
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
  ...more,
});

const SEED = {
  cid: CID,
  course: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent', block: 'B' },
  students: [
    student(ALICE, 'Alice', 'Anderson', { studentNumber: '1001' }),
    student(BOB, 'Bob', 'Baker', { dateOfBirth: '2012-05-06' }),
    student(CHARLIE, 'Charlie', 'Chen'), // nothing on file: his card has a password
  ],
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
        tags: [
          {
            id: TAG,
            label: 'Question and Predict',
            text: '',
            color: '#0891b2',
            subject: SUBJECT,
            name: 'Questioning and Predicting',
            shortName: 'Questioning',
            i_can_statements: [],
          },
        ],
      },
    ],
  },
};

/* The stand-in for what this build added to the server. `start` is what it
   holds when the test begins: { course: { student_page_enabled,
   return_grades }, rows }. */
async function serverWithStudentPage(page, start) {
  await mockAuth(page);
  await page.addInitScript(
    ({ seed, start }) => {
      const KEY = 'e2e-s0w1-server';
      // Seeded once: a reload keeps what the app has saved since.
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
          JSON.stringify({ version: 1, course: start.course, rows: start.rows || {}, cards: [], seq: 0 }),
        );
      }
      const read = () => JSON.parse(localStorage.getItem(KEY));
      const write = s => localStorage.setItem(KEY, JSON.stringify(s));
      const holds = s => s.course.student_page_enabled === true && s.course.return_grades === 'on_return';
      const ok = data => Promise.resolve({ data, error: null });
      const client = window._supabase;
      const real = client.rpc;

      client.rpc = function (name, params) {
        params = params || {};
        const s = read();
        if (name === 'get_class_bundle') {
          if (params.p_if_version != null && Number(params.p_if_version) === s.version) {
            window.__e2eRpcLog.push({ name, params, at: Date.now() });
            return ok({ not_modified: true, version: s.version });
          }
          return real(name, { p_course_id: params.p_course_id, p_if_version: null }).then(res => {
            if (res.data && res.data.gradebook) {
              res.data.version = s.version;
              // The whole course row comes with the class, the two settings in it.
              Object.assign(res.data.gradebook.course, s.course);
            }
            return res;
          });
        }
        if (name === 'list_course_grade_returns') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          return ok(s.rows);
        }
        if (name === 'update_course') {
          const patch = params.p_patch || {};
          const held = holds(s);
          ['student_page_enabled', 'return_grades'].forEach(k => {
            if (k in patch) s.course[k] = patch[k];
          });
          // Leaving When I Return Them returns what waits, in the same call.
          if (held && !holds(s)) {
            Object.values(s.rows).forEach(of =>
              Object.values(of).forEach(r => {
                if (!r.is_draft) return;
                r.is_draft = false;
                r.returned_at = new Date().toISOString();
              }),
            );
          }
          s.version += 1;
          write(s);
          return real(name, params);
        }
        if (/^upsert_(tag_)?score$|^upsert_rubric_score$|^save_score_comment$/.test(name)) {
          // The triggers: a save in a class that holds grades waits as a draft.
          const aid = params.p_assessment_id;
          const sid = params.p_enrollment_id;
          const of = s.rows[aid] || (s.rows[aid] = {});
          of[sid] = holds(s)
            ? Object.assign({}, of[sid], { is_draft: true })
            : { is_draft: false, returned_at: new Date().toISOString() };
          write(s);
          return real(name, params);
        }
        if (name === 'return_grades') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          const at = new Date().toISOString();
          const done = [];
          (params.p_enrollment_ids || []).forEach(sid => {
            const row = (s.rows[params.p_assessment_id] || {})[sid];
            if (!row || !row.is_draft) return;
            row.is_draft = false;
            row.returned_at = at;
            done.push(sid);
          });
          write(s);
          return ok({ returned: done.length, enrollment_ids: done, returned_at: at });
        }
        if (name === 'list_student_cards') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          return ok(s.cards);
        }
        if (name === 'issue_student_cards') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          let made = 0;
          seed.students.forEach(st => {
            if (s.cards.some(c => c.enrollment_id === st.id)) return;
            s.seq += 1;
            const identity = !!(st.dateOfBirth || st.studentNumber);
            s.cards.push({
              id: 'e2e00000-0000-4000-8000-' + String(900 + s.seq).padStart(12, '0'),
              enrollment_id: st.id,
              code: 'K7M-4Q' + (s.seq + 1),
              created_at: new Date().toISOString(),
              printed_at: null,
              last_opened_at: null,
              locked_at: null,
              wrong_tries: 0,
              wrong_tries_7d: 0,
              works_until: '2027-06-30',
              check: identity ? 'identity' : 'password',
              password: identity ? null : '4821',
            });
            made += 1;
          });
          write(s);
          return ok({ issued: made, cards: s.cards });
        }
        if (name === 'mark_student_cards_printed') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          const at = new Date().toISOString();
          let n = 0;
          s.cards.forEach(c => {
            if ((params.p_card_ids || []).indexOf(c.id) < 0) return;
            c.printed_at = at;
            n += 1;
          });
          write(s);
          return ok({ printed: n });
        }
        return real(name, params);
      };
    },
    { seed: SEED, start },
  );
}

const log = page => page.evaluate(() => window.__e2eRpcLog.map(c => ({ name: c.name, params: c.params })));
const calls = async (page, name) => (await log(page)).filter(c => c.name === name).map(c => c.params);
const server = page => page.evaluate(() => JSON.parse(localStorage.getItem('e2e-s0w1-server')));

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
const level = (dialog, n) =>
  dialog.locator('[data-action="graderTagLevel"][data-tag="' + TAG + '"][data-level="' + n + '"]');

test('with the student page off, a signed-in class asks the server nothing new and shows none of it', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // As every class made since Batch A is on the server: When I Return Them, the page off.
  await serverWithStudentPage(page, { course: { student_page_enabled: false, return_grades: 'on_return' } });
  await page.goto('/dashboard?manage=student-page');
  await expect(page.locator('.cm-tabs [role="tab"]')).toHaveCount(6);
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveCount(0);
  expect(await page.evaluate(cid => getReturnSettings(cid), CID)).toEqual({
    student_page: false,
    return_grades: 'on_return',
  });

  // Grade in the dialog: no Draft, no Return.
  const dialog = await openGrader(page, ALICE);
  await level(dialog, 3).click();
  await expect(dialog.locator('.grader-foot .grader-grade')).toContainText('Proficient');
  await expect(dialog.locator('.grader-draft-mark')).toHaveCount(0);
  await expect(dialog.locator('.grader-return')).toHaveCount(0);
  await expect(page.locator('.gb-draft')).toHaveCount(0);
  await expect.poll(async () => (await calls(page, 'upsert_tag_score')).length).toBe(1);
  // A class setting saved goes without the two keys.
  await page.evaluate(
    cid => saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), { calcMethod: 'average' })),
    CID,
  );
  await expect.poll(async () => (await calls(page, 'update_course')).length).toBe(1);
  const patch = (await calls(page, 'update_course'))[0].p_patch;
  expect('student_page_enabled' in patch).toBe(false);
  expect('return_grades' in patch).toBe(false);

  // Nothing this build added was called, and no row is kept.
  expect((await log(page)).filter(c => NEW_RPCS.test(c.name))).toEqual([]);
  expect(await page.evaluate(cid => localStorage.getItem('gb-grade-returns-' + cid), CID)).toBe(null);
  expect(errors).toEqual([]);
});

test('switch on at the build address, a draft, Return, and a card for each student', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await serverWithStudentPage(page, { course: { student_page_enabled: false, return_grades: 'on_return' } });

  // The switch: one update_course, then the class's rows are read.
  await page.goto('/dashboard?manage=student-page&build=student-page');
  const theSwitch = page.getByRole('switch', { name: 'Student Page' });
  await expect(theSwitch).not.toBeChecked();
  await page.locator('.sp-build .gpd-switch').click();
  await expect(theSwitch).toBeChecked();
  await expect.poll(async () => (await calls(page, 'update_course')).length).toBe(1);
  expect((await calls(page, 'update_course'))[0]).toEqual({
    p_course_id: CID,
    p_patch: { student_page_enabled: true, return_grades: 'on_return' },
  });
  await expect.poll(async () => (await calls(page, 'list_course_grade_returns')).length).toBeGreaterThan(0);
  expect((await calls(page, 'list_course_grade_returns'))[0]).toEqual({ p_course_id: CID });
  expect((await server(page)).course).toEqual({ student_page_enabled: true, return_grades: 'on_return' });
  // The class's own choice shows: it was made When I Return Them.
  const group = page.getByRole('radiogroup', { name: 'Return Grades' });
  await expect(group.getByRole('radio', { name: 'When I Return Them' })).toBeChecked();

  // A reload at the plain address: the settings come back from the server with the class.
  await page.goto('/dashboard?manage=student-page');
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#sp-build-switch')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(cid => _gradeReturnsLoadedFor[cid] === true, CID), { timeout: 10000 })
    .toBe(true);

  // A grade saved in the dialog is a Draft at once.
  let dialog = await openGrader(page, ALICE);
  await level(dialog, 3).click();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');
  await expect(dialog.locator('.grader-draft-text')).toHaveText('Saved. Not returned yet.');
  await expect.poll(async () => (await calls(page, 'upsert_tag_score')).length).toBe(1);
  expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.sid, a.aid), { cid: CID, sid: ALICE, aid: LAB })).toBe(
    'draft',
  );
  // The server holds the same draft; once the write has landed the rows are read again and agree.
  await expect.poll(async () => ((await server(page)).rows[LAB] || {})[ALICE]).toEqual({ is_draft: true });

  // Return: one call, for this student and this work, with a key.
  await dialog.locator('.grader-return [data-grader="return"]').click();
  await expect(dialog.locator('.grader-returned')).toHaveText(/^Returned /);
  await expect.poll(async () => (await calls(page, 'return_grades')).length).toBe(1);
  const sent = (await calls(page, 'return_grades'))[0];
  expect(Object.keys(sent).sort()).toEqual(['p_assessment_id', 'p_enrollment_ids', 'p_idempotency_key']);
  expect(sent.p_assessment_id).toBe(LAB);
  expect(sent.p_enrollment_ids).toEqual([ALICE]);
  expect(sent.p_idempotency_key).toMatch(UUID);
  // It went after the score it returns.
  const order = (await log(page)).map(c => c.name).filter(n => n === 'upsert_tag_score' || n === 'return_grades');
  expect(order).toEqual(['upsert_tag_score', 'return_grades']);
  await expect.poll(async () => (await server(page)).rows[LAB][ALICE].is_draft).toBe(false);
  await dialog.locator('.grader-done').click();

  // A reload: the state is the server's.
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  await expect
    .poll(() => page.evaluate(cid => _gradeReturnsLoadedFor[cid] === true, CID), { timeout: 10000 })
    .toBe(true);
  expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.sid, a.aid), { cid: CID, sid: ALICE, aid: LAB })).toBe(
    'returned',
  );
  await expect(page.locator('.gb-draft')).toHaveCount(0);

  // Student Cards.
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  await expect(card.locator('.sc-table tbody tr')).toHaveCount(3);
  await expect(card.locator('.sc-code')).toHaveText(['No Card Yet', 'No Card Yet', 'No Card Yet']);
  expect((await calls(page, 'list_student_cards')).pop()).toEqual({ p_course_id: CID });
  await card.getByRole('button', { name: 'Make Cards' }).click();
  await expect(card.locator('.sc-code')).toHaveText(['K7M-4Q2', 'K7M-4Q3', 'K7M-4Q4']);
  const issued = await calls(page, 'issue_student_cards');
  expect(issued.length).toBe(1);
  expect(issued[0].p_course_id).toBe(CID);
  expect(issued[0].p_enrollment_ids).toBe(null);
  expect(issued[0].p_idempotency_key).toMatch(UUID);
  await expect(card.getByRole('button')).toHaveText(['Print All']);

  // Print All: the three cards on one sheet, the QR carrying the code after #.
  await page.evaluate(() => {
    window.__sheet = null;
    window.print = () => {
      var root = document.getElementById('qr-slips-root');
      window.__sheet = {
        cells: root.querySelectorAll('.qs-slip').length,
        names: Array.from(root.querySelectorAll('.qs-name')).map(e => e.textContent),
        classes: Array.from(root.querySelectorAll('.qs-class')).map(e => e.textContent),
        codes: Array.from(root.querySelectorAll('.qs-type:not(.qs-pass) strong')).map(e => e.textContent),
        passwords: Array.from(root.querySelectorAll('.qs-pass strong')).map(e => e.textContent),
      };
    };
  });
  await card.getByRole('button', { name: 'Print All' }).click();
  await page.waitForFunction(() => !!window.__sheet);
  expect(await page.evaluate(() => window.__sheet)).toEqual({
    cells: 3,
    names: ['Alice Anderson', 'Bob Baker', 'Charlie Chen'],
    classes: ['Science 8 · Block B', 'Science 8 · Block B', 'Science 8 · Block B'],
    codes: ['K7M-4Q2', 'K7M-4Q3', 'K7M-4Q4'],
    passwords: ['4821'],
  });
  expect(await page.evaluate(() => StudentCards.cardUrl({ code: 'K7M-4Q2' }, 'https://fullvision.ca'))).toBe(
    'https://fullvision.ca/s/#K7M-4Q2',
  );
  await expect.poll(async () => (await calls(page, 'mark_student_cards_printed')).length).toBe(1);
  const marked = (await calls(page, 'mark_student_cards_printed'))[0];
  expect(marked.p_card_ids).toEqual((await server(page)).cards.map(c => c.id));
  expect(marked.p_idempotency_key).toMatch(UUID);
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(3);

  // No code or password is kept on this device.
  const kept = await page.evaluate(() => {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k !== 'e2e-s0w1-server' && /K7M-4Q|4821/.test(localStorage.getItem(k))) out.push(k);
    }
    return out;
  });
  expect(kept).toEqual([]);

  // The sync dot is quiet, and nothing asked for a count of drafts.
  await expect(page.locator('#sync-indicator-dot').first()).toHaveClass(/idle/);
  expect((await log(page)).filter(c => c.name === 'course_draft_count')).toEqual([]);
  expect(errors).toEqual([]);
});
