import { test, expect } from '@playwright/test';

// Per-student options on the Student Page (docs/plans/per-student-options-plan.md,
// Layout A), in Demo Mode: Class Settings › Student Page, a student's name
// opens their panel, Hide takes their overall grade off their page, the
// Exceptions count and the line under Show Overall Grade name them, Undo
// puts it back, and Preview as that student shows no overall grade.

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      var cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0;
    },
    null,
    { timeout: 15000 },
  );
  return page.evaluate(async () => {
    var cid = getActiveCourse();
    setStudentPageSwitch(cid, true);
    // The class shows the overall grade, so hiding it for one student is an exception.
    await setCourseFeedbackOptions(cid, { show_my_learning: true }, crypto.randomUUID());
    var s = sortStudents(getStudents(cid), 'lastName')[1];
    var first = (s.preferred || s.firstName || '').trim();
    return { cid: cid, sid: s.id, first: first, name: (first + ' ' + (s.lastName || '')).trim() };
  });
}

test('Students: hide one student’s overall grade, see the exception, Undo, and Preview', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const at = await demo(page);
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  const filters = card.getByRole('radiogroup', { name: 'Show' });
  await expect(card.getByRole('heading', { name: 'Students', exact: true })).toBeVisible();
  await expect(filters.getByRole('radio', { name: /^Grade Exceptions/ })).toHaveText('Grade Exceptions 0');
  await expect(page.locator('#sps-except')).toHaveCount(0);

  // The name is a button: it opens the student's panel.
  const name = card.getByRole('button', { name: at.name, exact: true });
  await name.click();
  const panel = page.getByRole('dialog', { name: at.name });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'What ' + at.first + ' Sees' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Preview as ' + at.first })).toBeVisible();
  const grade = panel.getByRole('radiogroup', { name: 'Overall Grade' });
  await expect(grade.getByRole('radio', { name: 'Use Class Setting (Shown)' })).toHaveAttribute('aria-checked', 'true');

  // Hide: the exception shows on the filter, the class's row and the student's row, with Undo.
  await grade.getByRole('radio', { name: 'Hide' }).click();
  await expect(grade.getByRole('radio', { name: 'Hide' })).toHaveAttribute('aria-checked', 'true');
  await expect(grade.getByRole('radio', { name: 'Hide' })).toBeFocused();
  await expect(panel.locator('#sps-grade-hint')).toHaveText(
    at.first + '’s overall grade stays off their page. Each piece’s result and feedback still show.',
  );
  await expect(filters.getByRole('radio', { name: /^Grade Exceptions/ })).toHaveText('Grade Exceptions 1');
  await expect(page.locator('#sps-except')).toHaveText('Hidden for ' + at.first);
  const row = card.locator('.sc-table tbody tr', { has: page.getByRole('button', { name: at.name, exact: true }) });
  await expect(row.locator('.sps-grade')).toHaveText('Hidden');
  const toast = page.locator('#undo-toast');
  await expect(toast).toContainText(at.first + '’s overall grade is hidden.');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(filters.getByRole('radio', { name: /^Grade Exceptions/ })).toHaveText('Grade Exceptions 0');
  await expect(page.locator('#sps-except')).toHaveCount(0);
  await expect(row.locator('.sps-grade')).toHaveText('Shown · Class');
  await expect(grade.getByRole('radio', { name: 'Use Class Setting (Shown)' })).toHaveAttribute('aria-checked', 'true');

  // Escape closes the panel, and the focus goes back to the name.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(name).toBeFocused();

  // The line under Show Overall Grade narrows the list to Exceptions.
  await name.click();
  await grade.getByRole('radio', { name: 'Hide' }).click();
  await page.keyboard.press('Escape');
  await page.locator('#sps-except').click();
  await expect(filters.getByRole('radio', { name: /^Grade Exceptions/ })).toHaveAttribute('aria-checked', 'true');
  await expect(card.locator('.sc-name')).toHaveText([at.name]);

  // Preview as the student: My Learning has no overall grade.
  await name.click();
  await panel.getByRole('button', { name: 'Preview as ' + at.first }).click();
  const overlay = page.locator('#preview-student');
  await expect(overlay).toBeVisible();
  await overlay.locator('.ps-screen .sp-tabs-bottom [data-act="tab"][data-tab="learning"]').click();
  await expect(overlay.locator('.ps-screen .sp-ml-work')).toBeVisible();
  await expect(overlay.locator('.ps-screen .sp-ml-period')).toHaveCount(0);
  expect(await page.evaluate(a => effectiveShowOverallGrade(a.cid, a.sid), at)).toBe(false);
  // Every other student still sees it.
  expect(
    await page.evaluate(
      a =>
        getStudents(a.cid)
          .filter(s => s.id !== a.sid)
          .every(s => effectiveShowOverallGrade(a.cid, s.id)),
      at,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('fv-sync-queue-v1'))).toBe(null);
  expect(errors).toEqual([]);
});
