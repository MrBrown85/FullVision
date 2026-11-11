import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';
import { cardMenuItem } from './card-menu.js';

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

  // Set Everyone To ▾ in the card's header, the four levels in its menu.
  await expect(card.locator('.assess-setto-btn')).toHaveText('Set Everyone To');
  await expect(card.locator('.assess-setto .assess-menu-item')).toHaveCount(4);

  const alice = card.locator('.rsg-student[data-status-student="stu-001"]');
  await expect(alice.locator('.rsg-student-name')).toContainText('Alice');
  await expect(alice.locator('.rsg-status .grader-status-btn')).toHaveText(['Missing', 'Excused', 'Late']);
  // The overall comment is a field under the criteria, not a button.
  await expect(alice.locator('.rsg-student-head .comment-btn')).toHaveCount(0);
  await expect(alice.locator('.rsg-overall-comment')).toHaveAttribute(
    'placeholder',
    'Add an overall comment for Alice',
  );

  // − | + sit inside the chosen level; the comment button sits under the name.
  const hyp = alice.locator('.rsg-criterion-row[data-criterion="crit-hyp"]');
  await expect(hyp.locator('.rsg-mod')).toHaveCount(0);
  await expect(hyp.locator('.rsg-criterion-side .rsg-crit-tools .rsg-crit-comment')).toHaveText('Comment');
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

test('Set Everyone To sets only unscored criteria, skips Missing, and Cmd+Z undoes it', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ rubric, assessment, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
      localStorage.setItem('gb-statuses-' + cid, JSON.stringify({ 'stu-002:assess-grid': 'NS' }));
    },
    { rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-assess-grid');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const cid = TEST_COURSE.id;
  const row = (sid, crit) =>
    card.locator('.rsg-student[data-status-student="' + sid + '"] .rsg-criterion-row[data-criterion="' + crit + '"]');
  const level = (sid, tid) =>
    page.evaluate(
      ([c, s, t]) => {
        const e = (getScores(c)[s] || []).find(x => x.assessmentId === 'assess-grid' && x.tagId === t);
        return e && e.score ? e.score : null;
      },
      [cid, sid, tid],
    );
  // Alice has Developing on Hypothesis; Bob is Missing; Carol has nothing.
  await row('stu-001', 'crit-hyp').locator('.rsg-level.l2').click();

  await (await cardMenuItem(card, 'confirmFillRubricAll', '[data-score="4"]')).click();
  await expect(page.locator('#confirm-title')).toHaveText('Set Everyone To Extending');
  await expect(page.locator('.confirm-message')).toHaveText(
    'Set 3 criteria with no score yet, for 2 students, to Extending? Criteria already scored stay as they are. 1 student is marked Missing or Excused and left out.',
  );
  await expect(page.locator('#confirm-ok-btn')).toHaveText('Set 3 Criteria');
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('#undo-toast')).toContainText('3 criteria set to Extending');

  expect(await level('stu-001', 'crit-hyp')).toBe(2);
  expect(await level('stu-001', 'crit-data')).toBe(4);
  expect(await level('stu-003', 'crit-hyp')).toBe(4);
  expect(await level('stu-003', 'crit-data')).toBe(4);
  // Bob stays Missing with no level, in the data and on screen.
  expect(await level('stu-002', 'crit-hyp')).toBe(null);
  expect(await level('stu-002', 'crit-data')).toBe(null);
  await expect(card.locator('.rsg-student[data-status-student="stu-002"] .rsg-level.active')).toHaveCount(0);
  await expect(row('stu-001', 'crit-hyp').locator('.rsg-level.l2')).toHaveClass(/active/);

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#undo-toast')).toHaveCount(0);
  expect(await level('stu-001', 'crit-hyp')).toBe(2);
  expect(await level('stu-001', 'crit-data')).toBe(null);
  expect(await level('stu-003', 'crit-hyp')).toBe(null);
  expect(await level('stu-003', 'crit-data')).toBe(null);
});
