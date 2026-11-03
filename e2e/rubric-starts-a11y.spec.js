import { test, expect } from '@playwright/test';

/* The rubric starts as a tab list, narrow and dark (rubric starts PR 7,
   2026-11-03): role tablist/tab/tabpanel with one Tab stop, ← → Home End
   between the starts that can open, Enter opens; under 900px one row of
   short names that scrolls sideways; the starts' and cards' greys follow
   dark mode. Demo Mode, Science 8 (no other classes, so Copy is off). */

// Demo Mode opens on a desktop width (a phone goes to the phone app); the
// window is narrowed once the teacher app is up.
async function openForm(page, width) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  if (width) await page.setViewportSize({ width: width, height: 900 });
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.fill('#af-title', 'Density Lab');
}
const tab = (page, name) => page.locator('#af-start-tab-' + name);

test('a tab list with one Tab stop; the open card is its panel', async ({ page }) => {
  await openForm(page);
  await expect(page.locator('.af-rubric-starts')).toHaveAttribute('role', 'tablist');
  await expect(page.locator('.af-rubric-starts [role="tab"]')).toHaveCount(3);
  await expect(tab(page, 'blank')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'choose')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.af-rubric-starts [tabindex="0"]')).toHaveCount(1);
  await expect(tab(page, 'blank')).toHaveAttribute('tabindex', '0');
  const panel = page.locator('#af-start-panel');
  await expect(panel).toHaveAttribute('role', 'tabpanel');
  await expect(panel).toHaveAttribute('aria-labelledby', 'af-start-tab-blank');
  await expect(tab(page, 'blank')).toHaveAttribute('aria-controls', 'af-start-panel');
});

test('← → Home End move between the starts; Enter opens one', async ({ page }) => {
  await openForm(page);
  await tab(page, 'blank').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'choose')).toBeFocused();
  await expect(tab(page, 'choose')).toHaveAttribute('tabindex', '0');
  await expect(tab(page, 'blank')).toHaveAttribute('tabindex', '-1');
  // Copy is off in a one-class account, so it is skipped.
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'blank')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab(page, 'choose')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, 'blank')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'choose')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tab(page, 'choose')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#af-start-panel')).toHaveAttribute('aria-labelledby', 'af-start-tab-choose');
});

for (const width of [768, 375]) {
  test(
    'under 900px: one row of short names that scrolls, nothing wider than the page at ' + width,
    async ({ page }, info) => {
      await openForm(page, width);
      const row = page.locator('.af-rubric-starts');
      const tops = await row.locator('[role="tab"]').evaluateAll(els => els.map(e => e.getBoundingClientRect().top));
      expect(new Set(tops.map(Math.round)).size).toBe(1);
      expect(await tab(page, 'blank').evaluate(e => e.innerText.trim())).toBe('Blank');
      await expect(tab(page, 'choose').locator('.af-start-name')).toBeHidden();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      ).toBe(true);
      await page.locator('#af-rubric-wrap').screenshot({ path: info.outputPath('starts-' + width + '.png') });
    },
  );
}

test('the starts and cards take dark greys in dark mode, the same greys in light', async ({ page }) => {
  await openForm(page);
  const bg = sel =>
    page
      .locator(sel)
      .first()
      .evaluate(e => getComputedStyle(e).backgroundColor);
  expect(await bg('#af-start-panel .af-rubric-card-head')).toBe('rgb(242, 242, 244)');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg('#af-start-panel .af-rubric-card-head')).toBe('rgb(58, 58, 60)');
  expect(await bg('#af-start-panel .af-tag-rubric-note')).toBe('rgb(58, 58, 60)');
  expect(await bg('.af-rubric-start.is-open')).toBe('rgb(58, 58, 60)');
  expect(await bg('.af-rubric-start:not(.is-open)')).toBe('rgb(36, 36, 38)');
});
