import { test, expect } from '@playwright/test';
import { gotoApp, clickAction, getText } from './helpers.js';
import { cardMenuItem } from './card-menu.js';

/* Pins what the Assignments list does today with its own actions, in Demo
   Mode on Science 8 (S19-D8): the order of the cards, dragging a card by
   its grip, Expand and Collapse, Duplicate, Copy to Another Class after
   Class Settings' Duplicate Class, Delete…, and adding, renaming and
   deleting a module. Demo data lives in localStorage, so page.reload()
   keeps it. Tests only: written before any split of page-assignments.js. */

test.use({ viewport: { width: 1440, height: 900 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openList(page, cid = 'sci8') {
  await gotoApp(page, '/assignments?course=' + cid);
  await expect(page.locator('.assess-card').first()).toBeVisible();
}

async function reloadList(page) {
  await page.reload();
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await expect(page.locator('.assess-card').first()).toBeVisible();
}

const folder = (page, moduleId) => page.locator(`.mod-folder[data-module-id="${moduleId}"]`);
const card = (page, aid) => page.locator('#ac-' + aid);
const cardIds = loc => loc.locator('.assess-card').evaluateAll(cards => cards.map(c => c.id.replace(/^ac-/, '')));
const scoreCount = (page, aid, cid = 'sci8') =>
  page.evaluate(
    ([a, c]) =>
      Object.values(getScores(c))
        .flat()
        .filter(e => e && e.assessmentId === a).length,
    [aid, cid],
  );

async function openCard(page, aid) {
  const c = card(page, aid);
  if (!(await c.evaluate(el => el.classList.contains('open')))) await c.locator('.assess-title').click();
  await expect(c).toHaveClass(/\bopen\b/);
  return c;
}

const CELLS = 'sci8-mod-cells'; // Cells & Body Systems, seven cards
const EARTH = 'sci8-mod-earth'; // Earth Science, four cards
const UNGROUPED = '__none__';

test.describe('Assignments list actions in Demo Mode', () => {
  test.beforeEach(async ({ page }) => {
    await enterDemo(page);
  });

  test('cards sit newest first in each module, and a placed card goes below the unplaced ones', async ({ page }) => {
    await openList(page);
    // No card has been placed by a drag yet, so each folder runs newest first.
    const folders = await page
      .locator('.mod-folder')
      .evaluateAll(fs =>
        fs.map(f => [f.dataset.moduleId, [...f.querySelectorAll('.assess-card')].map(c => c.id.slice(3))]),
      );
    expect(folders.map(f => f[0])).toEqual([
      CELLS,
      'sci8-mod-chem',
      EARTH,
      'sci8-mod-ecology',
      'sci8-mod-energy',
      UNGROUPED,
    ]);
    const dates = await page.evaluate(() => Object.fromEntries(getAssessments('sci8').map(a => [a.id, a.date])));
    for (const [, ids] of folders) {
      const shown = ids.map(id => dates[id]);
      expect(shown).toEqual(shown.slice().sort().reverse());
    }
    expect(folders.find(f => f[0] === CELLS)[1]).toEqual([
      'sci8q11',
      'sci8q9',
      'sci8a3',
      'sci8a2',
      'sci8t1',
      'sci8a1',
      'sci8q1',
    ]);
    expect(folders.find(f => f[0] === UNGROUPED)[1]).toEqual([
      'sci8a20',
      'sci8a10',
      'sci8q12',
      'sci8t5',
      'sci8q10',
      'sci8a6',
      'sci8q4',
    ]);

    // display_order 1 and 2 sit after every card still at 0, lowest first.
    await page.evaluate(() => {
      const list = getAssessments('sci8');
      list.find(a => a.id === 'sci8q4').display_order = 1;
      list.find(a => a.id === 'sci8a20').display_order = 2;
      saveAssessments('sci8', list);
    });
    await reloadList(page);
    expect(await cardIds(folder(page, UNGROUPED))).toEqual([
      'sci8a10',
      'sci8q12',
      'sci8t5',
      'sci8q10',
      'sci8a6',
      'sci8q4',
      'sci8a20',
    ]);
  });

  test('a card dragged by its grip lands where it was dropped and stays there after a reload', async ({ page }) => {
    await openList(page);
    const cells = folder(page, CELLS);
    // Over the top of the first card, the dragged card goes before it.
    await card(page, 'sci8a3')
      .locator('.assess-grip')
      .dragTo(card(page, 'sci8q11'), { targetPosition: { x: 200, y: 4 } });
    const moved = ['sci8a3', 'sci8q11', 'sci8q9', 'sci8a2', 'sci8t1', 'sci8a1', 'sci8q1'];
    await expect.poll(() => cardIds(cells)).toEqual(moved);
    // The drag numbers the whole list 1..n.
    const orders = await page.evaluate(() => getAssessments('sci8').map(a => a.display_order));
    expect(orders.slice().sort((a, b) => a - b)).toEqual(orders.map((_, i) => i + 1));
    expect(await page.evaluate(() => getAssessments('sci8').find(a => a.id === 'sci8a3').moduleId)).toBe(CELLS);

    await reloadList(page);
    expect(await cardIds(folder(page, CELLS))).toEqual(moved);
  });

  test('Expand opens every card and Collapse closes them all', async ({ page }) => {
    await openList(page);
    const expand = page.locator('[data-action="expandAllAssess"]');
    const collapse = page.locator('[data-action="collapseAllAssess"]');
    const total = await page.evaluate(() => getAssessments('sci8').length);
    await expect(page.locator('.assess-card')).toHaveCount(total);
    await expect(page.locator('.assess-card.open')).toHaveCount(0);
    await expect(collapse).toHaveAttribute('aria-pressed', 'true');
    await expect(expand).toHaveAttribute('aria-pressed', 'false');

    await clickAction(page, 'expandAllAssess');
    await expect(page.locator('.assess-card.open')).toHaveCount(total);
    await expect(page.locator('[data-action="expandAllAssess"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="collapseAllAssess"]')).toHaveAttribute('aria-pressed', 'false');

    await clickAction(page, 'collapseAllAssess');
    await expect(page.locator('.assess-card.open')).toHaveCount(0);
    await expect(page.locator('[data-action="collapseAllAssess"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="expandAllAssess"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Duplicate makes an open second card with the same scoring and no scores', async ({ page }) => {
    await openList(page);
    const orig = await openCard(page, 'sci8a1'); // Cell Microscope Lab, a rubric with scores
    expect(await scoreCount(page, 'sci8a1')).toBe(81);
    await (await cardMenuItem(orig, 'dupeAssess')).click();

    const copy = page.locator('.assess-card', {
      has: page.locator('.assess-title', { hasText: /^Cell Microscope Lab \(Copy\)$/ }),
    });
    await expect(copy).toHaveCount(1);
    await expect(copy).toHaveClass(/\bopen\b/);
    // It sits in the same module as the original.
    await expect(folder(page, CELLS).locator('.assess-card')).toHaveCount(8);
    await expect(copy.locator('.rubric-badge')).toHaveText(await getText(page, '#ac-sci8a1 .rubric-badge'));

    const both = await page.evaluate(() => {
      const list = getAssessments('sci8');
      const a = list.find(x => x.id === 'sci8a1');
      const b = list.find(x => x.title === 'Cell Microscope Lab (Copy)');
      const keep = x => ({
        rubricId: x.rubricId,
        tagIds: x.tagIds,
        scoreMode: x.scoreMode,
        maxPoints: x.maxPoints,
        type: x.type,
        categoryId: x.categoryId,
        moduleId: x.moduleId,
        date: x.date,
      });
      return { id: b.id, a: keep(a), b: keep(b), differ: a.id !== b.id };
    });
    expect(both.differ).toBe(true);
    expect(both.b).toEqual(both.a);
    expect(await scoreCount(page, both.id)).toBe(0);
    expect(await scoreCount(page, 'sci8a1')).toBe(81);

    await reloadList(page);
    await expect(card(page, both.id).locator('.assess-title')).toHaveText('Cell Microscope Lab (Copy)');
    expect(await scoreCount(page, both.id)).toBe(0);
  });

  test('Copy to Another Class, after Duplicate Class, puts the assessment in the new class', async ({ page }) => {
    // Class Settings: Duplicate Class for Block B, an empty second class.
    await gotoApp(page, '/dashboard?manage=students');
    await expect(page.locator('.cm-rs-row').first()).toBeVisible();
    await page.locator('.cm-head [data-action="cmStdMenu"]').click();
    await clickAction(page, 'cmDuplicateCourse');
    const dup = page.locator('.cm-dup-card');
    await dup.locator('.cm-block-picker .seg-btn', { hasText: /^B$/ }).click();
    await dup.locator('#cm-dup-ok').click();
    await expect(page.locator('.cm-head-meta')).toContainText('Block B · 0 Students');
    const other = await page.evaluate(() => Object.keys(COURSES).find(cid => cid !== 'sci8'));
    expect(other).toBeTruthy();
    expect(await page.evaluate(cid => getAssessments(cid).length, other)).toBe(0);

    await openList(page);
    const quiz = await openCard(page, 'sci8q12'); // Data Reading Quiz, points out of 10
    await (await cardMenuItem(quiz, 'copyAssessToClass')).click();
    // The edit form opens at its Classes row, on the new class's chip.
    await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
    const chip = page.locator(`.af-copy-chip[data-cid="${other}"]`);
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-action="saveEditAssess"]').click();

    await expect
      .poll(() => page.evaluate(cid => getAssessments(cid).map(a => a.title), other))
      .toEqual(['Data Reading Quiz']);
    const got = await page.evaluate(cid => {
      const a = getAssessments('sci8').find(x => x.id === 'sci8q12');
      const b = getAssessments(cid)[0];
      return { a: [a.scoreMode, a.maxPoints, a.date], b: [b.scoreMode, b.maxPoints, b.date], same: a.id === b.id };
    }, other);
    expect(got.same).toBe(false);
    expect(got.b).toEqual(got.a);
    // The original stays in Science 8 with its scores.
    expect(await scoreCount(page, 'sci8q12')).toBe(27);

    await openList(page, other);
    await expect(page.locator('.assess-card .assess-title')).toHaveText(['Data Reading Quiz']);
  });

  test('Delete… asks first; Cancel keeps it, Delete removes it and its scores for good', async ({ page }) => {
    await openList(page);
    const quiz = await openCard(page, 'sci8q12');
    expect(await scoreCount(page, 'sci8q12')).toBe(27);
    await (await cardMenuItem(quiz, 'deleteAssess')).click();
    const dialog = page.locator('.confirm-overlay');
    await expect(dialog.locator('.confirm-title')).toHaveText('Delete Assessment');
    await expect(dialog.locator('.confirm-message')).toHaveText('Delete this assessment and all its scores?');
    await dialog.locator('#confirm-cancel-btn').click();
    await expect(dialog).toHaveCount(0);
    await expect(card(page, 'sci8q12')).toBeVisible();
    expect(await scoreCount(page, 'sci8q12')).toBe(27);

    await (await cardMenuItem(card(page, 'sci8q12'), 'deleteAssess')).click();
    await expect(dialog.locator('#confirm-ok-btn')).toHaveText('Delete');
    await dialog.locator('#confirm-ok-btn').click();
    await expect(card(page, 'sci8q12')).toHaveCount(0);
    expect(await scoreCount(page, 'sci8q12')).toBe(0);

    await reloadList(page);
    await expect(card(page, 'sci8q12')).toHaveCount(0);
    expect(await page.evaluate(() => getAssessments('sci8').some(a => a.id === 'sci8q12'))).toBe(false);
    expect(await scoreCount(page, 'sci8q12')).toBe(0);
  });

  test('a module is added, renamed and deleted, and its cards move to Ungrouped', async ({ page }) => {
    await openList(page);
    const before = await page.evaluate(() => getModules('sci8').map(m => m.id));
    await clickAction(page, 'addModuleInline');
    await expect.poll(() => page.evaluate(() => getModules('sci8').length)).toBe(before.length + 1);
    const added = await page.evaluate(ids => getModules('sci8').find(m => !ids.includes(m.id)).id, before);
    const name = folder(page, added).locator('.mod-folder-name-input');
    // The new module's name box is ready to type over.
    await expect(name).toHaveValue('Module 6');
    await expect(name).toBeFocused();
    await expect(folder(page, added).locator('.mod-folder-empty')).toHaveText(
      'Drop assignments here or create a new one',
    );
    await page.keyboard.type('Review Week');
    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(id => getModules('sci8').find(m => m.id === id).name, added))
      .toBe('Review Week');

    // An emptied name is not saved: the box shows the saved one again.
    await name.fill('');
    await name.blur();
    await expect(name).toHaveValue('Review Week');

    await reloadList(page);
    await expect(folder(page, added).locator('.mod-folder-name-input')).toHaveValue('Review Week');

    // Deleting an empty module asks a short question.
    await folder(page, added).locator('[data-action="deleteModule"]').click();
    const dialog = page.locator('.confirm-overlay');
    await expect(dialog.locator('.confirm-title')).toHaveText('Delete Module');
    await expect(dialog.locator('.confirm-message')).toHaveText('Delete this module?');
    await dialog.locator('#confirm-ok-btn').click();
    await expect(folder(page, added)).toHaveCount(0);

    // A module with cards says where they go, and they go there.
    const earthCards = await cardIds(folder(page, EARTH));
    expect(earthCards).toHaveLength(4);
    await folder(page, EARTH).locator('[data-action="deleteModule"]').click();
    await expect(dialog.locator('.confirm-message')).toHaveText(
      '4 assessment(s) use this module. They will move to Ungrouped Assignments. Delete anyway?',
    );
    await dialog.locator('#confirm-ok-btn').click();
    await expect(folder(page, EARTH)).toHaveCount(0);
    for (const aid of earthCards) await expect(folder(page, UNGROUPED).locator('#ac-' + aid)).toHaveCount(1);

    await reloadList(page);
    await expect(folder(page, EARTH)).toHaveCount(0);
    expect(await page.evaluate(() => getModules('sci8').map(m => m.name))).toEqual([
      'Cells & Body Systems',
      'Chemistry & Matter',
      'Ecology & Environment',
      'Energy, Forces & Light',
    ]);
    for (const aid of earthCards) await expect(folder(page, UNGROUPED).locator('#ac-' + aid)).toHaveCount(1);
    expect(
      await page.evaluate(
        ids => getAssessments('sci8').filter(a => ids.includes(a.id) && a.moduleId).length,
        earthCards,
      ),
    ).toBe(0);
  });
});
