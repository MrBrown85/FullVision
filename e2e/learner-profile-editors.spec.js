import { test, expect } from '@playwright/test';

/* The Learner Profile's competency goal and reflection editors (Nov 3
   sweep, step 4), in Demo Mode on Liam in Science 8, who has no goals or
   reflections yet. */

test.use({ viewport: { width: 1440, height: 900 } });

async function openStudent(page, first) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(n => getStudents('sci8').find(s => s.firstName === n).id, first);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&course=sci8&tab=profile');
  await page.locator('.lp-layout').waitFor();
  return sid;
}

test('+ Reflection puts the cursor in the box, so typing lands there', async ({ page }) => {
  await openStudent(page, 'Liam');
  const row = page.locator('.gl-row').first();
  await row.getByRole('button', { name: '+ Reflection' }).click();
  await page.keyboard.type('I can plan a fair test now.');
  await expect(row.locator('textarea[id^="refl-input-"]')).toHaveValue('I can plan a fair test now.');
});
