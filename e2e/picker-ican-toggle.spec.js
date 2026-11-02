import { test, expect } from '@playwright/test';

/* The assessment form's competency picker (Nov 2 mockup, batch 2): each
   competency has an "I Can" toggle beside it that shows its statements
   under the row, without ticking the competency. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

test('the I Can toggle shows the statements without ticking the competency', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  const icans = await page.evaluate(() => getTagById('sci8', 'IP').i_can_statements);
  const row = page.locator('.af-tag-row', { has: page.locator('.af-tag-cb[value="IP"]') });
  await row.scrollIntoViewIfNeeded();
  const toggle = row.locator('.af-tag-ican-toggle');
  await expect(toggle).toHaveText('▸' + icans.length + ' I Can');
  const list = page.locator('[id^="af-icans-IP-"]');
  await expect(list).toBeHidden();
  await toggle.click();
  await expect(list).toBeVisible();
  await expect(list.locator('li')).toHaveText(icans);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.af-tag-cb')).not.toBeChecked();
  await toggle.click();
  await expect(list).toBeHidden();
  // The label still ticks the competency.
  await row.locator('.af-tag-name').click();
  await expect(row.locator('.af-tag-cb')).toBeChecked();
});
