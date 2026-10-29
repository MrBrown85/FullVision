/**
 * Every phone sheet dims the page behind it. A tap on the dim closes the
 * sheet, and nothing under the dim receives that tap. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('#m-loading')).toBeHidden();
}

async function tab(page, name) {
  await page.locator(`.m-tab-item[data-tab="${name}"]`).click();
}

// Opens a sheet, checks the dim covers the top of the screen, taps it, and
// checks the sheet closed with the same screens underneath.
async function expectDimCloses(page, open) {
  const screens = () => page.evaluate(() => [...document.querySelectorAll('#m-nav-stack > *')].map(e => e.id));
  const before = await screens();
  await open();
  const backdrop = page.locator('#m-sheet-backdrop');
  await expect(page.locator('#m-sheet-container .m-sheet.m-sheet-visible')).toBeVisible();
  await expect(backdrop).toBeVisible();
  await expect(backdrop).toHaveCSS('opacity', '1');
  const hit = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, 30)?.id);
  expect(hit).toBe('m-sheet-backdrop');
  await page.mouse.click(187, 30);
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
  await expect(backdrop).toBeHidden();
  expect(await screens()).toEqual(before);
}

test('every sheet dims the page and a tap on the dim closes it', async ({ page }) => {
  await enterDemo(page);

  await tab(page, 'students');
  await page.locator('[data-action="m-set-view"][data-mode="cards"]').click();
  await expectDimCloses(page, () => page.locator('[data-action="m-sort"]').click());
  await expectDimCloses(page, () => page.locator('[data-action="m-settings"]').first().click());
  // The grade overlaps the customize control on the card (a Phase 3 fix), so dispatch the click.
  await expectDimCloses(page, () =>
    page.locator('[data-action="m-open-widget-editor"]').first().dispatchEvent('click'),
  );

  await tab(page, 'observe');
  await expectDimCloses(page, () => page.locator('.m-quick-avatar[data-action="m-obs-quick-menu"]').first().click());
  await expectDimCloses(page, () => page.locator('[data-action="m-obs-new"]').click());
  await expectDimCloses(page, () => page.locator('#m-obs-cards [data-action="m-obs-edit"]').first().click());
  await expectDimCloses(page, async () => {
    await page.locator('[data-action="m-obs-new"]').click();
    await page.locator('#m-sheet-container [data-action="m-obs-picker"]').first().click();
  });

  await tab(page, 'grade');
  await expectDimCloses(page, () => page.locator('[data-action="m-grade-filter-open"]').click());
});
