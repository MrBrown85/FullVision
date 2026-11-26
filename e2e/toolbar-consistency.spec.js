/**
 * The bars under the dock look alike on every page (Colin, 2026-10-22: "tweak
 * all of the bars, so that they're consistent, contextually, with each other").
 * A page's toolbar starts its controls 12px in with one hairline under it;
 * every control in it is --control-h (32px) tall and every filter chip
 * --chip-h (24px). Demo Mode, 1440px wide.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

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
    var isChip = el => /chip/.test(el.className);
    var chips = all.filter(el => visible(el) && isChip(el));
    var controls = all.filter(
      el => visible(el) && !isChip(el) && !el.classList.contains('seg-btn') && !el.classList.contains('seg-sm'),
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
  ['/observations', '.obs-toolbar'],
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

test('the Observations bar is a page toolbar like the rest: controls 32px, its filter chips 24px', async ({ page }) => {
  // It was a slimmer "secondary bar" (a 24px search beside 24px chips) until its Search, Show and chips
  // took the Assignments bar's style (teacher/obs-toolbar.js).
  await open(page, '/observations');
  await page.locator('.obs-toolbar').waitFor();
  expect(await page.locator('#obs-search-input').evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(
    32,
  );
  await page.locator('.obs-toolbar .atb-filter-btn').click();
  await page.locator('.obp-row[data-grp="y"]').first().click();
  await page.keyboard.press('Escape');
  const obs = await measureBar(page, '.obs-toolbar');
  expect(obs.controls).toEqual([32]);
  expect(obs.chips).toEqual([24]);
  // The capture bar's two buttons are the control height.
  const capture = await page.evaluate(() =>
    ['.obsc-add', '.obsc-save-starter'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().height)),
  );
  expect(capture).toEqual([32, 32]);

  // The Gradebook's filters are chips in its own bar (teacher/gradebook-toolbar.js), 24px.
  await page.evaluate(r => window.Router.navigate(r), '/gradebook');
  await page.locator('.atb-filter-btn').click();
  await page.locator('.gbf-panel [data-catid]').first().click();
  await page.keyboard.press('Escape');
  const filtered = await measureBar(page, '.gb-toolbar');
  expect(filtered.controls).toEqual([32]);
  expect(filtered.chips).toEqual([24]);
});

/* The bars' ⋯ menus draw a 14px icon before every item, the way a card's ⋯
   menu does (Colin, 2026-11-25: "don't forget about the little icons beside
   the menu items!"). Each item's icon and label sit where a card menu's do,
   in the page font and the wide one CI's fonts are like. */
function measureMenu(page, selector) {
  return page.evaluate(sel => {
    const items = [...document.querySelector(sel).querySelectorAll('[role="menuitem"]')];
    return items.map(item => {
      const r = item.getBoundingClientRect();
      const icon = item.firstElementChild;
      const label = icon && icon.nextElementSibling;
      const ir = icon ? icon.getBoundingClientRect() : r;
      const lr = label ? label.getBoundingClientRect() : r;
      return {
        name: item.textContent.trim(),
        icon: {
          tag: icon ? icon.tagName.toLowerCase() : '',
          hidden: icon ? icon.getAttribute('aria-hidden') : null,
          stroke: icon ? icon.getAttribute('stroke') : null,
          size: [Math.round(ir.width), Math.round(ir.height)],
        },
        iconX: Math.round(ir.left - r.left),
        labelX: Math.round(lr.left - r.left),
        // The icon's middle against the label's, in whole pixels.
        middle: Math.round((ir.top + ir.bottom) / 2 - (lr.top + lr.bottom) / 2),
        font: getComputedStyle(item).fontSize,
        height: Math.round(r.height),
      };
    });
  }, selector);
}

async function openMenu(page, button, menu) {
  await page.locator(button).click();
  await expect(page.locator(menu)).toBeVisible();
  const items = await measureMenu(page, menu);
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toBeHidden();
  return items;
}

for (const font of FONTS) {
  test(`every item in the bars' ⋯ menus has its icon, lined up as a card's ⋯ menu (${font} font)`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/assignments');
    await page.locator('.assess-toolbar').waitFor();
    await useFont(page, font);

    // A card's ⋯ menu (on an open card): where its icons and labels sit.
    await page.locator('.assess-card .assess-title').first().click();
    await expect(page.locator('.assess-card.open')).toHaveCount(1);
    const card = await openMenu(page, '.assess-card.open .assess-more-btn', '.assess-card.open .assess-menu');
    const ref = card.find(i => i.icon.tag === 'svg');
    expect(ref.icon.size).toEqual([14, 14]);

    const menus = {
      'Assignments ⋯': await openMenu(page, '[data-atb="more"]', '.atb-more-wrap .assess-menu'),
      'Assignments ▾': await openMenu(page, '[data-atb="new"]', '.atb-new-wrap .assess-menu'),
    };
    await page.evaluate(r => window.Router.navigate(r), '/gradebook');
    await page.locator('.gb-toolbar').waitFor();
    menus['Gradebook ⋯'] = await openMenu(
      page,
      '.gb-toolbar [data-atb="more"]',
      '.gb-toolbar .atb-more-wrap .assess-menu',
    );

    await page.goto('/reports?tab=questionnaire&student=st1');
    await page.locator('.report-toolbar').waitFor();
    await page.locator('#report-period').selectOption('Report 2');
    await page.locator('#tq-narrative').waitFor();
    await useFont(page, font);
    menus['Reporting ⋯'] = await openMenu(page, '#tq-more-btn', '.rtb-more-wrap .assess-menu');

    await page.evaluate(r => window.Router.navigate(r), '/dashboard');
    await page.locator('[data-action="openClassManager"]').first().click();
    await page.getByRole('tab', { name: 'Students', exact: true }).click();
    menus['Class Actions ⋯'] = await openMenu(
      page,
      '.cm-head-actions [data-action="cmStdMenu"]',
      '.cm-class-actions-menu',
    );

    for (const [name, items] of Object.entries(menus)) {
      expect(items.length, name).toBeGreaterThan(0);
      for (const item of items) {
        const where = name + ': ' + item.name;
        expect(item.icon, where).toEqual({ tag: 'svg', hidden: 'true', stroke: 'currentColor', size: [14, 14] });
        expect([item.iconX, item.labelX, item.font, item.height], where).toEqual([
          ref.iconX,
          ref.labelX,
          ref.font,
          ref.height,
        ]);
        expect(Math.abs(item.middle), where).toBeLessThanOrEqual(1);
      }
    }
  });
}
