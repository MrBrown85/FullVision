/**
 * Class blocks: each class can name its block (A–E, X, or a label), so two
 * sections of one course read differently in every class picker
 * (migrations/20261020_course_block.sql).
 */
import { test, expect } from '@playwright/test';
import { mockAuth, gotoApp, TEST_LEARNING_MAP } from './helpers.js';

const PHIL_B = 'b0000000-0000-4000-8000-00000000000b';
const PHIL_A = 'a0000000-0000-4000-8000-00000000000a';
const ENG_D = 'd0000000-0000-4000-8000-00000000000d';

async function seedClasses(page, classes) {
  await page.addInitScript(
    ({ classes, learningMap }) => {
      const courses = {};
      classes.forEach(c => {
        courses[c.id] = {
          id: c.id,
          name: c.name,
          block: c.block,
          gradingSystem: 'proficiency',
          calcMethod: 'mostRecent',
        };
        localStorage.setItem('gb-students-' + c.id, '[]');
        localStorage.setItem('gb-assessments-' + c.id, '[]');
        localStorage.setItem('gb-learningMaps-' + c.id, JSON.stringify(learningMap));
      });
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: classes[0].id }));
    },
    { classes, learningMap: TEST_LEARNING_MAP },
  );
}

test.describe('Class blocks', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('pickers list classes in block order with the block before the name', async ({ page }) => {
    await seedClasses(page, [
      { id: ENG_D, name: 'English 10', block: 'D' },
      { id: PHIL_B, name: 'Philosophy 12', block: 'B' },
      { id: PHIL_A, name: 'Philosophy 12', block: 'A' },
    ]);
    await gotoApp(page, '/assignments');
    await expect(page.locator('#gb-course-select option')).toHaveText([
      'Block A · Philosophy 12',
      'Block B · Philosophy 12',
      'Block D · English 10',
    ]);
  });

  test('a block chosen in Class Management shows in the picker', async ({ page }) => {
    await seedClasses(page, [
      { id: PHIL_A, name: 'Philosophy 12' },
      { id: PHIL_B, name: 'Philosophy 12' },
    ]);
    await gotoApp(page, '/dashboard');
    await page.getByRole('button', { name: 'Class Management' }).first().click();
    const picker = page.locator('#cm-block');
    await expect(picker).toBeVisible();
    await picker.getByRole('radio', { name: 'A', exact: true }).click();
    await expect(picker.getByRole('radio', { name: 'A', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.cm-class-item.selected .cm-class-name')).toHaveText('Block A · Philosophy 12');

    await page.locator('#cm-block-other').fill('Lunch club');
    await page.locator('#cm-block-other').blur();
    await expect(page.locator('.cm-class-item.selected .cm-class-name')).toHaveText('Lunch club · Philosophy 12');
    expect(await page.evaluate(cid => COURSES[cid].block, PHIL_A)).toBe('Lunch club');
  });

  test('Duplicate Class asks for the block and keeps the name', async ({ page }) => {
    await seedClasses(page, [{ id: PHIL_A, name: 'Philosophy 12', block: 'A' }]);
    await gotoApp(page, '/dashboard');
    await page.getByRole('button', { name: 'Class Management' }).first().click();
    await page.getByRole('button', { name: /Duplicate Class/ }).click();
    const dialog = page.getByRole('dialog', { name: /Duplicate/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: 'B', exact: true }).click();
    await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.cm-class-name', { hasText: 'Block B · Philosophy 12' })).toBeVisible();
    await expect(page.locator('.cm-class-name', { hasText: 'Block A · Philosophy 12' })).toBeVisible();
  });
});
