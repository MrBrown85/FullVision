import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Competencies | Rubric on rubric work: Competencies lists the competencies
// the criteria feed (then any criterion that feeds none), each showing its
// criteria's level; a level set there goes to every criterion that feeds it.
const RUBRIC = {
  id: 'rubric-comp',
  name: 'Reading Questions',
  criteria: [
    { id: 'crit-q1', name: 'Question 1', tagIds: ['QAP'] },
    { id: 'crit-q2', name: 'Question 2', tagIds: ['QAP'] },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI', 'IP'] },
    { id: 'crit-neat', name: 'Neatness', tagIds: [] },
  ],
};
const ASSESSMENT = {
  id: 'assess-comp',
  title: 'Reading Questions',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI', 'IP'],
  rubricId: 'rubric-comp',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

function aliceScores(page) {
  return page.evaluate(cid => {
    var out = {};
    (getScores(cid)['stu-001'] || []).forEach(function (e) {
      if (e.assessmentId === 'assess-comp' && e.score) out[e.tagId] = e.score;
    });
    return out;
  }, TEST_COURSE.id);
}

test('the Competencies view scores a competency through its criteria', async ({ page }) => {
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
  const card = page.locator('#ac-assess-comp');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const view = card.locator('.rubric-view-toggle .rubric-view-btn');
  await expect(view).toHaveText(['Competencies', 'Rubric']);
  await view.filter({ hasText: 'Competencies' }).click();

  const alice = card.locator('.rsg-student[data-status-student="stu-001"]');
  const rows = alice.locator('.rsg-criterion-row.is-tag');
  await expect(rows).toHaveCount(4);
  expect(await rows.evaluateAll(els => els.map(el => el.dataset.tag))).toEqual(['QAP', 'PI', 'IP', 'crit-neat']);

  const qap = alice.locator('.rsg-criterion-row[data-tag="QAP"]');
  await qap.locator('.rsg-level.l3').click();
  await expect(qap.locator('.rsg-level.active')).toHaveText('Proficient');
  expect(await aliceScores(page)).toEqual({ 'crit-q1': 3, 'crit-q2': 3 });

  // Criteria that disagree show the lowest, striped, with no + | −.
  await view.filter({ hasText: 'Rubric' }).click();
  await alice.locator('.rsg-criterion-row[data-criterion="crit-q2"] .rsg-level.l2').click();
  await view.filter({ hasText: 'Competencies' }).click();
  await expect(qap.locator('.rsg-level.active.mixed')).toHaveText('Developing');
  await expect(qap.locator('.rsg-mod:disabled')).toHaveCount(2);

  // Clicking the mixed level sets every criterion to it.
  await qap.locator('.rsg-level.l2').click();
  await expect(qap.locator('.rsg-level.active')).not.toHaveClass(/mixed/);
  expect(await aliceScores(page)).toEqual({ 'crit-q1': 2, 'crit-q2': 2 });

  // A criterion that feeds two competencies shows on both rows at once.
  await alice.locator('.rsg-criterion-row[data-tag="PI"] .rsg-level.l4').click();
  await expect(alice.locator('.rsg-criterion-row[data-tag="IP"] .rsg-level.active')).toHaveText('Extending');

  // A criterion with no competency is scored on its own.
  await alice.locator('.rsg-criterion-row[data-tag="crit-neat"] .rsg-level.l4').click();
  expect(await aliceScores(page)).toEqual({ 'crit-q1': 2, 'crit-q2': 2, 'crit-data': 4, 'crit-neat': 4 });
});
