import { test, expect } from '@playwright/test';
import { gotoApp, clickAction, getText, openCompPicker, closeCompPicker } from './helpers.js';

/* Pins what Class Settings' Reporting Terms and Competencies tabs do today
   in Demo Mode on Science 8 (S19 handoff review, before any split of
   teacher/dash-class-manager.js). Terms: add, typed dates, span, delete,
   a preset, Cancel and reload, and the gradebook print dialog's term list.
   Competencies: a new folder, a competency moved into it, the folder
   deleted, wording edited and restored, an I Can deleted, kept after a
   reload and shown in the assessment form's Choose Competencies. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await enterDemo(page);
});

/* ── Reporting Terms ─────────────────────────────────────── */

const tiles = page => page.locator('.cm-term-tile');
const termRows = page => page.locator('.cm-term-row');
const termLabels = page => page.locator('.cm-term-row .cm-term-label');
const saveTerms = page => page.getByRole('button', { name: 'Save Terms' });
const spanGroup = page => page.getByRole('radiogroup', { name: 'This Class Runs' });
const savedTerms = page => page.evaluate(() => getReportingTerms('sci8'));

async function openTerms(page) {
  await gotoApp(page, '/dashboard?manage=terms');
  await expect(page.getByRole('tab', { name: 'Reporting Terms' })).toHaveAttribute('aria-selected', 'true');
}

async function fillTerm(page, idx, starts, ends) {
  const row = termRows(page).nth(idx);
  await row.getByLabel('Start date').fill(starts);
  await row.getByLabel('End date').fill(ends);
}

const tileTexts = page =>
  tiles(page).evaluateAll(els =>
    els.map(e => [
      e.querySelector('.cm-term-tile-name').textContent,
      e.querySelector('.cm-term-tile-dates').textContent,
    ]),
  );

/* Each tile's name and dates, once the tiles are drawn. */
async function expectTiles(page, expected) {
  await expect(tiles(page)).toHaveCount(expected.length);
  expect(await tileTexts(page)).toEqual(expected);
}

/* The gradebook's Print Grades dialog: its Term menu's choices. */
async function printTermChoices(page) {
  await gotoApp(page, '/gradebook?course=sci8');
  await page.getByRole('button', { name: 'Print Grades' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print Grades' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Term / }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const names = await menu.getByRole('menuitemradio').evaluateAll(els => els.map(e => e.firstChild.textContent));
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  return names;
}

test.describe('Reporting Terms', () => {
  test('saved terms show as tiles and Cancel drops an added term and typed dates', async ({ page }) => {
    await openTerms(page);
    const before = await savedTerms(page);
    expect(before.map(t => t.label)).toEqual(['Term 1', 'Term 2']);
    await expect(tiles(page)).toHaveCount(2);
    const shown = await tileTexts(page);
    expect(shown.map(t => t[0])).toEqual(['Term 1', 'Term 2']);
    // Typed terms are the class's own: no This Class Runs choice.
    await expect(spanGroup(page)).toHaveCount(0);

    await clickAction(page, 'cmTermEdit');
    await expect(termRows(page)).toHaveCount(2);
    await expect(saveTerms(page)).toBeDisabled();
    await fillTerm(page, 0, '2026-09-02', '2026-11-27');
    await fillTerm(page, 1, '2026-11-28', '2027-01-29');
    await expect(saveTerms(page)).toBeEnabled();
    await clickAction(page, 'cmTermAdd');
    await expect(termRows(page)).toHaveCount(3);

    await clickAction(page, 'cmTermCancel');
    await expect(termRows(page)).toHaveCount(0);
    await expect(tiles(page)).toHaveCount(2);
    expect(await tileTexts(page)).toEqual(shown);
    expect(await savedTerms(page)).toEqual(before);
  });

  test('an added term with typed dates saves, survives a reload and appears in the print dialog', async ({ page }) => {
    await openTerms(page);
    await clickAction(page, 'cmTermEdit');
    await fillTerm(page, 0, '2026-09-02', '2026-11-27');
    await fillTerm(page, 1, '2026-11-28', '2027-01-29');
    await page.getByRole('button', { name: '+ Add Term' }).click();
    await expect(termRows(page)).toHaveCount(3);
    // The new term is named for its place and starts the day after the last one ends.
    await expect(termLabels(page).nth(2)).toHaveValue('Term 3');
    await expect(termRows(page).nth(2).getByLabel('Start date')).toHaveValue('2027-01-30');
    await expect(saveTerms(page)).toBeDisabled();
    await expect(page.locator('#cm-term-foot-sci8')).toHaveText('Every term needs a start date and an end date.');
    await termRows(page).nth(2).getByLabel('End date').fill('2027-06-25');
    await expect(page.locator('#cm-term-foot-sci8')).toHaveText('Report 1–3 on the Reports page match these terms.');
    await saveTerms(page).click();

    const expected = [
      ['Term 1', 'Sep 2 – Nov 27'],
      ['Term 2', 'Nov 28 – Jan 29'],
      ['Term 3', 'Jan 30 – Jun 25'],
    ];
    await expectTiles(page, expected);
    expect(await savedTerms(page)).toEqual([
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-11-27' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-11-28', ends_on: '2027-01-29' },
      { ordinal: 3, label: 'Term 3', starts_on: '2027-01-30', ends_on: '2027-06-25' },
    ]);

    await page.reload();
    await expectTiles(page, expected);

    expect(await printTermChoices(page)).toEqual([
      'All Time',
      'Term 1 Year to Date',
      'Term 2 Year to Date',
      'Term 3 Year to Date',
      'Custom Dates',
    ]);
  });

  test('deleting a term saves and survives a reload', async ({ page }) => {
    await openTerms(page);
    await clickAction(page, 'cmTermEdit');
    await fillTerm(page, 0, '2026-09-02', '2026-11-27');
    await fillTerm(page, 1, '2026-11-28', '2027-01-29');
    await clickAction(page, 'cmTermAdd');
    await termRows(page).nth(2).getByLabel('End date').fill('2027-06-25');
    await saveTerms(page).click();
    await expect(tiles(page)).toHaveCount(3);

    await clickAction(page, 'cmTermEdit');
    await termRows(page).nth(2).getByRole('button', { name: 'Remove term' }).click();
    await expect(termRows(page)).toHaveCount(2);
    await expect(page.locator('#cm-term-foot-sci8')).toHaveText('Report 1–2 on the Reports page match these terms.');
    await saveTerms(page).click();
    await expect(tiles(page)).toHaveCount(2);
    expect((await savedTerms(page)).map(t => t.label)).toEqual(['Term 1', 'Term 2']);

    await page.reload();
    await expectTiles(page, [
      ['Term 1', 'Sep 2 – Nov 27'],
      ['Term 2', 'Nov 28 – Jan 29'],
    ]);
  });

  test('a preset fills the terms, a span keeps one semester, and the print dialog follows', async ({ page }) => {
    await openTerms(page);
    await clickAction(page, 'cmTermEdit');
    // With every row removed the presets come back.
    await termRows(page).nth(1).getByRole('button', { name: 'Remove term' }).click();
    await termRows(page).nth(0).getByRole('button', { name: 'Remove term' }).click();
    await expect(termRows(page)).toHaveCount(0);
    await expect(page.locator('#cm-term-foot-sci8')).toHaveText('No terms: every page shows the whole year.');
    await page.getByRole('button', { name: 'Quarters (4)' }).click();
    await expect(termLabels(page)).toHaveCount(4);
    expect(await termLabels(page).evaluateAll(els => els.map(e => e.value))).toEqual([
      'Term 1',
      'Term 2',
      'Term 3',
      'Term 4',
    ]);
    await expect(spanGroup(page).getByRole('radio', { name: 'Full Year' })).toHaveAttribute('aria-checked', 'true');

    // Semester 2 keeps Terms 3 and 4 with their numbers.
    await spanGroup(page).getByRole('radio', { name: 'Semester 2' }).click();
    await expect(termLabels(page)).toHaveCount(2);
    expect(await termLabels(page).evaluateAll(els => els.map(e => e.value))).toEqual(['Term 3', 'Term 4']);
    await saveTerms(page).click();
    await expectTiles(page, [
      ['Term 3', 'Feb 1 – Apr 15'],
      ['Term 4', 'Apr 16 – Jun 30'],
    ]);
    expect(await getText(page, '.cm-term-view-foot .cm-hint')).toBe(
      'Report 3–4 on the Reports page match these terms.',
    );
    const saved = await savedTerms(page);
    expect(saved.map(t => t.ordinal)).toEqual([3, 4]);
    expect(saved.map(t => t.starts_on.slice(5) + '/' + t.ends_on.slice(5))).toEqual(['02-01/04-15', '04-16/06-30']);

    // Full Year opens the editor with all four; Cancel puts the two back.
    await spanGroup(page).getByRole('radio', { name: 'Full Year' }).click();
    await expect(termLabels(page)).toHaveCount(4);
    await clickAction(page, 'cmTermCancel');
    await expect(tiles(page)).toHaveCount(2);
    expect(await savedTerms(page)).toEqual(saved);

    await page.reload();
    await expect(tiles(page)).toHaveCount(2);
    await expect(spanGroup(page).getByRole('radio', { name: 'Semester 2' })).toHaveAttribute('aria-checked', 'true');

    expect(await printTermChoices(page)).toEqual([
      'All Time',
      'Term 3 Year to Date',
      'Term 4 Year to Date',
      'Custom Dates',
    ]);
  });
});

/* ── Competencies ────────────────────────────────────────── */

const folderInputs = page => page.locator('.mod-folder-name-input');

/* The folders' names in order, once the folders are drawn. */
async function expectFolders(page, names) {
  await expect(folderInputs(page)).toHaveCount(names.length);
  expect(await folderInputs(page).evaluateAll(els => els.map(e => e.value))).toEqual(names);
}
const folder = (page, name) =>
  page.locator('.mod-folder').filter({ has: page.locator('.mod-folder-name-input[value="' + name + '"]') });
const sectionOf = (page, id) =>
  page.evaluate(sid => {
    const s = getLearningMap('sci8').sections.find(x => x.id === sid);
    const t = s.tags[0];
    return { groupId: s.groupId || null, text: t.text, source: t.source_text, icans: t.i_can_statements };
  }, id);

async function openCompetencies(page) {
  await gotoApp(page, '/dashboard?manage=competencies');
  await expect(page.getByRole('tab', { name: /^Competencies/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-action="cmAddCompGroup"]')).toBeVisible();
}

/* The assessment form's Choose Competencies window, in its List view. */
async function openPicker(page) {
  await gotoApp(page, '/assignments?course=sci8');
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
  return openCompPicker(page);
}

const pickerRow = (dlg, id) => dlg.locator('.af-tag-row:has(.af-tag-item[data-section="' + id + '"])');

const pickerGroup = (dlg, name) =>
  dlg.locator('.af-list-group').filter({ has: dlg.page().locator('.af-list-group-name', { hasText: name }) });

const SIX_FOLDERS = [
  'Questioning and Predicting',
  'Planning and Conducting',
  'Processing and Analyzing',
  'Evaluating',
  'Applying and Innovating',
  'Communicating',
];

test.describe('Competencies', () => {
  test('a new folder takes a moved competency, survives a reload, shows in the picker and can be deleted', async ({
    page,
  }) => {
    await openCompetencies(page);
    await expectFolders(page, SIX_FOLDERS);

    await clickAction(page, 'cmAddCompGroup');
    await expectFolders(page, [...SIX_FOLDERS, 'Group 7']);
    await expect(folder(page, 'Group 7').locator('.mod-folder-meta')).toHaveText('0 Competencies');

    // Select mode moves QP1 into the new folder.
    await clickAction(page, 'cmCompSelectStart');
    await page.getByRole('checkbox', { name: 'Select Sustained Inquiry' }).check();
    await expect(page.locator('.cm-comp-selected')).toHaveText('1 Selected');
    await page.getByRole('button', { name: /^Move to Folder/ }).click();
    await page.getByRole('menuitem', { name: 'Group 7' }).click();
    await clickAction(page, 'cmCompSelectDone');
    await expect(folder(page, 'Group 7').locator('.mod-folder-meta')).toHaveText('1 Competency');
    await expect(folder(page, 'Group 7').locator('#cm-std-QP1')).toBeVisible();
    await expect(folder(page, 'Questioning and Predicting').locator('.mod-folder-meta')).toHaveText('4 Competencies');
    const groupId = await page.evaluate(
      () => getLearningMap('sci8').competencyGroups.find(g => g.name === 'Group 7').id,
    );
    expect((await sectionOf(page, 'QP1')).groupId).toBe(groupId);

    await page.reload();
    await expectFolders(page, [...SIX_FOLDERS, 'Group 7']);
    await expect(folder(page, 'Group 7').locator('#cm-std-QP1')).toBeVisible();

    let dlg = await openPicker(page);
    await expect(pickerGroup(dlg, 'Group 7').locator('.af-tag-item')).toHaveCount(1);
    await expect(pickerGroup(dlg, 'Group 7').locator('.af-tag-item[data-section="QP1"]')).toBeVisible();
    await expect(pickerGroup(dlg, 'Questioning and Predicting').locator('.af-tag-item')).toHaveCount(4);
    await closeCompPicker(page);

    // A folder with a competency in it asks first; QP1 leaves the folder.
    await openCompetencies(page);
    await folder(page, 'Group 7').locator('[data-action="cmDeleteCompGroup"]').click();
    const confirm = page.getByRole('dialog', { name: 'Delete Group' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(confirm).toHaveCount(0);
    await expectFolders(page, SIX_FOLDERS);
    expect((await sectionOf(page, 'QP1')).groupId).toBeNull();
    await expect(page.locator('#cm-std-QP1')).toBeVisible();

    await page.reload();
    await expectFolders(page, SIX_FOLDERS);
    dlg = await openPicker(page);
    await expect(dlg.locator('.af-list-group-name', { hasText: 'Group 7' })).toHaveCount(0);
    await expect(dlg.locator('.af-tag-item[data-section="QP1"]')).toBeVisible();
  });

  test('wording edited then restored, and an I Can deleted, each survive a reload and show in the picker', async ({
    page,
  }) => {
    await openCompetencies(page);
    const pc1 = await sectionOf(page, 'PC1');
    const pc2 = await sectionOf(page, 'PC2');
    expect(pc1.text).toBe(pc1.source);
    expect(pc2.icans.length).toBe(3);

    // Edit Wording opens a box; leaving it saves and flags the card.
    const card1 = page.locator('#cm-std-PC1');
    await card1.locator('.cm-std-header').click();
    await card1.getByRole('button', { name: 'Edit Wording' }).click();
    const box = card1.locator('.cm-std-wording-input');
    await expect(box).toBeFocused();
    await box.fill('Plan an investigation with a partner');
    await box.blur();
    await expect(card1.locator('.cm-std-wording p')).toHaveText('Plan an investigation with a partner');
    await expect(card1.locator('.cm-std-source')).toContainText('· Edited');
    expect((await sectionOf(page, 'PC1')).text).toBe('Plan an investigation with a partner');
    expect((await sectionOf(page, 'PC1')).source).toBe(pc1.source);

    // An I Can's ✕ deletes it at once.
    const card2 = page.locator('#cm-std-PC2');
    await card2.locator('.cm-std-header').click();
    await expect(card2.locator('.cm-ican-text')).toHaveCount(3);
    await card2.getByRole('button', { name: 'Delete this statement' }).first().click();
    await expect(card2.locator('.cm-ican-text')).toHaveCount(2);
    expect((await sectionOf(page, 'PC2')).icans).toEqual(pc2.icans.slice(1));

    await page.reload();
    await expect(card1.locator('.cm-std-flag')).toHaveText('Wording Edited');
    await expect(card1.locator('.cm-std-line')).toHaveText('Plan an investigation with a partner');
    await expect(card2.locator('.cm-std-count')).toHaveText('2 I Can');

    let dlg = await openPicker(page);
    await expect(pickerRow(dlg, 'PC1').locator('.af-tag-name')).toHaveText('Plan an investigation with a partner');
    const icans = pickerRow(dlg, 'PC2').getByRole('button', { name: '2 I Can' });
    await icans.click();
    await expect(dlg.locator('#' + (await icans.getAttribute('aria-controls')) + ' li')).toHaveText(pc2.icans.slice(1));
    await closeCompPicker(page);

    // Restore Original Wording, from the card's ⋯ menu.
    await openCompetencies(page);
    // The card's tools show once it is open.
    await card1.locator('.cm-std-header').click();
    await expect(card1).toHaveClass(/\bopen\b/);
    await card1.getByRole('button', { name: 'More actions for Investigation Plans' }).click();
    await page.getByRole('menuitem', { name: 'Restore Original Wording' }).click();
    await expect(card1.locator('.cm-std-flag')).toHaveCount(0);
    expect((await sectionOf(page, 'PC1')).text).toBe(pc1.source);

    await page.reload();
    await expect(card1.locator('.cm-std-flag')).toHaveCount(0);
    await expect(card1.locator('.cm-std-line')).toHaveText(pc1.source);
    dlg = await openPicker(page);
    await expect(pickerRow(dlg, 'PC1').locator('.af-tag-name')).toHaveText(pc1.source);
    await expect(pickerRow(dlg, 'PC2').getByRole('button', { name: '2 I Can' })).toBeVisible();
  });
});
