import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers.js';
import { catchPrints, fakeTeacherCards, heldAnywhere, serveTeacherCards, sheets } from './student-card-fake.js';

// S0-W1: Draft and Returned and student cards for a signed-in teacher, in
// the browser, against a stand-in server.
//
// - With the class's student page off, nothing new is asked of the server
//   and no screen shows any of it.
// - At the build address the switch turns it on: the server is asked
//   first, for the switch alone, and the class is on only once it has
//   answered; then the class and its rows are read.
// - Starting to hold grades needs a connection: offline, the control says
//   it could not be changed and nothing changes. Stopping asks the server
//   how many grades wait, and asks the teacher before returning them.
// - A grade saved in the dialog is a Draft at once; Return sends
//   return_grades for that student and that work, with a key.
// - Student Cards: Make and Print asks the teacher-cards function (its real
//   handler over a stand-in database), prints, and marks the cards printed
//   (mark_student_cards_printed); no code is shown in the list or kept on
//   the device; a lost reply ends with printed cards and no message.
//
// helpers.js `mockAuth` answers the class load. This file wraps it with the
// part of the server this build added: the two settings on the course row,
// the rows, Return and the cards' list (from the teacher-cards stand-in). Its state is kept in localStorage under
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
async function serverWithStudentPage(page, start, cardOpts) {
  // The teacher-cards function and its database: its real handler over a stand-in.
  const fake = await fakeTeacherCards({
    course: CID,
    tokens: ['e2e-test-token'],
    students: [
      { id: ALICE, first: 'Alice', number: '1001' },
      { id: BOB, first: 'Bob', birthday: '2012-05-06' },
      { id: CHARLIE, first: 'Charlie' },
    ],
  });
  const posts = await serveTeacherCards(page, fake, cardOpts);
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
        localStorage.setItem(KEY, JSON.stringify({ version: 1, course: start.course, rows: start.rows || {} }));
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
        if (name === 'course_draft_count') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          let n = 0;
          Object.values(s.rows).forEach(of => Object.values(of).forEach(r => (n += r.is_draft ? 1 : 0)));
          return ok(n);
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
          // The cards as the stand-in teacher-cards database holds them, shaped as after S3-M1.
          return window.__e2eCardList().then(data => ({ data, error: null }));
        }
        if (name === 'mark_student_cards_printed') {
          window.__e2eRpcLog.push({ name, params, at: Date.now() });
          // A test can hold Mark Printed back: the server never hears it.
          if (window.__e2eHoldMarks) return new Promise(() => {});
          return window.__e2eCardsPrinted(params.p_card_ids || []).then(data => ({ data, error: null }));
        }
        return real(name, params);
      };
    },
    { seed: SEED, start },
  );
  return { fake, posts };
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
  const cards = await serverWithStudentPage(page, {
    course: { student_page_enabled: false, return_grades: 'on_return' },
  });

  // The switch: the server is asked for it alone, then the class and its rows are read.
  await page.goto('/dashboard?manage=student-page&build=student-page');
  const theSwitch = page.getByRole('switch', { name: 'Student Page' });
  await expect(theSwitch).not.toBeChecked();
  await page.locator('.sp-build .gpd-switch').click();
  await expect(theSwitch).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: 'Return Grades' })).toBeVisible();
  expect(await calls(page, 'update_course')).toEqual([{ p_course_id: CID, p_patch: { student_page_enabled: true } }]);
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

  // Student Cards: no card yet, one button.
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  await expect(card.locator('.sc-table tbody tr')).toHaveCount(3);
  await expect(card.locator('.sc-which')).toHaveText(['No Card Yet', 'No Card Yet', 'No Card Yet']);
  expect((await calls(page, 'list_student_cards')).pop()).toEqual({ p_course_id: CID });
  await expect(card.locator('.sc-actions button')).toHaveText(['Make and Print 3 Cards']);

  // Make and Print: one request to teacher-cards with the teacher's sign-in, then the print dialog.
  await catchPrints(page);
  await card.getByRole('button', { name: 'Make and Print 3 Cards' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  expect(cards.posts.length).toBe(1);
  const asked = cards.posts[0];
  expect(asked.url).toMatch(/\/functions\/v1\/teacher-cards\?forceFunctionRegion=ca-central-1$/);
  expect(asked.headers.authorization).toBe('Bearer e2e-test-token');
  expect(Object.keys(asked.body).sort()).toEqual(['course_id', 'items', 'request_id']);
  expect(asked.body.course_id).toBe(CID);
  expect(asked.body.request_id).toMatch(UUID);
  expect(asked.body.items).toEqual([ALICE, BOB, CHARLIE].map(enrollment_id => ({ enrollment_id, replaces: null })));
  // No RPC makes a card.
  expect((await log(page)).filter(c => /issue/.test(c.name))).toEqual([]);
  const [sheet] = await sheets(page);
  expect(sheet.names).toEqual(['Alice Anderson', 'Bob Baker', 'Charlie Chen']);
  expect(sheet.classes).toEqual(['Science 8 · Block B']);
  expect(sheet.numbers).toEqual(['Card 1', 'Card 1', 'Card 1']);
  sheet.codes.forEach(code => expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/));
  // Only Charlie has no birthday or student number: only his card prints a password.
  expect(sheet.passwords.length).toBe(1);
  expect(sheet.passwords[0]).toMatch(/^\d{4}$/);

  // Marked printed, through the outbox, with the live cards' ids.
  await expect.poll(async () => (await calls(page, 'mark_student_cards_printed')).length).toBe(1);
  const marked = (await calls(page, 'mark_student_cards_printed'))[0];
  expect(marked.p_card_ids).toEqual([ALICE, BOB, CHARLIE].map(sid => cards.fake.live(sid).id));
  expect(marked.p_idempotency_key).toMatch(UUID);
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(3);
  await expect(card.locator('.sc-which').first()).toHaveText(/^Card 1 · Made \w+ \d+$/);
  await expect(card.locator('.sc-note')).toHaveText(
    '3 cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
  );

  // No code or password on the screen or anywhere on this device.
  const shownText = await page.locator('body').innerText();
  const kept = await heldAnywhere(page);
  for (const code of sheet.codes.concat(sheet.passwords)) {
    expect(shownText).not.toContain(code);
    expect(kept).not.toContain(code);
    expect(kept).not.toContain(code.replace('-', ''));
  }

  // Print Again prints the same; after a reload it is gone, and the server's list shows the cards printed.
  await card.getByRole('button', { name: 'Print Again' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(2);
  expect((await sheets(page))[1].codes).toEqual(sheet.codes);
  await page.reload();
  await expect(page.locator('.sc-card .sc-status', { hasText: /^Printed / })).toHaveCount(3);
  await expect(page.locator('.sc-card .sc-which')).toHaveText(Array(3).fill(/^Card 1 · Made /));
  await expect(page.locator('.sc-card .sc-actions button')).toHaveText(['New Codes for This Class']);

  // The sync dot is quiet, and nothing asked for a count of drafts.
  await expect(page.locator('#sync-indicator-dot').first()).toHaveClass(/idle/);
  expect((await log(page)).filter(c => c.name === 'course_draft_count')).toEqual([]);
  expect(errors).toEqual([]);
});

test('starting to hold grades needs a connection; stopping asks the server how many wait', async ({
  page,
  context,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // The class's student page is on, set to As Soon As I Save.
  await serverWithStudentPage(page, { course: { student_page_enabled: true, return_grades: 'on_save' } });
  await page.goto('/dashboard?manage=student-page&build=student-page');
  const group = page.getByRole('radiogroup', { name: 'Return Grades' });
  const onReturn = group.getByRole('radio', { name: 'When I Return Them' });
  const onSave = group.getByRole('radio', { name: 'As Soon As I Save' });
  await expect(onSave).toBeChecked();
  await expect
    .poll(() => page.evaluate(cid => _gradeReturnsLoadedFor[cid] === true, CID), { timeout: 10000 })
    .toBe(true);

  // Offline: When I Return Them is not made, and the row says so.
  await context.setOffline(true);
  await onReturn.click();
  await expect(page.locator('#sp-return-note')).toHaveText(
    'Could not change this. Check the connection and try again.',
  );
  await expect(onSave).toBeChecked();
  await expect(onReturn).not.toBeChecked();
  expect(await page.evaluate(cid => getReturnSettings(cid).return_grades, CID)).toBe('on_save');
  expect(await calls(page, 'update_course')).toEqual([]);
  expect(await page.evaluate(() => window.v2Queue.stats().queued)).toBe(0);

  // Online: it is asked of the server, for that one setting, and then shows.
  await context.setOffline(false);
  await onReturn.click();
  await expect(onReturn).toBeChecked();
  await expect(page.locator('#sp-return-note')).toHaveCount(0);
  expect(await calls(page, 'update_course')).toEqual([{ p_course_id: CID, p_patch: { return_grades: 'on_return' } }]);
  expect((await server(page)).course).toEqual({ student_page_enabled: true, return_grades: 'on_return' });

  // A grade saved now waits as a draft, here and on the server.
  await page.evaluate(a => Grader.setLevel(a.cid, a.sid, a.aid, a.tag, 3, 0), {
    cid: CID,
    sid: ALICE,
    aid: LAB,
    tag: TAG,
  });
  await expect.poll(async () => ((await server(page)).rows[LAB] || {})[ALICE]).toEqual({ is_draft: true });

  // Turning the page off offline: the count cannot be read, so it stays on.
  const theSwitch = page.getByRole('switch', { name: 'Student Page' });
  await expect(theSwitch).toBeChecked();
  await context.setOffline(true);
  await page.locator('.sp-build .gpd-switch').click();
  await expect(page.locator('#sp-switch-note')).toHaveText(
    'Could not check for grades waiting to be returned. Check the connection and try again.',
  );
  await expect(theSwitch).toBeChecked();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(cid => getReturnSettings(cid).student_page, CID)).toBe(true);

  // Online: the server's count is asked, and the teacher is asked before anything is returned.
  await context.setOffline(false);
  await page.locator('.sp-build .gpd-switch').click();
  const ask = page.getByRole('dialog', { name: 'Return 1 Grade Now?' });
  await expect(ask).toBeVisible();
  await expect(ask.locator('.confirm-message')).toHaveText(
    '1 grade is waiting as a draft. Changing this returns it to the student now.',
  );
  expect((await calls(page, 'course_draft_count')).pop()).toEqual({ p_course_id: CID });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(theSwitch).toBeChecked();
  expect((await server(page)).rows[LAB][ALICE].is_draft).toBe(true);
  await page.locator('.sp-build .gpd-switch').click();
  await page
    .getByRole('dialog', { name: 'Return 1 Grade Now?' })
    .getByRole('button', { name: 'Return and Change' })
    .click();
  await expect(theSwitch).not.toBeChecked();
  await expect.poll(async () => (await calls(page, 'update_course')).length).toBe(2);
  expect((await calls(page, 'update_course'))[1]).toEqual({
    p_course_id: CID,
    p_patch: { student_page_enabled: false },
  });
  // The server returned it itself; no return was sent.
  expect(await calls(page, 'return_grades')).toEqual([]);
  await expect.poll(async () => (await server(page)).rows[LAB][ALICE].is_draft).toBe(false);
  expect(errors).toEqual([]);
});

/* A reply lost on the way back (the card-codes design, section 7): the
   function made the cards, but the page never heard. The retry under the
   same request id is answered as a replay with no codes; the page asks
   again, naming those cards; fresh codes are printed. The teacher sees no
   message, only printed cards. */
test('Make and Print: a lost reply ends with printed cards and no message', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cards = await serverWithStudentPage(
    page,
    { course: { student_page_enabled: true, return_grades: 'on_return' } },
    { lose: (post, n) => n === 1 },
  );
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  await expect(card.locator('.sc-actions button')).toHaveText(['Make and Print 3 Cards']);
  await catchPrints(page);
  await card.getByRole('button', { name: 'Make and Print 3 Cards' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  // The lost one, the same one again (a replay), and one naming the cards it made.
  expect(cards.posts.length).toBe(3);
  expect(cards.posts[1].body).toEqual(cards.posts[0].body);
  expect(cards.posts[2].body.request_id).not.toBe(cards.posts[0].body.request_id);
  const firstMade = cards.fake.db.state.cards.slice(0, 3);
  expect(cards.posts[2].body.items).toEqual(firstMade.map(k => ({ enrollment_id: k.enrollment_id, replaces: k.id })));
  expect(firstMade.every(k => k.stopped)).toBe(true);
  const [sheet] = await sheets(page);
  expect(sheet.names).toEqual(['Alice Anderson', 'Bob Baker', 'Charlie Chen']);
  expect(sheet.numbers).toEqual(['Card 2', 'Card 2', 'Card 2']);
  await expect.poll(async () => (await calls(page, 'mark_student_cards_printed')).length).toBe(1);
  expect((await calls(page, 'mark_student_cards_printed'))[0].p_card_ids).toEqual(
    [ALICE, BOB, CHARLIE].map(sid => cards.fake.live(sid).id),
  );
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(3);
  // No message but the usual line.
  await expect(card.locator('.sc-note')).toHaveText(
    '3 cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
  );
  await expect(page.locator('.toast, [role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/* S3-F2 signed in: New Codes for This Class names each student's live card
   in `replaces`; when part of the run gets no answer, what was made is
   printed and a line names the students still on their old card; Print
   New Card on one of them asks first and takes them off the line. No code
   on the page or the device afterwards. The class goes one student to a
   request here so a part-failed run can be made; a real class goes 250 to
   a request. Set S3F2_SHOTS to a folder for a picture of the line. */
test('New Codes for This Class: a part-failed run names who still has their old card; Print New Card fixes one', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // 1: Make and Print. 2: Alice's new code. 3 and its retry 4: Bob's, lost. Charlie's is never sent.
  const cards = await serverWithStudentPage(
    page,
    { course: { student_page_enabled: true, return_grades: 'on_return' } },
    { fail: (post, n) => n === 3 || n === 4 },
  );
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  await catchPrints(page);
  await card.getByRole('button', { name: 'Make and Print 3 Cards' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(3);
  const firstCards = [ALICE, BOB, CHARLIE].map(sid => cards.fake.live(sid).id);

  await page.evaluate(() => StudentCards._setBatch(1));
  await card.getByRole('button', { name: 'New Codes for This Class' }).click();
  const ask = page.getByRole('dialog', { name: 'New Codes for All 3 Students?' });
  await expect(ask.locator('.confirm-message')).toHaveText(
    "3 cards stop working now. Print the new cards and hand them out. Students can't open their page until they have their new card. Everything they have sent stays.",
  );
  await ask.getByRole('button', { name: 'Make 3 New Cards' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(2);
  const two = (await sheets(page))[1];
  expect(two.names).toEqual(['Alice Anderson']);
  expect(cards.posts.length).toBe(4);
  expect(cards.posts[1].body.items).toEqual([{ enrollment_id: ALICE, replaces: firstCards[0] }]);
  await expect(card.locator('.sc-note .sc-note-line')).toHaveText([
    '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
    '2 students still have their old card: Bob Baker, Charlie Chen. Use Print New Card on their rows to try again.',
  ]);
  expect(cards.fake.live(BOB).id).toBe(firstCards[1]);
  expect(cards.fake.live(CHARLIE).id).toBe(firstCards[2]);
  if (process.env.S3F2_SHOTS) {
    await page.waitForTimeout(400);
    await card.screenshot({ path: process.env.S3F2_SHOTS + '/s3f2-part-failed.png' });
  }

  // Print New Card for Bob: asked first (his card was printed), then printed.
  await card.getByRole('button', { name: 'Print a New Card for Bob Baker' }).click();
  const one = page.getByRole('dialog', { name: 'Print a New Card for Bob?' });
  await expect(one.locator('.confirm-message')).toHaveText(
    'The card Bob has now stops working as soon as the new one is made. Everything Bob has sent stays.',
  );
  await one.getByRole('button', { name: 'Print New Card' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(3);
  expect(cards.posts[cards.posts.length - 1].body.items).toEqual([{ enrollment_id: BOB, replaces: firstCards[1] }]);
  await expect(card.locator('.sc-note .sc-note-line')).toHaveText([
    '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
    '1 student still has their old card: Charlie Chen. Use Print New Card on their row to try again.',
  ]);

  const all = await sheets(page);
  const shownText = await page.locator('body').innerText();
  const kept = await heldAnywhere(page);
  for (const sheet of all) {
    for (const code of sheet.codes.concat(sheet.passwords)) {
      expect(shownText).not.toContain(code);
      expect(kept).not.toContain(code);
      expect(kept).not.toContain(code.replace('-', ''));
    }
  }
  expect(errors).toEqual([]);
});

test('Make and Print offline says so and makes nothing; an answer after Class Settings closes prints nothing', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  let hold = null;
  const cards = await serverWithStudentPage(
    page,
    { course: { student_page_enabled: true, return_grades: 'on_return' } },
    { fail: (post, n) => n <= 2 },
  );
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  await catchPrints(page);
  await card.getByRole('button', { name: 'Make and Print 3 Cards' }).click();
  await expect(card.locator('.sc-note')).toHaveText('Could not make the cards. Check the connection and try again.');
  expect(await sheets(page)).toEqual([]);
  expect(cards.fake.db.state.cards).toEqual([]);
  await expect(card.locator('.sc-which')).toHaveText(['No Card Yet', 'No Card Yet', 'No Card Yet']);

  // A slow answer that lands after Class Settings has closed: nothing is printed.
  await page.route('**/functions/v1/teacher-cards**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    await new Promise(r => (hold = r));
    return route.fallback();
  });
  await card.getByRole('button', { name: 'Make and Print 3 Cards' }).click();
  await expect.poll(() => !!hold).toBe(true);
  await page.locator('[data-action="closeClassManager"]').first().click();
  await expect(page.locator('.sc-card')).toHaveCount(0);
  hold();
  await expect.poll(() => cards.fake.db.state.cards.length).toBe(3);
  await page.waitForTimeout(300);
  expect(await sheets(page)).toEqual([]);
  // Back on the screen: the cards that were made show Not Printed, and Make and Print replaces them.
  await page.goto('/dashboard?manage=student-page');
  await expect(page.locator('.sc-card .sc-status')).toHaveText(['Not Printed', 'Not Printed', 'Not Printed']);
  await expect(page.locator('.sc-card .sc-actions button')).toHaveText(['Make and Print 3 Cards']);
  expect(errors).toEqual([]);
});

/* The review of Nov 10: a list read again before Mark Printed reaches the
   server must not show just-printed cards as Not Printed, or the next
   press would replace them without asking. */
test('Make and Print with Mark Printed held back: a list read again keeps the cards printed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cards = await serverWithStudentPage(page, {
    course: { student_page_enabled: true, return_grades: 'on_return' },
  });
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  await page.evaluate(() => (window.__e2eHoldMarks = true));
  await catchPrints(page);
  await card.getByRole('button', { name: 'Make and Print 3 Cards' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(3);
  // The server still says Not Printed; the list is read again from it.
  expect(cards.fake.cardsListed().every(c => c.printed_at === null)).toBe(true);
  const reads = (await calls(page, 'list_student_cards')).length;
  await page.evaluate(cid => StudentCards.load(cid), CID);
  expect((await calls(page, 'list_student_cards')).length).toBe(reads + 1);
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(3);
  await expect(card.getByRole('button', { name: /^Make and Print/ })).toHaveCount(0);
  expect(cards.posts.length).toBe(1);
  expect(errors).toEqual([]);
});
