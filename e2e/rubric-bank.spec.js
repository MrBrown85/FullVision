/**
 * Rubric Bank: the Rubrics button opens a window listing the class's
 * rubrics (used first, then not used yet) beside the selected rubric, read
 * only, with its actions (teacher/rubric-bank.js).
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

const LAB = {
  id: 'rubric-001',
  name: 'Lab Report Rubric',
  criteria: [
    {
      id: 'crit-hyp',
      name: 'Hypothesis',
      tagIds: ['QAP'],
      weight: 1,
      levels: { 4: 'Explains why', 3: 'Predicts from evidence', 2: 'States a guess', 1: 'Needs help to guess' },
    },
  ],
};

const TALK = {
  id: 'rubric-002',
  name: 'Presentation Rubric',
  criteria: [{ id: 'crit-voice', name: 'Delivery', tagIds: [], weight: 1, levels: { 4: '', 3: '', 2: '', 1: '' } }],
};

const ASSESSMENT = {
  id: 'assess-rubric-001',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  rubricId: 'rubric-001',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

async function openBank(page) {
  await page.evaluate(() => {
    window.location.hash = '#/assignments';
  });
  await page.locator('[data-action="openRubricBank"]').click();
  const bank = page.getByRole('dialog', { name: 'Rubric Bank' });
  await expect(bank).toBeVisible();
  return bank;
}

test.describe('Rubric Bank', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(
      ({ rubrics, assessment, cid }) => {
        localStorage.setItem('gb-rubrics-' + cid, JSON.stringify(rubrics));
        localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
      },
      { rubrics: [LAB, TALK], assessment: ASSESSMENT, cid: TEST_COURSE.id },
    );
    await gotoApp(page, '/dashboard');
  });

  test('lists used rubrics first and shows the selected one read only', async ({ page }) => {
    const bank = await openBank(page);
    await expect(bank.locator('.rb-group').first()).toContainText('Used in');
    await expect(bank.locator('.rb-group').nth(1)).toContainText('Not Used Yet · 1');
    await expect(bank.locator('.rb-title')).toHaveText('Lab Report Rubric');
    await expect(bank.locator('.rb-level-head')).toHaveText([/Extending/, /Proficient/, /Developing/, /Emerging/]);
    await expect(bank.locator('.rb-cell').first()).toHaveText('Explains why');
    await expect(bank.locator('.rb-use-chip')).toHaveText(['Rubric Lab Report']);

    // Down moves to the unused rubric, which has nothing to print.
    await bank.locator('#rb-search').press('ArrowDown');
    await expect(bank.locator('.rb-title')).toHaveText('Presentation Rubric');
    await expect(bank.locator('[data-rb="print"]')).toHaveCount(0);

    await bank.locator('#rb-search').fill('zzz');
    await expect(bank.locator('#rb-list')).toHaveText('No rubrics match.');

    await page.keyboard.press('Escape');
    await expect(bank).toHaveCount(0);
  });

  test('remembers the selected rubric for the class', async ({ page }) => {
    let bank = await openBank(page);
    await bank.locator('.rb-row', { hasText: 'Presentation Rubric' }).click();
    await bank.locator('[data-rb="close"]').click();
    bank = await openBank(page);
    await expect(bank.locator('.rb-title')).toHaveText('Presentation Rubric');
  });

  test('duplicates and renames from the More menu', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'More actions' }).click();
    await bank.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(bank.locator('.rb-title')).toHaveText('Lab Report Rubric (2)');
    await expect(bank.locator('.rb-row')).toHaveCount(3);

    await bank.getByRole('button', { name: 'More actions' }).click();
    await bank.getByRole('menuitem', { name: 'Rename' }).click();
    const input = bank.locator('#rb-rename');
    await input.fill('Lab Report Rubric, Short');
    await input.press('Enter');
    await expect(bank.locator('.rb-title')).toHaveText('Lab Report Rubric, Short');
    expect(await page.evaluate(cid => getRubrics(cid).map(r => r.name), TEST_COURSE.id)).toContain(
      'Lab Report Rubric, Short',
    );
  });

  test('Edit Rubric closes the bank and opens the editor', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'Edit Rubric' }).click();
    await expect(bank).toHaveCount(0);
    await expect(page.locator('#rubric-modal')).toBeVisible();
  });

  test('Use in New Assessment opens the form with the rubric picked', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'Use in New Assessment' }).click();
    await expect(bank).toHaveCount(0);
    await expect(page.locator('#af-rubric')).toHaveValue('rubric-001');
  });

  test('a Used In chip opens that assessment', async ({ page }) => {
    const bank = await openBank(page);
    await bank.locator('.rb-use-chip', { hasText: 'Rubric Lab Report' }).click();
    await expect(bank).toHaveCount(0);
    await expect(page.locator('#ac-assess-rubric-001')).toBeVisible();
  });
});
