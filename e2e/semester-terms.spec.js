/**
 * Full year / Semester 1 / Semester 2 per class (DECISIONS, Reporting
 * periods 9). A Semester 2 class keeps the school's Terms 3 and 4, and the
 * Reports page names them by the school's schedule.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

const GRANDVIEW = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-27' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-28', ends_on: '2027-01-26' },
  { ordinal: 3, label: 'Term 3', starts_on: '2027-01-27', ends_on: '2027-04-23' },
  { ordinal: 4, label: 'Term 4', starts_on: '2027-04-24', ends_on: '2027-06-24' },
];

async function openTerms(page) {
  await gotoApp(page, '/dashboard');
  await page.getByRole('button', { name: 'Class Management' }).first().click();
  await page.getByRole('tab', { name: 'Reporting Terms' }).click();
  const span = page.getByRole('radiogroup', { name: 'This Class Runs' });
  await expect(span).toBeVisible();
  return span;
}

const termLabels = page => page.locator('.cm-term-row .cm-term-label');

test.describe('Semester classes', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(
      ({ cid, terms }) => localStorage.setItem('gb-courseconfig-' + cid, JSON.stringify({ reportingTerms: terms })),
      { cid: TEST_COURSE.id, terms: GRANDVIEW },
    );
  });

  test('Semester 2 keeps Terms 3 and 4 as Report 3 and 4, and Full year brings 1 and 2 back', async ({ page }) => {
    const span = await openTerms(page);
    await expect(span.getByRole('radio', { name: 'Full Year' })).toHaveAttribute('aria-checked', 'true');
    await expect(termLabels(page)).toHaveCount(4);

    await span.getByRole('radio', { name: 'Semester 2' }).click();
    await expect(termLabels(page)).toHaveCount(2);
    await expect(termLabels(page).first()).toHaveValue('Term 3');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.locator('[id^="cm-term-foot-"]')).toContainText('Report 3–4');
    expect(await page.evaluate(cid => getReportingTerms(cid).map(t => t.ordinal), TEST_COURSE.id)).toEqual([3, 4]);

    await page.getByRole('radiogroup', { name: 'This Class Runs' }).getByRole('radio', { name: 'Full Year' }).click();
    await expect(termLabels(page)).toHaveCount(4);
  });

  test("a Semester 2 class's report picker shows the school's Apr and Jun reports", async ({ page }) => {
    await page.addInitScript(
      ({ cid, terms }) => localStorage.setItem('gb-courseconfig-' + cid, JSON.stringify({ reportingTerms: terms })),
      { cid: TEST_COURSE.id, terms: GRANDVIEW.slice(2) },
    );
    await gotoApp(page, '/reports');
    const opts = page.locator('#report-period option');
    await expect(opts).toHaveText(['Apr Report Card', 'Jun Report Card']);
    expect(await opts.first().getAttribute('value')).toBe('Report 3');
  });
});
