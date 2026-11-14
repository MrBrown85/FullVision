import { test, expect } from '@playwright/test';

/* The curriculum bank's level wording (shared/bank-proficiency.js, about
   858 KB) is printed only on Feedback Pages' Tag Rubrics (speed assessment
   R6). Progress Reports fetched it, and drew the tab twice, on every first
   open of a class with bank competencies. It is fetched now only when the
   report prints rubrics: never with Rubrics off, once when it is turned on. */

test('Progress Reports fetches the bank wording only when its Feedback Pages print rubrics', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  let fetched = 0;
  page.on('request', r => r.url().includes('/shared/bank-proficiency.js') && fetched++);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  // Demo Mode's Science 8 has competencies from the bank.
  expect(await page.evaluate(() => RubricPrint.classUsesBankLevels('sci8'))).toBe(true);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  expect(await page.evaluate(() => !!((getReportConfig('sci8') || {}).one || {}).feedback?.rubrics)).toBe(false);
  await page.waitForTimeout(1500);
  expect(fetched).toBe(0);
  // Rubrics on: fetched once, and the pages are drawn again with it.
  const rubrics = page.locator('#studio-palette [data-action="oneSwitch"][data-part="fb-rubrics"]');
  await rubrics.evaluate(b => b.click());
  await expect(rubrics).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => typeof window.BANK_PROFICIENCY)).toBe('object');
  expect(fetched).toBe(1);
  // Off and on again: nothing more to fetch.
  await rubrics.evaluate(b => b.click());
  await rubrics.evaluate(b => b.click());
  await page.waitForTimeout(500);
  expect(fetched).toBe(1);
  expect(errors).toEqual([]);
});
