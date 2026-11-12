import { test, expect } from '@playwright/test';
import { gotoApp, clickAction, getText } from './helpers.js';

/* Pins what the gradebook does today with edits that must outlast a reload,
   in Demo Mode on Science 8: typed scores and a Complete/Incomplete mark,
   Clear Score and its Undo toast, Cmd+Z after a typed level, Mark Blank
   Cells Missing and Undo Marking Blank Cells, Delete Assessment's Undo
   window, an Overall Comment from the grader dialog, and one student's
   Export CSV row. Demo data lives in localStorage, so page.reload() keeps
   it. Tests only: written before any split of page-gradebook.js. */

test.use({ viewport: { width: 1440, height: 900 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openScores(page) {
  await gotoApp(page, '/gradebook?course=sci8');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await expect(page.locator('#gb-data td.gb-scores-cell').first()).toBeVisible();
}

async function reloadScores(page) {
  await page.reload();
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await expect(page.locator('#gb-data td.gb-scores-cell').first()).toBeVisible();
}

const STUDENT = 'st1'; // Cece Adeyemi
const POINTS = 'sci8q12'; // Data Reading Quiz, points out of 10
const LEVEL = 'sci8a10'; // Mid-Year Lab Skills Check, a level on two competencies
const COMPLETE = 'sci8a13'; // Periodic Table Scavenger Hunt, Complete/Incomplete
const BLANK = 'sci8a21'; // Light Refraction Lab, no scores yet
const SMALL = 'sci8q3'; // KMT Vocabulary Check: 27 of the class's 2,000 or so entries

const cell = (page, aid, sid = STUDENT) => page.locator(`.gb-scores-cell[data-aid="${aid}"][data-sid="${sid}"]`);
const cellText = (page, aid, sid = STUDENT) => cell(page, aid, sid).locator('.gb-scores-val');
const overall = (page, sid = STUDENT) =>
  page.locator(`#gb-rowheads .gb-grid-rowhead:has([data-sid="${sid}"]) .gb-grid-rowhead-grade`);
const columnAverage = (page, aid) => page.locator(`#gb-data tr.gb-scores-stats td[data-aid="${aid}"]`);
const toast = page => page.locator('#undo-toast');

/* Selects the cell, types the digits and Return, as a teacher would. Return
   moves the box down a row; Escape closes that one without saving. */
async function typeInCell(page, aid, digits) {
  await cell(page, aid).focus();
  await expect(cell(page, aid)).toHaveClass(/gb-focus/);
  await page.keyboard.press(digits[0]);
  const box = cell(page, aid).locator('.gb-scores-input');
  await expect(box).toBeFocused();
  if (digits.length > 1) await page.keyboard.type(digits.slice(1));
  await page.keyboard.press('Enter');
  await expect(page.locator('.gb-scores-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gb-scores-input')).toHaveCount(0);
}

async function columnMenu(page, aid) {
  const label = page.locator(`#gb-colheads .gb-grid-colhead[data-aid="${aid}"] .gb-grid-colhead-label`);
  await label.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.gb-ctx-menu')).toBeVisible();
  return page.locator('.gb-ctx-menu');
}

const entries = (page, aid, sid = STUDENT) =>
  page.evaluate(
    ([a, s]) => (getScores('sci8')[s] || []).filter(e => e.assessmentId === a).map(e => [e.tagId, e.score]),
    [aid, sid],
  );

// What the Scores view shows for the student and the columns this file edits.
async function screen(page) {
  const out = {
    overall: await overall(page).innerText(),
    classOverall: await getText(page, '.gb-scores-stats-head .gb-class-overall'),
  };
  for (const aid of [POINTS, LEVEL, COMPLETE]) {
    out[aid] = await cellText(page, aid).innerText();
    out[aid + ' avg'] = await columnAverage(page, aid).innerText();
  }
  return out;
}

test.beforeEach(async ({ page }) => {
  await enterDemo(page);
});

test('typed points, a typed level and an Incomplete mark show the same after a reload', async ({ page }) => {
  await openScores(page);
  const before = await screen(page);

  await typeInCell(page, POINTS, '5');
  await expect(cellText(page, POINTS)).toHaveText('5');
  await typeInCell(page, LEVEL, '1');
  await expect(cellText(page, LEVEL)).toHaveText('1.0');

  // Complete/Incomplete is marked in the grader the cell opens.
  await cell(page, COMPLETE).click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog.locator('.grdc-complete')).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('.grdc-incomplete').click();
  await expect(dialog.locator('.grdc-incomplete')).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('.grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);

  const after = await screen(page);
  expect(after[COMPLETE]).not.toBe(before[COMPLETE]);
  expect(after.overall).not.toBe(before.overall);
  expect(after[POINTS + ' avg']).not.toBe(before[POINTS + ' avg']);

  await reloadScores(page);
  expect(await screen(page)).toEqual(after);
  expect(await entries(page, POINTS)).toEqual([[expect.any(String), 5]]);
  const level = await entries(page, LEVEL);
  expect(level.length).toBe(2);
  for (const [, score] of level) expect(score).toBe(1);
});

test('Clear Score from the cell menu, then the toast Undo puts the score back', async ({ page }) => {
  await openScores(page);
  const was = await cellText(page, POINTS).innerText();
  const stored = await entries(page, POINTS);
  expect(stored.length).toBeGreaterThan(0);

  await cell(page, POINTS).click({ button: 'right' });
  await page.locator('.gb-ctx-item[data-ctx="clearCell"]').click();
  await expect(cellText(page, POINTS)).toHaveText('—');
  await expect(toast(page)).toContainText('Score cleared for Cece Adeyemi');

  await toast(page).locator('[data-action="executeUndo"]').click();
  await expect(toast(page)).toHaveCount(0);
  await expect(cellText(page, POINTS)).toHaveText(was);
  expect(await entries(page, POINTS)).toEqual(stored);

  await reloadScores(page);
  await expect(cellText(page, POINTS)).toHaveText(was);
});

test('Cmd+Z after a typed level puts the old level back', async ({ page }) => {
  await openScores(page);
  const was = await cellText(page, LEVEL).innerText();
  const stored = await entries(page, LEVEL);

  await typeInCell(page, LEVEL, '1');
  await expect(cellText(page, LEVEL)).toHaveText('1.0');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(cellText(page, LEVEL)).toHaveText(was);
  expect(await entries(page, LEVEL)).toEqual(stored);

  await reloadScores(page);
  await expect(cellText(page, LEVEL)).toHaveText(was);
});

test('Mark Blank Cells Missing, then Undo Marking Blank Cells takes them off again', async ({ page }) => {
  await openScores(page);
  const rows = await page.locator('.gb-scores-row[data-sid]').count();
  await expect(cellText(page, BLANK)).toHaveText('—');

  let menu = await columnMenu(page, BLANK);
  await expect(menu.locator('[data-ctx="undoBulkStatus"]')).toHaveCount(0);
  await menu.locator('[data-ctx="markUngradedNS"]').click();
  await expect(toast(page)).toContainText(rows + ' blank cells marked Missing');
  await expect(cell(page, BLANK)).not.toContainText('—');
  const missing = await cellText(page, BLANK).innerText();

  // The list Undo Marking Blank Cells works from is kept on this device.
  await reloadScores(page);
  await expect(cellText(page, BLANK)).toHaveText(missing);
  const marked = await page.evaluate(
    aid => Object.keys(getAssignmentStatuses('sci8')).filter(k => k.endsWith(':' + aid)).length,
    BLANK,
  );
  expect(marked).toBe(rows);

  menu = await columnMenu(page, BLANK);
  await menu.locator('[data-ctx="undoBulkStatus"]').click();
  await expect(cellText(page, BLANK)).toHaveText('—');
  menu = await columnMenu(page, BLANK);
  await expect(menu.locator('[data-ctx="undoBulkStatus"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await reloadScores(page);
  await expect(cellText(page, BLANK)).toHaveText('—');
  const left = await page.evaluate(
    aid => Object.keys(getAssignmentStatuses('sci8')).filter(k => k.endsWith(':' + aid)).length,
    BLANK,
  );
  expect(left).toBe(0);
});

async function deleteColumn(page, aid, title) {
  const menu = await columnMenu(page, aid);
  await menu.locator('[data-ctx="deleteAssess"]').click();
  await expect(page.locator('#confirm-title')).toHaveText('Delete “' + title + '”?');
  await page.locator('#confirm-ok-btn').click();
  await expect(cell(page, aid)).toHaveCount(0);
  await expect(toast(page)).toContainText('Deleted “' + title + '”');
}

test('Delete Assessment: Undo keeps it, and letting the toast close removes it for good', async ({ page }) => {
  test.slow(); // the toast stays up ten seconds
  await openScores(page);
  const title = await page.evaluate(aid => getAssessments('sci8').find(a => a.id === aid).title, SMALL);
  const was = await cellText(page, SMALL).innerText();
  const stored = await entries(page, SMALL);
  expect(stored.length).toBeGreaterThan(0);

  await deleteColumn(page, SMALL, title);
  await toast(page).locator('[data-action="executeUndo"]').click();
  await expect(cellText(page, SMALL)).toHaveText(was);
  await reloadScores(page);
  await expect(cellText(page, SMALL)).toHaveText(was);
  expect(await entries(page, SMALL)).toEqual(stored);

  await deleteColumn(page, SMALL, title);
  // Until the toast closes, the assessment is only hidden.
  expect(await page.evaluate(aid => getAssessments('sci8').some(a => a.id === aid), SMALL)).toBe(true);
  await expect(toast(page)).toHaveCount(0, { timeout: 15_000 });
  await reloadScores(page);
  await expect(cell(page, SMALL)).toHaveCount(0);
  await expect(page.locator('#gb-data td.gb-scores-cell').first()).toBeVisible();
  expect(await page.evaluate(aid => getAssessments('sci8').some(a => a.id === aid), SMALL)).toBe(false);
  expect(await entries(page, SMALL)).toEqual([]);
});

test('an Overall Comment typed in the grader dialog is still there after a reload', async ({ page }) => {
  const text = 'Clear labels on every reading.';
  await openScores(page);
  await cell(page, LEVEL).click();
  const field = page.locator(`#grader-overlay #grdt-overall-${LEVEL}`);
  await expect(field).toHaveValue('');
  await field.fill(text);
  await page.locator('#grader-overlay .grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);

  await reloadScores(page);
  expect(await page.evaluate(([s, a]) => getScoreComment('sci8', s, a), [STUDENT, LEVEL])).toBe(text);
  await cell(page, LEVEL).click();
  await expect(page.locator(`#grader-overlay #grdt-overall-${LEVEL}`)).toHaveValue(text);
});

test("one student's Export CSV row matches the Scores view", async ({ page }) => {
  await openScores(page);
  const [download] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'exportScoresCSV')]);
  const csv = (await (await download.createReadStream()).toArray()).join('');
  const lines = csv
    .trim()
    .split('\n')
    .map(l => l.slice(1, -1).split('","'));
  const header = lines[0];
  const name = await page.locator(`#gb-rowheads [data-sid="${STUDENT}"]`).innerText();
  const row = lines.find(l => l[0] === name);
  expect(row, 'a row for ' + name).toBeTruthy();

  // Overall to two places in the file, to one on screen.
  const shown = await overall(page).locator('.gb-grade-text').innerText();
  expect(Number(row[header.indexOf('Overall')]).toFixed(1)).toBe(shown);

  // Every assessment column: the file's text is the cell's, a blank for —.
  // A Complete mark shows as ✓ and is spelled out in the file, as the
  // cell's label spells it.
  const columns = await page.evaluate(() =>
    getAssessments('sci8').map(a => ({
      aid: a.id,
      head: a.title + ' (' + (a.date || '') + ')',
      mark: isCompletionScored(a),
    })),
  );
  let compared = 0;
  for (const { aid, head, mark } of columns) {
    const i = header.indexOf(head);
    expect(i, head).toBeGreaterThan(0);
    const onScreen = (await cellText(page, aid).innerText()).trim();
    if (mark && onScreen !== '—') {
      expect(row[i], head).toBe('Complete');
      expect(onScreen, head).toBe('✓');
      await expect(cell(page, aid)).toHaveAttribute('aria-label', new RegExp(': Complete$'));
    } else expect(row[i], head).toBe(onScreen === '—' ? '' : onScreen);
    compared++;
  }
  expect(compared).toBe(columns.length);
});
