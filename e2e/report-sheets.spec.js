/**
 * Page Studio and its sheets (teacher/report-studio.js, report-sheets.js).
 * Runs in Chromium and WebKit: the palette, the pages at paper size, the
 * inspector, Everyone view, Print Reports with its saved copy, templates,
 * and that nothing overflows a page. Page counts from Chromium's print
 * engine are in report-print.spec.js.
 */
import { test, expect } from '@playwright/test';

const STUDENTS = 27;

async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('.report-sheet')).toHaveCount(2);
}

async function showEveryone(page) {
  await page.locator('[data-action="studioView"][data-view="all"]').click();
  await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2);
}

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

test.describe('Page Studio', () => {
  test.setTimeout(90_000);

  test('opens on one student, two pages side by side, with the palette and the inspector', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('.studio-palette .studio-blk')).toHaveCount(17);
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
    await page.locator('[data-action="studioBlock"][data-block="attendance"]').click();
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('[data-action="studioBlock"][data-block="attendance"]')).toHaveClass(/placed/);
  });

  test('templates: the Interim Update is one side with the legend; the Conference Pack cuts its grade table at rows', async ({
    page,
  }) => {
    await openStudio(page);
    await applyTemplate(page, 'interim-update');
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(1);
    await expect(page.locator('.report-sheet .report-learner-dim')).toHaveCount(0);
    await expect(page.locator('.sheet-label').first()).toHaveText('Page 1 of 2');
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

  test('Legal paper makes the pages 14 in tall; Black ink turns the levels black', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('radio', { name: 'Legal' }).click();
    await expect(page.locator('.report-sheet[data-paper="legal"]')).toHaveCount(2);
    const h = await page
      .locator('.report-sheet')
      .first()
      .evaluate(el => el.offsetHeight);
    expect(h).toBe(14 * 96);
    await page.getByRole('radio', { name: 'Letter' }).click();
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

  test('on a phone the pages fit the width and the palette opens from a button', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'one engine is enough for the layout at phone width');
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
