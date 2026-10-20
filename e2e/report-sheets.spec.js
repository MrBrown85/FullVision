/**
 * The Report Card form lays each student into explicit sheets. These checks
 * run in Chromium and WebKit: the sheet count, that no sheet's content
 * overflows its box, and that the footer names the student and sheet.
 * Page counts from Chromium's print engine are in report-print.spec.js.
 */
import { test, expect } from '@playwright/test';

const STUDENTS = 27;

async function openReportCard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await page.locator('[data-action="rbApplyPreset"][data-preset="standard"]').click();
  await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2);
}

async function overflowing(page) {
  return page
    .locator('.report-sheet')
    .evaluateAll(sheets =>
      sheets
        .filter(s => s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1)
        .map(s => s.querySelector('.sheet-footer')?.textContent || '?'),
    );
}

test.describe('Report Card sheets', () => {
  test.setTimeout(90_000);

  test('every student is one sheet, front and back, and nothing overflows', async ({ page }) => {
    await openReportCard(page);
    expect(await overflowing(page), 'sheets whose content overflows the page').toEqual([]);
    await expect(page.locator('.sheet-overflow')).toHaveCount(0);
    const first = page.locator('.report-sheet').first();
    await expect(first.locator('.sheet-footer')).toContainText('Cece Adeyemi · Sheet 1 of 1 · Front');
    await expect(page.locator('.report-sheet').nth(1).locator('.sheet-footer')).toContainText('Sheet 1 of 1 · Back');
    await expect(page.locator('#rb-form-summary')).toContainText('every student on one sheet');
  });

  test('the back carries the dispositions and the response pinned at the bottom, wording intact', async ({ page }) => {
    await openReportCard(page);
    const back = page.locator('.report-sheet').nth(1);
    await expect(back.locator('.report-learner-profile')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned')).toContainText('I have reviewed this report with my child');
    await expect(back.locator('.sheet-pinned')).toContainText('I would like to schedule a meeting with the teacher');
    await expect(back.locator('.sheet-pinned')).toContainText(
      'Please review this report with your child and return this section to the school.',
    );
  });

  test('Legal sheets are 14 in tall and still hold every student on one sheet', async ({ page }) => {
    await openReportCard(page);
    await page.getByRole('radio', { name: 'Legal' }).click();
    await expect(page.locator('.report-sheet[data-paper="legal"]')).toHaveCount(STUDENTS * 2);
    // offsetHeight is in the sheet's own CSS pixels, before the preview's zoom.
    const h = await page
      .locator('.report-sheet')
      .first()
      .evaluate(el => el.offsetHeight);
    expect(h).toBe(14 * 96);
    expect(await overflowing(page)).toEqual([]);
  });

  test('the rail says how many sheets each student needs, and why', async ({ page }) => {
    await openReportCard(page);
    const badges = page.locator('#gb-sidebar .student-row-sheets');
    await expect(badges).toHaveCount(STUDENTS);
    for (const text of await badges.allTextContents()) expect(text).toMatch(/^(1 sheet|\d sheets|No comment)$/);
    await expect(page.locator('.sheet-student').first().locator('.sheet-badge')).toHaveText('1 sheet');
    // A note explains any report that is not the plain form.
    const notes = page.locator('.sheet-note');
    if (await notes.count()) await expect(notes.first()).toContainText(/moved to the back|second sheet|No comment/);
    // Leaving the Report Card brings the grade badges back.
    await page.locator('[data-action="rbApplyPreset"][data-preset="brief"]').click();
    await expect(page.locator('#gb-sidebar .student-row-sheets')).toHaveCount(0);
    await expect(page.locator('#gb-sidebar .student-row-prof').first()).toBeVisible();
  });

  test('Fit Map shows every student at a glance and a thumbnail opens that student', async ({ page }) => {
    await openReportCard(page);
    await page.getByRole('button', { name: 'Fit Map' }).click();
    await expect(page.locator('#rb-preview')).toHaveClass(/report-fitmap/);
    await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS);
    await page.locator('.sheet-student').nth(2).click();
    await expect(page.locator('#rb-preview')).not.toHaveClass(/report-fitmap/);
    await expect(page.locator('.sheet-student')).toHaveCount(1);
    await expect(page.locator('#picker-label')).toHaveText('Hannah Berg');
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
    await expect(page.locator('.sheet-note').first()).toContainText('Comment is');
  });

  test('Issue saves a fixed copy that can be shown and printed again', async ({ page }) => {
    await openReportCard(page);
    await expect(page.getByRole('button', { name: 'Issue Reports…' })).toBeVisible();
    await page.getByRole('button', { name: 'Issue Reports…' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog).toContainText('Issue 27 Reports');
    await expect(dialog).toContainText('A fixed copy of every report');
    await expect(dialog.locator('input[name="issue-who"]')).toHaveCount(1);
    await dialog.locator('#issue-print').uncheck();
    await expect(dialog.locator('[data-issue="go"]')).toHaveText('Issue');
    await dialog.locator('[data-issue="go"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#rb-form-summary')).toContainText(/Issued .* · 27 reports saved as a fixed copy/);
    const copies = page.locator('#report-copy');
    await expect(copies).toBeVisible();
    await expect(copies.locator('option')).toHaveCount(2);
    await copies.selectOption({ index: 1 });
    await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2);
    await expect(page.getByRole('button', { name: 'Print This Copy' })).toBeVisible();
    await copies.selectOption({ index: 0 });
    await expect(page.getByRole('button', { name: 'Issue Reports…' })).toBeVisible();
    await page.getByRole('button', { name: 'Issue Reports…' }).click();
    await expect(page.locator('#issue-overlay input[name="issue-who"]')).toHaveCount(2);
    await expect(page.locator('#issue-overlay')).toContainText('Changed since the last issue');
    await expect(page.locator('#issue-overlay input[value="changed"]')).toBeDisabled();
  });

  test('Photocopy view turns the levels black on screen', async ({ page }) => {
    await openReportCard(page);
    const chip = page.locator('.report-sheet .report-section-chip-value').first();
    const before = await chip.evaluate(el => getComputedStyle(el).color);
    await page.getByRole('radio', { name: 'Photocopy' }).click();
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    expect(before).not.toBe('rgb(0, 0, 0)');
  });
});
