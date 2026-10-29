/**
 * Pickers in the observation sheet keep their header (Back, title, Done)
 * on screen while the list scrolls. The Assessment and Competency pickers
 * have a search field like the Students picker, and each assessment row
 * shows its date. Runs in Demo Mode.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

// The picker's Back is on screen and nothing covers it.
async function expectHeaderShowing(page) {
  const ok = await page.evaluate(() => {
    const back = document.querySelector('#m-obs-edit-picker [data-action="m-obs-picker-back"]');
    const r = back.getBoundingClientRect();
    return (
      r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === back
    );
  });
  expect(ok).toBe(true);
}

const shownRows = page => page.locator('#m-obs-edit-picker .m-pick-row:visible');

test('the Assessment picker keeps its header, searches, and dates its rows', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await page.locator('[data-action="m-obs-new"]').click();

  await page.locator('#m-obs-asm-row').click();
  const picker = page.locator('#m-obs-edit-picker');
  await expect(picker.locator('.m-edit-title')).toHaveText('Assessment');
  await expectHeaderShowing(page);
  await expect(
    picker.locator('.m-pick-row', { hasText: 'Mid-Year Lab Skills Check' }).locator('.m-pick-meta'),
  ).toHaveText(/^[A-Z][a-z]{2} \d{1,2}$/);

  await picker.locator('.m-pick-search').fill('Mid');
  await expect(shownRows(page).filter({ hasText: 'Mid-Year Lab Skills Check' })).toHaveCount(1);
  await expect(shownRows(page).filter({ hasText: 'Data Reading Quiz' })).toHaveCount(0);

  await picker.locator('.m-pick-row', { hasText: 'Mid-Year Lab Skills Check' }).click();
  await expect(page.locator('#m-obs-asm-row')).toContainText('Mid-Year Lab Skills Check');

  // The Competency picker: header stays when the list scrolls; search hides empty sections.
  await page.locator('#m-obs-comp-row').click();
  await page.evaluate(() => (document.querySelector('#m-sheet-container .m-sheet-content').scrollTop = 400));
  await expectHeaderShowing(page);
  await picker.locator('.m-pick-search').fill('plan');
  await expect(shownRows(page).filter({ hasText: 'Plan Investigations' })).toHaveCount(1);
  await expect(picker.locator('.m-pick-section:visible')).toHaveCount(1);
});
