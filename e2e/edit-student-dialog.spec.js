import { test, expect } from '@playwright/test';

/* The student page's Edit Student dialog, layout B (Colin, 2026-10-29): the
   name, school record, contact and language support on the left, every
   designation on the right as a row that turns blue when chosen. It has the
   Class Management roster's fields, Parent Email and Parent Email 2
   included. Runs in Demo Mode on Cece Adeyemi (st1) in Science 8. */

test.use({ viewport: { width: 1280, height: 1100 } });

async function openDialog(page) {
  await page.goto('/student?id=st1&course=sci8');
  await page.locator('[data-action="openEditStudent"]').click();
  const dialog = page.locator('.es-modal');
  await expect(dialog).toBeVisible();
  return dialog;
}

const cece = page => page.evaluate(() => getStudents('sci8').find(s => s.id === 'st1'));

test('two columns with every roster field; 44 px controls; Save', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  const dialog = await openDialog(page);

  await expect(dialog.locator('.es-h')).toHaveText([
    'Name',
    'School Record',
    'Contact',
    'Language Support',
    'Designations',
  ]);
  for (const label of [
    'First Name',
    'Last Name',
    'Preferred Name',
    'Pronouns',
    'Student Number',
    'Date of Birth',
    'Student Email',
    'Parent Email',
    'Parent Email 2',
  ]) {
    await expect(dialog.locator('.es-label', { hasText: label }).first()).toBeVisible();
  }
  await expect(dialog.locator('.es-list[aria-label="Designations"] .es-toggle')).toHaveCount(12);
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Update' })).toHaveCount(0);

  // Designations sit to the right of the fields, and every name shows whole.
  const fieldsBox = await dialog.locator('#edit-first').boundingBox();
  const listBox = await dialog.locator('.es-list[aria-label="Designations"]').boundingBox();
  expect(listBox.x).toBeGreaterThan(fieldsBox.x + fieldsBox.width);
  const cut = await dialog.evaluate(
    el => [...el.querySelectorAll('.es-toggle span')].filter(s => s.scrollWidth > s.clientWidth + 1).length,
  );
  expect(cut).toBe(0);
  const small = await dialog.evaluate(
    el =>
      [...el.querySelectorAll('button, input, select')]
        .filter(c => c.getClientRects().length)
        .filter(c => c.getBoundingClientRect().height < 44).length,
  );
  expect(small).toBe(0);
});

test('choices, a parent email and a missing first name save as expected', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  let dialog = await openDialog(page);

  const g = dialog.locator('.es-toggle[data-code="G"]');
  await expect(g).toHaveAttribute('aria-pressed', 'false');
  await g.click();
  await expect(g).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('.es-toggle[data-code="ELL"]').click();

  // A bad email says so under the field and nothing saves.
  await dialog.locator('#edit-g0').fill('not an email');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('#edit-g0-err')).toBeVisible();
  await expect(dialog.locator('#edit-g0')).toHaveAttribute('aria-invalid', 'true');

  // So does a missing first name.
  await dialog.locator('#edit-g0').fill('parent@example.com');
  await expect(dialog.locator('#edit-g0-err')).toBeHidden();
  const first = await dialog.locator('#edit-first').inputValue();
  await dialog.locator('#edit-first').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('#edit-first-err')).toHaveText('Enter a first name.');
  expect((await cece(page)).designations || []).not.toContain('G');

  await dialog.locator('#edit-first').fill(first);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await cece(page);
  expect(saved.designations).toEqual(expect.arrayContaining(['G', 'ELL']));
  expect(saved.firstName).toBe(first);
  expect(await page.evaluate(() => DashClassManager.guardianEmails('sci8', 'st1'))).toEqual(['parent@example.com', '']);

  // Reopening shows what was saved.
  dialog = await openDialog(page);
  await expect(dialog.locator('.es-toggle[data-code="G"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.es-toggle[data-code="ELL"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('#edit-g0')).toHaveValue('parent@example.com');
});
