/**
 * Show My Learning in a signed-in class (S13-W2), against a stand-in
 * server: Class Settings › Student Page offers the switch for a class whose
 * student page the server has on, off as the server says; turned on, it
 * sends set_course_feedback_options with { show_my_learning: true } and a
 * key, and stays on across a reload because the server keeps it. The class
 * is graded by letter (as History 12 is), and the row names it.
 *
 * helpers.js `mockAuth` answers the class load. This file adds the course
 * row's student-page settings and set_course_feedback_options, kept in
 * localStorage under e2e-ml-server so they last across the reload.
 */
import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers.js';

test.use({ viewport: { width: 1366, height: 900 } });

const id = n => 'e2e00000-0000-4000-8000-' + String(n).padStart(12, '0');
const CID = id(1);
const ALICE = id(11);
const SUBJECT = id(40);
const SECTION = id(41);
const TAG = id(51);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEED = {
  cid: CID,
  course: { id: CID, name: 'History 12', gradingSystem: 'letter', calcMethod: 'mostRecent', gradeLevel: '12' },
  students: [
    {
      id: ALICE,
      firstName: 'Alice',
      lastName: 'Anderson',
      preferred: 'Alice',
      pronouns: '',
      studentNumber: '',
      email: '',
      dateOfBirth: '',
      designations: [],
      enrolledDate: '',
      attendance: [],
      sortName: 'Anderson Alice',
    },
  ],
  learningMap: {
    _flatVersion: 2,
    subjects: [{ id: SUBJECT, name: 'History 12', color: '#0891b2' }],
    sections: [
      {
        id: SECTION,
        subject: SUBJECT,
        name: 'Using Evidence',
        shortName: 'Evidence',
        color: '#0891b2',
        tags: [{ id: TAG, label: 'Use Evidence', text: '', color: '#0891b2', subject: SUBJECT }],
      },
    ],
  },
};

async function server(page) {
  await mockAuth(page);
  await page.addInitScript(seed => {
    const KEY = 'e2e-ml-server';
    if (!localStorage.getItem(KEY)) {
      const cid = seed.cid;
      localStorage.setItem('gb-courses', JSON.stringify({ [cid]: seed.course }));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-lastActiveCourse', cid);
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(seed.learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(seed.students));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([]));
      localStorage.setItem('gb-scores-' + cid, JSON.stringify({}));
      localStorage.setItem(
        KEY,
        JSON.stringify({
          course: {
            student_page_enabled: true,
            return_grades: 'on_return',
            send_work: false,
            reflect_on_feedback: false,
            show_my_learning: false,
          },
        }),
      );
    }
    const read = () => JSON.parse(localStorage.getItem(KEY));
    const write = s => localStorage.setItem(KEY, JSON.stringify(s));
    const ok = data => Promise.resolve({ data, error: null });
    const log = (name, params) => window.__e2eRpcLog.push({ name, params, at: Date.now() });
    const client = window._supabase;
    const real = client.rpc;

    client.rpc = function (name, params) {
      params = params || {};
      const s = read();
      if (name === 'get_class_bundle') {
        return real(name, { p_course_id: params.p_course_id, p_if_version: null }).then(res => {
          if (res.data && res.data.gradebook) Object.assign(res.data.gradebook.course, s.course);
          return res;
        });
      }
      if (name === 'set_course_feedback_options') {
        log(name, params);
        Object.assign(s.course, params.p_patch);
        write(s);
        return ok({ reflect_on_feedback: s.course.reflect_on_feedback, show_my_learning: s.course.show_my_learning });
      }
      return real(name, params);
    };
  }, SEED);
}

const calls = (page, name) => page.evaluate(n => window.__e2eRpcLog.filter(c => c.name === n).map(c => c.params), name);

test('Show My Learning turned on in a signed-in Letter class is sent to the server and kept', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await server(page);

  await page.goto('/dashboard?manage=student-page');
  const learning = page.getByRole('switch', { name: 'Show My Learning' });
  await expect(learning).toBeVisible();
  await expect(learning).not.toBeChecked();
  await expect(page.locator('#sp-learning-would')).toContainText('grading style (Letter)');
  await expect(page.locator('.sp-learning')).not.toContainText("can't show My Learning");

  await page.locator('.sp-learning .gpd-switch').click();
  await expect(learning).toBeChecked();
  await expect.poll(async () => (await calls(page, 'set_course_feedback_options')).length).toBe(1);
  const [sent] = await calls(page, 'set_course_feedback_options');
  expect(sent.p_course_id).toBe(CID);
  expect(sent.p_patch).toEqual({ show_my_learning: true });
  expect(sent.p_idempotency_key).toMatch(UUID);
  // Reflect on Feedback was not touched.
  await expect(page.getByRole('switch', { name: 'Reflect on Feedback' })).not.toBeChecked();

  // The server keeps it: after a reload the switch is still on.
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Show My Learning' })).toBeChecked();
  expect(errors).toEqual([]);
});
