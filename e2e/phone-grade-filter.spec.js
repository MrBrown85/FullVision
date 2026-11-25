import { test, expect } from '@playwright/test';

/* The phone's Grade filter (teacher-mobile/tab-grade.js
   _renderLiveFilterSheet). Each section is a short list, one row a choice
   with a check on what is picked; it was a cloud of outlined capsules
   wrapping at uneven widths (Colin, 2026-11-25: "janky looking filter").
   A picked Module showed no check (the sheet only knew Category held a
   list), and Done scrolled away on a long sheet. Demo Mode's Science 8. */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openFilter(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-filter-open"]').click();
  const sheet = page.locator('#m-sheet-container .m-live-filter');
  await expect(sheet).toBeVisible();
  return { sheet, errors };
}

test('each section is a list of rows; a tap checks a row, and Done stays in reach', async ({ page }) => {
  const { sheet, errors } = await openFilter(page);
  const group = name => sheet.getByRole('group', { name });
  await expect(group('Status').locator('.m-filter-row')).toHaveCount(2);
  await expect(group('Module').locator('.m-filter-row').first()).toBeVisible();

  // Every row is a full-width line of the same height, one under the other.
  const boxes = await sheet.locator('.m-filter-row').evaluateAll(rows =>
    rows.map(r => {
      const b = r.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    }),
  );
  expect(new Set(boxes.map(b => b.w)).size).toBe(1);
  boxes.forEach(b => expect(b.h).toBeGreaterThanOrEqual(44));

  // Date is one at a time: a second tap lets go.
  const week = group('Date').getByRole('button', { name: 'This Week' });
  await week.click();
  await expect(week).toHaveAttribute('aria-pressed', 'true');
  await expect(week).toHaveClass(/m-filter-active/);
  await week.click();
  await expect(week).toHaveAttribute('aria-pressed', 'false');
  await expect(week).not.toHaveClass(/m-filter-active/);

  // A Module, like a Category, shows its check.
  const mod = group('Module').locator('.m-filter-row').first();
  await mod.scrollIntoViewIfNeeded();
  await mod.click();
  await expect(mod).toHaveAttribute('aria-pressed', 'true');
  await expect(mod).toHaveClass(/m-filter-active/);
  await expect(page.locator('.m-grade-filter-badge')).toHaveText('1');

  // Scrolled to the foot, Done is still on screen and closes the sheet.
  const done = sheet.locator('[data-action="m-grade-filter-done"]');
  await expect(done).toBeInViewport();
  await done.click();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});
