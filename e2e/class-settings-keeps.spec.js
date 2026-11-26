import { test, expect } from '@playwright/test';

/* Class Settings is drawn over what is on screen, not from nothing. A tab
   click keeps the class list, the toolbar, the header and the tab strip as
   the same elements and draws only the tab body again. A switch flipped
   inside a tab keeps the whole tab body, with its scroll. Demo Mode. */

async function openSettings(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.locator('.cm-tab').first().waitFor();
  // The class's data and the level wording land after the first draw.
  await page.waitForFunction(() => !!document.querySelector('#cm-tabpanel'));
  await page.waitForTimeout(600);
}

/** Marks every element in the three regions. */
const mark = page =>
  page.evaluate(() => {
    for (const sel of ['#sidebar-mount', '#page-toolbar-mount', '#main']) {
      document.querySelectorAll(sel + ' *').forEach(el => (el.__kept = 1));
    }
  });

/** How many elements in `scope` lost their mark (are new). */
const fresh = (page, scope) =>
  page.evaluate(s => Array.from(document.querySelectorAll(s + ' *')).filter(el => !el.__kept).length, scope);

const total = (page, scope) => page.evaluate(s => document.querySelectorAll(s + ' *').length, scope);

test('a tab click keeps the class list, the toolbar and the header; only the tab body is drawn', async ({ page }) => {
  await openSettings(page);
  for (const tab of ['grading', 'students', 'terms', 'details']) {
    await mark(page);
    await page.locator('#cm-tab-' + tab).click();
    await expect(page.locator('#cm-tab-' + tab)).toHaveAttribute('aria-selected', 'true');
    expect(await fresh(page, '#sidebar-mount'), tab + ': class list').toBe(0);
    expect(await fresh(page, '#page-toolbar-mount'), tab + ': toolbar').toBe(0);
    for (const kept of ['.cm-layout', '.cm-detail', '.cm-detail-inner', '.cm-head', '.cm-tabs', '.cm-tab']) {
      const lost = await page.evaluate(
        s => Array.from(document.querySelectorAll('#main ' + s)).filter(el => !el.__kept).length,
        kept,
      );
      expect(lost, tab + ': ' + kept).toBe(0);
    }
    expect(await page.evaluate(() => !!document.querySelector('#cm-tabpanel.cm-tab-panel'))).toBe(true);
  }
});

test('flipping a switch inside a tab keeps the whole tab body and its scroll', async ({ page }) => {
  await openSettings(page);
  await page.locator('#cm-tab-grading').click();
  await page.locator('[data-action="cmSetCalcMethod"]').first().waitFor();
  await page.evaluate(() => {
    document.querySelector('.cm-detail').scrollTop = 120;
  });
  const top = await page.evaluate(() => document.querySelector('.cm-detail').scrollTop);
  await mark(page);
  const pick = page.locator('[data-action="cmSetCalcMethod"]:not(.active)').first();
  const want = await pick.getAttribute('data-value');
  await pick.click();
  // A change that moves grades asks first; the answer here is yes.
  if (await page.locator('#confirm-ok-btn').isVisible()) await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('[data-action="cmSetCalcMethod"][data-value="' + want + '"]')).toHaveClass(/active/);
  for (const scope of ['#sidebar-mount', '#page-toolbar-mount', '#main']) {
    expect(await total(page, scope)).toBeGreaterThan(5);
    expect(await fresh(page, scope), scope).toBe(0);
  }
  expect(await page.evaluate(() => document.querySelector('.cm-detail').scrollTop)).toBe(top);
});

test('picking a block on Details keeps the tab body', async ({ page }) => {
  await openSettings(page);
  await page.locator('#cm-tab-details').click();
  await mark(page);
  await page.locator('.cm-detail [data-action="cmBlockChip"]').nth(2).click();
  expect(await fresh(page, '#sidebar-mount')).toBe(0);
  expect(await fresh(page, '#page-toolbar-mount')).toBe(0);
  expect(await fresh(page, '#main')).toBeLessThan(4);
});

test("flipping Reflect's Off | On keeps the tab body", async ({ page }) => {
  await openSettings(page);
  await page.locator('#cm-tab-questionnaires').click();
  const seg = page.locator('.cm-detail .seg-btn[data-on]:not(.active)').first();
  await seg.waitFor();
  const on = await seg.getAttribute('data-on');
  await mark(page);
  await seg.click();
  await expect(page.locator('.cm-detail .seg-btn[data-on="' + on + '"].active').first()).toBeVisible();
  expect(await fresh(page, '#sidebar-mount')).toBe(0);
  expect(await fresh(page, '#page-toolbar-mount')).toBe(0);
  // Turning it on adds its own lines (status, bars, buttons); the switch, the
  // header and the rest of the body stay.
  expect(await page.evaluate(() => !!document.querySelector('.cm-detail .seg.seg-sm').__kept)).toBe(true);
  expect(await fresh(page, '#main')).toBeLessThan(25);
});
