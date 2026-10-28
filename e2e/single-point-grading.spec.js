import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// A single-point rubric is graded with a level under each criterion's
// Proficient standard, plus Work On and Went Beyond notes: three columns in
// the grade editor, fields under the level control on the Assignments page.
const RUBRIC = {
  id: 'rubric-sp',
  name: 'Lab Single-Point',
  style: 'single_point',
  criteria: [
    {
      id: 'crit-hyp',
      name: 'Hypothesis',
      tagIds: ['QAP'],
      levels: { 4: '', 3: 'States a testable hypothesis.', 2: '', 1: '' },
    },
  ],
};
const ASSESSMENT = {
  id: 'assess-sp',
  title: 'Single-Point Lab',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  rubricId: 'rubric-sp',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

async function seed(page) {
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
}

const notes = (page, sid) =>
  page.evaluate(
    ({ cid, sid }) => {
      const crit = getRubricById(cid, 'rubric-sp').criteria[0];
      return [
        getRubricCriterionComment(cid, sid, 'assess-sp', crit),
        getRubricCriterionBeyond(cid, sid, 'assess-sp', crit),
      ];
    },
    { cid: TEST_COURSE.id, sid },
  );

test('the grade editor shows Work On | the standard | Went Beyond', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-sp"]').click();

  const card = page.locator('#grader-overlay .grsp-crit[data-critid="crit-hyp"]');
  await expect(card.locator('.grsp-words')).toHaveText('States a testable hypothesis.');
  await card.locator('.grdl-level[data-level="3"]').click();
  await expect(card.locator('.grdl-level.is-on')).toHaveText('Proficient');

  await card.locator('.grsp-note.is-work .grdt-note').fill('Name the variable.');
  await card.locator('.grsp-note.is-beyond .grdt-note').fill('Predicted a range.');
  await page.locator('#grader-overlay .grader-student').click();
  expect(await notes(page, 'stu-001')).toEqual(['Name the variable.', 'Predicted a range.']);
});

test('the whole class shows the standard once and notes under each level', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-assess-sp');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();

  await expect(card.locator('.rsg-sp-card')).toHaveCount(1);
  await expect(card.locator('.rsg-sp-card')).toContainText('States a testable hypothesis.');
  const row = card.locator('.rsg-criterion-row[data-student="stu-001"]');
  await expect(row.locator('.rsg-crit-comment')).toHaveCount(0);
  await row.locator('.rsg-sp-field.is-beyond input').fill('Tested a second variable.');
  await row.locator('.rsg-sp-field.is-work input').click();
  expect((await notes(page, 'stu-001'))[1]).toBe('Tested a second variable.');
});
