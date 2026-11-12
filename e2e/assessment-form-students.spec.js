import { test, expect } from '@playwright/test';

/* The assessment form's Students row, in the top box since Nov 11 (board
   "Assessment Form" 2a to 3c): a button says who the work is for and opens
   Choose Students, a chip per student that changes in place; pairs and
   groups show their builder under it. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('the top box says All 27 Students, with the list closed', async ({ page }) => {
  await openForm(page);
  const n = await page.evaluate(() => getStudents('sci8').length);
  await expect(page.locator('.af-card-what #af-students-summary')).toHaveText('All ' + n + ' Students');
  await expect(page.locator('.af-card-students')).toHaveCount(0);
  await expect(page.locator('.collab-choose-grid')).toHaveCount(0);
  await expect(page.locator('#af-choose-students')).toHaveAttribute('aria-expanded', 'false');
});

test('Choose Students opens the list; three chosen are counted and saved', async ({ page }) => {
  await openForm(page);
  const n = await page.evaluate(() => getStudents('sci8').length);
  await page.locator('#af-choose-students').click();
  await expect(page.locator('#af-choose-students')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('[data-action="collabCheckNone"]').click();
  const chips = page.locator('.collab-choose-chip');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');
  // A click changes that one chip: the list is not drawn again.
  const first = await chips.first().elementHandle();
  for (const i of [0, 1, 2]) await chips.nth(i).click();
  expect(await first.evaluate(el => el.isConnected && el.getAttribute('aria-pressed'))).toBe('true');
  await expect(page.locator('#collab-choose-count')).toHaveText('3 of ' + n + ' chosen');
  await expect(page.locator('#af-students-summary')).toHaveText('3 Students');
  await page.locator('.collab-panel [data-action="toggleChooseStudents"]').click();
  await expect(page.locator('.collab-choose-grid')).toHaveCount(0);
  await expect(page.locator('#af-students-summary')).toHaveText('3 Students');
  // Who they are shows under the button.
  await expect(page.locator('#af-students-names')).toBeVisible();
  await page.fill('#af-title', 'Three Students Only');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Three Students Only'));
  expect(saved.excludedStudents.length).toBe(n - 3);
});

test('Group shows the builder and counts groups in good English', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-collab-btn[data-collab="group"]').click();
  await expect(page.locator('#af-choose-students')).toBeVisible();
  await expect(page.locator('.collab-stepper')).toBeVisible();
  await expect(page.locator('.collab-stepper-info')).not.toContainText(/\b1 groups\b/);
  // 27 students in 5 groups: 3 groups of 5, 2 of 6; in 2 groups: 1 group of 13, 1 of 14.
  for (let i = 0; i < 2; i++) await page.locator('[data-action="collabSetGroupCount"][data-delta="-1"]').click();
  await expect(page.locator('.collab-stepper-info')).not.toContainText(/\b1 groups\b/);
});

test('groups are made only from the students chosen, and a drag says where they went with Undo', async ({ page }) => {
  await openForm(page);
  const n = await page.evaluate(() => getStudents('sci8').length);
  await page.locator('#af-choose-students').click();
  await page.locator('.collab-choose-chip').first().click();
  await page.locator('.collab-panel [data-action="toggleChooseStudents"]').click();
  await page.locator('.af-collab-btn[data-collab="group"]').click();
  await page.locator('[data-action="collabRandomGroups"]').click();
  await expect(page.locator('.collab-group-member')).toHaveCount(n - 1);
  // Drag the first student of Group 1 into Group 2.
  const member = page.locator('[data-collab-drop="0"] .collab-group-member').first();
  const name = (await member.textContent()).trim();
  await member.dragTo(page.locator('[data-collab-drop="1"]'));
  await expect(page.locator('.collab-moved')).toContainText('moved to Group 2.');
  await expect(page.locator('[data-collab-drop="1"]')).toContainText(name.slice(2));
  await page.locator('[data-action="collabUndoMove"]').click();
  await expect(page.locator('.collab-moved')).toHaveCount(0);
  await expect(page.locator('[data-collab-drop="0"]')).toContainText(name.slice(2));
});
