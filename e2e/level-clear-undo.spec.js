import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Nov 3 sweep (step 4 group 2 #14): clicking the chosen level clears it, and
// a misclick had no way back. The toast says "Score cleared" with Undo (as
// the phone does), and Cmd+Z takes it while the toast is up.
const RUBRIC = {
  id: 'rubric-clear',
  name: 'Lab Report Rubric',
  criteria: [
    { id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI'] },
  ],
};
const base = {
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};
const RUBRIC_WORK = Object.assign({ id: 'assess-clear', title: 'Rubric Lab Report', rubricId: 'rubric-clear' }, base);
const LEVEL_WORK = Object.assign({ id: 'assess-levels', title: 'Levels Lab', rubricId: '' }, base);

async function seed(page) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ rubric, list, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(list));
    },
    { rubric: RUBRIC, list: [RUBRIC_WORK, LEVEL_WORK], cid: TEST_COURSE.id },
  );
}
const stored = (page, aid, key) =>
  page.evaluate(
    ({ cid, aid, key }) => {
      const e = (getScores(cid)['stu-001'] || []).find(s => s.assessmentId === aid && s.tagId === key);
      return e ? [Number(e.score), e.mod || 0] : null;
    },
    { cid: TEST_COURSE.id, aid, key },
  );

test('a click on the chosen rubric level clears it, and Cmd+Z puts it back with its +', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-assess-clear');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const hyp = card.locator('.rsg-student[data-status-student="stu-001"] .rsg-criterion-row[data-criterion="crit-hyp"]');
  await hyp.locator('.rsg-level.l3').click();
  await hyp.locator('.rsg-mod[data-mod="1"]').click();
  await expect(hyp.locator('.rsg-level.active .rsg-level-name')).toHaveText('Proficient +');

  await hyp.locator('.rsg-level.l3 .rsg-level-name').click();
  await expect(hyp.locator('.rsg-level.active')).toHaveCount(0);
  await expect(page.locator('#undo-toast')).toContainText('Score cleared');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#undo-toast')).toHaveCount(0);
  await expect(hyp.locator('.rsg-level.active .rsg-level-name')).toHaveText('Proficient +');
  expect(await stored(page, 'assess-clear', 'crit-hyp')).toEqual([3, 1]);
});

test('in the grader, clearing a competency level offers Undo', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/gradebook');
  await page.evaluate(cid => PageAssignments.openGrader(cid, 'assess-levels', 'stu-001'), TEST_COURSE.id);
  const qap = page.locator('#grader-overlay .grdl-card[data-tag="QAP"]');
  await qap.locator('.grdl-level[data-level="2"]').click();
  await expect(qap.locator('.grdl-level.is-on')).toHaveText('Developing');
  await qap.locator('.grdl-level[data-level="2"]').click();
  await expect(qap.locator('.grdl-level.is-on')).toHaveCount(0);
  await expect(page.locator('#undo-toast')).toContainText('Score cleared');
  await page.locator('#undo-toast .undo-toast-btn').click();
  await expect(qap.locator('.grdl-level.is-on')).toHaveText('Developing');
  expect(await stored(page, 'assess-levels', 'QAP')).toEqual([2, 0]);
});
