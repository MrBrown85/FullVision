import { test, expect } from '@playwright/test';

// Print Rubrics lists the class by last name with full names ("Cece
// Adeyemi"), as the roster and gradebook do, and prints in that order.
test.use({ viewport: { width: 1440, height: 900 } });

test('Print Rubrics lists students by last name with full names', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // A preferred name keeps the roster's rule: preferred, then last name.
  await page.evaluate(() => {
    var list = getStudents('sci8');
    list[list.length - 1].lastName = 'Aaronson';
    saveStudents('sci8', list);
    window.Router.navigate('/assignments?course=sci8');
  });
  const card = page.locator('#ac-sci8a19');
  await card.waitFor();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await card.locator('[data-action="printRubrics"]').first().click();
  const rows = page.locator('.rp-pick .rp-pick-option > span');
  await expect(rows.first()).toBeVisible();
  const shown = await rows.evaluateAll(spans =>
    spans.map(sp => {
      var c = sp.cloneNode(true);
      c.querySelectorAll('.rp-help, .rp-tag').forEach(t => t.remove());
      return c.textContent.trim();
    }),
  );
  const expected = await page.evaluate(() =>
    sortStudents(getStudents('sci8'), 'lastName').map(s => displayNameWithLast(s)),
  );
  expect(shown).toEqual(expected);
  expect(shown[0]).toMatch(/ Aaronson$/);
  const printed = await page.evaluate(() =>
    RubricPrint.selectStudents('sci8', 'sci8a19', { students: 'all' }).map(s => s.id),
  );
  expect(printed).toEqual(await page.evaluate(() => sortStudents(getStudents('sci8'), 'lastName').map(s => s.id)));
});
