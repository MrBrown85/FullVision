/**
 * The top bar is drawn once: moving between pages lights the new tab in
 * place, so the sidebar button, the sync dot, Help and the account button
 * are the same elements throughout and never flash (Colin, Nov 26, 2026).
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

test('the bar stays as it is from page to page; only the lit tab changes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/help/index.json', r => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.tb-seg-active').waitFor();
  // Mark each part of the bar, and count anything put into or taken out of it.
  await page.evaluate(() => {
    const parts = ['#app-dock', '[data-action="toggleSidebar"]', '#sync-indicator-dot', '.tb-help-btn', '.tb-user-btn'];
    window.__parts = parts.map(q => document.querySelector(q));
    window.__changes = 0;
    new MutationObserver(list =>
      list.forEach(m => {
        if (m.type === 'childList' && !m.target.closest('.tb-seg')) window.__changes++;
      }),
    ).observe(document.getElementById('dock-mount'), { childList: true, subtree: true });
  });
  const same = () =>
    page.evaluate(() =>
      ['#app-dock', '[data-action="toggleSidebar"]', '#sync-indicator-dot', '.tb-help-btn', '.tb-user-btn'].every(
        (q, i) => document.querySelector(q) === window.__parts[i],
      ),
    );

  for (const [href, name] of [
    ['/observations', 'Observations'],
    ['/gradebook', 'Gradebook'],
    ['/reports', 'Reporting'],
    ['/dashboard', 'Dashboard'],
  ]) {
    await page.click('.tb-seg-link[data-href="' + href + '"]');
    await expect(page.locator('.tb-seg-active')).toHaveText(name);
    await expect(page.locator('.tb-seg-link[aria-current="page"]')).toHaveText(name);
    await expect(page.locator('.tb-seg-link[aria-current="page"]')).toHaveCount(1);
    expect(await same()).toBe(true);
  }
  // Back in the browser's history lights the tab in place too.
  await page.goBack();
  await expect(page.locator('.tb-seg-active')).toHaveText('Reporting');
  expect(await same()).toBe(true);
  // Help, opened and then a page change: its button keeps its state.
  await page.click('.tb-help-btn');
  await expect(page.locator('.tb-help-btn')).toHaveAttribute('aria-expanded', 'true');
  await page.click('.tb-seg-link[data-href="/assignments"]');
  await expect(page.locator('.tb-seg-active')).toHaveText('Assignments');
  await expect(page.locator('.tb-help-btn')).toHaveAttribute('aria-expanded', 'true');
  expect(await same()).toBe(true);
  expect(await page.evaluate(() => window.__changes)).toBe(0);
  expect(errors).toEqual([]);
});
