import { test, expect } from '@playwright/test';

/* The assessment form's Students card (redesign PR 5, 2026-11-02): one line
   says who the work is assigned to; Choose Students opens the list in the
   card; pairs and groups show their builder there. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('the card says All 27 students, with the list closed', async ({ page }) => {
  await openForm(page);
  const n = await page.evaluate(() => getStudents('sci8').length);
  await expect(page.locator('#af-students-summary')).toHaveText('All ' + n + ' students');
  await expect(page.locator('.collab-student-grid')).toHaveCount(0);
});

test('Choose Students opens the list; three chosen are counted and saved', async ({ page }) => {
  await openForm(page);
  const n = await page.evaluate(() => getStudents('sci8').length);
  await page.locator('#af-choose-students').click();
  await expect(page.locator('#af-choose-students')).toHaveText('Done');
  await page.locator('[data-action="collabCheckNone"]').click();
  const boxes = page.locator('.collab-student-item input');
  for (const i of [0, 1, 2]) await boxes.nth(i).check();
  await expect(page.locator('#af-students-summary')).toHaveText('3 of ' + n + ' students');
  await page.locator('#af-choose-students').click();
  await expect(page.locator('.collab-student-grid')).toHaveCount(0);
  await expect(page.locator('#af-students-summary')).toHaveText('3 of ' + n + ' students');
  await page.fill('#af-title', 'Three Students Only');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Three Students Only'));
  expect(saved.excludedStudents.length).toBe(n - 3);
});

test('Group shows the builder and counts groups in good English', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-collab-btn[data-collab="group"]').click();
  await expect(page.locator('#af-choose-students')).toBeHidden();
  await expect(page.locator('.collab-stepper')).toBeVisible();
  await expect(page.locator('.collab-stepper-info')).not.toContainText(/\b1 groups\b/);
  // 27 students in 5 groups: 3 groups of 5, 2 of 6; in 2 groups: 1 group of 13, 1 of 14.
  for (let i = 0; i < 2; i++) await page.locator('[data-action="collabSetGroupCount"][data-delta="-1"]').click();
  await expect(page.locator('.collab-stepper-info')).not.toContainText(/\b1 groups\b/);
});
