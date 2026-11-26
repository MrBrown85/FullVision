/**
 * The student list beside the page is drawn once: moving between pages keeps
 * its elements, its scroll and its search text, and only the selected row
 * and the grades change in place, so nothing flashes (Colin, Nov 26, 2026).
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

const tab = (page, href, name) =>
  page
    .click('.tb-seg-link[data-href="' + href + '"]')
    .then(() => expect(page.locator('.tb-seg-active')).toHaveText(name));

// How many of the marked elements are still in the list, and are the very ones.
const kept = page =>
  page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll(
        '#sidebar-mount *:not(.student-row-grades *):not(#sb-term-note, #sb-term-note *, .student-row-note, .student-row-note *, #gb-sidebar-extra, #gb-sidebar-extra *)',
      ),
    );
    return { total: els.length, marked: els.filter(e => e.__kept === 1).length };
  });

test('the student list is the same elements from page to page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/help/index.json', r => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('#gb-roster-list .student-row').first().waitFor();
  // Let the grade chips fill, then mark every element in the list.
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document
      .querySelectorAll(
        '#sidebar-mount *:not(.student-row-grades *):not(#sb-term-note, #sb-term-note *, .student-row-note, .student-row-note *, #gb-sidebar-extra, #gb-sidebar-extra *)',
      )
      .forEach(e => (e.__kept = 1));
    const list = document.getElementById('gb-roster-list');
    const css = document.createElement('style');
    css.textContent = '#gb-roster-list { max-height: 200px !important; }';
    document.head.appendChild(css);
    list.scrollTop = 60;
    window.__scroll = list.scrollTop;
  });
  const first = await kept(page);
  expect(first.marked).toBe(first.total);
  expect(await page.evaluate(() => window.__scroll)).toBeGreaterThan(0);

  const stillTheSame = async (noneSelected = true, scroll = true) => {
    await page.waitForTimeout(300);
    const k = await kept(page);
    expect(k.marked).toBe(k.total);
    expect(k.total).toBe(first.total);
    if (scroll) {
      expect(await page.evaluate(() => document.getElementById('gb-roster-list').scrollTop)).toBe(
        await page.evaluate(() => window.__scroll),
      );
    }
    await expect(page.locator('#sidebar-mount')).toBeVisible();
    // Reporting opens on a student of its own; the other pages select none.
    if (noneSelected) await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveCount(0);
  };

  // A search typed in stays, and still filters the list.
  await page.fill('#gb-roster-search', 'a');
  const shown = await page.locator('#gb-roster-list .student-row:visible').count();
  await page.evaluate(() => (window.__scroll = document.getElementById('gb-roster-list').scrollTop));

  for (const [href, name] of [
    ['/observations', 'Observations'],
    ['/reports', 'Reporting'],
    ['/dashboard', 'Dashboard'],
  ]) {
    await tab(page, href, name);
    // Reporting opens on a student of its own, and scrolls to it.
    await stillTheSame(href !== '/reports', href !== '/reports');
    await expect(page.locator('#gb-roster-search')).toHaveValue('a');
    expect(await page.locator('#gb-roster-list .student-row:visible').count()).toBe(shown);
  }

  // Gradebook has no class list; the next page shows the same one again.
  await tab(page, '/gradebook', 'Gradebook');
  await expect(page.locator('#sidebar-mount')).toBeHidden();
  // (A hidden list loses its scroll in the browser, so only the elements are checked.)
  await tab(page, '/observations', 'Observations');
  await stillTheSame(true, false);

  // Assignments draws its rows as buttons, so those rows are drawn again; the
  // list around them, its search and its scroll stay.
  await tab(page, '/assignments', 'Assignments');
  await page.waitForTimeout(300);
  const around = await page.evaluate(() =>
    ['#gb-sidebar', '#gb-roster-list', '#gb-roster-search', '#gb-course-select'].map(
      q => document.querySelector(q).__kept === 1,
    ),
  );
  expect(around).toEqual([true, true, true, true]);
  await expect(page.locator('#gb-roster-search')).toHaveValue('a');
  expect(await page.evaluate(() => document.getElementById('gb-roster-list').scrollTop)).toBe(
    await page.evaluate(() => window.__scroll),
  );

  // Picking a student shows that row selected; the next page clears it.
  await page.fill('#gb-roster-search', '');
  const row = page.locator('#gb-roster-list .student-row:visible').nth(1);
  const sid = await row.getAttribute('data-sid');
  await row.click();
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveCount(1);
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveAttribute('data-sid', sid);
  await tab(page, '/observations', 'Observations');
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('gb-sidebar').__kept)).toBe(1);

  expect(errors).toEqual([]);
});
