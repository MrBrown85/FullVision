import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers.js';

/* Pins what the Assignments cards do today with grades that must outlast a
   reload, in Demo Mode on Science 8: a rubric card's level, its +, a
   criterion comment and Missing on another student; a points ledger score
   with Late; a Complete/Incomplete mark; and Set Unmarked to 10 / 10, to
   Missing and to Complete, each taken back with the toast's Undo. Demo data
   lives in localStorage, so page.reload() keeps it. Tests only: written
   before any split of page-assignments.js. */

test.use({ viewport: { width: 1440, height: 900 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

const RUBRIC = 'sci8a3'; // Disease Research Poster, a four-level rubric with three criteria
const QUALITY = 'crit_sci8_res_quality'; // Research Quality
const ANALYSIS = 'crit_sci8_res_analysis'; // Analysis
const POINTS = 'sci8q1'; // Cell Structure Quiz, points out of 10
const COMPLETE = 'sci8a13'; // Periodic Table Scavenger Hunt, Complete/Incomplete
const CECE = 'st1'; // Cece Adeyemi
const NOOR = 'st2'; // Noor Al-Rashid
// On the Cell Structure Quiz the demo has Sam Excused, Jasper Late with 7 and Raj Missing.
const SAM = 'st3';
const JASPER = 'st7';
const RAJ = 'st18';

async function openAssignments(page) {
  await gotoApp(page, '/assignments?course=sci8');
}

async function openCard(page, aid) {
  const card = page.locator('#ac-' + aid);
  await expect(card).toBeVisible();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/open/);
  return card;
}

async function reload(page) {
  await page.reload();
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openScores(page) {
  await gotoApp(page, '/gradebook?course=sci8');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await expect(page.locator('#gb-data td.gb-scores-cell').first()).toBeVisible();
}

const gbCell = (page, aid, sid) => page.locator(`.gb-scores-cell[data-aid="${aid}"][data-sid="${sid}"]`);
const gbText = (page, aid, sid) => gbCell(page, aid, sid).locator('.gb-scores-val');
const student = (card, sid) => card.locator(`.rsg-student[data-status-student="${sid}"]`);
const criterion = (card, sid, crit) => student(card, sid).locator(`.rsg-criterion-row[data-criterion="${crit}"]`);
const ledgerRow = (card, sid) => card.locator(`.ldg-row[data-status-student="${sid}"]`);
const pointsBox = (card, sid) => ledgerRow(card, sid).locator('.ldg-pts-input');
const status = (row, code) => row.locator(`.grader-status-btn[data-status="${code}"]`);
const toast = page => page.locator('#undo-toast');

const entries = (page, aid, sid) =>
  page.evaluate(
    ([a, s]) => (getScores('sci8')[s] || []).filter(e => e.assessmentId === a).map(e => [e.tagId, e.score]),
    [aid, sid],
  );
const statusOf = (page, aid, sid) =>
  page.evaluate(([a, s]) => getAssignmentStatuses('sci8')[s + ':' + a] || null, [aid, sid]);

// The ledger's Set Unmarked To buttons: the button, its confirm, then the toast.
async function setUnmarked(page, card, label, okLabel) {
  await card.locator('.ldg-actions .ldg-action', { hasText: label }).click();
  await expect(page.locator('#confirm-title')).toHaveText(label);
  await expect(page.locator('#confirm-ok-btn')).toHaveText(okLabel);
  await page.locator('#confirm-ok-btn').click();
}

async function undo(page) {
  await toast(page).locator('[data-action="executeUndo"]').click();
  await expect(toast(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await enterDemo(page);
});

test('a rubric level with +, a criterion comment and Missing on another student show the same after a reload', async ({
  page,
}) => {
  await openScores(page);
  await expect(gbText(page, RUBRIC, CECE)).toHaveText('3.0');

  await openAssignments(page);
  let card = await openCard(page, RUBRIC);

  // Cece: Developing on Research Quality, then + on it.
  const quality = criterion(card, CECE, QUALITY);
  await quality.locator('.rsg-level.l2').click();
  await expect(quality.locator('.rsg-level.active .rsg-level-name')).toHaveText('Developing');
  await quality.locator('.rsg-mod[data-mod="1"]').click();
  await expect(quality.locator('.rsg-level.active .rsg-level-name')).toHaveText('Developing +');

  // Cece: a comment on Analysis.
  const comment = criterion(card, CECE, ANALYSIS).locator('.rsg-crit-comment');
  await comment.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Comment for/).fill('Name the pattern in your data.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.crit-comment-popover')).toHaveCount(0);
  await expect(comment).toHaveClass(/has-comment/);

  // Noor: Missing is off while she has levels; Clear from her row menu, then Missing.
  const noor = student(card, NOOR);
  await expect(status(noor, 'NS')).toBeDisabled();
  await noor.locator('[data-action="toggleScoreMenu"]').click();
  await noor.locator('[data-action="fillRubricScoresAndClose"][data-score="0"]').click();
  await expect(noor.locator('.rsg-level.active')).toHaveCount(0);
  await expect(status(noor, 'NS')).toBeEnabled();
  await status(noor, 'NS').click();
  await expect(status(noor, 'NS')).toHaveAttribute('aria-pressed', 'true');

  await reload(page);
  card = await openCard(page, RUBRIC);
  const qualityAfter = criterion(card, CECE, QUALITY);
  await expect(qualityAfter.locator('.rsg-level.l2')).toHaveClass(/active/);
  await expect(qualityAfter.locator('.rsg-level.active .rsg-level-name')).toHaveText('Developing +');
  await expect(qualityAfter.locator('.rsg-mod[data-mod="1"]')).toHaveAttribute('aria-pressed', 'true');
  const commentAfter = criterion(card, CECE, ANALYSIS).locator('.rsg-crit-comment');
  await expect(commentAfter).toHaveClass(/has-comment/);
  await commentAfter.click();
  await expect(page.getByRole('dialog').getByLabel(/Comment for/)).toHaveValue('Name the pattern in your data.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.crit-comment-popover')).toHaveCount(0);
  const noorAfter = student(card, NOOR);
  await expect(status(noorAfter, 'NS')).toHaveAttribute('aria-pressed', 'true');
  await expect(noorAfter.locator('.rsg-level.active')).toHaveCount(0);

  const cece = await page.evaluate(
    ([a, q, n]) => {
      const list = (getScores('sci8').st1 || []).filter(e => e.assessmentId === a);
      const find = t => list.find(e => e.tagId === t) || {};
      return { quality: [find(q).score, find(q).mod], comment: find(n).critNote };
    },
    [RUBRIC, QUALITY, ANALYSIS],
  );
  expect(cece).toEqual({ quality: [2, 1], comment: 'Name the pattern in your data.' });
  expect(await statusOf(page, RUBRIC, NOOR)).toBe('NS');

  // In the gradebook: Developing + with two Proficient is 2.8; Noor is Missing.
  await openScores(page);
  await expect(gbText(page, RUBRIC, CECE)).toHaveText('2.8');
  await expect(gbCell(page, RUBRIC, CECE)).toHaveAttribute(
    'aria-label',
    'Cece Adeyemi, Disease Research Poster: 2.8, Proficient',
  );
  await expect(gbText(page, RUBRIC, NOOR)).toHaveText('M');
  await expect(gbCell(page, RUBRIC, NOOR)).toHaveAttribute(
    'aria-label',
    'Noor Al-Rashid, Disease Research Poster: Missing',
  );
});

test('a points ledger score with Late and an Incomplete mark show the same after a reload', async ({ page }) => {
  await openAssignments(page);
  let card = await openCard(page, POINTS);
  const row = ledgerRow(card, CECE);
  await pointsBox(card, CECE).fill('4');
  await pointsBox(card, CECE).press('Tab');
  await expect(row.locator('.gb-pts-live-pct')).toHaveText('40%');
  await status(row, 'LATE').click();
  await expect(status(row, 'LATE')).toHaveAttribute('aria-pressed', 'true');

  card = await openCard(page, COMPLETE);
  const mark = ledgerRow(card, CECE);
  await expect(mark.locator('.cmp-complete')).toHaveClass(/active/);
  await mark.locator('.cmp-incomplete').click();
  await expect(mark.locator('.cmp-incomplete')).toHaveClass(/active/);
  await expect(mark.locator('.cmp-complete')).not.toHaveClass(/active/);

  await reload(page);
  card = await openCard(page, POINTS);
  const rowAfter = ledgerRow(card, CECE);
  await expect(pointsBox(card, CECE)).toHaveValue('4');
  await expect(rowAfter.locator('.gb-pts-live-pct')).toHaveText('40%');
  await expect(status(rowAfter, 'LATE')).toHaveAttribute('aria-pressed', 'true');
  card = await openCard(page, COMPLETE);
  await expect(ledgerRow(card, CECE).locator('.cmp-incomplete')).toHaveClass(/active/);
  await expect(ledgerRow(card, CECE).locator('.cmp-complete')).not.toHaveClass(/active/);
  expect(await entries(page, POINTS, CECE)).toEqual([[expect.any(String), 4]]);
  expect(await statusOf(page, POINTS, CECE)).toBe('LATE');

  await openScores(page);
  await expect(gbText(page, POINTS, CECE)).toHaveText('4L');
  await expect(gbCell(page, POINTS, CECE)).toHaveAttribute(
    'aria-label',
    'Cece Adeyemi, Cell Structure Quiz: 4 out of 10, Late',
  );
  await expect(gbText(page, COMPLETE, CECE)).toHaveText('✗');
  await expect(gbCell(page, COMPLETE, CECE)).toHaveAttribute(
    'aria-label',
    'Cece Adeyemi, Periodic Table Scavenger Hunt: Incomplete',
  );
});

test('Set Unmarked to 10 / 10 and to Missing fill only blank rows, and Undo takes each back', async ({ page }) => {
  await openAssignments(page);
  let card = await openCard(page, POINTS);
  // Emptying the box clears a score, so Cece and Noor are unmarked.
  for (const sid of [CECE, NOOR]) {
    await pointsBox(card, sid).fill('');
    await pointsBox(card, sid).press('Tab');
    await expect(pointsBox(card, sid)).toHaveValue('');
  }

  // Rows with a status are left alone, Late with its score included.
  const leftAlone = async () => {
    await expect(status(ledgerRow(card, SAM), 'EXC')).toHaveAttribute('aria-pressed', 'true');
    await expect(pointsBox(card, SAM)).toHaveValue('');
    await expect(status(ledgerRow(card, RAJ), 'NS')).toHaveAttribute('aria-pressed', 'true');
    await expect(pointsBox(card, RAJ)).toHaveValue('');
    await expect(status(ledgerRow(card, JASPER), 'LATE')).toHaveAttribute('aria-pressed', 'true');
    await expect(pointsBox(card, JASPER)).toHaveValue('7');
  };

  await setUnmarked(page, card, 'Set Unmarked to 10 / 10', 'Set to 10 / 10');
  await expect(toast(page)).toContainText('Unmarked students set to 10 / 10');
  card = await openCard(page, POINTS);
  for (const sid of [CECE, NOOR]) await expect(pointsBox(card, sid)).toHaveValue('10');
  await leftAlone();
  await undo(page);
  card = await openCard(page, POINTS);
  for (const sid of [CECE, NOOR]) await expect(pointsBox(card, sid)).toHaveValue('');
  await leftAlone();

  await setUnmarked(page, card, 'Set Unmarked to Missing', 'Set to Missing');
  await expect(toast(page)).toContainText('Unmarked students set to Missing');
  card = await openCard(page, POINTS);
  for (const sid of [CECE, NOOR])
    await expect(status(ledgerRow(card, sid), 'NS')).toHaveAttribute('aria-pressed', 'true');
  await leftAlone();
  await undo(page);
  card = await openCard(page, POINTS);
  for (const sid of [CECE, NOOR])
    await expect(status(ledgerRow(card, sid), 'NS')).toHaveAttribute('aria-pressed', 'false');
  await leftAlone();

  // After a reload the undone rows are still blank, with no status.
  await reload(page);
  card = await openCard(page, POINTS);
  for (const sid of [CECE, NOOR]) {
    await expect(pointsBox(card, sid)).toHaveValue('');
    await expect(status(ledgerRow(card, sid), 'NS')).toHaveAttribute('aria-pressed', 'false');
    expect(await entries(page, POINTS, sid)).toEqual([]);
    expect(await statusOf(page, POINTS, sid)).toBe(null);
  }
  await leftAlone();
});

test('Set Unmarked to Complete marks only blank rows, and Undo takes it back', async ({ page }) => {
  await openAssignments(page);
  let card = await openCard(page, COMPLETE);
  // Clicking the active mark clears it, so Cece is unmarked; Noor keeps hers.
  await ledgerRow(card, CECE).locator('.cmp-complete').click();
  await expect(ledgerRow(card, CECE).locator('.cmp-btn.active')).toHaveCount(0);
  await expect(ledgerRow(card, NOOR).locator('.cmp-btn.active')).toHaveCount(1);
  const noorMark = await ledgerRow(card, NOOR).locator('.cmp-btn.active').getAttribute('class');

  await setUnmarked(page, card, 'Set Unmarked to Complete', 'Set to Complete');
  await expect(toast(page)).toContainText('Unmarked students set to Complete');
  card = await openCard(page, COMPLETE);
  await expect(ledgerRow(card, CECE).locator('.cmp-complete')).toHaveClass(/active/);
  await expect(ledgerRow(card, NOOR).locator('.cmp-btn.active')).toHaveAttribute('class', noorMark);
  await undo(page);
  card = await openCard(page, COMPLETE);
  await expect(ledgerRow(card, CECE).locator('.cmp-btn.active')).toHaveCount(0);
  await expect(ledgerRow(card, NOOR).locator('.cmp-btn.active')).toHaveAttribute('class', noorMark);

  // After a reload Cece is still unmarked, on the card and in the gradebook.
  await reload(page);
  card = await openCard(page, COMPLETE);
  await expect(ledgerRow(card, CECE).locator('.cmp-btn.active')).toHaveCount(0);
  expect(await entries(page, COMPLETE, CECE)).toEqual([]);
  await openScores(page);
  await expect(gbText(page, COMPLETE, CECE)).toHaveText('—');
  await expect(gbCell(page, COMPLETE, CECE)).toHaveAttribute(
    'aria-label',
    'Cece Adeyemi, Periodic Table Scavenger Hunt: no score',
  );
});
