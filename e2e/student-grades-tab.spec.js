import { test, expect } from '@playwright/test';

/* The Grades tab (redesign R4, R5): Assessments and Grade Breakdown in one
   tab, for every class. Demo Mode, Mei Wong (st23) in Science 8. */

async function open(page, on) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  if (on) await page.evaluate(() => setStudentPageSwitch('sci8', true));
  await page.evaluate(() => window.Router.navigate('/student?id=st23&course=sci8&tab=comps'));
  await page.locator('.stu-tabs').waitFor();
}

test('the Grades tab shows with the build switch off, and the old tabs are gone', async ({ page }) => {
  await open(page, false);
  await expect(page.locator('#stu-tab-grades')).toHaveCount(1);
  await expect(page.locator('#stu-tab-assess, #stu-tab-breakdown')).toHaveCount(0);
});

test('Grades builds the course grade by category, groups the work, and opens a row in place', async ({ page }) => {
  await open(page, false);
  await page.locator('#stu-tab-grades').click();
  const tab = page.locator('.stu-gr');
  await expect(tab.locator('.stu-gr-title')).toHaveText('Grades');
  // One bar segment per weighted category, each with its share of the grade.
  const segs = tab.locator('.stu-gr-seg');
  const cats = await page.evaluate(() => getCategories('sci8').filter(c => Number(c.weight) > 0).length);
  await expect(segs).toHaveCount(cats);
  await expect(segs.first().locator('.stu-gr-seg-w')).toHaveText(/^\d+(\.\d+)?% of the grade$/);
  // Category groups, each with its grade.
  await expect(tab.locator('.stu-gr-group').first().locator('.stu-level')).toBeVisible();
  // A row opens in place.
  const row = tab.locator('.stu-ov-row-btn').first();
  await row.click();
  await expect(tab.locator('.stu-ov-row.open')).toHaveCount(1);
  // Date groups by month; Missing narrows the list.
  await tab.locator('[data-action="stuGrGroup"][data-group="date"]').click();
  await expect(tab.locator('[data-action="stuGrGroup"][data-group="date"]')).toHaveAttribute('aria-checked', 'true');
  await expect(tab.locator('.stu-gr-group-name').first()).toHaveText(/\d{4}$/);
  await tab.locator('[data-action="stuGrFilter"][data-filter="missing"]').click();
  await expect(tab.locator('[data-action="stuGrFilter"][data-filter="missing"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
