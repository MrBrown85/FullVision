/**
 * The grades beside the names are the year so far everywhere but the
 * Reports page, where they are the year to date as of the report's end
 * (Colin, 2026-11-03). The roster says so while a report is in view, and
 * a report's term never carries over to the other pages: they have no term
 * picker. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test('the roster names the report’s end on the Reports page and nothing elsewhere', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);

  await page.goto('/reports?course=sci8&tab=questionnaire');
  await expect(page.locator('#sb-term-note')).toBeVisible();
  const end = await page.evaluate(() => formatShortDate(getActiveTerm('sci8').endsOn));
  await expect(page.locator('#sb-term-note')).toHaveText('Grades to ' + end);

  for (const path of ['/gradebook?course=sci8', '/assignments?course=sci8', '/dashboard?course=sci8']) {
    await page.goto(path);
    await expect(page.locator('#main')).not.toBeEmpty();
    await expect(page.locator('[data-action="setTerm"]')).toHaveCount(0);
    await expect(page.locator('#sb-term-note')).toHaveCount(0);
    expect(await page.evaluate(() => getActiveTerm('sci8'))).toBeNull();
  }
});
