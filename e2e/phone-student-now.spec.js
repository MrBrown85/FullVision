import { test, expect } from '@playwright/test';

/* The phone's student detail (Nov 2 mockup, batch 2): an opened competency
   starts with where the student is now and the next step, as the desktop
   student page does. Demo Mode, Cece in Science 8, on Data Patterns (PA4)
   from the curriculum bank. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('an opened competency shows Now and Next', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/teacher-mobile/, { timeout: 20000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => CompetencyWording.loadBank());
  await page.evaluate(() => document.querySelector('[data-action="m-student-detail"]').click());
  const card = page.locator('.m-section-card[data-sec="PA4"]');
  await card.waitFor();
  await card.click();
  const now = card.locator('.m-sec-now');
  await expect(now).toBeVisible();
  await expect(now).toContainText('Now · Proficient: Consistently finds patterns and connections in data.');
  await expect(now).toContainText('Next step:');
});
