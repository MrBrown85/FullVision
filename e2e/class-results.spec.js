import { test, expect } from '@playwright/test';

/* Class Results (docs/plans/class-results-plan.md): the Class Average card
   and the panel, in Demo Mode's Science 8. sci8a1 is a lab rubric with a
   Missing, an Excused and a Late cell; sci8q1 a points quiz; sci8q4 a
   Complete/Incomplete check. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openGradebook(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.waitForSelector('#gb-data .gb-stats-row td[data-aid="sci8a1"]');
}

const avgCell = (page, aid) => page.locator(`#gb-data .gb-stats-row td[data-aid="${aid}"]`);

test('the Class Average card shows on hover and the panel opens on a click', async ({ page }) => {
  await openGradebook(page);
  const cell = avgCell(page, 'sci8a1');
  await cell.scrollIntoViewIfNeeded();
  await cell.hover();
  const tip = page.locator('#gb-tooltip.gb-tip-avg');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Class Average');
  await expect(tip).toContainText('1 missing');
  await expect(tip).toContainText('View Class Results');

  await cell.click();
  const panel = page.locator('#class-results');
  await expect(panel).toBeVisible();
  await expect(page.locator('#cr-title')).toHaveText('Cell Microscope Lab');
  await expect(tip).toBeHidden();
  await expect(panel).toContainText('Below Proficient');

  // A grid cell lists its students; selecting it again lets go.
  const gridCell = panel.locator('button.cr-cell').first();
  await gridCell.click();
  await expect(panel.locator('.cr-sec h3').nth(1)).toContainText(' on ');
  await panel.locator('[data-cr="clear"]').click();
  await expect(panel.locator('.cr-sec h3').nth(1)).toContainText('Below Proficient');

  // Escape closes it and gives the focus back to the cell.
  await page.locator('#cr-title').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(cell).toBeFocused();
});

test('the column menu has View Class Results with the column average', async ({ page }) => {
  await openGradebook(page);
  await page.locator('#gb-colheads .gb-grid-colhead[data-aid="sci8q1"] .gb-grid-colhead-label').focus();
  await page.keyboard.press('Enter');
  const item = page.locator('.gb-ctx-menu [data-ctx="viewResults"]');
  await expect(item).toContainText('View Class Results');
  await expect(item.locator('.gb-ctx-hint')).toContainText('Avg');
  await item.click();
  await expect(page.locator('#cr-title')).toHaveText('Cell Structure Quiz');
  await expect(page.locator('#class-results')).toContainText('Score Spread');
});

test('points, Complete/Incomplete and Help panel rules', async ({ page }) => {
  await openGradebook(page);
  await page.evaluate(() => ClassResults.open('sci8', 'sci8q4'));
  const panel = page.locator('#class-results');
  await expect(panel.locator('.cr-crows')).toContainText('Complete');
  await expect(panel).toContainText('Unmarked');

  // Mark Missing on the Unmarked list offers Undo and moves the student.
  await panel.locator('[data-cr="markBlank"][data-status="NS"]').click();
  await expect(page.locator('#undo-toast')).toContainText('marked Missing');
  await expect(panel).toContainText('Missing or Excused · 2');

  // Help and Class Results share the side of the page.
  await page.evaluate(() => setHelpOpen(true));
  await expect(panel).toHaveCount(0);
  await page.evaluate(() => ClassResults.open('sci8', 'sci8a1'));
  await expect(page.locator('#help-panel')).toHaveCount(0);
});

test('the Assignments page opens it from a card', async ({ page }) => {
  await openGradebook(page);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  // A closed card shows its actions on hover.
  await page.locator('#ac-sci8q1 .assess-header').hover();
  const btn = page.locator('.cr-card-btn[data-aid="sci8q1"]');
  await btn.click();
  await expect(page.locator('#cr-title')).toHaveText('Cell Structure Quiz');
});
