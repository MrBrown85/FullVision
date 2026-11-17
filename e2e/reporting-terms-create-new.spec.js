import { test, expect } from '@playwright/test';

/* Class Settings > Reporting Terms > Create New, in Demo Mode on Science 8
   with Grandview Heights' terms saved: Create New beside the school menu
   opens Your Own Dates on a copy of the class's dates; an overlap marks its
   row and keeps Save off; fixed and saved, the tiles read Your Own Dates
   and survive a reload. */

async function openTerms(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => saveReportingTerms('sci8', reportingTermPreset('grandviewheights', '2026-11-03')));
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Reporting Terms/ }).click();
}

const rows = page => page.locator('.cm-term-row');
const saveTerms = page => page.getByRole('button', { name: 'Save Terms' });

test('Create New makes the class’s own terms from a copy of its dates', async ({ page }) => {
  await openTerms(page);
  await expect(page.getByLabel('Dates From')).toHaveValue('grandviewheights');
  await page.getByRole('button', { name: 'Create New' }).click();

  await expect(page.getByRole('heading', { name: 'Your Own Dates' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'This Class’s Dates' })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(0).getByLabel('End date')).toHaveValue('2026-11-27');
  await expect(saveTerms(page)).toBeDisabled();
  await expect(page.locator('.cm-term-strip-term')).toHaveCount(4);

  // Term 2 runs into Term 3: its row says so and Save stays off.
  await rows(page).nth(1).getByLabel('End date').fill('2027-02-03');
  await expect(page.locator('#cm-term-row-msg-sci8-1')).toHaveText('Term 2 and Term 3 overlap: Term 3 starts Jan 27.');
  await expect(page.locator('#cm-term-row-sci8-1')).toHaveClass(/cm-term-row-bad/);
  await expect(page.locator('.cm-term-strip-overlap')).toHaveCount(1);
  await expect(saveTerms(page)).toBeDisabled();

  await rows(page).nth(1).getByLabel('End date').fill('2027-01-29');
  await rows(page).nth(2).getByLabel('Start date').fill('2027-02-01');
  await rows(page).nth(0).getByLabel('Term name').fill('Fall Report');
  await expect(page.locator('#cm-term-row-msg-sci8-1')).toHaveText('');
  await expect(page.locator('.cm-term-strip-overlap')).toHaveCount(0);
  await expect(saveTerms(page)).toBeEnabled();
  await saveTerms(page).click();

  const tiles = page.locator('.cm-term-tile-name');
  await expect(tiles).toHaveText(['Fall Report', 'Term 2', 'Term 3', 'Term 4']);
  await expect(page.getByLabel('Dates From')).toHaveValue('own');
  const saved = await page.evaluate(() => getReportingTerms('sci8'));
  expect(saved.map(t => [t.ordinal, t.starts_on, t.ends_on])).toEqual([
    [1, '2026-09-08', '2026-11-27'],
    [2, '2026-11-28', '2027-01-29'],
    [3, '2027-02-01', '2027-04-23'],
    [4, '2027-04-24', '2027-06-24'],
  ]);

  await page.reload();
  await expect(page.locator('.cm-term-tile-name')).toHaveText(['Fall Report', 'Term 2', 'Term 3', 'Term 4']);
});
