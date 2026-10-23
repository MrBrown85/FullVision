/**
 * Rubric Levels: a class decides whether the four levels run Extending →
 * Emerging (the default) or Emerging → Extending on every scoring card and
 * printed rubric (migrations/20261022_course_level_order.sql). The setting
 * is in Class Management, Grading tab, under Grading System.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

const RUBRIC = {
  id: 'rubric-001',
  name: 'Lab Report Rubric',
  criteria: [
    { id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI'] },
  ],
};

const ASSESSMENT = {
  id: 'assess-rubric-001',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  rubricId: 'rubric-001',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

const DESC = ['Extending', 'Proficient', 'Developing', 'Emerging'];
const ASC = ['Emerging', 'Developing', 'Proficient', 'Extending'];

async function seedRubric(page) {
  await page.addInitScript(
    ({ rubric, assessment, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
}

/* The expanded scoring card: its fill-all header and the first criterion
   row's level buttons, as texts left to right. */
async function openCard(page) {
  await page.evaluate(() => {
    window.location.hash = '#/assignments';
  });
  const title = page.locator('text=Rubric Lab Report').first();
  await expect(title).toBeVisible();
  // The card's grid is in the page while collapsed; expand it when hidden.
  if (!(await page.locator('.rsg-header-level').first().isVisible())) await title.click();
  await expect(page.locator('.rsg-header-level').first()).toBeVisible();
  await expect(page.locator('.rsg-header-level')).toHaveCount(4);
}

async function cardOrder(page) {
  const header = await page.locator('.rsg-header-level').allTextContents();
  const row = await page.locator('.rsg-criterion-row').first().locator('.rsg-level').allTextContents();
  return { header, row };
}

/* Print from the dialog with window.print stubbed. The staged sheets are
   kept until the test reads them: print() would otherwise clear them on its
   next tick. */
async function printedHeads(page) {
  await page.evaluate(() => {
    window.print = () => {};
    window.__realSetTimeout = window.setTimeout;
    window.setTimeout = (fn, ms, ...rest) => (!ms ? 0 : window.__realSetTimeout(fn, ms, ...rest));
  });
  await page.locator('[data-action="printRubrics"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
  const sheet = page.locator('#rubric-print-root .rubric-sheet').first();
  await expect(sheet.locator('.rubric-level-head')).toHaveCount(4);
  const heads = await sheet.locator('.rubric-level-head').allTextContents();
  await page.evaluate(() => {
    window.setTimeout = window.__realSetTimeout;
    const root = document.getElementById('rubric-print-root');
    if (root) root.innerHTML = '';
    document.body.classList.remove('rubric-print-active');
  });
  return heads;
}

test.describe('Rubric Levels', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedRubric(page);
  });

  test('Extending first by default, Emerging first once the class chooses it', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    await openCard(page);
    expect(await cardOrder(page)).toEqual({ header: DESC, row: DESC });
    expect(await printedHeads(page)).toEqual(DESC);

    // Class Management → Grading → Rubric Levels.
    await page.evaluate(() => {
      window.location.hash = '#/dashboard';
    });
    await page.getByRole('button', { name: 'Class Management' }).first().click();
    await page.locator('[data-action="cmSetTab"][data-tab="grading"]').click();
    const control = page.locator('#cm-level-order');
    await expect(control).toBeVisible();
    await expect(control.getByRole('radio', { name: 'Extending First' })).toHaveAttribute('aria-checked', 'true');
    await control.getByRole('radio', { name: 'Emerging First' }).click();
    await expect(control.getByRole('radio', { name: 'Emerging First' })).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(cid => getCourseConfig(cid).levelOrder, TEST_COURSE.id)).toBe('asc');

    await openCard(page);
    expect(await cardOrder(page)).toEqual({ header: ASC, row: ASC });
    // The button's level, not its place, is what a click scores.
    const first = page.locator('.rsg-criterion-row').first().locator('.rsg-level').first();
    await expect(first).toHaveAttribute('data-level', '1');
    await first.click();
    await expect(first).toHaveClass(/active/);
    expect(await printedHeads(page)).toEqual(ASC);
  });

  test('a class that chose Emerging first opens that way', async ({ page }) => {
    await page.addInitScript(cid => {
      localStorage.setItem('gb-courseconfig-' + cid, JSON.stringify({ levelOrder: 'asc' }));
    }, TEST_COURSE.id);
    await gotoApp(page, '/dashboard');
    await openCard(page);
    expect(await cardOrder(page)).toEqual({ header: ASC, row: ASC });
  });
});
