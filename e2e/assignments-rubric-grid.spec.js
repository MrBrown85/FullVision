import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The whole-class rubric grid: "Set Everyone To" capsules, then per student
// the name with Missing | Excused | Late and Comment, and each criterion's
// − | + and comment under its name with the level control beside it.
const RUBRIC = {
  id: 'rubric-grid',
  name: 'Lab Report Rubric',
  criteria: [
    { id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI'] },
  ],
};
const ASSESSMENT = {
  id: 'assess-grid',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  rubricId: 'rubric-grid',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

test('the whole-class rubric grid scores, fine-tunes and sets a status', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ rubric, assessment, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-assess-grid');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();

  await expect(card.locator('.rsg-header-label')).toHaveText('Set Everyone To');
  await expect(card.locator('.rsg-header-level')).toHaveCount(4);

  const alice = card.locator('.rsg-student[data-status-student="stu-001"]');
  await expect(alice.locator('.rsg-student-name')).toContainText('Alice');
  await expect(alice.locator('.rsg-status .grader-status-btn')).toHaveText(['Missing', 'Excused', 'Late']);
  // The overall comment is a field under the criteria, not a button.
  await expect(alice.locator('.rsg-student-head .comment-btn')).toHaveCount(0);
  await expect(alice.locator('.rsg-overall-comment')).toHaveAttribute(
    'placeholder',
    'Add an overall comment for Alice',
  );

  // − | + sit inside the chosen level; the comment button ends the row.
  const hyp = alice.locator('.rsg-criterion-row[data-criterion="crit-hyp"]');
  await expect(hyp.locator('.rsg-mod')).toHaveCount(0);
  await expect(hyp.locator('.rsg-criterion-main .rsg-crit-comment')).toHaveText('Comment');
  await hyp.locator('.rsg-level.l3').click();
  await expect(hyp.locator('.rsg-level.active .rsg-level-name')).toHaveText('Proficient');
  await expect(hyp.locator('.rsg-level.active .rsg-mod')).toHaveCount(2);
  await hyp.locator('.rsg-mod[data-mod="1"]').click();
  await expect(hyp.locator('.rsg-mod.active')).toHaveCount(1);
  await expect(hyp.locator('.rsg-level.active .rsg-level-name')).toHaveText('Proficient +');
  await expect(hyp.locator('.rsg-level.l3')).toHaveClass(/active/);

  // Scored work can't be Missing or Excused; Late still applies.
  await expect(alice.locator('.grader-status-btn[data-status="EXC"]')).toBeDisabled();
  await expect(alice.locator('.grader-status-btn[data-status="NS"]')).toBeDisabled();
  await alice.locator('.grader-status-btn[data-status="LATE"]').click();
  await expect(alice).toHaveClass(/has-late/);
  await expect(alice.locator('.grader-status-btn[data-status="LATE"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Undo on Set Everyone To puts back only the fill', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  const quiz = Object.assign({}, ASSESSMENT, { id: 'assess-quiz', title: 'Quiz', rubricId: '', tagIds: ['QAP'] });
  await page.addInitScript(
    ({ rubric, assessments, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
    },
    { rubric: RUBRIC, assessments: [ASSESSMENT, quiz], cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-assess-grid');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const cid = TEST_COURSE.id;
  await page.evaluate(c => {
    for (const sid of ['stu-002', 'stu-003']) upsertScore(c, sid, 'assess-quiz', 'QAP', 2, '2026-03-21', 'summative');
  }, cid);
  const hyp = card.locator('.rsg-student[data-status-student="stu-001"] .rsg-criterion-row[data-criterion="crit-hyp"]');
  await hyp.locator('.rsg-level.l2').click();
  await card.locator('[data-action="confirmFillRubricAll"][data-score="4"]').click();
  await page.locator('#confirm-ok-btn').click();
  await expect(hyp.locator('.rsg-level.l4')).toHaveClass(/active/);
  // While the toast is up, a score goes in on other work.
  await page.evaluate(c => upsertScore(c, 'stu-001', 'assess-quiz', 'QAP', 3, '2026-03-21', 'summative'), cid);
  await page.locator('#undo-toast [data-action="executeUndo"]').click();
  const level = (aid, tid) =>
    page.evaluate(
      ([c, a, t]) => {
        const e = (getScores(c)['stu-001'] || []).find(x => x.assessmentId === a && x.tagId === t);
        return e ? e.score : null;
      },
      [cid, aid, tid],
    );
  expect(await level('assess-grid', 'crit-hyp')).toBe(2);
  expect(await level('assess-grid', 'crit-data')).toBe(null);
  expect(await level('assess-quiz', 'QAP')).toBe(3);
});
