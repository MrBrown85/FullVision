import { test, expect } from '@playwright/test';
import { gotoApp, clickAction, getText } from './helpers.js';

/* Pins what Class Settings > Grading does today in Demo Mode (Science 8,
   sci8), before any split of teacher/dash-class-manager.js: the grading
   system, the calculation method, Show the % As, Rubric Levels, adding and
   deleting a category, and a Counts As preset with its reset. Each change
   is read back on the screen and through the page's globals, and again
   after a reload. Demo data lives in localStorage, so it survives one. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openGrading(page) {
  await gotoApp(page, '/dashboard?manage=grading');
  await expect(page.locator('.cm-gs-cards')).toBeVisible();
}

async function reloadGrading(page) {
  await page.reload();
  await expect(page.locator('.cm-gs-cards')).toBeVisible();
}

const system = (page, value) => page.locator('[data-action="cmSetGradingSystem"][data-value="' + value + '"]');
const method = (page, value) => page.locator('[data-action="cmSetCalcMethod"][data-value="' + value + '"]');
const levelOrder = (page, value) => page.locator('[data-action="cmSetLevelOrder"][data-value="' + value + '"]');
const checkValue = page => page.locator('.cm-check-value');
const countsAsRule = page => page.locator('.cm-rule-text', { hasText: 'Proficient counts as' });

// Cece Adeyemi is the first student, and Check With a Student opens on her.
async function gradebookOverall(page) {
  await gotoApp(page, '/gradebook?course=sci8');
  const head = page.locator('.gb-grid-rowhead', { hasText: 'Cece Adeyemi' }).locator('.gb-grid-rowhead-grade');
  await expect(head).toBeVisible();
  return {
    cece: (await head.innerText()).split('\n').filter(Boolean),
    classOverall: await getText(page, '.gb-class-overall'),
  };
}

const categories = page =>
  page.evaluate(() => getCategories('sci8').map(c => ({ name: c.name, weight: Number(c.weight) })));
const rowNames = page => page.locator('.cm-cat-row .cm-cat-name').evaluateAll(els => els.map(e => e.value));
const rowWeights = page => page.locator('.cm-cat-row .cm-cat-weight').evaluateAll(els => els.map(e => e.value));
const inCategory = (page, id) =>
  page.evaluate(cid => getAssessments('sci8').filter(a => a.categoryId === cid).length, id);

test.describe('Class Settings Grading tab in Demo Mode', () => {
  test.beforeEach(async ({ page }) => {
    await enterDemo(page);
  });

  test('Letter, Proficiency and Both each change how the gradebook shows Overall, and a reload keeps the choice', async ({
    page,
  }) => {
    await openGrading(page);
    await expect(system(page, 'proficiency')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.cm-lane-note', { hasText: 'Not used in a Proficiency class.' })).toBeVisible();
    expect(await gradebookOverall(page)).toEqual({ cece: ['3.1', 'Proficient'], classOverall: '2.9' });

    await openGrading(page);
    await system(page, 'letter').click();
    await expect(system(page, 'letter')).toHaveAttribute('aria-checked', 'true');
    await expect(system(page, 'proficiency')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.cm-lane-note', { hasText: 'Not used in a Proficiency class.' })).toHaveCount(0);
    await expect(checkValue(page)).toHaveText('B 78.9%');
    expect(await page.evaluate(() => COURSES.sci8.gradingSystem)).toBe('letter');
    expect(await gradebookOverall(page)).toEqual({ cece: ['B 78.9%'], classOverall: 'B 73.6%' });
    await page.reload();
    expect(await gradebookOverall(page)).toEqual({ cece: ['B 78.9%'], classOverall: 'B 73.6%' });

    await openGrading(page);
    await system(page, 'both').click();
    await expect(system(page, 'both')).toHaveAttribute('aria-checked', 'true');
    await expect(checkValue(page)).toHaveText('3.1 · B 78.9%');
    expect(await gradebookOverall(page)).toEqual({ cece: ['3.1', 'B 78.9%'], classOverall: '2.9 · B 73.6%' });

    await openGrading(page);
    await reloadGrading(page);
    await expect(system(page, 'both')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => COURSES.sci8.gradingSystem)).toBe('both');

    await system(page, 'proficiency').click();
    await expect(checkValue(page)).toHaveText('3.1');
    expect(await gradebookOverall(page)).toEqual({ cece: ['3.1', 'Proficient'], classOverall: '2.9' });
  });

  test('Changing the calculation method asks first, Cancel keeps Mean, and Change moves the Overall', async ({
    page,
  }) => {
    await openGrading(page);
    await expect(method(page, 'average')).toHaveAttribute('aria-checked', 'true');
    await expect(checkValue(page)).toHaveText('3.1');

    await method(page, 'highest').click();
    await expect(page.locator('#confirm-title')).toHaveText('Change Calculation Method to Highest Score?');
    await expect(page.locator('.confirm-message')).toContainText('of your 27 students');
    await page.locator('#confirm-cancel-btn').click();
    await expect(page.locator('#confirm-title')).toHaveCount(0);
    await expect(method(page, 'average')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => getCourseConfig('sci8').calcMethod || COURSES.sci8.calcMethod)).toBe('average');

    await method(page, 'highest').click();
    await expect(page.locator('#confirm-ok-btn')).toHaveText('Change Method');
    await page.locator('#confirm-ok-btn').click();
    await expect(method(page, 'highest')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.cm-rule-title', { hasText: 'Exactly How Highest Score Works' })).toBeVisible();
    await expect(checkValue(page)).toHaveText('3.5');
    expect(await page.evaluate(() => getCourseConfig('sci8').calcMethod)).toBe('highest');
    expect((await gradebookOverall(page)).cece).toEqual(['3.5', 'Extending']);

    await page.reload();
    expect((await gradebookOverall(page)).cece).toEqual(['3.5', 'Extending']);
    await openGrading(page);
    await expect(method(page, 'highest')).toHaveAttribute('aria-checked', 'true');
  });

  test('Show the % As Whole Number rounds the Overall in a Letter class, and a reload keeps it', async ({ page }) => {
    await openGrading(page);
    await system(page, 'letter').click();
    const select = page.locator('#cm-round-percent');
    await expect(select).toHaveValue('decimal');
    await expect(checkValue(page)).toHaveText('B 78.9%');

    await select.selectOption('whole');
    await expect(checkValue(page)).toHaveText('B 79%');
    expect(await page.evaluate(() => [getCourseConfig('sci8').roundPercent, getRoundWholePercent('sci8')])).toEqual([
      true,
      true,
    ]);
    expect((await gradebookOverall(page)).cece).toEqual(['B 79%']);

    await openGrading(page);
    await reloadGrading(page);
    await expect(page.locator('#cm-round-percent')).toHaveValue('whole');
    await expect(checkValue(page)).toHaveText('B 79%');

    await page.locator('#cm-round-percent').selectOption('decimal');
    await expect(checkValue(page)).toHaveText('B 78.9%');
    expect(await page.evaluate(() => getRoundWholePercent('sci8'))).toBe(false);
  });

  test('Rubric Levels Extending First reverses the levels on a scoring card, and a reload keeps it', async ({
    page,
  }) => {
    const ASC = ['Emerging', 'Developing', 'Proficient', 'Extending'];
    const DESC = ['Extending', 'Proficient', 'Developing', 'Emerging'];
    // Cell Microscope Lab is a rubric card; Set Everyone To lists its levels.
    const cardLevels = async () => {
      await gotoApp(page, '/assignments?course=sci8');
      const items = page.locator('#ac-sci8a1 .assess-setto .assess-menu-item');
      await expect(items).toHaveCount(4);
      return items.allTextContents();
    };

    await openGrading(page);
    await expect(levelOrder(page, 'asc')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => levelOrderFor('sci8'))).toEqual([1, 2, 3, 4]);
    expect(await cardLevels()).toEqual(ASC);

    await openGrading(page);
    await levelOrder(page, 'desc').click();
    await expect(levelOrder(page, 'desc')).toHaveAttribute('aria-checked', 'true');
    await expect(levelOrder(page, 'asc')).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => [getCourseConfig('sci8').levelOrder, levelOrderFor('sci8')])).toEqual([
      'desc',
      [4, 3, 2, 1],
    ]);
    expect(await cardLevels()).toEqual(DESC);

    await page.reload();
    await expect(page.locator('#ac-sci8a1 .assess-setto .assess-menu-item')).toHaveText(DESC);
    await openGrading(page);
    await expect(levelOrder(page, 'desc')).toHaveAttribute('aria-checked', 'true');
  });

  test('A new weighted category saves only once it has a name and the weights total 100, and a reload keeps it', async ({
    page,
  }) => {
    await openGrading(page);
    expect(await rowNames(page)).toEqual(['Labs & Investigations', 'Projects & Communication', 'Quizzes & Checks']);
    expect(await rowWeights(page)).toEqual(['40', '35', '25']);
    const save = page.locator('#cm-cat-save-sci8');
    const sum = page.locator('#cm-cat-sum-sci8');
    await expect(save).toBeDisabled();

    await clickAction(page, 'cmCatAdd');
    await expect(page.locator('.cm-cat-row')).toHaveCount(4);
    await expect(sum).toHaveText('Total: 100 / 100% (every category needs a name)');
    await expect(save).toBeDisabled();

    const added = page.locator('.cm-cat-row').last();
    await added.locator('.cm-cat-name').fill('Homework');
    await added.locator('.cm-cat-weight').fill('10');
    await expect(sum).toHaveText('Total: 110 / 100% (weights must total 100)');
    await expect(save).toBeDisabled();

    await page.locator('.cm-cat-row').first().locator('.cm-cat-weight').fill('30');
    await expect(sum).toHaveText('Total: 100 / 100%');
    await expect(save).toBeEnabled();
    await save.click();

    const saved = [
      { name: 'Labs & Investigations', weight: 30 },
      { name: 'Projects & Communication', weight: 35 },
      { name: 'Quizzes & Checks', weight: 25 },
      { name: 'Homework', weight: 10 },
    ];
    await expect.poll(() => categories(page)).toEqual(saved);
    await expect(save).toBeDisabled();

    await reloadGrading(page);
    expect(await categories(page)).toEqual(saved);
    await expect(page.locator('.cm-cat-row')).toHaveCount(4);
    expect(await rowNames(page)).toEqual(saved.map(c => c.name));
    expect(await rowWeights(page)).toEqual(['30', '35', '25', '10']);
  });

  test('Deleting a category that has work asks where the work goes, moves it at once, and Save removes the category', async ({
    page,
  }) => {
    await openGrading(page);
    const checks = await inCategory(page, 'sci8-cat-checks');
    const labs = await inCategory(page, 'sci8-cat-labs');
    expect(checks).toBeGreaterThan(0);
    // A Quizzes & Checks assessment, to find on the Assignments page later.
    const movedId = await page.evaluate(() => getAssessments('sci8').find(a => a.categoryId === 'sci8-cat-checks').id);

    await page.locator('.cm-cat-row').nth(2).locator('[data-action="cmCatDelete"]').click();
    const move = page.locator('.cm-cat-move');
    await expect(move).toContainText('Move ' + checks + ' assessments in Quizzes & Checks to');
    await expect(page.locator('#cm-cat-move-target option')).toHaveText([
      'Labs & Investigations',
      'Projects & Communication',
    ]);
    await page.locator('#cm-cat-move-target').selectOption({ label: 'Labs & Investigations' });
    await page.locator('[data-action="cmCatMoveDelete"]').click();

    // The work moves now; the category leaves the list and is removed on Save.
    await expect.poll(() => inCategory(page, 'sci8-cat-checks')).toBe(0);
    expect(await inCategory(page, 'sci8-cat-labs')).toBe(labs + checks);
    expect((await categories(page)).map(c => c.name)).toContain('Quizzes & Checks');
    expect(await rowNames(page)).toEqual(['Labs & Investigations', 'Projects & Communication']);
    const sum = page.locator('#cm-cat-sum-sci8');
    const save = page.locator('#cm-cat-save-sci8');
    await expect(sum).toHaveText('Total: 75 / 100% (weights must total 100)');
    await expect(save).toBeDisabled();

    await page.locator('.cm-cat-row').first().locator('.cm-cat-weight').fill('65');
    await expect(save).toBeEnabled();
    await save.click();
    const saved = [
      { name: 'Labs & Investigations', weight: 65 },
      { name: 'Projects & Communication', weight: 35 },
    ];
    await expect.poll(() => categories(page)).toEqual(saved);

    await reloadGrading(page);
    expect(await categories(page)).toEqual(saved);
    expect(await rowNames(page)).toEqual(['Labs & Investigations', 'Projects & Communication']);
    expect(await rowWeights(page)).toEqual(['65', '35']);
    expect(await inCategory(page, 'sci8-cat-checks')).toBe(0);
    expect(await inCategory(page, 'sci8-cat-labs')).toBe(labs + checks);

    await gotoApp(page, '/assignments?course=sci8');
    await expect(page.locator('#ac-' + movedId + ' .type-badge')).toHaveText('Labs & Investigations');
  });

  test('BC Letter Bands asks first because a term has ended, Reset to Defaults puts Counts As back, and a reload keeps each', async ({
    page,
  }) => {
    const BC = { 1: 45, '1+': 50, '2-': 55, 2: 63, '2+': 67, '3-': 73, 3: 80, '3+': 86, '4-': 92, 4: 100 };
    const DEFAULT = { 1: 25, 2: 50, 3: 75, 4: 100 };
    const percents = () => page.evaluate(() => getGradingScale('sci8').percents);

    await openGrading(page);
    await system(page, 'letter').click();
    await expect(countsAsRule(page)).toContainText('Proficient counts as 75% now.');
    await expect(page.locator('#cm-pts-step-3')).toHaveAttribute('aria-label', '3 counts as 75%');
    await expect(checkValue(page)).toHaveText('B 78.9%');
    expect(await percents()).toEqual(DEFAULT);

    await clickAction(page, 'cmPointsScaleBc');
    await expect(page.locator('#confirm-title')).toHaveText('Change the Course %?');
    await expect(page.locator('.confirm-message')).toContainText('Term 1, which has already ended');
    await expect(page.locator('#confirm-ok-btn')).toHaveText('Change');
    await page.locator('#confirm-ok-btn').click();
    await expect(countsAsRule(page)).toContainText('Proficient counts as 80% now.');
    await expect(page.locator('#cm-pts-step-3')).toHaveAttribute('aria-label', '3 counts as 80%');
    await expect(page.locator('.cm-pts-pill')).toHaveCount(10);
    expect(await percents()).toEqual(BC);
    const bcOverall = await checkValue(page).innerText();
    expect(bcOverall).not.toBe('B 78.9%');
    expect((await gradebookOverall(page)).cece).toEqual([bcOverall]);

    await openGrading(page);
    await reloadGrading(page);
    expect(await percents()).toEqual(BC);
    await expect(countsAsRule(page)).toContainText('Proficient counts as 80% now.');
    await expect(checkValue(page)).toHaveText(bcOverall);

    await clickAction(page, 'cmPointsScaleReset');
    await expect(page.locator('#confirm-title')).toHaveText('Change the Course %?');
    await page.locator('#confirm-ok-btn').click();
    await expect(countsAsRule(page)).toContainText('Proficient counts as 75% now.');
    await expect(page.locator('.cm-pts-pill')).toHaveCount(10);
    await expect(checkValue(page)).toHaveText('B 78.9%');
    expect(await percents()).toEqual(DEFAULT);

    await reloadGrading(page);
    expect(await percents()).toEqual(DEFAULT);
    await expect(page.locator('#cm-pts-step-3')).toHaveAttribute('aria-label', '3 counts as 75%');
  });
});
