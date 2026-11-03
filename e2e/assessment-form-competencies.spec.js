import { test, expect } from '@playwright/test';

/* The assessment form's competency picker (redesign PR 4, 2026-11-02):
   Codes (one-click chips by Ministry group, and a focus box)
   and List (one line each), behind a switch remembered on this device;
   type to narrow, Enter ticks; with a rubric, the rubric's
   competencies, read only. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

// Choose a Rubric opens the picker; '' uses no rubric; a number picks that row.
async function pickRubric(page, rid) {
  await page.locator('[data-action="chooseRubric"]').first().click();
  const bank = page.locator('#rubric-bank-overlay');
  if (rid === '') return bank.locator('[data-rb="pick-none"]').click();
  if (typeof rid === 'object') {
    await bank
      .locator('.rb-row')
      .nth(rid.index - 1)
      .click();
  } else {
    await bank.locator('.rb-row[data-rid="' + rid + '"]').click();
  }
  await bank.locator('[data-rb="pick-use"]').click();
}

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

const ticked = page =>
  page.evaluate(() => Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(c => c.value));

test('Codes: a click ticks a competency, and the chips above name it', async ({ page }) => {
  await openForm(page);
  await expect(page.locator('.af-card-competencies')).toHaveAttribute('data-view', 'codes');
  await page.locator('.af-code[data-tag="QP3"]').click();
  await page.locator('.af-code[data-tag="PA4"]').click();
  expect(await ticked(page)).toEqual(['QP3', 'PA4']);
  await expect(page.locator('.af-code[data-tag="QP3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#af-comp-chosen .af-comp-chip')).toHaveCount(2);
  await page.locator('.af-code[data-tag="QP3"]').click();
  expect(await ticked(page)).toEqual(['PA4']);
});

test('the focus box shows the wording and I Can statements of the chip pointed at', async ({ page }) => {
  await openForm(page);
  const tag = await page.evaluate(() => getTagById('sci8', 'EV4'));
  await page.locator('.af-code[data-tag="EV4"]').hover();
  const box = page.locator('#af-codes-focus');
  await expect(box.locator('.af-codes-focus-code')).toHaveText('EV4');
  await expect(box.locator('.af-codes-focus-text')).toHaveText(tag.text);
  await expect(box.locator('.af-codes-focus-icans li')).toHaveText(tag.i_can_statements);
});

test('type to narrow; Enter ticks the first match; arrows move between chips', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-comp-find', 'pc2');
  await expect(page.locator('.af-code:not([hidden])')).toHaveCount(1);
  await page.locator('#af-comp-find').press('Enter');
  expect(await ticked(page)).toEqual(['PC2']);
  await page.locator('#af-comp-find').press('Escape');
  await expect(page.locator('.af-code[data-tag="QP1"]')).toBeVisible();
  await page.locator('.af-code[data-tag="QP1"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.af-code[data-tag="QP2"]')).toBeFocused();
  await page.keyboard.press('Space');
  expect(await ticked(page)).toEqual(['QP2', 'PC2']);
});

test('no Same As row and no counts on the chips; the focus box follows the pointer at once', async ({ page }) => {
  await openForm(page);
  // Removed Nov 2 (Colin): both distracted from the competencies.
  await expect(page.locator('.af-same-as')).toHaveCount(0);
  expect(await page.locator('.af-code').first().innerText()).not.toMatch(/\d+$/);
  await page.locator('.af-code[data-tag="EV4"]').hover();
  const code = page.locator('#af-codes-focus .af-codes-focus-code');
  // At once, with no pause (it isn't a hover-over).
  await expect(code).toHaveText('EV4', { timeout: 200 });
  // The count lives in the focus box.
  await expect(page.locator('#af-codes-focus .af-codes-focus-count')).toContainText('this year');
});

test('List shows one row each with the whole wording, and the choice is remembered', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-comp-view [data-view="list"]').click();
  await expect(page.locator('.af-card-competencies')).toHaveAttribute('data-view', 'list');
  await expect(page.locator('.af-codes')).toBeHidden();
  const row = page.locator('.af-tag-row', { has: page.locator('.af-tag-cb[value="QP3"]') });
  await row.locator('.af-tag-name').click();
  expect(await ticked(page)).toEqual(['QP3']);
  // The whole wording shows, not cut off.
  expect(await row.locator('.af-tag-name').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  // The page doesn't scroll sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  // A ticked competency counts as filled in, so Cancel asks first.
  await page.locator('[data-action="cancelAssessForm"]').click();
  await page.locator('.af-dialog-card button', { hasText: 'Discard' }).click();
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('.af-card-competencies')).toHaveAttribute('data-view', 'list');
});

test('a rubric decides the competencies, read only while it is chosen', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-code[data-tag="CM2"]').click();
  const rubric = await page.evaluate(() => {
    const r = getRubrics('sci8')[0];
    return { id: r.id, tags: [...new Set(r.criteria.flatMap(c => c.tagIds || []))] };
  });
  await pickRubric(page, rubric.id);
  expect((await ticked(page)).sort()).toEqual(rubric.tags.slice().sort());
  await expect(page.locator('#af-comp-rubric-note')).toBeVisible();
  await expect(page.locator('.af-code[data-tag="CM2"]')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('.af-code[data-tag="CM2"]').click({ force: true });
  expect((await ticked(page)).sort()).toEqual(rubric.tags.slice().sort());
  // None hands them back.
  await pickRubric(page, '');
  await expect(page.locator('#af-comp-rubric-note')).toBeHidden();
  await page.locator('.af-code[data-tag="CM2"]').click();
  expect(await ticked(page)).toContain('CM2');
});
