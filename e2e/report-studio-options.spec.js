/**
 * Page Studio, stage 3: the inspector's options (teacher/report-studio.js,
 * report-blocks.js). Show checkboxes change the printed block; the
 * no-evidence rule; I-can statements; Leave Off for one student; the text
 * block; Pages per student cuts and marks what does not fit. Chromium and
 * WebKit.
 */
import { test, expect } from '@playwright/test';

async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('.report-sheet')).toHaveCount(2);
}

const inspector = page => page.locator('#studio-inspector');

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
