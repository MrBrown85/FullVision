/**
 * Draft assessments (teacher/assign-draft.js; Colin, Nov 16 2026). Demo
 * Mode, Science 8: Save as Draft in the New Assessment form makes a Draft
 * card with Assign; the gradebook doesn't show it; Assign gives it to the
 * class and the gradebook shows it.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

test('Save as Draft keeps a new assessment out of the gradebook until Assign', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).length > 0;
  });

  await page.goto('/assignments');
  await page.locator('.tb-action-btn[data-action="showNewForm"]').first().click();
  const form = page.locator('#new-assess-form');
  await expect(form.locator('.af-actions button')).toHaveText([
    'Cancel',
    'Save as Draft',
    'Create and Add Another',
    'Create Assessment',
  ]);
  await form.locator('#af-title').fill('Organ Systems Plan');
  await form.locator('#af-category').selectOption({ index: 1 });
  await form.locator('[data-action="saveNewAssess"][data-draft="1"]').click();

  const draft = page.locator('.assess-card.is-draft', { hasText: 'Organ Systems Plan' });
  await expect(draft).toHaveCount(1);
  await expect(draft.locator('.assess-title')).toHaveText('Organ Systems Plan');
  await expect(draft.locator('.draft-badge')).toHaveText('Draft');
  await expect(draft.locator('.draft-body')).toContainText('Students can’t see this yet');

  await page.goto('/gradebook');
  await expect(page.locator('#main')).toContainText('Cell Structure Quiz');
  await expect(page.locator('#main')).not.toContainText('Organ Systems Plan');

  await page.goto('/assignments');
  await draft.locator('.draft-assign-btn').click();
  await expect(draft).toHaveCount(0);
  const assigned = await page.evaluate(
    () => getAssessments(getActiveCourse()).find(a => a.title === 'Organ Systems Plan').isDraft,
  );
  expect(assigned).toBeFalsy();

  await page.goto('/gradebook');
  await expect(page.locator('#main')).toContainText('Organ Systems Plan');
  expect(errors).toEqual([]);
});
