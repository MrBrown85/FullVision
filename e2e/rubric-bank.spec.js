/**
 * Rubric Bank: the Rubrics button opens a window listing the class's
 * rubrics (used first, then not used yet) beside the selected rubric, read
 * only, with its actions (teacher/rubric-bank.js).
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

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
    window.Router.navigate('/assignments');
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

    // Down moves to the unused rubric, which can still print blank.
    await bank.locator('#rb-search').press('ArrowDown');
    await expect(bank.locator('.rb-title')).toHaveText('Presentation Rubric');
    await expect(bank.locator('[data-rb="print"]')).toHaveCount(1);

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

test.describe('Rubric Bank, delete', () => {
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
  });

  async function openDelete(page) {
    await gotoApp(page, '/dashboard');
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'More actions' }).click();
    await bank.getByRole('menuitem', { name: 'Delete Rubric' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete Lab Report Rubric?' });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('names the assessments; Cancel keeps the rubric', async ({ page }) => {
    const dialog = await openDelete(page);
    await expect(dialog).toContainText('1 assessment uses this rubric.');
    await expect(dialog.locator('.rb-del-row')).toHaveText([/Rubric Lab Report.*Mar 21, 2026/]);
    await expect(dialog.locator('.rb-del-warn')).toHaveText('They will lose their rubric link.');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Rubric Bank' })).toBeVisible();
    expect(await page.evaluate(cid => getRubrics(cid).length, TEST_COURSE.id)).toBe(2);
  });

  test('warns that scores go with it, then deletes', async ({ page }) => {
    await seedScores(page, { 'stu-001': { 'assess-rubric-001': { QAP: 3 } } });
    const dialog = await openDelete(page);
    await expect(dialog.locator('.rb-del-row')).toContainText('1 Student Scored');
    await expect(dialog.locator('.rb-del-warn')).toHaveText(
      'The rubric scores in these assessments will be deleted with it. This cannot be undone.',
    );
    await dialog.getByRole('button', { name: 'Delete Rubric' }).click();
    await expect(dialog).toHaveCount(0);
    const bank = page.getByRole('dialog', { name: 'Rubric Bank' });
    await expect(bank.locator('.rb-title')).toHaveText('Presentation Rubric');
    const left = await page.evaluate(
      cid => ({
        rubrics: getRubrics(cid).map(r => r.id),
        link: getAssessments(cid)[0].rubricId || null,
      }),
      TEST_COURSE.id,
    );
    expect(left).toEqual({ rubrics: ['rubric-002'], link: null });
  });
});

test.describe('Rubric Bank, class stats', () => {
  const TALKS = {
    ...ASSESSMENT,
    id: 'assess-talk',
    title: 'Talks',
    date: '2026-03-25',
    tagIds: [],
    rubricId: 'rubric-002',
  };

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(
      ({ rubrics, assessments, cid }) => {
        localStorage.setItem('gb-rubrics-' + cid, JSON.stringify(rubrics));
        localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
      },
      { rubrics: [LAB, TALK], assessments: [ASSESSMENT, TALKS], cid: TEST_COURSE.id },
    );
    await seedScores(page, {
      'stu-001': { 'assess-rubric-001': { QAP: 4 }, 'assess-talk': { 'crit-voice': 3 } },
      'stu-002': { 'assess-rubric-001': { QAP: 3 }, 'assess-talk': { 'crit-voice': 2 } },
    });
    await gotoApp(page, '/dashboard');
  });

  test('a pie per criterion, hidden by the switch until it is turned back on', async ({ page }) => {
    let bank = await openBank(page);
    await expect(bank.locator('.rb-stats')).toContainText('2 scores across 1 assessment');
    await expect(bank.locator('.rb-stats')).toContainText('Only you see these. They are never printed.');
    await expect(bank.locator('.rb-pie')).toHaveAttribute(
      'aria-label',
      'Extending 1, Proficient 1, Developing 0, Emerging 0',
    );
    await expect(bank.locator('.rb-overall')).toHaveCount(0);

    await bank.getByRole('switch', { name: 'Show Class Stats' }).click();
    await expect(bank.locator('.rb-pie')).toHaveCount(0);
    await bank.locator('[data-rb="close"]').click();
    bank = await openBank(page);
    await expect(bank.locator('.rb-pie')).toHaveCount(0);
    await expect(bank.getByRole('switch', { name: 'Show Class Stats' })).not.toBeChecked();
    await bank.getByRole('switch', { name: 'Show Class Stats' }).click();
    await expect(bank.locator('.rb-pie')).toHaveCount(1);
  });

  test('a custom-criteria rubric shows its overall levels', async ({ page }) => {
    const bank = await openBank(page);
    await bank.locator('.rb-row', { hasText: 'Presentation Rubric' }).click();
    await expect(bank.locator('.rb-sub')).toContainText('Custom Criteria (Not Linked to Competencies)');
    const overall = bank.locator('.rb-overall');
    await expect(overall).toContainText('Overall Level');
    await expect(overall.locator('.rb-overall-bar')).toHaveAttribute(
      'aria-label',
      'Overall: Extending 0, Proficient 1, Developing 1, Emerging 0',
    );
    await expect(overall.locator('.rb-dist-seg')).toHaveText(['1', '1']);
  });
});

test.describe('Rubric Bank, Print Rubrics window', () => {
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
    await seedScores(page, { 'stu-001': { 'assess-rubric-001': { QAP: 3 } } });
    await gotoApp(page, '/dashboard');
  });

  test('opens on completed rubrics, switches to blank copies, and counts pages', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(bank).toHaveCount(0);
    const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
    await expect(dialog).toContainText('Lab Report Rubric · 1 Criterion');
    await expect(dialog.getByRole('radio', { name: /Completed Rubrics/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /All Scored Students/ })).toBeVisible();
    await dialog.getByRole('radio', { name: /All Students/ }).check();
    await dialog.locator('.rp-tile', { hasText: '1 per Page' }).click();
    await expect(dialog.getByRole('button', { name: 'Print 3 Pages' })).toBeEnabled();
    await expect(dialog.locator('#rp-preview .rubric-page')).toHaveCount(1);
    await expect(dialog.locator('#rp-preview-count')).toHaveText('Page 1 of 3');

    await dialog.locator('.rp-tile', { hasText: 'Blank Rubric' }).click();
    await expect(dialog.getByRole('radio', { name: /All Students/ })).toHaveCount(0);
    await expect(dialog.getByRole('spinbutton', { name: 'Copies' })).toHaveValue('3');
    await expect(dialog.getByRole('checkbox', { name: 'Overall Level' })).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: 'Competency Codes' })).toBeVisible();
    await dialog.locator('.rp-tile', { hasText: '4 per Page' }).click();
    await expect(dialog.getByRole('button', { name: 'Print 1 Page' })).toBeEnabled();
    await expect(dialog.locator('#rp-preview .rubric-name-line')).toHaveCount(3);
  });

  test('a rubric no assessment uses prints blank only', async ({ page }) => {
    const bank = await openBank(page);
    await bank.locator('.rb-row', { hasText: 'Presentation Rubric' }).click();
    await bank.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
    await expect(dialog.getByRole('radio', { name: /Completed Rubrics/ })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: /Blank Rubric/ })).toBeChecked();
    await dialog.getByRole('spinbutton', { name: 'Copies' }).fill('5');
    await dialog.locator('.rp-tile', { hasText: '2 per Page' }).click();
    await expect(dialog.getByRole('button', { name: 'Print 3 Pages' })).toBeEnabled();
    await expect(dialog.locator('#rp-status')).toContainText('5 blank rubrics on 3 pages');
  });

  test('the assessment card opens the same window on that assessment', async ({ page }) => {
    await page.evaluate(() => {
      window.Router.navigate('/assignments');
    });
    const title = page.locator('text=Rubric Lab Report').first();
    await expect(title).toBeVisible();
    if (!(await page.locator('[data-action="printRubrics"]').first().isVisible())) await title.click();
    await page.locator('[data-action="printRubrics"]').first().click();
    const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
    await expect(dialog.getByRole('radio', { name: /Completed Rubrics/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /Blank Rubric/ })).toBeEnabled();
  });
});

test.describe('Rubric Bank, Advanced Rubrics', () => {
  const ADV = {
    id: 'rubric-adv',
    name: 'Lab Skills Rubric',
    style: 'advanced',
    criteria: [
      {
        id: 'crit-safe',
        name: 'Safety',
        tagIds: ['QAP'],
        weight: 1,
        levels: { 4: 'Leads safe practice', 3: 'Follows every step', 2: 'Needs reminders', 1: 'Many reminders' },
        checks: [
          { id: 'k4a', level: 4, label: 'Reminds others', displayOrder: 0 },
          { id: 'k3a', level: 3, label: 'Goggles on', displayOrder: 0 },
          { id: 'k3b', level: 3, label: 'Cleans the station', displayOrder: 1 },
        ],
      },
    ],
  };

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(
      ({ rubrics, cid }) => {
        localStorage.setItem('gb-rubrics-' + cid, JSON.stringify(rubrics));
        localStorage.setItem('gb-assessments-' + cid, '[]');
        localStorage.setItem('rubric-bank-selected', JSON.stringify({ [cid]: 'rubric-adv' }));
      },
      { rubrics: [LAB, ADV], cid: TEST_COURSE.id },
    );
    await gotoApp(page, '/dashboard');
  });

  test('tags the rubric, counts its checkboxes and draws them under each level', async ({ page }) => {
    const bank = await openBank(page);
    await expect(bank.locator('.rb-row', { hasText: 'Lab Skills Rubric' }).locator('.rb-adv-tag')).toHaveText(
      'Advanced',
    );
    await expect(bank.locator('.rb-row', { hasText: 'Lab Report Rubric' }).locator('.rb-adv-tag')).toHaveCount(0);
    await expect(bank.locator('.rb-sub')).toContainText('1 Criterion · 3 Checkboxes');
    await expect(bank.locator('.rb-rule')).toContainText('the highest level whose boxes are all ticked');
    await expect(bank.locator('.rb-cell').nth(1).locator('.rb-cell-check')).toHaveText([
      'Goggles on',
      'Cleans the station',
    ]);
  });

  test('+ New Rubric offers Standard and Advanced', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: /New Rubric/ }).click();
    await expect(bank.getByRole('menuitem')).toHaveCount(2);
    await bank.getByRole('menuitem', { name: /Advanced Rubric/ }).click();
    await expect(bank).toHaveCount(0);
    const editor = page.locator('#rubric-modal');
    await expect(editor).toBeVisible();
    await expect(editor.locator('.rubric-style-seg').getByRole('radio', { name: 'Advanced' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('Print offers Checkboxes for an Advanced rubric', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
    await expect(dialog.getByRole('checkbox', { name: 'Checkboxes' })).toBeChecked();
    await expect(dialog.locator('#rp-preview .rubric-check')).toHaveCount(3);
  });
});

test.describe('Rubric Bank, renaming a linked rubric', () => {
  const GROUP = '7a7a7a7a-0000-4000-8000-000000000001';

  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(
      ({ course, map, mine, theirs }) => {
        const courses = JSON.parse(localStorage.getItem('gb-courses') || '{}');
        courses[course.id] = course;
        localStorage.setItem('gb-courses', JSON.stringify(courses));
        localStorage.setItem('gb-learningMaps-' + course.id, JSON.stringify(map));
        ['students', 'assessments', 'observations', 'modules', 'customTags'].forEach(k =>
          localStorage.setItem('gb-' + k + '-' + course.id, '[]'),
        );
        localStorage.setItem('gb-rubrics-' + course.id, JSON.stringify([theirs]));
        localStorage.setItem('gb-rubrics-sci8', JSON.stringify([mine]));
        localStorage.setItem('gb-assessments-sci8', '[]');
      },
      {
        course: SCI9,
        map: SCI9_MAP,
        mine: { ...LAB, copyGroup: GROUP },
        theirs: {
          ...LAB,
          id: 'rubric-lab-9',
          copyGroup: GROUP,
          criteria: [{ ...LAB.criteria[0], id: 'crit-9', tagIds: ['S9Q'] }],
        },
      },
    );
    await gotoApp(page, '/dashboard');
  });

  test('offers the new name to the linked copy', async ({ page }) => {
    const bank = await openBank(page);
    await expect(bank.locator('.rb-linked')).toHaveText('Linked With Science 9 — Test');
    await bank.getByRole('button', { name: 'More actions' }).click();
    await bank.getByRole('menuitem', { name: 'Rename' }).click();
    await bank.locator('#rb-rename').fill('Lab Report Rubric, Grade 8');
    await bank.locator('#rb-rename').press('Enter');

    const offer = page.getByRole('dialog', { name: 'Update the other classes too?' });
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('Name → Lab Report Rubric, Grade 8');
    await offer.getByRole('button', { name: 'Update' }).click();
    await expect(offer).toHaveCount(0);
    expect(await page.evaluate(() => getRubricById('sci9', 'rubric-lab-9').name)).toBe('Lab Report Rubric, Grade 8');
  });

  test('Only this class keeps the copy’s name', async ({ page }) => {
    const bank = await openBank(page);
    await bank.getByRole('button', { name: 'More actions' }).click();
    await bank.getByRole('menuitem', { name: 'Rename' }).click();
    await bank.locator('#rb-rename').fill('Renamed Here');
    await bank.locator('#rb-rename').press('Enter');
    const offer = page.getByRole('dialog', { name: 'Update the other classes too?' });
    await offer.getByRole('button', { name: 'Only this class' }).click();
    expect(await page.evaluate(() => getRubricById('sci9', 'rubric-lab-9').name)).toBe('Lab Report Rubric');
    await expect(bank.locator('.rb-title')).toHaveText('Renamed Here');
  });
});
