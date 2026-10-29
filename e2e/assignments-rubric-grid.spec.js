import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The whole-class rubric grid: "Set Everyone To" capsules, then per student
// the name with Late | Excused | Missing and Comment, and each criterion's
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
  await expect(alice.locator('.rsg-status .grader-status-btn')).toHaveText(['Late', 'Excused', 'Missing']);
  await expect(alice.locator('.rsg-comment-btn')).toContainText('Comment');

  const hyp = alice.locator('.rsg-criterion-row[data-criterion="crit-hyp"]');
  await expect(hyp.locator('.rsg-criterion-side .rsg-mods .rsg-mod')).toHaveCount(2);
  await expect(hyp.locator('.rsg-criterion-side .rsg-crit-comment')).toBeVisible();
  await hyp.locator('.rsg-level.l3').click();
  await expect(hyp.locator('.rsg-level.active')).toHaveText('Proficient');
  await hyp.locator('.rsg-mod[data-mod="1"]').click();
  await expect(hyp.locator('.rsg-mod.active')).toHaveCount(1);

  // Scored work can't be Missing or Excused; Late still applies.
  await expect(alice.locator('.grader-status-btn[data-status="EXC"]')).toBeDisabled();
  await expect(alice.locator('.grader-status-btn[data-status="NS"]')).toBeDisabled();
  await alice.locator('.grader-status-btn[data-status="LATE"]').click();
  await expect(alice).toHaveClass(/has-late/);
  await expect(alice.locator('.grader-status-btn[data-status="LATE"]')).toHaveAttribute('aria-pressed', 'true');
});
