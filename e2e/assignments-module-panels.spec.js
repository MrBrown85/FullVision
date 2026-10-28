import { test, expect } from '@playwright/test';

// A module is a panel tinted in its colour: header with grip, arrow,
// colour square, name, "N Assignments" and delete; an empty one says where
// to drop work. Ungrouped Assignments is a plain heading.
test('modules draw as tinted panels with their header', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const now = new Date().toISOString();
    saveModules(cid, [
      { id: 'mod-a', name: 'Unit A', color: '#1565c0', sortOrder: 0, created: now },
      { id: 'mod-empty', name: 'Unit B', color: '#2e7d32', sortOrder: 1, created: now },
    ]);
    const list = getAssessments(cid);
    list[0].moduleId = 'mod-a';
    list[1].moduleId = 'mod-a';
    saveAssessments(cid, list);
  });
  await page.evaluate(r => window.Router.navigate(r), '/assignments');

  const panel = page.locator('.mod-folder[data-module-id="mod-a"]');
  await expect(panel).toHaveAttribute('style', /--mod-color:\s*#1565c0/);
  await expect(panel.locator('.mod-folder-meta')).toHaveText('2 Assignments');
  await expect(panel.locator('.mod-folder-grip')).toBeVisible();
  await expect(panel.locator('.mod-folder-chevron svg')).toBeVisible();
  await expect(panel.locator('[data-action="deleteModule"]')).toHaveAttribute('aria-label', 'Delete module');
  await expect(panel.locator('.assess-card')).toHaveCount(2);

  const empty = page.locator('.mod-folder[data-module-id="mod-empty"]');
  await expect(empty.locator('.mod-folder-meta')).toHaveText('0 Assignments');
  await expect(empty.locator('.mod-folder-empty')).toHaveText('Drop assignments here or create a new one');

  const loose = page.locator('.mod-folder.no-module');
  await expect(loose.locator('.mod-folder-name')).toHaveText('Ungrouped Assignments');
  await expect(loose.locator('.mod-folder-meta')).toHaveText(/\d+ Assignments/);
  await expect(loose).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
