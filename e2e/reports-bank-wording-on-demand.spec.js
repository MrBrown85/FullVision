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
  await page.getByRole('tab', { name: 'Print Reports' }).click();
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

/* The fit line counts in the bank's wording: a count that finished before
   the wording arrived is counted again once it is here. */
test('the fit counts the class again when the bank wording arrives after it', async ({ page }) => {
  let release;
  const held = new Promise(r => (release = r));
  await page.route('**/shared/bank-proficiency.js', async route => {
    await held;
    await route.continue();
  });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await page.evaluate(() => {
    window.__layouts = 0;
    window.__lastLayout = performance.now();
    const layoutWith = ReportOne.layoutWith;
    ReportOne.layoutWith = function (m) {
      const lay = layoutWith(m);
      return function () {
        window.__layouts++;
        window.__lastLayout = performance.now();
        return lay.apply(this, arguments);
      };
    };
  });
  const quiet = () =>
    page.waitForFunction(() => performance.now() - window.__lastLayout > 1000, null, { timeout: 60000 });
  await page.locator('#studio-palette [data-action="oneSwitch"][data-part="fb-rubrics"]').evaluate(b => b.click());
  await quiet();
  expect(await page.evaluate(() => typeof window.BANK_PROFICIENCY)).toBe('undefined');
  await page.evaluate(() => (window.__layouts = 0));
  release();
  await expect.poll(() => page.evaluate(() => typeof window.BANK_PROFICIENCY)).toBe('object');
  await page.evaluate(() => (window.__lastLayout = performance.now()));
  await quiet();
  // The canvas and every student for the fit line.
  const students = await page.evaluate(() => getStudents('sci8').length);
  expect(await page.evaluate(() => window.__layouts)).toBe(students + 1);
});
