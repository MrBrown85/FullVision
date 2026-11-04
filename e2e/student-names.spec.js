import { test, expect } from '@playwright/test';

/* One name on screen for a student: the preferred name, then the last
   name. Demo Mode's Jasper Gill goes by Jas, so every view says "Jas Gill",
   and the sidebar search still finds him by his legal first name. */
test.use({ viewport: { width: 1440, height: 900 } });

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

test('the gradebook, sidebar, student page and tab title all say Jas Gill', async ({ page }) => {
  await demo(page);
  await page.evaluate(r => window.Router.navigate(r), '/gradebook?course=sci8');
  await expect(page.getByRole('link', { name: 'Jas Gill' }).first()).toBeVisible();
  await expect(page.locator('.gb-grid-rowhead', { hasText: 'Jasper' })).toHaveCount(0);

  await page.evaluate(r => window.Router.navigate(r), '/student?id=st7&course=sci8');
  await expect(page).toHaveTitle(/Jas Gill/);
  const row = page.locator('#gb-sidebar .student-row[data-sid="st7"]');
  await expect(row.locator('.student-row-name')).toHaveText('Jas Gill');
  await expect(row.locator('.student-avatar')).toHaveText('JG');
  await expect(page.locator('main')).not.toContainText('Jasper');

  await page.locator('#gb-roster-search').fill('jasper');
  await expect(row).toBeVisible();
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st1"]')).toBeHidden();
});

test('the phone says Jas Gill', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();
  // The All Students sheet lists every student by the same name.
  await page.getByRole('button', { name: 'All Students' }).click();
  const cell = page.locator('.m-cell[data-sid="st7"]').first();
  await expect(cell).toContainText('Jas Gill');
  await expect(cell.locator('.m-cell-avatar')).toHaveText('JG');
});
