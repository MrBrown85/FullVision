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

test('Add Student pronouns take the list or any typed set, as the roster does', async ({ page }) => {
  await openAddStudent(page);
  const pro = page.locator('#cm-add-pro');
  await expect(pro).toHaveAttribute('list', 'cm-add-pronouns');
  expect(await page.locator('#cm-add-pronouns option').evaluateAll(o => o.map(x => x.value))).toEqual([
    'he/him',
    'she/her',
    'they/them',
    'prefer not to say',
  ]);
  await page.locator('#cm-add-first').fill('Rin');
  await pro.fill('he/they');
  await page.keyboard.press('Enter');
  const rin = await page.evaluate(() => getStudents('sci8').find(s => s.firstName === 'Rin'));
  expect(rin.pronouns).toBe('he/they');
});

test('Add Student fields are named by their labels', async ({ page }) => {
  await openAddStudent(page);
  for (const name of [
    'First Name *',
    'Last Name',
    'Preferred Name',
    'Pronouns',
    'Student Number',
    'Email',
    'Date of Birth',
  ]) {
    await expect(form(page).getByLabel(name, { exact: true })).toHaveCount(1);
  }
});

test('Save and Add Another keeps the form open; Save closes it', async ({ page }) => {
  await openAddStudent(page);
  const before = await page.evaluate(() => getStudents('sci8').length);
  const another = form(page).getByRole('button', { name: 'Save and Add Another' });
  const save = form(page).getByRole('button', { name: 'Save', exact: true });
  // Save and Add Another sits beside Save, on the same line.
  const [a, s] = await Promise.all([another.boundingBox(), save.boundingBox()]);
  expect(a.y).toBe(s.y);
  expect(a.x + a.width).toBeLessThan(s.x);
  await page.locator('#cm-add-first').fill('Kai');
  await page.locator('#cm-add-last').fill('Lee');
  await another.click();
  await expect(form(page)).toBeVisible();
  await expect(page.locator('#cm-add-first')).toBeFocused();
  await expect(page.locator('#cm-add-first')).toHaveValue('');
  await expect(page.locator('#cm-add-last')).toHaveValue('');
  await expect(page.locator('#cm-add-status')).toContainText('Added Kai Lee');
  await page.locator('#cm-add-first').fill('Noor');
  await form(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form(page)).toBeHidden();
  await expect(page.locator('.cm-roster-add')).toBeFocused();
  expect(await page.evaluate(() => getStudents('sci8').length)).toBe(before + 2);
});
