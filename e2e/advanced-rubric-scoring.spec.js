/**
 * Scoring an Advanced Rubric (Rubric Bank plan §5, PR 8; mockup C10). Each
 * criterion row has a Checks button; it opens the checkboxes under the row.
 * Ticking writes the level the boxes suggest (the highest level whose boxes
 * are all ticked) unless the teacher picked a level by hand.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

const RUBRIC = {
  id: 'rub-adv',
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
        { id: 'k2a', level: 2, label: 'Needs one reminder', displayOrder: 0 },
      ],
    },
    {
      id: 'crit-data',
      name: 'Data',
      tagIds: ['PI'],
      weight: 1,
      levels: { 4: 'Repeatable', 3: 'Complete', 2: 'Partial', 1: 'Little' },
      checks: [{ id: 'k3c', level: 3, label: 'Records units', displayOrder: 0 }],
    },
  ],
};

const ASSESSMENT = {
  id: 'assess-adv',
  title: 'Density Lab',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  rubricId: 'rub-adv',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

function row(page, sid, critId) {
  return page.locator(
    `.rsg-criterion-row[data-assess="assess-adv"][data-student="${sid}"][data-criterion="${critId}"]`,
  );
}

async function openCard(page) {
  await page.evaluate(() => {
    window.Router.navigate('/assignments');
  });
  const title = page.locator('text=Density Lab').first();
  await expect(title).toBeVisible();
  if (!(await row(page, 'stu-001', 'crit-safe').isVisible())) await title.click();
  await expect(row(page, 'stu-001', 'crit-safe')).toBeVisible();
}

test.describe('Scoring an Advanced Rubric', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(
      ({ rubric, assessment, cid }) => {
        localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
        localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
        localStorage.removeItem('rsg-checklists-mode');
      },
      { rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
    );
    await gotoApp(page, '/dashboard');
    await openCard(page);
  });

  test('ticking every box of a level writes that level; unticking clears it', async ({ page }) => {
    const safety = row(page, 'stu-001', 'crit-safe');
    const btn = safety.locator('.rsg-checks-btn');
    await expect(btn).toHaveText('0/4');
    await btn.click();
    const panel = page.locator('.rsg-checklist[data-sid="stu-001"][data-critid="crit-safe"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.rsg-checklist-head')).toHaveText('No Level Suggested Yet');
    // Columns run in the class's level order: Extending first by default.
    await expect(panel.locator('.rsg-checklist-col').first()).toHaveAttribute('data-level', '4');

    await panel.getByLabel('Goggles on').check();
    await expect(safety.locator('.rsg-level.active')).toHaveCount(0);
    await panel.getByLabel('Cleans the station').check();
    await expect(safety.locator('.rsg-level.active')).toHaveText('Proficient');
    await expect(panel.locator('.rsg-checklist-head')).toHaveText('Suggested: Proficient');
    await expect(safety.locator('.rsg-checks-btn')).toHaveText('2/4');
    const stored = await page.evaluate(cid => getRubricCheckIds(cid, 'stu-001', 'assess-adv').sort(), TEST_COURSE.id);
    expect(stored).toEqual(['k3a', 'k3b']);

    await panel.getByLabel('Goggles on').uncheck();
    await expect(safety.locator('.rsg-level.active')).toHaveCount(0);
  });

  test('a level picked by hand stays when boxes are ticked', async ({ page }) => {
    const safety = row(page, 'stu-001', 'crit-safe');
    await safety.locator('.rsg-level', { hasText: 'Developing' }).click();
    await safety.locator('.rsg-checks-btn').click();
    const panel = page.locator('.rsg-checklist[data-sid="stu-001"][data-critid="crit-safe"]');
    await panel.getByLabel('Goggles on').check();
    await panel.getByLabel('Cleans the station').check();
    await expect(safety.locator('.rsg-level.active')).toHaveText('Developing');
    await expect(panel.locator('.rsg-checklist-hint')).toContainText('You picked Developing');
  });

  test('One at a Time closes the last checklist; All opens every one', async ({ page }) => {
    await row(page, 'stu-001', 'crit-safe').locator('.rsg-checks-btn').click();
    await expect(page.locator('.rsg-checklist')).toHaveCount(1);
    await row(page, 'stu-002', 'crit-data').locator('.rsg-checks-btn').click();
    await expect(page.locator('.rsg-checklist')).toHaveCount(1);
    await expect(page.locator('.rsg-checklist[data-sid="stu-002"][data-critid="crit-data"]')).toBeVisible();
    await expect(row(page, 'stu-001', 'crit-safe').locator('.rsg-checks-btn')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await openCard(page);
    // Three students, two criteria with boxes each.
    await expect(page.locator('.rsg-checklist')).toHaveCount(6);
    expect(await page.evaluate(() => localStorage.getItem('rsg-checklists-mode'))).toBe('all');
  });

  test('K opens the focused row’s checklist', async ({ page }) => {
    const safety = row(page, 'stu-001', 'crit-safe');
    await safety.locator('.rsg-level', { hasText: 'Proficient' }).click();
    await safety.locator('.rsg-level', { hasText: 'Proficient' }).click();
    await page.keyboard.press('k');
    await expect(page.locator('.rsg-checklist')).toHaveCount(1);
  });

  test('a standard rubric has no Checks column', async ({ page }) => {
    await page.evaluate(cid => {
      saveRubrics(
        cid,
        getRubrics(cid).map(r => Object.assign({}, r, { style: 'standard' })),
      );
    }, TEST_COURSE.id);
    await page.evaluate(() => {
      window.Router.navigate('/dashboard');
    });
    await openCard(page);
    await expect(page.locator('.rsg-checks-btn')).toHaveCount(0);
    await expect(page.locator('.rsg-checklist-mode')).toHaveCount(0);
  });
});
