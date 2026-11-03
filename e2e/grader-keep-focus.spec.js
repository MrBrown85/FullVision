import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Grading one student by keyboard: after a level key and → the same
// criterion card has focus for the next student, so 1–4 keeps scoring.
const RUBRIC = {
  id: 'rubric-kf',
  name: 'Lab Rubric',
  criteria: [
    { id: 'crit-a', name: 'Hypothesis', tagIds: ['QAP'], levels: { 4: 'Bold', 3: 'Clear', 2: 'Partly', 1: 'Not yet' } },
    { id: 'crit-b', name: 'Analysis', tagIds: ['PI'], levels: { 4: 'Deep', 3: 'Sound', 2: 'Thin', 1: 'Missing' } },
  ],
};
const ASSESSMENT = {
  id: 'assess-kf',
  title: 'Rubric Lab',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: 'rubric-kf',
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

test('the focused criterion card keeps focus on the next student', async ({ page }) => {
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
  const crit = page.locator('#ac-assess-kf .grdt-crit[data-critid="crit-b"]');
  await crit.focus();
  await page.keyboard.press('2');
  await expect(crit).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.focus-banner')).toContainText('Bob');
  await expect(crit).toBeFocused();
  await page.keyboard.press('3');
  const levels = await page.evaluate(
    cid =>
      ['stu-001', 'stu-002'].map(sid => {
        var e = (getScores(cid)[sid] || []).find(x => x.assessmentId === 'assess-kf' && x.tagId === 'crit-b');
        return e ? e.score : null;
      }),
    TEST_COURSE.id,
  );
  expect(levels).toEqual([2, 3]);
});
