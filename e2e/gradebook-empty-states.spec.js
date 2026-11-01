import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp } from './helpers.js';

// With nothing to show, the gradebook says why in one white card and offers
// the one step that changes it.
const card = page => page.locator('.gb-empty');

test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
});

test('a new class asks for students', async ({ page }) => {
  await gotoApp(page, '/gradebook');
  await expect(card(page)).toContainText('This class has no students or assessments yet.');
  await expect(card(page).getByRole('link', { name: 'Add Students' })).toHaveAttribute(
    'data-href',
    /\/dashboard\?course=.+&manage=students$/,
  );
});

test('a class with students and no assessments says so', async ({ page }) => {
  await seedStudents(page);
  await gotoApp(page, '/gradebook');
  await expect(card(page)).toContainText('No assessments in this class yet.');
});

test('a search that finds no one offers Clear Search', async ({ page }) => {
  await seedStudents(page);
  await seedAssessments(page);
  await gotoApp(page, '/gradebook');
  await page.locator('.gb-search-input').fill('zzzz');
  await expect(card(page)).toContainText('No students match “zzzz”.');
  await card(page).getByRole('button', { name: 'Clear Search' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('.gb-search-input')).toHaveValue('');
  await expect(page.locator('#gb-data tr[data-sid]').first()).toBeVisible();
});
