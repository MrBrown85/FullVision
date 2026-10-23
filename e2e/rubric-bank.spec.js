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

const SCI9 = { id: 'sci9', name: 'Science 9 — Test', gradingSystem: 'proficiency', calcMethod: 'mostRecent' };

const SCI9_MAP = {
  _flatVersion: 2,
  subjects: [{ id: 'SCI9', name: 'Science 9', color: '#0891b2' }],
  sections: [
    {
      id: 'S9Q',
      subject: 'SCI9',
      name: 'Questioning and Predicting',
      shortName: 'Questioning',
      color: '#0891b2',
      tags: [{ id: 'S9Q', label: 'Question and Predict', text: '', subject: 'SCI9', i_can_statements: [] }],
    },
    {
      id: 'S9H',
      subject: 'SCI9',
      name: 'Applying and Innovating',
      shortName: 'Applying',
      color: '#0891b2',
      tags: [{ id: 'S9H', label: 'Assess Human Impact', text: '', subject: 'SCI9', i_can_statements: [] }],
    },
  ],
};

const FIELD = {
  id: 'rubric-901',
  name: 'Ecosystems Field Study Rubric',
  criteria: [
    {
      id: 'crit-obs',
      name: 'Field Observations',
      tagIds: ['S9Q'],
      weight: 1,
      levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' },
    },
    { id: 'crit-hum', name: 'Human Impact', tagIds: ['S9H'], weight: 1, levels: { 4: 'e', 3: 'f', 2: 'g', 1: 'h' } },
  ],
};

test.describe('Rubric Bank, All My Classes', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(
      ({ course, map, rubric, sci8Rubrics }) => {
        const courses = JSON.parse(localStorage.getItem('gb-courses') || '{}');
        courses[course.id] = course;
        localStorage.setItem('gb-courses', JSON.stringify(courses));
        localStorage.setItem('gb-learningMaps-' + course.id, JSON.stringify(map));
        ['students', 'assessments', 'observations', 'modules', 'customTags'].forEach(k =>
          localStorage.setItem('gb-' + k + '-' + course.id, '[]'),
        );
        localStorage.setItem('gb-rubrics-' + course.id, JSON.stringify([rubric]));
        localStorage.setItem('gb-rubrics-sci8', JSON.stringify(sci8Rubrics));
      },
      { course: SCI9, map: SCI9_MAP, rubric: FIELD, sci8Rubrics: [LAB] },
    );
    await gotoApp(page, '/dashboard');
  });

  test('browses another class and copies a rubric in', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'All My Classes' }).click();
    const group = bank.locator('.rb-class', { hasText: 'Science 9 — Test' });
    await expect(group).toContainText('· 1');
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await group.click();
    await bank.locator('.rb-row', { hasText: 'Ecosystems Field Study Rubric' }).click();

    await expect(bank.locator('.rb-sub')).toHaveText('From Science 9 — Test · 2 Criteria · Not Used');
    await expect(bank.locator('.rb-note')).toContainText('1 of 2 match');
    await expect(bank.locator('.rb-grid .rb-chip.is-missing')).toHaveText('Assess Human Impact');
    await expect(bank.getByRole('button', { name: 'Edit Rubric' })).toHaveCount(0);

    await bank.getByRole('button', { name: /^Copy to Science 8/ }).click();
    await expect(bank.getByRole('button', { name: 'This Class' })).toHaveAttribute('aria-pressed', 'true');
    await expect(bank.locator('.rb-title')).toHaveText('Ecosystems Field Study Rubric');
    await expect(bank.getByRole('button', { name: 'Edit Rubric' })).toBeVisible();
    const copied = await page.evaluate(() => getRubrics('sci8').find(r => r.name === 'Ecosystems Field Study Rubric'));
    expect(copied.criteria.map(c => c.tagIds)).toEqual([['QAP'], []]);
  });

  test('search opens every class with a match', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'All My Classes' }).click();
    await expect(bank.locator('.rb-class', { hasText: 'Science 9 — Test' })).toContainText('· 1');
    await bank.locator('#rb-search').fill('ecosystems');
    await expect(bank.locator('.rb-row')).toHaveText([/Ecosystems Field Study Rubric/]);
    await expect(bank.locator('.rb-class')).toHaveCount(1);
  });
});
