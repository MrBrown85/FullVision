import { test, expect } from '@playwright/test';

/* The Term Questionnaire's address follows the open student and class
   (Nov 3 sweep, step 4 group 3 #70), so a reload reopens the same place.
   Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

test('the address follows the student; a reload reopens that student', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor();
  await expect(page).toHaveURL(/\/reports\?course=sci8&tab=questionnaire&student=st1$/);
  await page.locator('#gb-sidebar .student-row[data-sid="st2"]').click();
  await expect(page.locator('.qn')).toHaveAttribute('data-sid', 'st2');
  await expect(page).toHaveURL(/student=st2$/);
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn')).not.toHaveAttribute('data-sid', 'st2');
  const next = await page.locator('.qn').getAttribute('data-sid');
  await expect(page).toHaveURL(new RegExp('student=' + next + '$'));
  await page.reload();
  await page.locator('#tq-narrative').waitFor();
  await expect(page.locator('.qn')).toHaveAttribute('data-sid', next);
});
