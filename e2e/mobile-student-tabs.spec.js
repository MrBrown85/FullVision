/**
 * The phone's student screen has the desktop student page's five tabs.
 * A tap switches the panel without leaving the screen, and the tab is
 * remembered for the next student.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('five tabs; a tap switches the panel and is remembered', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  // The list view, where each row opens the student.
  await page.locator('[data-action="m-view-list"], [data-mode="list"]').first().click();
  await page.locator('[data-action="m-student-detail"]').first().click();
  const screen = page.locator('#m-screen-student-detail');
  await expect(screen.locator('.m-st-tab .m-st-tab-label')).toHaveText([
    'Competencies',
    'Assessments',
    'Evidence',
    'Goals',
    'Learner Profile',
  ]);
  await expect(screen.locator('#m-st-panel-comps')).toBeVisible();
  await screen.locator('.m-st-tab[data-tab="assess"]').click();
  await expect(screen.locator('#m-st-panel-assess')).toBeVisible();
  await expect(screen.locator('#m-st-panel-comps')).toBeHidden();
  await expect(screen.locator('#m-st-panel-assess')).toContainText(/\d+\/\d+ · \d+%/);
  await expect(screen.locator('.m-st-tab[data-tab="assess"]')).toHaveAttribute('aria-selected', 'true');
  const saved = await page.evaluate(() => localStorage.getItem('gb-student-tab'));
  expect(saved).toBe('assess');
});
