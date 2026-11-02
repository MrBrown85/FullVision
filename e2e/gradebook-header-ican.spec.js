import { test, expect } from '@playwright/test';

/* The Gradebook's Competencies headers (Nov 2 mockup, batch 2): the tip on
   a competency's header lists its I Can statements, and the header takes
   focus (Tab) and taps as well as hover. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.locator('button', { hasText: 'Competencies' }).first().click();
  const head = page.locator('.gb-grid-tag-header', { hasText: /^PI$/ }).first();
  await head.waitFor();
  const icans = await page.evaluate(() => getTagById('sci8', 'PI').i_can_statements);
  return { head, icans };
}

test('hovering a competency header lists its I Can statements', async ({ page }) => {
  const { head, icans } = await open(page);
  await head.hover();
  const tip = page.locator('#gb-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip.locator('.gb-code-tip-icans li')).toHaveText(icans);
});

test('a header takes focus and shows its tip, and Escape hides it', async ({ page }) => {
  const { head, icans } = await open(page);
  await head.focus();
  const tip = page.locator('#gb-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(icans[0]);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });
  test('a tap shows the tip and a second tap hides it', async ({ page }) => {
    const { head, icans } = await open(page);
    await head.tap();
    const tip = page.locator('#gb-tooltip');
    await expect(tip).toContainText(icans[0]);
    await head.tap();
    await expect(tip).toBeHidden();
  });
});
