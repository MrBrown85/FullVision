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

test('the headers are one Tab stop, and the arrow keys move between them', async ({ page }) => {
  const { head } = await open(page);
  const heads = page.locator('.gb-grid-tag-header');
  await expect(heads.locator('xpath=self::*[@tabindex="0"]')).toHaveCount(1);
  await heads.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(heads.nth(1)).toBeFocused();
  await expect(heads.nth(1)).toHaveAttribute('tabindex', '0');
  await expect(heads.first()).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#gb-tooltip')).toBeVisible();
  expect(await head.count()).toBe(1);
});

test('header keys stay on the headers: Home and End, the grid keeps its place and its line', async ({ page }) => {
  await open(page);
  const heads = page.locator('.gb-grid-tag-header');
  await expect(page.locator('.gb-grid-colheads-row2')).toHaveAttribute('role', 'group');
  // A selected score cell doesn't move when a header takes the arrows.
  const cell = page.locator('#gb-data td.gb-score').first();
  await cell.click();
  await expect(cell).toHaveClass(/gb-focus/);
  await heads.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(heads.nth(1)).toBeFocused();
  await expect(cell).toHaveClass(/gb-focus/);
  // End reaches the last header, and the headers stay over their columns.
  await page.keyboard.press('End');
  const last = heads.last();
  await expect(last).toBeFocused();
  const cells = page.locator('#gb-data tbody tr').first().locator('td.gb-score');
  const hb = await last.boundingBox();
  const cb = await cells.last().boundingBox();
  expect(Math.abs(hb.x - cb.x)).toBeLessThan(3);
  await page.keyboard.press('Home');
  await expect(heads.first()).toBeFocused();
});

test('the Tab stop stays on the header it moved to through a redraw', async ({ page }) => {
  await open(page);
  const heads = page.locator('.gb-grid-tag-header');
  await heads.first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await expect(page.locator('.gb-grid-tag-header').nth(2)).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.gb-grid-tag-header[tabindex="0"]')).toHaveCount(1);
});
