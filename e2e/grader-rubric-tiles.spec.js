import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The grade editor draws a rubric for one student as the board's compact
// rows: the level bar scores the criterion (a level's wording is its hover,
// never on the grid), the chosen level's − | + fine-tunes it, 1–4 on a
// focused criterion scores it, and the Comment chip opens the box that saves
// to the criterion's comment.
const RUBRIC = {
  id: 'rubric-gt',
  name: 'Lab Report Rubric',
  criteria: [
    {
      id: 'crit-hyp',
      name: 'Hypothesis',
      tagIds: ['QAP'],
      levels: { 4: 'Bold, testable', 3: 'Clear and testable', 2: 'Partly testable', 1: 'Not testable' },
    },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI'], levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
  ],
};
const ASSESSMENT = {
  id: 'assess-gt',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: 'rubric-gt',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  dueDate: '',
  collaboration: 'individual',
  moduleId: '',
  pairs: [],
  groups: [],
  excludedStudents: [],
  created: new Date('2026-03-21').toISOString(),
};

test('rubric tiles score, fine-tune and take feedback', async ({ page }) => {
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
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-gt"]').click();

  const dialog = page.locator('#grader-overlay .grader-dialog');
  const hyp = dialog.locator('.grdt-crit[data-critid="crit-hyp"]');
  // Descriptors stay off the scoring grid: the wording is the level's hover.
  await expect(hyp).not.toContainText('Clear and testable');
  await expect(hyp.locator('[data-action="graderLevel"][data-level="3"]')).toHaveAttribute(
    'title',
    /^Proficient: Clear and testable/,
  );
  await expect(hyp.locator('.grdl-level.is-on')).toHaveCount(0);

  await hyp.locator('[data-action="graderLevel"][data-level="3"]').click();
  await expect(hyp.locator('.grdl-level.is-on')).toHaveText('Proficient');
  await hyp.locator('[data-action="graderMod"][data-mod="1"]').click();
  // The + shows on its own button; the label stays the level's name (mockup).
  await expect(hyp.locator('[data-action="graderMod"][data-mod="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(hyp.locator('.grdl-level.is-on')).toHaveText('Proficient');

  await hyp.focus();
  await page.keyboard.press('4');
  await expect(hyp.locator('.grdl-level.is-on')).toHaveText(/Extending/);

  await hyp.locator('[data-action="graderNote"]').first().click();
  await hyp.locator('.grdt-note').fill('Clear question.');
  await dialog.locator('.grader-student').click();
  // The Overall Comment is a field under the tiles; the observations list is gone.
  await expect(dialog.locator('.grader-feedback')).toHaveCount(0);
  await dialog.locator('.grdt-overall .grdt-note').fill('Strong lab.');
  await dialog.locator('.grader-student').click();
  await expect
    .poll(() => page.evaluate(({ cid }) => getScoreComment(cid, 'stu-001', 'assess-gt'), { cid: TEST_COURSE.id }))
    .toBe('Strong lab.');
  const note = await page.evaluate(
    ({ cid }) => {
      const a = getAssessments(cid).find(x => x.id === 'assess-gt');
      return getRubricCriterionComment(cid, 'stu-001', 'assess-gt', getRubricById(cid, a.rubricId).criteria[0]);
    },
    { cid: TEST_COURSE.id },
  );
  expect(note).toBe('Clear question.');
});
