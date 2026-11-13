import { test, expect } from '@playwright/test';
import { mockAuth, TEST_LEARNING_MAP } from './helpers.js';
import { cardMenuItem } from './card-menu.js';

/* Work graded by competency, then given a rubric through the assessment
   form: the marks move to the rubric's criteria at once, as a reload moves
   them. They used to stay under the competencies until a reload: the
   criteria read blank, the next grade anywhere in a class that holds
   grades made every student's grade on the work a Draft, and signed in, a
   whole-class save sent upsert_score 0 for every student on the work.

   The class: 30 students, Essay graded on Questioning and Predicting and
   Planning and Conducting for all 30, a rubric with one criterion on each,
   and Quiz with no grades. Student page on, grades held until Return. In
   Demo Mode and signed in (helpers.js mockAuth); signed in, the class has
   server-shaped ids so the writes reach the fake server. Run with TZ=UTC.
   Tests only. */

test.use({ viewport: { width: 1440, height: 900 } });

const CID = 'c1a55e00-0000-4000-8000-00000000a7a7';
const SIDS = Array.from({ length: 30 }, (_, i) => 'e0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
const ESSAY = 'a5500000-0000-4000-8000-0000000000a1';
const QUIZ = 'a5500000-0000-4000-8000-0000000000a2';
const RUBRIC = 'b0b00000-0000-4000-8000-0000000000a1';
const QUESTIONS = 'b0c00000-0000-4000-8000-0000000000a1'; // feeds QAP
const METHOD = 'b0c00000-0000-4000-8000-0000000000a2'; // feeds PI
const FIRST = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley'];
const name = i => FIRST[i % FIRST.length] + ' ' + 'Student' + String(i + 1).padStart(2, '0');
// Essay's levels: QAP and PI per student.
const qap = i => 1 + (i % 4);
const pi = i => 1 + ((i + 2) % 4);

function classData() {
  const students = SIDS.map((id, i) => {
    const last = 'Student' + String(i + 1).padStart(2, '0');
    return {
      id,
      personId: id.replace(/^e/, 'f'),
      firstName: FIRST[i % FIRST.length],
      lastName: last,
      preferred: '',
      pronouns: '',
      studentNumber: '',
      email: '',
      dateOfBirth: '',
      designations: [],
      attendance: [],
      sortName: last + ' ' + FIRST[i % FIRST.length],
    };
  });
  const assessments = [
    { id: ESSAY, title: 'Essay', date: '2026-10-05', type: 'summative', tagIds: ['QAP', 'PI'] },
    { id: QUIZ, title: 'Quiz', date: '2026-10-06', type: 'summative', tagIds: ['QAP'] },
  ];
  const rubrics = [
    {
      id: RUBRIC,
      name: 'Essay Rubric',
      criteria: [
        { id: QUESTIONS, name: 'Questions', tagIds: ['QAP'], levels: { 4: 'Deep', 3: 'Clear', 2: 'Some', 1: 'Few' } },
        { id: METHOD, name: 'Method', tagIds: ['PI'], levels: { 4: 'Deep', 3: 'Clear', 2: 'Some', 1: 'Few' } },
      ],
    },
  ];
  const entry = (sid, tid, score) => ({
    id: sid + ':' + ESSAY + ':' + tid,
    assessmentId: ESSAY,
    tagId: tid,
    score,
    date: '2026-10-05',
    type: 'summative',
    note: '',
    created: '2026-10-05T17:00:00.000Z',
  });
  const scores = {};
  SIDS.forEach((sid, i) => (scores[sid] = [entry(sid, 'QAP', qap(i)), entry(sid, 'PI', pi(i))]));
  return { cid: CID, students, assessments, rubrics, scores, learningMap: TEST_LEARNING_MAP };
}

/* Writes the class into localStorage once, before the page's own scripts
   run. In Demo Mode, beside the sample class once Demo Mode has made it. */
async function seedClass(page, demo) {
  await page.addInitScript(
    ({ data, demo }) => {
      const { cid, students, assessments, rubrics, scores, learningMap } = data;
      if (localStorage.getItem('e2e-rubric-attach-seeded')) return;
      if (demo && !JSON.parse(localStorage.getItem('gb-assessments-sci8') || '[]').length) return;
      localStorage.setItem('e2e-rubric-attach-seeded', '1');
      const courses = demo ? JSON.parse(localStorage.getItem('gb-courses') || '{}') : {};
      courses[cid] = { id: cid, name: 'Grade 9 Science', gradingSystem: 'proficiency', calcMethod: 'mostRecent' };
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      if (!demo) localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify(rubrics));
      localStorage.setItem('gb-scores-' + cid, JSON.stringify(scores));
      localStorage.setItem(
        'gb-courseconfig-' + cid,
        JSON.stringify({ student_page_enabled: true, return_grades: 'on_return' }),
      );
    },
    { data: classData(), demo },
  );
}

async function waitForClass(page) {
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(cid => getAssessments(cid).length === 2, CID, { timeout: 10_000 });
}

async function enterDemo(page) {
  await seedClass(page, true);
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The sample class seeds after the curriculum bank loads; the reload adds ours.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.reload();
  await waitForClass(page);
}

async function signIn(page) {
  await mockAuth(page);
  await seedClass(page, false);
  await page.goto('/dashboard');
  await waitForClass(page);
}

const go = (page, path) => page.evaluate(p => window.Router.navigate(p), path);

async function openCard(page, aid) {
  const card = page.locator('#ac-' + aid);
  await expect(card).toBeVisible();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/\bopen\b/);
  return card;
}

/* Edit Assessment on Essay, Rubric scoring, the class's Essay Rubric, then
   Save Changes: what a teacher does to give graded work a rubric. */
async function attachRubric(page) {
  const card = await openCard(page, ESSAY);
  await (await cardMenuItem(card, 'editAssess')).click();
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  await page.locator('.af-scoremode-btn[data-mode="proficiency"]').click();
  await expect(page.locator('#af-scoremode')).toHaveValue('proficiency');
  await page.locator('[data-action="chooseRubric"]').first().click();
  await page.locator(`#af-rubric-view .af-start-row[data-rid="${RUBRIC}"]`).click();
  await page.locator('#af-rubric-view [data-action="startPickUse"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Change the Rubric?');
  await page.locator('.af-dialog-card button', { hasText: 'Change the Rubric' }).click();
  await expect(page.locator('#af-rubric')).toHaveValue(RUBRIC);
  await page.locator('[data-action="saveEditAssess"]').click();
  await expect(page.locator('#new-assess-form')).toBeHidden();
  await expect
    .poll(() => page.evaluate(([cid, aid]) => getAssessments(cid).find(a => a.id === aid).rubricId, [CID, ESSAY]))
    .toBe(RUBRIC);
}

const sidOf = (page, fullName) =>
  page.evaluate(([cid, n]) => getStudents(cid).find(s => s.firstName + ' ' + s.lastName === n).id, [CID, fullName]);

// The level a criterion row shows for one student on Essay's card.
const shownLevel = (page, sid, crit) =>
  page
    .locator(`.rsg-criterion-row[data-assess="${ESSAY}"][data-student="${sid}"][data-criterion="${crit}"]`)
    .locator('.rsg-level.active .rsg-level-name');

// How many students' grades on Essay are Drafts.
const essayDrafts = page =>
  page.evaluate(
    ([cid, aid]) => getStudents(cid).filter(s => GradeState.stateOf(cid, s.id, aid) === GradeState.DRAFT).length,
    [CID, ESSAY],
  );

// Every upsert_score sent for Essay with no level (0 or none).
const essayZeros = page =>
  page.evaluate(aid => {
    return (window.__e2eRpcLog || [])
      .filter(c => c.name === 'upsert_score' && c.params && c.params.p_assessment_id === aid)
      .filter(c => c.params.p_value == null || Number(c.params.p_value) === 0)
      .map(c => c.params);
  }, ESSAY);

// Essay's levels for every student, on the page and in the saved copy.
const essayLevels = page =>
  page.evaluate(
    ([cid, aid]) => {
      const of = blob =>
        Object.keys(blob || {})
          .sort()
          .map(sid =>
            (blob[sid] || [])
              .filter(e => e && e.assessmentId === aid)
              .map(e => e.tagId + '=' + e.score)
              .sort()
              .join(' '),
          );
      return { cache: of(getScores(cid)), saved: of(JSON.parse(localStorage.getItem('gb-scores-' + cid))) };
    },
    [CID, ESSAY],
  );
const LEVELS_BY_CRITERION = SIDS.map((sid, i) => [QUESTIONS + '=' + qap(i), METHOD + '=' + pi(i)].sort().join(' '));

const LEVEL_NAMES = { 1: 'Emerging', 2: 'Developing', 3: 'Proficient', 4: 'Extending' };

for (const mode of ['Demo Mode', 'signed in'])
  test(`${mode}: a rubric given to graded work shows its marks at once and keeps them`, async ({ page }) => {
    test.slow();
    await page.clock.setFixedTime(new Date('2026-11-12T18:00:00Z'));
    if (mode === 'signed in') await signIn(page);
    else await enterDemo(page);
    await go(page, '/assignments?course=' + CID);
    // The card read the scores before the rubric was given.
    await openCard(page, ESSAY);
    expect(await essayDrafts(page)).toBe(0);

    await attachRubric(page);

    // The criteria show the marks with no reload. (Soft, so a failure here
    // still runs the steps below and reports what they do.)
    await openCard(page, ESSAY);
    for (const i of [0, 7, 29]) {
      const sid = await sidOf(page, name(i));
      await expect.soft(shownLevel(page, sid, QUESTIONS)).toHaveText(LEVEL_NAMES[qap(i)], { timeout: 2000 });
      await expect.soft(shownLevel(page, sid, METHOD)).toHaveText(LEVEL_NAMES[pi(i)], { timeout: 2000 });
    }
    expect.soft((await essayLevels(page)).cache).toEqual(LEVELS_BY_CRITERION);

    // Another grade: Blake on Quiz, Questioning and Predicting, Proficient.
    const blake = await sidOf(page, name(1));
    const quiz = await openCard(page, QUIZ);
    await quiz
      .locator(`.rsg-criterion-row[data-assess="${QUIZ}"][data-student="${blake}"] .rsg-level[data-level="3"]`)
      .first()
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          ([cid, sid, aid]) => (getScores(cid)[sid] || []).some(e => e.assessmentId === aid && e.score === 3),
          [CID, blake, QUIZ],
        ),
      )
      .toBe(true);
    expect.soft(await essayDrafts(page)).toBe(0);

    // A whole-class action on Quiz: Set Everyone To Developing, then Undo,
    // which saves the class's whole score list.
    await (await cardMenuItem(quiz, 'confirmFillAll', '[data-score="2"]')).click();
    const ok = page.locator('.confirm-overlay #confirm-ok-btn');
    if (await ok.isVisible().catch(() => false)) await ok.click();
    const undo = page.locator('#undo-toast button', { hasText: 'Undo' });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(page.locator('#undo-toast')).toHaveCount(0, { timeout: 15_000 });

    // No grade on Essay became a Draft, no level changed, and nothing set
    // Essay's score to 0 on the server.
    expect.soft(await essayDrafts(page)).toBe(0);
    expect.soft(await essayLevels(page)).toEqual({ cache: LEVELS_BY_CRITERION, saved: LEVELS_BY_CRITERION });
    await page.waitForTimeout(500);
    expect.soft(await essayZeros(page)).toEqual([]);
    for (const i of [0, 7, 29]) {
      const sid = await sidOf(page, name(i));
      await expect(shownLevel(page, sid, QUESTIONS)).toHaveText(LEVEL_NAMES[qap(i)]);
    }
  });
