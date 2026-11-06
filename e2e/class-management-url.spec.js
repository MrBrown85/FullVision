import { test, expect } from '@playwright/test';

/* Class Settings keeps its own address (/dashboard?manage=…), so a reload
   or Back returns to the tab, class or wizard it was on. Demo Mode. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

test('A reload keeps Class Settings open on its tab', async ({ page }) => {
  await enterDemo(page);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Grading/ }).click();
  await expect(page).toHaveURL(/\/dashboard\?manage=grading$/);
  await expect(page).toHaveTitle('FullVision — Class Settings');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Grading/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveTitle('FullVision — Class Settings');
  // Leaving by the breadcrumb puts the dashboard's own address back.
  await page.locator('.cm-toolbar [data-action="closeClassManager"]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page).toHaveTitle('FullVision — Dashboard');
});

test('A reload keeps the New Class wizard open', async ({ page }) => {
  await enterDemo(page);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.locator('[data-action="cmStartCreate"]').first().click();
  await expect(page).toHaveURL(/\/dashboard\?manage=new$/);
  await page.reload();
  await expect(page.locator('.cw-steps')).toBeVisible();
});
