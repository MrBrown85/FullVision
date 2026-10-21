/**
 * Reports: Page Studio and the printed reports (teacher/report-studio.js,
 * report-sheets.js, report-blocks.js, page-reports.js). Demo Mode's Science 8
 * class, 27 students. The palette, the pages at paper size, the inspector,
 * drag and drop, block options, templates, Print Reports with its saved copy,
 * and page counts from Chromium's print engine.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

const STUDENTS = 27;

async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('.report-sheet')).toHaveCount(2);
}

/* Everyone: every student's pages on the canvas, which is what prints. */
async function showEveryone(page) {
  await page.locator('[data-action="studioView"][data-view="all"]').click();
  await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2);
}

/* A template from the palette's Templates tab. */
async function applyTemplate(page, id) {
  await page.locator('[data-action="studioTab"][data-tab="templates"]').click();
  await page.locator(`[data-action="studioTemplate"][data-starter="${id}"]`).click();
  await page.locator('[data-action="studioTab"][data-tab="blocks"]').click();
}

async function overflowing(page) {
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets
      .filter(s => {
        const body = s.querySelector('.sheet-body');
        return body && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1);
      })
      .map(s => s.querySelector('.sheet-footer')?.textContent || '?'),
  );
}

const inspector = page => page.locator('#studio-inspector');
const palette = page => page.locator('#studio-palette');

/* The palette and the canvas scroll; a point is only reachable on screen. */
async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function box(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.boundingBox();
}

/* Drags from one point to another in steps, so the drop zones appear and
   the pointer lands on one. */
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(150);
}

/* Chromium writes one "/Type /Page" object per page (and one "/Type /Pages"
   tree node, which the trailing character class excludes). */
function countPages(pdf) {
  const text = pdf.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function pageBoxes(pdf) {
  const text = pdf.toString('latin1');
  return [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+(\d+)\s+(\d+)\s*\]/g)].map(m => [Number(m[1]), Number(m[2])]);
}

async function printToPdf(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  return pdf;
}

test.describe('Page Studio', () => {
  test.setTimeout(90_000);

  test('opens on one student, two pages side by side, with the palette and the inspector', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('.studio-palette .studio-blk')).toHaveCount(16);
    await expect(page.locator('.studio-blk.placed')).toHaveCount(6);
    await expect(page.locator('.studio-palette')).not.toContainText('Letterhead');
    await expect(page.locator('.sheet-label').first()).toHaveText('Page 1 of 2');
    await expect(page.locator('.report-sheet').first().locator('.sheet-footer')).toContainText(
      'Cece Adeyemi · Page 1 of 2',
    );
    await expect(page.locator('#studio-inspector')).toContainText('Select a block on the page');
    await expect(page.locator('#studio-inspector')).toContainText('Longest report in class');
    // No setup list, no presets, no Class Summary, no Issue.
    await expect(page.locator('.rb-setup, [data-action="rbApplyPreset"], .rb-preset-btn')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Class Summary' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Print Reports' })).toBeVisible();
    expect(await overflowing(page)).toEqual([]);
  });

  test('every student is one sheet, front and back, and nothing overflows', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    // Everyone shows thumbnails; the engine's own overflow flag is the check here.
    await expect(page.locator('.sheet-overflow')).toHaveCount(0);
    const sheets = await page.locator('.sheet-student').evaluateAll(els => els.map(el => el.dataset.sheets));
    expect(sheets.every(n => n === '1')).toBe(true);
    // A thumbnail opens that student.
    await page.locator('.sheet-student[data-sid="st2"]').click();
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toHaveText('Noor Al-Rashid');
  });

  test('the back carries the dispositions and the response pinned at the bottom, wording intact', async ({ page }) => {
    await openStudio(page);
    const back = page.locator('.report-sheet').nth(1);
    await expect(back.locator('.report-learner-profile')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned')).toContainText('I have reviewed this report with my child');
    await expect(back.locator('.sheet-pinned')).toContainText('I would like to schedule a meeting with the teacher');
    await expect(back.locator('.sheet-pinned')).toContainText(
      'Please review this report with your child and return this section to the school.',
    );
  });

  test('a block is placed from the palette, selected on the page, and removed from the inspector', async ({ page }) => {
    await openStudio(page);
    await page.locator('[data-action="studioBlock"][data-block="legend"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(1);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).toHaveClass(/placed/);
    await expect(page.locator('#studio-inspector')).toContainText('Proficiency Legend');
    await expect(page.locator('#studio-inspector')).toContainText('Page 2 · row 3');
    // Click a block on the page: the inspector follows.
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    await expect(page.locator('.sheet-cell[data-block="competency-table"]')).toHaveClass(/studio-sel/);
    await expect(page.locator('#studio-inspector')).toContainText('Competency Table');
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 4');
    // The letterhead cannot be removed.
    await page.locator('.sheet-cell[data-block="header"]').click();
    await expect(page.locator('#studio-inspector')).toContainText('Letterhead');
    await expect(page.locator('[data-action="studioRemove"]')).toHaveCount(0);
    // Remove the legend; it is back in the palette.
    await page.locator('.sheet-cell[data-block="legend"]').click();
    await page.locator('[data-action="studioRemove"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).not.toHaveClass(/placed/);
    expect(await overflowing(page)).toEqual([]);
    // The form is the class's: it survives a reload.
    await page.locator('[data-action="studioBlock"][data-block="observations"]').click();
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('[data-action="studioBlock"][data-block="observations"]')).toHaveClass(/placed/);
  });

  test('the Conference Pack cuts its grade table at rows', async ({ page }) => {
    await openStudio(page);
    await applyTemplate(page, 'conference-pack');
    await expect(
      page.locator('.report-block-title', { hasText: 'Assignment Grades (continued)' }).first(),
    ).toBeVisible();
    expect(await overflowing(page)).toEqual([]);
    // Everyone on the Conference Pack: three sheets each, none overflowing.
    await page.locator('[data-action="studioView"][data-view="all"]').click();
    await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 6, { timeout: 30_000 });
    await expect(page.locator('.report-sheet.sheet-overflow')).toHaveCount(0);
    await applyTemplate(page, 'report-card');
    // Laying every student out twice takes a few seconds.
    await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2, { timeout: 30_000 });
  });

  test('Black ink turns the levels black', async ({ page }) => {
    await openStudio(page);
    const chip = page.locator('#rb-preview .report-section-chip-value').first();
    const before = await chip.evaluate(el => getComputedStyle(el).color);
    await page.getByRole('radio', { name: 'Black' }).click();
    await expect(page.locator('#rb-preview')).toHaveClass(/report-photocopy/);
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await page.getByRole('radio', { name: 'Colour' }).click();
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe(before);
  });

  test('Print Reports saves a copy of every report and lists it as Printed', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog).toContainText('Print 27 Reports');
    await expect(dialog).toContainText('27 students · 1 sheet each');
    await expect(dialog).toContainText('Letter, 2-sided, flip on long edge');
    await expect(dialog).not.toContainText(/Issue/);
    await expect(dialog.locator('[data-issue="go"]')).toHaveText('Print');
    await dialog.locator('[data-issue="go"]').click();
    await expect(dialog).toHaveCount(0);
    const copies = page.locator('#report-copy');
    await expect(copies).toBeVisible();
    await expect(copies.locator('option').nth(1)).toHaveText(/^Printed /);
    await copies.selectOption({ index: 1 });
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Print This Copy' })).toBeVisible();
    await copies.selectOption({ index: 0 });
    await expect(page.getByRole('button', { name: 'Print Reports' })).toBeVisible();
  });

  test('the comment box says how the draft sits on the form, as it is typed', async ({ page }) => {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/app\.html/, { timeout: 15000 });
    await page.goto(page.url().replace(/#.*/, '#/reports'));
    const fit = page.locator('#tq-fit-text');
    await expect(fit).toContainText(/Fits the front\. \d+ lines?; room for \d+ more/);
    const editor = page.locator('#tq-narrative');
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 12; i++)
      await page.keyboard.type(
        ' She keeps asking questions that move the whole class forward and writes it all down with care.',
      );
    await expect(fit).toContainText(/past the front’s room/);
    await expect(fit).toContainText('Nothing is cut.');
    await page.getByRole('button', { name: 'See the Page' }).click();
    await expect(page.getByRole('tab', { name: 'Progress Reports' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#picker-label')).toHaveText('Cece Adeyemi');
    await expect(page.locator('.report-sheet')).toHaveCount(2);
  });

  test('on a phone the pages fit the width and the palette opens from a button', async ({ page }) => {
    await openStudio(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const box = await page.locator('.report-sheet').first().boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    await expect(page.locator('#studio-palette')).toBeHidden();
    await page.getByRole('button', { name: 'Blocks', exact: true }).click();
    await expect(page.locator('#studio-palette')).toBeVisible();
    await page.getByRole('button', { name: 'Blocks', exact: true }).click();
    await expect(page.locator('#studio-palette')).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  });
});

test.describe('Page Studio drag and drop', () => {
  test.setTimeout(90_000);

  test('a block dragged from the palette drops where its zone says it fits', async ({ page }) => {
    await openStudio(page);
    const legend = page.locator('[data-action="studioBlock"][data-block="legend"]');
    const comment = page.locator('.sheet-cell[data-block="teacher-narrative"]');
    const from = await center(legend);
    const c = await box(comment);
    // Hover just under the comment: the "after row 3" zone.
    await drag(page, from, { x: c.x + c.width / 2, y: c.y + c.height + 1 });
    const zone = page.locator('.studio-drop.active');
    await expect(zone).toHaveCount(1);
    await expect(zone).toContainText(/Drop here · fits \(\d+% of page left\)/);
    await expect(page.locator('.studio-ghost')).toHaveText('Proficiency Legend');
    await page.mouse.up();
    await expect(page.locator('.studio-drop')).toHaveCount(0);
    await expect(page.locator('.studio-ghost')).toHaveCount(0);
    await expect(page.locator('#studio-inspector')).toContainText('Proficiency Legend');
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 4');
    await expect(page.locator('#studio-live')).toContainText('Proficiency Legend placed on page 1');
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveClass(/studio-sel/);
  });

  test('dropped beside a block it makes a two-column row; the handle and the inspector set its width', async ({
    page,
  }) => {
    await openStudio(page);
    const legend = page.locator('[data-action="studioBlock"][data-block="legend"]');
    const table = page.locator('.sheet-cell[data-block="competency-table"]');
    const t = await box(table);
    await drag(page, await center(legend), { x: t.x + t.width - 8, y: t.y + t.height / 2 });
    await expect(page.locator('.studio-drop.active')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 4 · right');
    const row = page.locator('.sheet-row').first();
    await expect(row.locator('.sheet-cell')).toHaveCount(2);
    // Inspector: Two-thirds for the table.
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    await expect(page.getByRole('radio', { name: 'Half' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Two-thirds' }).click();
    await expect(page.getByRole('radio', { name: 'Two-thirds' })).toHaveAttribute('aria-checked', 'true');
    const widths = await page
      .locator('.sheet-row')
      .first()
      .locator('.sheet-cell')
      .evaluateAll(c => c.map(el => el.offsetWidth));
    expect(widths[0]).toBeGreaterThan(widths[1] * 1.6);
    // The handle: drag the table's corner left to a third.
    const handle = page.locator('.studio-handle');
    await expect(handle).toHaveCount(1);
    const h = await center(handle);
    const r = await page.locator('.sheet-row').first().boundingBox();
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.3, h.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('radio', { name: 'Third', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#studio-live')).toContainText('Competency Table is now a third.');
    // Full width puts the legend on its own row again.
    await page.getByRole('radio', { name: 'Full' }).click();
    await expect(page.locator('.sheet-row')).toHaveCount(0);
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 4');
  });

  test('a block on the page moves to another row; the keyboard moves one too, with announcements', async ({ page }) => {
    await openStudio(page);
    // Pointer: the competency table up to before the comment.
    const table = page.locator('.sheet-cell[data-block="competency-table"]');
    const comment = page.locator('.sheet-cell[data-block="teacher-narrative"]');
    const c = await box(comment);
    await drag(page, await center(table), { x: c.x + c.width / 2, y: c.y - 2 });
    await expect(page.locator('.studio-drop.active')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('#studio-inspector')).toContainText('Competency Table');
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 3');
    // Keyboard: pick the comment up, move it down one slot, drop.
    await page.locator('.sheet-cell[data-block="teacher-narrative"]').focus();
    await page.keyboard.press(' ');
    await expect(page.locator('#studio-live')).toContainText('Picked up Teacher Comment');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#studio-live')).toContainText(/Teacher Comment, page 1, .*(fits|lands on page)/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-live')).toContainText('Teacher Comment placed on page 1');
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toBeFocused();
    // Escape lets go without moving.
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.locator('#studio-live')).toContainText('Let go.');
    // The drop put the comment beside the competency table; Shift+arrows resize it.
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('#studio-live')).toContainText('Teacher Comment is now a third.');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('#studio-live')).toContainText('already a third');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('#studio-live')).toContainText('Teacher Comment is now half width.');
    // Delete removes.
    await page.keyboard.press('Delete');
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(0);
    await expect(page.locator('[data-action="studioBlock"][data-block="teacher-narrative"]')).not.toHaveClass(/placed/);
  });

  test('a block that does not fit says so and lands on a later page; Height Fixed takes lines', async ({ page }) => {
    await openStudio(page);
    const grades = page.locator('[data-action="studioBlock"][data-block="grade-table"]');
    const dims = page.locator('.sheet-cell[data-block="learner-dimensions"]');
    const d = await box(dims);
    await drag(page, await center(grades), { x: d.x + d.width / 2, y: d.y - 2 });
    const zone = page.locator('.studio-drop.active');
    await expect(zone).toHaveCount(1);
    await expect(zone).toContainText(/Drop here|Doesn’t fit here/);
    await page.mouse.up();
    await expect(page.locator('.sheet-cell[data-block="grade-table"]').first()).toBeVisible();
    // The comment's height.
    await page.locator('.sheet-cell[data-block="teacher-narrative"]').click();
    await expect(page.getByRole('radio', { name: 'Fixed' })).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-action="studioLines"]').fill('4');
    await page.locator('[data-action="studioLines"]').dispatchEvent('change');
    await expect(page.locator('[data-action="studioLines"]')).toHaveValue('4');
    await page.getByRole('radio', { name: 'Fit Content' }).click();
    await expect(page.locator('[data-action="studioLines"]')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Fit Content' })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('Page Studio options', () => {
  test.setTimeout(90_000);

  test('Show checkboxes change the competency table and the letterhead', async ({ page }) => {
    await openStudio(page);
    const table = page.locator('.report-sheet .report-ct').first();
    await expect(table.locator('th.report-ct-evidence')).toHaveCount(1);
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    await inspector(page).getByLabel('Evidence Count').uncheck();
    await expect(page.locator('.report-sheet .report-ct th.report-ct-evidence')).toHaveCount(0);
    await inspector(page).getByLabel('Assignment Names').check();
    await expect(page.locator('.report-sheet .report-ct .report-ct-note').first()).toBeVisible();
    // The letterhead's student number.
    const meta = page.locator('.report-sheet .report-header-meta').first();
    await expect(meta).toContainText('Student No.');
    await page.locator('.sheet-cell[data-block="header"]').click();
    await inspector(page).getByLabel('Student Number').uncheck();
    await expect(page.locator('.report-sheet .report-header-meta').first()).not.toContainText('Student No.');
    // The choices are the class's: they survive a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('.report-sheet .report-ct th.report-ct-evidence')).toHaveCount(0);
  });

  test('dispositions show descriptions when asked; Growth and Next Steps takes 0–3 I-can statements', async ({
    page,
  }) => {
    await openStudio(page);
    await expect(page.locator('.report-sheet .report-dim-note')).toHaveCount(0);
    await page.locator('.sheet-cell[data-block="learner-dimensions"]').click();
    await inspector(page).getByLabel('Descriptions').check();
    await expect(page.locator('.report-sheet .report-dim-note').first()).toBeVisible();
    await expect(inspector(page).getByRole('radiogroup', { name: 'I-can Statements' })).toHaveCount(0);
    // Next steps is empty for the first demo student; its options still show.
    await page.locator('[data-action="studioBlock"][data-block="next-steps"]').click();
    const group = inspector(page).getByRole('radiogroup', { name: 'I-can Statements' });
    await expect(group.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('radio', { name: 'None' }).click();
    await expect(group.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
  });

  test('the no-evidence rule and Leave Off change one student without changing the class', async ({ page }) => {
    await openStudio(page);
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    const rule = inspector(page).getByRole('radiogroup', { name: 'When a student has no evidence' });
    await expect(rule.getByRole('radio', { name: 'Show “No Evidence”' })).toHaveAttribute('aria-checked', 'true');
    await rule.getByRole('radio', { name: 'Hide Row' }).click();
    await expect(rule.getByRole('radio', { name: 'Hide Row' })).toHaveAttribute('aria-checked', 'true');
    // Leave the legend-free comment off Cece's report only.
    await page.locator('.sheet-cell[data-block="teacher-narrative"]').click();
    await inspector(page).getByLabel('Leave off Cece Adeyemi’s report').check();
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(0);
    await expect(inspector(page)).toContainText('Teacher Comment');
    // Noor still has it.
    await page.locator('[data-action="studioView"][data-view="all"]').click();
    await expect(
      page.locator('.sheet-student[data-sid="st2"] .sheet-cell[data-block="teacher-narrative"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('.sheet-student[data-sid="st1"] .sheet-cell[data-block="teacher-narrative"]'),
    ).toHaveCount(0);
    // Back on Cece: the palette selects the block, and the checkbox brings it back.
    await page.locator('.sheet-student[data-sid="st1"]').click();
    await page.locator('[data-action="studioBlock"][data-block="teacher-narrative"]').click();
    await inspector(page).getByLabel('Leave off Cece Adeyemi’s report').uncheck();
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(1);
  });

  test('a text block prints what the teacher writes', async ({ page }) => {
    await openStudio(page);
    await page.locator('[data-action="studioBlock"][data-block="text-block"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="text-block"]').click();
    await expect(inspector(page)).toContainText('Text Block');
    await inspector(page).getByLabel('Title').fill('Upcoming Dates');
    await inspector(page).getByLabel('Title').dispatchEvent('change');
    await inspector(page).getByLabel('Text', { exact: true }).fill('Science fair: Nov 30.\nConferences: Dec 4.');
    await inspector(page).getByLabel('Text', { exact: true }).dispatchEvent('change');
    const block = page.locator('.report-sheet .report-text-block');
    await expect(block).toContainText('Upcoming Dates');
    await expect(block).toContainText('Conferences: Dec 4.');
  });

  test('Pages per student: 1 puts the response on the front and marks what does not fit', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('radio', { name: '1', exact: true }).click();
    await expect(page.getByRole('radio', { name: '1', exact: true })).toHaveAttribute('aria-checked', 'true');
    const front = page.locator('.report-sheet').first();
    await expect(front.locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    await expect(page.locator('.report-sheet').nth(1)).toHaveClass(/sheet-blank-side/);
    await expect(front.locator('.sheet-capped')).toContainText('Doesn’t fit');
    await expect(inspector(page)).toContainText('Over the page limit');
    await page.getByRole('radio', { name: 'Auto' }).click();
    await expect(page.locator('.sheet-capped')).toHaveCount(0);
    await expect(page.locator('.report-sheet').nth(1).locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
  });
});

test.describe('Page Studio templates', () => {
  test.setTimeout(90_000);

  test('a starter applies, and Undo puts the layout back', async ({ page }) => {
    await openStudio(page);
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(palette(page)).toContainText('Your Templates');
    await expect(palette(page)).toContainText('None yet');
    await palette(page).getByRole('button', { name: 'Interim Update', exact: true }).click();
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(1);
    await expect(page.locator('#undo-toast')).toContainText('Applied Interim Update');
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(0);
    await expect(page.locator('.report-sheet .report-learner-profile')).toHaveCount(1);
  });

  test('Save as Template keeps the layout under a name; it applies later and deletes with Undo', async ({ page }) => {
    await openStudio(page);
    // Change the layout: add the legend.
    await page.locator('[data-action="studioBlock"][data-block="legend"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="legend"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(1);
    // Save it.
    await page.getByRole('button', { name: 'Save as Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as Template' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('Science 8 with Legend');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toBeVisible();
    // Apply a starter, then the saved one.
    await palette(page).getByRole('button', { name: 'Report Card', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(1);
    // It is kept: still listed after a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toBeVisible();
    // Delete, then Undo.
    await palette(page).getByRole('button', { name: 'Delete Science 8 with Legend' }).click();
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toHaveCount(0);
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toBeVisible();
  });

  test('the dialog cancels with Escape and needs a name', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Save as Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as Template' });
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save as Template' })).toBeFocused();
  });
});

test('below 1240 px wide, Save as Template is in the Templates tab and the toolbar fits', async ({ page }) => {
  await openStudio(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('#tb-save-template')).toBeHidden();
  const right = await page.locator('#tb-print-btn').evaluate(el => el.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(1100);
  await palette(page).getByRole('tab', { name: 'Templates' }).click();
  await palette(page).getByRole('button', { name: 'Save as Template' }).click();
  await expect(page.getByRole('dialog', { name: 'Save as Template' })).toBeVisible();
});

test.describe('Printed progress reports', () => {
  test.setTimeout(90_000);

  test('the Report Card prints two Letter pages per student', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    const pdf = await printToPdf(page);
    expect(countPages(pdf)).toBe(STUDENTS * 2);
    for (const [w, h] of pageBoxes(pdf)) {
      expect([w, h]).toEqual([612, 792]);
    }
  });

  test('the Interim Update prints one side per student, with its back left blank for duplex', async ({ page }) => {
    await openStudio(page);
    await applyTemplate(page, 'interim-update');
    await showEveryone(page);
    expect(countPages(await printToPdf(page))).toBe(STUDENTS * 2);
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(STUDENTS);
  });

  test('the letterhead names the class, block, report, term dates and student number', async ({ page }) => {
    await openStudio(page);
    const header = page.locator('.report-sheet, .report-student').first().locator('.report-header');
    await expect(header.locator('.report-course-title')).toHaveText('Science 8 · Block A');
    await expect(header.locator('.report-student-name')).toHaveText('Cece Adeyemi');
    const meta = header.locator('.report-header-meta');
    await expect(meta.locator('.report-period')).toHaveText(
      await page.locator('#report-period option:checked').innerText(),
    );
    await expect(meta).toContainText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
    await expect(meta).toContainText('Student No. STU-201');
    await expect(page.locator('.report-sheet').first().locator('.sheet-footer')).toContainText(
      'Cece Adeyemi · Page 1 of 2',
    );
  });

  test('levels print as dots and a word in black', async ({ page }) => {
    await openStudio(page);
    const chip = page.locator('#rb-preview .report-section-chip-value').first();
    const dim = page.locator('#rb-preview .report-learner-dim-value').first();
    await expect(chip).toContainText(/[●○]{4}/);
    await expect(dim).toContainText(/[●○]{4}/);
    await page.emulateMedia({ media: 'print' });
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    expect(await dim.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await page.emulateMedia({ media: 'screen' });
  });

  test('Legal paper prints a 14 in page and is remembered for the class on this device', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    await page.getByRole('radio', { name: 'Legal' }).click();
    const pdf = await printToPdf(page);
    const boxes = pageBoxes(pdf);
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toEqual([612, 1008]);
    expect(countPages(pdf)).toBeLessThanOrEqual(STUDENTS * 2);

    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.getByRole('radio', { name: 'Legal' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Letter' }).click();
    for (const box of pageBoxes(await printToPdf(page))) expect(box).toEqual([612, 792]);
  });

  test('a dimension the teacher did not rate is left off the printed report', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('#rb-preview')).not.toContainText('Not Assessed');
  });
});
