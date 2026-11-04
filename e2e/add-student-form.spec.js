import { test, expect } from '@playwright/test';

/* Class Management > Students > Add Student, in Demo Mode. */

const form = page => page.locator('#cm-add-student-form');

async function openAddStudent(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Students/ }).click();
  await page.locator('.cm-roster-add').click();
  await expect(page.locator('#cm-add-first')).toBeFocused();
}

test('Add Student stays open after Save, so the next student can be typed', async ({ page }) => {
  await openAddStudent(page);
  const before = await page.evaluate(() => getStudents('sci8').length);
  await page.locator('#cm-add-first').fill('Amara');
  await page.locator('#cm-add-last').fill('Osei');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cm-add-student-form')).toBeVisible();
  await expect(page.locator('#cm-add-first')).toBeFocused();
  await expect(page.locator('#cm-add-first')).toHaveValue('');
  await expect(page.locator('#cm-add-status')).toContainText('Added Amara Osei');
  await page.keyboard.type('Bea');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cm-add-status')).toContainText('Added Bea');
  expect(await page.evaluate(() => getStudents('sci8').length)).toBe(before + 2);
});

test('Escape closes Add Student and puts the focus back on the button', async ({ page }) => {
  await openAddStudent(page);
  await page.keyboard.type('Test');
  await page.keyboard.press('Escape');
  await expect(page.locator('#cm-add-student-form')).toBeHidden();
  await expect(page.locator('.cm-roster-add')).toBeFocused();
});
