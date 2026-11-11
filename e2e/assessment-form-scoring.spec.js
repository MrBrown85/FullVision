import { test, expect } from '@playwright/test';

/* The assessment form's Scoring card (redesign PR 2, 2026-11-02): Factor at
   the end of the mode row, a stepper that takes any value (2026-11-06); each mode shows only what it
   needs (Rubric for Proficiency, Max Points for Points); choices are kept
   across mode switches until save; Points saves no rubric. Demo Mode,
   Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

// Choose a Rubric opens the picker; '' uses no rubric; a number picks that row.
async function pickRubric(page, rid) {
  await page.locator('[data-action="chooseRubric"]').first().click();
  const bank = page.locator('#af-rubric-view');
  if (rid === '') return bank.locator('[data-action="startPickNone"]').click();
  if (typeof rid === 'object') {
    await bank
      .locator('.af-start-row')
      .nth(rid.index - 1)
      .click();
  } else {
    await bank.locator('.af-start-row[data-rid="' + rid + '"]').click();
  }
  await bank.locator('[data-action="startPickUse"]').click();
}

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('each mode shows only what it needs', async ({ page }) => {
  await openForm(page);
  await expect(page.locator('#af-rubric-wrap')).toBeVisible();
  await expect(page.locator('#af-maxpoints')).toBeHidden();
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await expect(page.locator('#af-rubric-wrap')).toBeHidden();
  await expect(page.locator('#af-maxpoints')).toBeVisible();
  await page.locator('.af-scoremode-btn[data-mode="complete"]').click();
  await expect(page.locator('#af-rubric-wrap')).toBeHidden();
  await expect(page.locator('#af-maxpoints')).toBeHidden();
  await expect(page.locator('#af-weight')).toBeVisible();
  // Factor sits on the mode row, in the Scoring card's head.
  await expect(page.locator('.af-card-scoring .af-card-head #af-weight')).toBeVisible();
});

test('a rubric survives a trip through Points, and Points saves none', async ({ page }) => {
  await openForm(page);
  const rid = await page.evaluate(() => getRubrics('sci8')[0].id);
  await pickRubric(page, rid);
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.locator('#af-maxpoints-picks [data-value="25"]').click();
  await page.locator('.af-scoremode-btn[data-mode="proficiency"]').click();
  await expect(page.locator('#af-rubric')).toHaveValue(rid);
  // Back to Points and save: no rubric goes with points work.
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await expect(page.locator('#af-maxpoints')).toHaveValue('25');
  await page.fill('#af-title', 'Points Keep No Rubric');
  await page.selectOption('#af-category', 'sci8-cat-checks');
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Points Keep No Rubric'));
  expect(saved.scoreMode).toBe('points');
  expect(saved.maxPoints).toBe(25);
  expect(saved.rubricId).toBeFalsy();
});

test('DIBELS shows its line and no Factor, in a class that offers it', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    COURSES.sci8.curriculumTags = ['SCI8', 'ELA8'];
    saveCourses(COURSES);
    window.Router.navigate('/assignments?course=sci8');
  });
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.locator('.af-scoremode-btn[data-mode="dibels"]').click();
  await expect(page.locator('#af-dibels-note')).toBeVisible();
  await expect(page.locator('#af-weight')).toBeHidden();
  await expect(page.locator('#af-rubric-wrap')).toBeHidden();
});
