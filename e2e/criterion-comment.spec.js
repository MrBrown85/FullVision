import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

const RUBRIC = {
  id: 'rubric-cc',
  name: 'Lab Report Rubric',
  criteria: [
    { id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI'] },
  ],
};

const ASSESSMENT = {
  id: 'assess-cc',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: 'rubric-cc',
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

async function openGrid(page) {
  await page.addInitScript(
    ({ rubric, assessment, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');
  await page.locator('text=Rubric Lab Report').first().click();
  await expect(page.locator('.rsg-crit-comment').first()).toBeVisible();
}

function commentButton(page, sid, critId) {
  return page.locator('.rsg-crit-comment[data-sid="' + sid + '"][data-critid="' + critId + '"]');
}

test.describe('Criterion comment box', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('has a labelled text area, a count, and Save off until the text changes', async ({ page }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = dialog.getByLabel(/Comment for/);
    await expect(box).toBeFocused();
    expect(await box.evaluate(el => el.tagName)).toBe('TEXTAREA');
    await expect(dialog.locator('#crit-comment-count')).toHaveText('0 / 500');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    await box.fill('Clear question.');
    await expect(dialog.locator('#crit-comment-count')).toHaveText('15 / 500');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

    await box.fill('x'.repeat(150));
    await expect(dialog.locator('#crit-comment-count')).toHaveClass(/is-long/);
  });

  test('Shift+Enter adds a line and Enter saves', async ({ page }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    const box = page.getByRole('dialog').getByLabel(/Comment for/);
    await box.type('First line');
    await box.press('Shift+Enter');
    await box.type('Second line');
    await expect(box).toHaveValue('First line\nSecond line');
    await box.press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(commentButton(page, 'stu-001', 'crit-hyp')).toHaveClass(/has-comment/);
  });

  test('shows the chosen level beside the criterion', async ({ page }) => {
    await openGrid(page);
    await page
      .locator('[data-action="selectRubricScore"][data-level="3"][data-sid="stu-001"][data-critid="crit-hyp"]')
      .first()
      .click();
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await expect(page.locator('.crit-comment-level')).toHaveText('Proficient');
  });

  test('Save and next moves to the next criterion, then the next student', async ({ page }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Comment for/).fill('Good hypothesis.');
    await dialog.getByRole('button', { name: 'Save and Next Criterion' }).click();
    await expect(dialog.locator('.crit-comment-crit')).toHaveText('Data Collection');
    await expect(commentButton(page, 'stu-001', 'crit-hyp')).toHaveClass(/has-comment/);

    await dialog.getByLabel(/Comment for/).fill('Tidy table.');
    await dialog.getByLabel(/Comment for/).press('Control+Enter');
    await expect(dialog.locator('.crit-comment-crit')).toHaveText('Hypothesis');
    await expect(dialog.getByLabel(/Comment for/)).toHaveValue('');
    await expect(commentButton(page, 'stu-001', 'crit-data')).toHaveClass(/has-comment/);
  });

  test('Remove comment clears it; keys do not reach the grid while open', async ({ page }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await page
      .getByRole('dialog')
      .getByLabel(/Comment for/)
      .fill('To remove.');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

    await commentButton(page, 'stu-001', 'crit-hyp').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('3');
    await expect(page.locator('.rsg-level.active')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Remove Comment' }).click();
    await expect(dialog).toBeHidden();
    await expect(commentButton(page, 'stu-001', 'crit-hyp')).not.toHaveClass(/has-comment/);

    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
