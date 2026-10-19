import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The Term Questionnaire's report picker follows the class's reporting
// terms: a school's preset shows that school's report names.
async function seedTerms(page, terms) {
  await page.addInitScript(
    ({ cid, terms }) => {
      localStorage.setItem('gb-courseconfig-' + cid, JSON.stringify({ reportingTerms: terms }));
    },
    { cid: TEST_COURSE.id, terms },
  );
}

const GRANDVIEW = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-27' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-28', ends_on: '2027-01-26' },
  { ordinal: 3, label: 'Term 3', starts_on: '2027-01-27', ends_on: '2027-04-23' },
  { ordinal: 4, label: 'Term 4', starts_on: '2027-04-24', ends_on: '2027-06-24' },
];

test.describe('Report picker', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test("a school's preset terms show the school's report names", async ({ page }) => {
    await seedTerms(page, GRANDVIEW);
    await gotoApp(page, '/reports');
    const sel = page.locator('#report-period');
    await expect(sel.locator('option')).toHaveText([
      'Nov report card',
      'Feb report card',
      'Apr report card',
      'Jun report card',
    ]);
    expect(await sel.locator('option').first().getAttribute('value')).toBe('Report 1');
  });

  test("custom terms show the class's own term names", async ({ page }) => {
    await seedTerms(page, [
      { ordinal: 1, label: 'Oct interim', starts_on: '2026-09-08', ends_on: '2026-10-30' },
      { ordinal: 2, label: 'Dec full report', starts_on: '2026-10-31', ends_on: '2026-12-18' },
    ]);
    await gotoApp(page, '/reports');
    await expect(page.locator('#report-period option')).toHaveText(['Oct interim', 'Dec full report']);
  });

  test('a class with no terms keeps Report 1 to 6', async ({ page }) => {
    await gotoApp(page, '/reports');
    await expect(page.locator('#report-period option')).toHaveCount(6);
    await expect(page.locator('#report-period option').first()).toHaveText('Report 1');
  });
});
