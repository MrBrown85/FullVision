/**
 * The phone student page shows what the student answered in questionnaires
 * (Nov 3 sweep, step 4): their own goals, About Me and their reflections
 * on the Learner Profile. Demo Mode, Cece in Science 8.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

test("Cece's own goals and answers show on her phone profile", async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  const screen = page.locator('#m-screen-student-detail');
  await expect(screen.locator('.m-sp-name')).toContainText('Cece');

  // Her goal and check-in, About Me, and her reflections, first on the profile.
  const goal = screen.locator('.m-sp-card', { has: page.locator('h2', { hasText: 'Cece’s Goal' }) });
  await expect(goal).toContainText('Hand in labs on time');
  await expect(goal).toContainText('Working On It');
  await expect(goal).toContainText('Core Competency: Personal Awareness & Responsibility');
  const about = screen.locator('.m-sp-card', { has: page.locator('h2', { hasText: 'About Me' }) });
  await expect(about).toContainText('I ask a lot of questions');
  const refl = screen.locator('.m-sp-card', { has: page.locator('h2', { hasText: 'Reflections' }) });
  await refl.locator('summary').first().click();
  await expect(refl.locator('details[open]').first()).toBeVisible();
  await expect(screen).toContainText('Personal Awareness & Responsibility: Growing');
});
