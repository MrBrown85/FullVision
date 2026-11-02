import { test, expect } from '@playwright/test';

/* The student page's evidence drawer (Nov 2 mockup): opening a competency
   shows where the student is now, the level's descriptor, and the next step.
   Demo Mode, Cece in Science 8, on Data Patterns (PA4) from the curriculum
   bank. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, letter) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(l => {
    if (l) COURSES.sci8.gradingSystem = 'letter';
    window.Router.navigate('/student?id=st1&course=sci8');
  }, letter);
  const row = page.locator('.stu-comp-row[data-tagid="PA4"]');
  await row.waitFor();
  return row;
}

test('opening a competency shows Now and Next above its evidence', async ({ page }) => {
  const row = await open(page);
  const now = page.locator('.stu-comp-row[data-tagid="PA4"] ~ .stu-comp-now');
  await expect(now).toBeHidden();
  await row.click();
  await expect(now).toBeVisible();
  await expect(now).toContainText('Now · Proficient: Consistently finds patterns and connections in data.');
  await expect(now).toContainText('Next step:');
  // Above Where It Shows and the evidence list.
  const n = await now.boundingBox();
  const where = await page.locator('.stu-comp-row[data-tagid="PA4"] ~ .stu-comp-where').boundingBox();
  expect(n.y + n.height).toBeLessThanOrEqual(where.y);
});

test('a Letter class says Now without a proficiency word', async ({ page }) => {
  const row = await open(page, true);
  await row.click();
  const now = page.locator('.stu-comp-row[data-tagid="PA4"] ~ .stu-comp-now');
  await expect(now).toContainText('Now: Consistently finds patterns');
  await expect(now).not.toContainText('Proficient:');
});
