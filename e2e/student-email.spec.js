/**
 * The student page header's email (docs/plans/dashboard-cards-plan.md, D):
 * the last item on the line under the name, a button that copies the address
 * and says Copied for a moment. Demo Mode, Cece in Science 8.
 */
import { test, expect } from '@playwright/test';

test('the header copies the email address and says Copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid);
  const btn = page.locator('.student-header-top .stu-email-copy');
  await expect(btn).toHaveAccessibleName('Copy cece.adeyemi@students.example.ca');
  await expect(btn).toHaveAttribute('title', 'Copy email address');
  await expect(btn.locator('.stu-email-copied')).toBeHidden();
  await btn.hover();
  await btn.click();
  await expect(btn.locator('.stu-email-copied')).toBeVisible();
  await expect(btn.locator('.stu-email-copied')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('cece.adeyemi@students.example.ca');
  // Back to the icon after 1.5 s.
  await expect(btn.locator('.stu-email-copied')).toBeHidden({ timeout: 3000 });
  await expect(btn.locator('.stu-email-icon')).toBeVisible();
});
