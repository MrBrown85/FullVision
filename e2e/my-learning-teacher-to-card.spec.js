/**
 * Show My Learning from end to end, with the e2e fakes (S13-W2). A signed-in
 * teacher turns Show My Learning on for a Letter class (set_course_feedback_options,
 * kept by the teacher's stand-in server). The student's card for that class is
 * then served by the student-submit function's own handler (the fake of
 * tests/helpers/fake-student-submit.js), with `page` answering as
 * student_submit.page does: the teacher's own reply for that student
 * (StudentView.reply, which tests/student-view.test.js holds equal to the SQL)
 * and, only while the switch is on in the teacher's server, `learning` in the
 * shape of migrations/2026111201 (as tests/my-learning-device-matches-preview.test.js
 * writes it). The card shows the My Learning tab, and its overall letter and
 * percent equal Preview as Student's for the same student.
 *
 * What this cannot prove: the SQL itself (the fakes stand in for the database;
 * migrations/local-test/my_learning_rest.py runs the SQL).
 */
import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers.js';
import { PHONE, TODAY, serve } from './student-card-fake.js';
import { fakeStudentSubmit, sampleCard, CECE, OMAR } from '../tests/helpers/fake-student-submit.js';

test.use({ viewport: { width: 1366, height: 900 } });

const id = n => 'e2e00000-0000-4000-8000-' + String(n).padStart(12, '0');
const CID = id(1);
const SUBJECT = id(40);
const SECTION = id(41);
const SECTION2 = id(42);
const TAG = id(51);
const TAG2 = id(52);
const QUIZ = id(31);
const ESSAY = id(32);
const TEST = id(33);

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
const piece = (aid, title, date, extra) =>
  Object.assign(
    {
      id: aid,
      title,
      date,
      type: 'summative',
      tagIds: [],
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
    extra,
  );
const SEED = {
  cid: CID,
  course: { id: CID, name: 'History 12', gradingSystem: 'letter', calcMethod: 'mostRecent', gradeLevel: '12' },
  // Omar is first by last name (Adeyemi), Cece second: Preview picks Cece by her id, never by place.
  students: [student(OMAR, 'Omar', 'Adeyemi'), student(CECE, 'Cece', 'Zhou')],
  assessments: [
    piece(QUIZ, 'Map Quiz', '2026-10-01', { scoreMode: 'points', maxPoints: 10, tagIds: [TAG] }),
    piece(ESSAY, 'DBQ Essay', '2026-10-05', { tagIds: [TAG, TAG2] }),
    piece(TEST, 'Unit Test', '2026-10-20', { scoreMode: 'points', maxPoints: 20, tagIds: [TAG2] }),
  ],
  scores: {
    [CECE]: [
      { assessmentId: QUIZ, tagId: TAG, score: 7 },
      { assessmentId: ESSAY, tagId: TAG, score: 3 },
      { assessmentId: ESSAY, tagId: TAG2, score: 4 },
      { assessmentId: TEST, tagId: TAG2, score: 13 },
    ],
    [OMAR]: [
      { assessmentId: QUIZ, tagId: TAG, score: 10 },
      { assessmentId: TEST, tagId: TAG2, score: 20 },
    ],
  },
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
      {
        id: SECTION2,
        subject: SUBJECT,
        name: 'Significance',
        shortName: 'Significance',
        color: '#0891b2',
        tags: [{ id: TAG2, label: 'Historical Significance', text: '', color: '#0891b2', subject: SUBJECT }],
      },
    ],
  },
};

async function teacherServer(page) {
  await mockAuth(page);
  await page.addInitScript(seed => {
    const KEY = 'e2e-ml-e2e-server';
    if (!localStorage.getItem(KEY)) {
      const cid = seed.cid;
      localStorage.setItem('gb-courses', JSON.stringify({ [cid]: seed.course }));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-lastActiveCourse', cid);
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(seed.learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(seed.students));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(seed.assessments));
      localStorage.setItem('gb-scores-' + cid, JSON.stringify(seed.scores));
      localStorage.setItem(
        KEY,
        JSON.stringify({
          course: {
            student_page_enabled: true,
            return_grades: 'on_save',
            send_work: false,
            reflect_on_feedback: false,
            show_my_learning: false,
          },
        }),
      );
    }
    const read = () => JSON.parse(localStorage.getItem(KEY));
    const write = s => localStorage.setItem(KEY, JSON.stringify(s));
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
        window.__e2eRpcLog.push({ name, params, at: Date.now() });
        Object.assign(s.course, params.p_patch);
        write(s);
        return Promise.resolve({
          data: { reflect_on_feedback: s.course.reflect_on_feedback, show_my_learning: s.course.show_my_learning },
          error: null,
        });
      }
      return real(name, params);
    };
  }, SEED);
}

/* student_submit.page for one student, as the database sends it, written in the
   teacher's page from the teacher's own data; `learning` only while the
   teacher's server has the switch on (2026111201's shape). */
function databasePage(args) {
  const { cid, sid } = args;
  const on = JSON.parse(localStorage.getItem('e2e-ml-e2e-server')).course.show_my_learning === true;
  const page = StudentView.reply(cid, sid);
  delete page.course.id;
  if (!on) return page;
  const course = COURSES[cid];
  const cc = getCourseConfig(cid) || {};
  const map = getLearningMap(cid);
  const byId = {};
  (getAssessments(cid) || []).forEach(a => (byId[a.id] = a));
  page.assessments.forEach(a => (a.category_id = (byId[a.id] && byId[a.id].categoryId) || null));
  page.show_my_learning = true;
  page.learning = {
    course: {
      grading_system: course.gradingSystem,
      calc_method: cc.calcMethod || course.calcMethod || 'mostRecent',
      decay_weight: cc.decayWeight == null ? null : cc.decayWeight,
      recent_score_limit: cc.recentScoreLimit == null ? null : cc.recentScoreLimit,
      grading_scale: cc.gradingScale || null,
      category_weights: cc.categoryWeights || null,
      round_percent: typeof cc.roundPercent === 'boolean' ? cc.roundPercent : null,
      level_order: cc.levelOrder === 'asc' ? 'asc' : 'desc',
      reporting_terms: cc.reportingTerms || null,
      timezone: course.timezone || 'America/Vancouver',
      folders_count_as_one: cc.foldersCountAsOne !== false,
      courses_count_equally: cc.coursesCountEqually === true,
      grade_level: course.gradeLevel || null,
    },
    rubric_tags: {},
    categories: (getCategories(cid) || []).map((k, i) => ({
      id: k.id,
      name: k.name,
      weight: k.weight,
      display_order: k.displayOrder == null ? i : k.displayOrder,
      calc_mode: k.calcMode || 'points',
    })),
    section_overrides: Object.fromEntries(
      Object.entries((getOverrides(cid) || {})[sid] || {}).map(([k, o]) => [
        k,
        { level: o.level, date: o.date || null },
      ]),
    ),
    competency_groups: [],
    subjects: (map.subjects || []).map((subj, si) => ({
      id: subj.id,
      name: subj.name,
      display_order: si,
      sections: (map.sections || [])
        .filter(sec => sec.subject === subj.id)
        .map((sec, i) => ({
          id: sec.id,
          name: sec.name,
          display_order: i,
          competency_group_id: sec.groupId || null,
          tags: (sec.tags || []).map((t, j) => ({
            id: t.id,
            code: t.code || '',
            label: t.label,
            i_can_text: t.text || null,
            i_can_statements: t.i_can_statements || [],
            bank_id: t.bank_id || null,
            display_order: j,
          })),
        })),
    })),
  };
  return page;
}

test('a teacher turns Show My Learning on for a Letter class; the card shows it, with Preview’s letter and %', async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await teacherServer(page);

  // The teacher turns it on, and it is kept by the server.
  await page.goto('/dashboard?manage=student-page');
  const learning = page.getByRole('switch', { name: 'Show My Learning' });
  await expect(learning).not.toBeChecked();
  await page.locator('.sp-learning .gpd-switch').click();
  await expect(learning).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.__e2eRpcLog.filter(c => c.name === 'set_course_feedback_options').length))
    .toBe(1);
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Show My Learning' })).toBeChecked();

  // Preview as Student for Cece, chosen by her id.
  await page.locator('#sp-preview-student').selectOption(CECE);
  await page.locator('#sp-preview-open').click();
  const overlay = page.locator('#preview-student');
  await overlay.locator('.ps-screen .sp-tabs-bottom [data-act="tab"][data-tab="learning"]').click();
  await expect(overlay.locator('.sp-ml-overall-letter')).toBeVisible();
  const preview = {
    letter: (await overlay.locator('.sp-ml-letter').innerText()).trim(),
    pct: (await overlay.locator('.sp-ml-pct').innerText()).trim(),
  };

  // The database's page for Cece, from the teacher's data and the server's switch.
  const reply = await page.evaluate(databasePage, { cid: CID, sid: CECE });
  expect(reply.show_my_learning).toBe(true);

  // Cece's card, on her phone, through the student-submit function's own handler.
  const phone = await browser.newContext(PHONE);
  const card = await phone.newPage();
  card.on('pageerror', e => errors.push(String(e)));
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  fn.state.dirty = sent =>
    Object.assign({}, JSON.parse(JSON.stringify(reply)), {
      expires_at: sent.expires_at,
      classes: sent.classes,
    });
  await serve(card, fn);
  await card.goto('/s/#P3R8-WDK4');
  await card.getByLabel('Student Number').fill('0123456');
  await card.getByRole('button', { name: 'Yes, That’s Me' }).click();
  const tab = card.locator('[data-act="tab"][data-tab="learning"]:visible').first();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(card.locator('.sp-page')).not.toContainText('hasn’t turned on My Learning');
  await expect(card.locator('.sp-ml-overall-letter')).toBeVisible();
  const device = {
    letter: (await card.locator('.sp-ml-letter').innerText()).trim(),
    pct: (await card.locator('.sp-ml-pct').innerText()).trim(),
  };
  console.log('E2E My Learning overall: Preview ' + JSON.stringify(preview) + ', card ' + JSON.stringify(device));
  expect(preview.letter).toMatch(/^[A-F][+-]?$|^IE$/);
  expect(preview.pct).toMatch(/^\d+(\.\d)?%$/);
  expect(device).toEqual(preview);
  expect(errors).toEqual([]);
  await phone.close();
});
