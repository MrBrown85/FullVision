import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Picking a student on the Assignments page grades them with the same
// grader as the gradebook's dialog: their name, Late | Excused | Missing,
// Comment and the grade above the rubric tiles, inside each open card.
const RUBRIC = {
  id: 'rubric-os',
  name: 'Lab Report Rubric',
  criteria: [
    {
      id: 'crit-hyp',
      name: 'Hypothesis',
      tagIds: ['QAP'],
      levels: { 4: 'Bold, testable', 3: 'Clear and testable', 2: 'Partly testable', 1: 'Not testable' },
    },
  ],
};
const ASSESSMENT = {
  id: 'assess-os',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: 'rubric-os',
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

test('one student is graded with the grader inside the card', async ({ page }) => {
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
  await page.locator('#gb-roster-list .student-row[data-sid="stu-001"]').click();

  await expect(page.locator('.focus-banner')).toContainText('Alice Anderson');
  const card = page.locator('#ac-assess-os');
  const grader = card.locator('.grader-inline');
  await expect(grader.locator('.grader-inline-name')).toHaveText(/Alice/);
  await expect(grader.locator('.grader-status .grader-status-btn')).toHaveText(['Late', 'Excused', 'Missing']);
  await expect(page.locator('#rsg-descriptor-bar')).toBeHidden();

  const hyp = grader.locator('.grdt-crit[data-critid="crit-hyp"]');
  await expect(hyp).toContainText('Clear and testable');
  await hyp.locator('.grdt-tile[data-level="3"]').click();
  await expect(card.locator('.grdt-tile.is-chosen')).toContainText('Proficient');
  await expect(card.locator('.grader-grade')).toContainText('Proficient');

  await card.locator('.grdt-crit[data-critid="crit-hyp"]').focus();
  await page.keyboard.press('4');
  await expect(card.locator('.grdt-chosen-label')).toHaveText(/Extending/);

  await card.locator('.grader-status [data-status="EXC"]').click();
  await expect(card.locator('.grader-inline')).toHaveClass(/is-locked/);
  await expect(card.locator('.grader-grade')).toHaveText('Excused');

  await page.locator('[data-action="clearFocusStudent"]').click();
  await expect(page.locator('.grader-inline')).toHaveCount(0);
});
