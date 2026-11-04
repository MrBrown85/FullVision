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
  await page.locator('.m-card-stack-item[data-depth="0"] [data-action="m-student-detail"]').click();
  const screen = page.locator('#m-screen-student-detail');
  await expect(screen.locator('.m-hero, .m-nav-bar').first()).toContainText('Cece');

  // Goals are part of the Learner Profile, as on the desktop student page.
  await screen.locator('.m-st-tab[data-tab="profile"]').click();
  const goals = screen.locator('#m-st-panel-profile');
  await expect(goals).toContainText('Cece’s Own Goals');
  await expect(goals).toContainText('Hand in labs on time');
  await expect(goals).toContainText('Working On It');
  await expect(goals).toContainText('Core Competency Goal · Personal Awareness & Responsibility');

  const words = screen.locator('#m-st-panel-profile');
  await expect(words).toContainText('In Cece’s Words');
  await expect(words).toContainText('About Me');
  await expect(words).toContainText('I ask a lot of questions');
  await expect(words).toContainText('Personal Awareness & Responsibility: Growing');
  await expect(words).toContainText('Learning Dispositions');

  // The chosen tab stays in view in the strip.
  const inView = await screen.locator('.m-st-tab[data-tab="profile"]').evaluate(el => {
    const strip = el.closest('.m-st-tabs').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.left >= strip.left - 1 && r.right <= strip.right + 1;
  });
  expect(inView).toBe(true);
});
