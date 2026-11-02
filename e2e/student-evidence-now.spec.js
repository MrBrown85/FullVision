import { test, expect } from '@playwright/test';

/* The student page's evidence drawer (Nov 2 mockup): opening a competency
   shows where the student is now, the level's descriptor, and the next step.
   Demo Mode, Cece in Science 8, with Identify Patterns given a curriculum
   bank id. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, letter) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(l => {
    getTagById('sci8', 'IP').bank_id = 'bc.sci8.cc.14';
    if (l) COURSES.sci8.gradingSystem = 'letter';
    window.Router.navigate('/student?id=st1&course=sci8');
  }, letter);
  const row = page.locator('.stu-comp-row[data-tagid="IP"]');
  await row.waitFor();
  return row;
}

test('opening a competency shows Now and Next above its evidence', async ({ page }) => {
  const row = await open(page);
  const now = page.locator('.stu-comp-row[data-tagid="IP"] ~ .stu-comp-now');
  await expect(now).toBeHidden();
  await row.click();
  await expect(now).toBeVisible();
  await expect(now).toContainText('Now · Proficient: Consistently finds patterns and connections in data.');
  await expect(now).toContainText('Next step:');
  // Above Where It Shows and the evidence list.
  const n = await now.boundingBox();
  const where = await page.locator('.stu-comp-row[data-tagid="IP"] ~ .stu-comp-where').boundingBox();
  expect(n.y + n.height).toBeLessThanOrEqual(where.y);
});

test('a Letter class says Now without a proficiency word', async ({ page }) => {
  const row = await open(page, true);
  await row.click();
  const now = page.locator('.stu-comp-row[data-tagid="IP"] ~ .stu-comp-now');
  await expect(now).toContainText('Now: Consistently finds patterns');
  await expect(now).not.toContainText('Proficient:');
});
