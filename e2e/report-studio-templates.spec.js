/**
 * Page Studio, stage 4: templates (teacher/report-studio.js, page-reports.js).
 * Starters apply with Undo; Save as Template keeps the class's layout under
 * a name on the Templates tab; a saved template applies to another layout
 * and deletes with Undo. Chromium and WebKit, Demo Mode (the device copy).
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

const palette = page => page.locator('#studio-palette');

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
