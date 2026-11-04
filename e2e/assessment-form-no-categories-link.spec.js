import { test, expect } from '@playwright/test';

/* Nov 3 sweep (step 4 group 3 #24): a class with no categories said only
   "No grading categories configured for this course yet.", with no way to
   add them. Add Categories opens Class Management's Grading tab, asking
   first when the form has something typed. Demo Mode, Science 8 with its
   categories taken away. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    saveCategories('sci8', []);
    window.Router.navigate('/assignments?course=sci8');
  });
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('Add Categories opens the Grading tab', async ({ page }) => {
  await openForm(page);
  await expect(page.locator('.af-rubric-info')).toContainText('This class has no grading categories yet.');
  await page.locator('[data-action="afAddCategories"]').click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator('[role="tab"][aria-selected="true"]', { hasText: 'Grading' })).toBeVisible();
});

test('with a title typed, Add Categories asks before leaving', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Lab Quiz 1');
  await page.locator('[data-action="afAddCategories"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Discard This Assessment?');
  await page.locator('.af-dialog-card button', { hasText: 'Keep Editing' }).click();
  await expect(page).toHaveURL(/\/assignments/);
  await expect(page.locator('#af-title')).toHaveValue('Lab Quiz 1');
});
