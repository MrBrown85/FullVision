/**
 * The bars under the dock look alike on every page (Colin, 2026-10-22: "tweak
 * all of the bars, so that they're consistent, contextually, with each other").
 * A page's toolbar starts its controls 12px in with one hairline under it;
 * every control in it is --control-h (32px) tall and every filter chip
 * --chip-h (24px). Demo Mode, 1440px wide.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, hash) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), hash);
}

/* The bar's inset and hairline, and the heights of what is in it: controls
   (pickers, buttons, searches, switches) and chips. */
function measureBar(page, selector) {
  return page.evaluate(sel => {
    var bar = document.querySelector(sel);
    var cs = getComputedStyle(bar);
    var visible = el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    var height = el => Math.round(el.getBoundingClientRect().height);
    var all = Array.prototype.slice.call(bar.querySelectorAll('button, select, input, a.tb-action-btn, .seg'));
    var chips = all.filter(el => visible(el) && /chip/.test(el.className));
    var controls = all.filter(
      el =>
        visible(el) &&
        !/chip/.test(el.className) &&
        !el.classList.contains('seg-btn') &&
        !el.classList.contains('seg-sm'),
    );
    return {
      inset: cs.paddingLeft,
      // The hairline's colour and style (headless Chromium rounds 0.5px to 1px).
      border: cs.borderBottomStyle + ' ' + cs.borderBottomColor,
      controls: Array.from(new Set(controls.map(height))),
      chips: Array.from(new Set(chips.map(height))),
    };
  }, selector);
}

// --divider-medium in light mode.
const HAIRLINE = 'solid rgba(0, 0, 0, 0.09)';

const PAGES = [
  ['/dashboard', '.dash-toolbar'],
  ['/assignments', '.assess-toolbar'],
  ['/gradebook', '.gb-toolbar'],
  ['/reports', '.report-toolbar'],
];

for (const [hash, bar] of PAGES) {
  test(`${hash}: the toolbar's inset, hairline and control heights match`, async ({ page }) => {
    await open(page, hash);
    await page.locator(bar).waitFor();
    const m = await measureBar(page, bar);
    expect(m.inset).toBe('12px');
    expect(m.border).toBe(HAIRLINE);
    expect(m.controls).toEqual([32]);
    if (m.chips.length) expect(m.chips).toEqual([24]);
  });
}

test('the secondary bars are in line with the toolbars, chips 24px', async ({ page }) => {
  await open(page, '/observations');
  await page.locator('.obs-toolbar').waitFor();
  const obs = await measureBar(page, '.obs-toolbar');
  expect(obs.inset).toBe('12px');
  expect(obs.border).toBe(HAIRLINE);
  expect(obs.chips).toEqual([24]);
  // The search there is chip height, beside the chips.
  expect(await page.locator('.obs-search-input').evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(
    24,
  );
  // The capture bar's two buttons are the control height.
  const capture = await page.evaluate(() =>
    ['.obsc-add', '.obsc-save-starter'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().height)),
  );
  expect(capture).toEqual([32, 32]);

  await page.evaluate(r => window.Router.navigate(r), '/gradebook');
  await page.locator('[data-action="toggleFilterStrip"]').click();
  const strip = await measureBar(page, '.gb-filter-strip');
  expect(strip.inset).toBe('12px');
  expect(strip.chips).toEqual([24]);
});
