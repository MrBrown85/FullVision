/**
 * The phone's student screen has the desktop student page's tabs (Goals
 * is in the Learner Profile; Evidence is the phone's Observations).
 * A tap switches the panel without leaving the screen, and the tab is
 * remembered for the next student.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('the tabs; a tap switches the panel and is remembered', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-card-stack-item[data-depth="0"] [data-action="m-student-detail"]').click();
  const screen = page.locator('#m-screen-student-detail');
  await expect(screen.locator('.m-st-tab .m-st-tab-label')).toHaveText([
    'Competencies',
    'Assessments',
    'Evidence',
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

// Step 4 group 3 #74: the open tab is in view when the screen opens, even
// when it is the last one in a strip that scrolls.
test('the open tab is scrolled into view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.evaluate(() => localStorage.setItem('gb-student-tab', 'profile'));
  await page.locator('.m-card-stack-item[data-depth="0"] [data-action="m-student-detail"]').click();
  const tab = page.locator('#m-screen-student-detail .m-st-tab[data-tab="profile"]');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const inView = await tab.evaluate(el => {
    const strip = el.closest('.m-st-tabs').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.left >= strip.left - 1 && r.right <= strip.right + 1;
  });
  expect(inView).toBe(true);
});
