import { test, expect } from '@playwright/test';

// A module closed on Assignments stays closed after a visit to another page
// and back (Colin, 2026-10-24).
test('a closed module stays closed after leaving Assignments', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // Two modules, each holding one assessment.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const now = new Date().toISOString();
    saveModules(cid, [
      { id: 'mod-a', name: 'Unit A', color: '#3b82f6', sortOrder: 0, created: now },
      { id: 'mod-b', name: 'Unit B', color: '#059669', sortOrder: 1, created: now },
    ]);
    const list = getAssessments(cid);
    list[0].moduleId = 'mod-a';
    list[1].moduleId = 'mod-b';
    saveAssessments(cid, list);
  });
  await page.evaluate(r => window.Router.navigate(r), '/assignments');
  const id = 'mod-a';
  const folder = page.locator('.mod-folder[data-module-id="' + id + '"]');
  await expect(folder).toHaveClass(/\bopen\b/);
  await folder.locator('[data-action="toggleModuleFolder"]').first().click();
  await expect(folder).not.toHaveClass(/\bopen\b/);

  await page.evaluate(r => window.Router.navigate(r), '/gradebook');
  await expect(page.locator('.mod-folder')).toHaveCount(0);
  await page.evaluate(r => window.Router.navigate(r), '/assignments');
  await expect(folder).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('.mod-folder[data-module-id="mod-b"]')).toHaveClass(/\bopen\b/);

  await folder.locator('[data-action="toggleModuleFolder"]').first().click();
  await page.reload();
  await expect(folder).toHaveClass(/\bopen\b/);
});
