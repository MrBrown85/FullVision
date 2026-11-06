import { test, expect } from '@playwright/test';

/* Class Settings > Reporting Terms: picking a school previews its dates,
   and Cancel or leaving the tab puts the menu back on the class's school.
   Demo Mode, with Grandview Heights' terms saved on the class. */

async function openTerms(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => saveReportingTerms('sci8', reportingTermPreset('grandviewheights', '2026-11-03')));
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Reporting Terms/ }).click();
}

const school = page => page.locator('.cm-term-school-select');

test('Picking a school shows its dates before they replace the class’s', async ({ page }) => {
  await openTerms(page);
  await expect(school(page)).toHaveValue('grandviewheights');
  await expect(page.locator('.cm-term-school-preview')).toHaveCount(0);
  await school(page).selectOption('earlmarriott');
  await expect(page.locator('.cm-term-school-preview')).toContainText('Earl Marriott Secondary: Term 1 Sep 8 – Nov 19');
  // The class's own terms are unchanged until Replace.
  await expect(page.locator('.cm-term-tile').first()).toContainText('Nov 27');
});

test('Leaving the tab puts the menu back on the school whose dates the class has', async ({ page }) => {
  await openTerms(page);
  await school(page).selectOption('earlmarriott');
  await page.getByRole('tab', { name: /^Details/ }).click();
  await page.getByRole('tab', { name: /^Reporting Terms/ }).click();
  await expect(school(page)).toHaveValue('grandviewheights');
});

test('Cancel after Replace puts back the class’s terms and its school', async ({ page }) => {
  await openTerms(page);
  await school(page).selectOption('earlmarriott');
  await page.locator('[data-action="cmTermSchoolPreset"]').click();
  await page.locator('[data-action="cmTermCancel"]').click();
  await expect(school(page)).toHaveValue('grandviewheights');
  await expect(page.locator('.cm-term-tile').first()).toContainText('Nov 27');
});
