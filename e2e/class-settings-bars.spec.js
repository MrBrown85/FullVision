/**
 * Class Settings' bars in the Assignments bar's style (Colin, Nov 25): the
 * class list's New Class and the class header's Open Gradebook are tinted
 * buttons, Class Actions is a grey ⋯ over the same menu, the tabs carry no
 * counts, and the Students bar is a grey search field with Import Roster and
 * Add Student at the right. Demo Mode, Science 8.
 *
 * Layout is asserted in the page's own font and in the wide stand-in for CI's
 * Linux fonts (e2e/wide-font.js), at three desktop widths and two iPad ones.
 */
import { test, expect } from '@playwright/test';
import { useFont, FONTS } from './wide-font.js';

// The wide stand-in is a style the page's own CSP would refuse.
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });

async function openSettings(page, width = 1440, height = 900, { tablet = false, tab = 'Students' } = {}) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('[data-action="openClassManager"]').first().click();
  if (tablet) await page.evaluate(() => document.documentElement.classList.add('fv-tablet'));
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.locator('.cm-head-title')).toHaveText('Science 8');
}

const more = page => page.getByRole('button', { name: 'Class Actions', exact: true });
const menu = page => page.locator('.cm-class-actions-menu');
const bar = page => page.locator('.cm-roster-bar');

const heights = (page, selector) =>
  page.locator(selector).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));

// What is wrong with a bar: a control outside it, two controls on each other, a
// button whose words run past its edge, or the page scrolling sideways.
const problems = (page, selector) =>
  page.evaluate(sel => {
    const card = document.querySelector(sel);
    const c = card.getBoundingClientRect();
    const items = [...card.querySelectorAll('button, input')]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(p => p.r.width > 0 && p.r.height > 0);
    const out = [];
    const name = el => el.dataset.action || el.id || el.className;
    for (const p of items) {
      if (p.r.left < c.left - 0.5 || p.r.right > c.right + 0.5) out.push('outside: ' + name(p.el));
      if (p.el.tagName === 'BUTTON' && p.el.scrollWidth > p.el.clientWidth + 1) out.push('clipped: ' + name(p.el));
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i].r;
        const b = items[j].r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
          out.push('overlap: ' + name(items[i].el) + ' / ' + name(items[j].el));
      }
    // The words beside the buttons (the class's counts, the roster's notes) stay inside the bar too.
    for (const t of card.querySelectorAll('.cm-head-meta, .cm-head-title, .cm-rs-summary:not([hidden])')) {
      const r = t.getBoundingClientRect();
      if (r.width > 0 && (r.right > c.right + 0.5 || t.scrollWidth > t.clientWidth + 1))
        out.push('words: ' + t.className);
    }
    return { out, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }, selector);

const TINT = /^rgba\(0, 122, 255, 0\.\d+\)$/;

test('the tabs carry no counts', async ({ page }) => {
  await openSettings(page);
  const tabs = page.getByRole('tab');
  const names = await tabs.allTextContents();
  expect(names).toEqual(
    expect.arrayContaining(['Details', 'Students', 'Reflect', 'Grading', 'Reporting Terms', 'Competencies']),
  );
  for (const n of names) expect(n, n).not.toMatch(/\d/);
  await expect(page.locator('.cm-tab-count')).toHaveCount(0);
  // The underline tabs are as they were: the open one is blue with its underline.
  const on = page.getByRole('tab', { name: 'Students', exact: true });
  await expect(on).toHaveAttribute('aria-selected', 'true');
  expect(await on.evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe('2px');
});

test('New Class and Open Gradebook are tinted, Class Actions is a grey ⋯', async ({ page }) => {
  await openSettings(page);
  const newClass = page.locator('.cm-sidebar-header [data-action="cmStartCreate"]');
  const gradebook = page.locator('[data-action="cmOpenGradebook"]');
  await expect(newClass).toHaveText('+ New Class');
  await expect(gradebook).toHaveText('Open Gradebook');
  for (const el of [newClass, gradebook]) {
    expect(await el.evaluate(b => getComputedStyle(b).backgroundColor)).toMatch(TINT);
    expect(await el.evaluate(b => Math.round(b.getBoundingClientRect().height))).toBe(32);
  }
  const dots = more(page);
  await expect(dots).toHaveText('');
  await expect(dots).toHaveAttribute('aria-haspopup', 'menu');
  await expect(dots).toHaveAttribute('aria-expanded', 'false');
  const look = await dots.evaluate(b => {
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), fill: getComputedStyle(b).backgroundColor };
  });
  expect(look).toEqual({ w: 32, h: 32, fill: 'rgba(118, 118, 128, 0.12)' });
  // Restore from Backup at the foot is as it was.
  await expect(page.locator('.cm-sidebar-foot .cm-new-btn')).toHaveText('Restore from Backup');
  // New Class opens the wizard, Open Gradebook the gradebook.
  await newClass.click();
  await expect(page.locator('.cw-steps')).toBeVisible();
});

test('Open Gradebook opens the class gradebook', async ({ page }) => {
  await openSettings(page);
  await page.locator('[data-action="cmOpenGradebook"]').click();
  await expect(page).toHaveURL(/\/gradebook$/);
});

test('⋯ opens the class menu with its items, and Escape puts the focus back on ⋯', async ({ page }) => {
  await openSettings(page);
  await expect(menu(page)).toBeHidden();
  await more(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  const items = menu(page).getByRole('menuitem');
  await expect(items).toHaveText(['Duplicate Class', 'Download Class Backup', 'Archive Class']);
  await expect(items.first()).toBeFocused();
  // Archive Class in red; the others in the text colour.
  const colours = await items.evaluateAll(els => els.map(el => getComputedStyle(el).color));
  expect(colours[2]).not.toBe(colours[0]);
  expect(colours[2]).toMatch(/^rgb\((1[5-9]\d|2\d\d), \d{1,2}, \d{1,2}\)$/);
  // The menu's look: rounded, under its button, lined up with its right edge.
  const box = await menu(page).evaluate(el => {
    const r = el.getBoundingClientRect();
    const b = el.parentElement.querySelector('[aria-haspopup]').getBoundingClientRect();
    return {
      radius: getComputedStyle(el).borderTopLeftRadius,
      below: Math.round(r.top - b.bottom),
      right: Math.round(r.right - b.right),
    };
  });
  expect(box.radius).toBe('12px');
  expect(box.below).toBeGreaterThanOrEqual(0);
  expect(box.below).toBeLessThanOrEqual(8);
  expect(box.right).toBe(0);

  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(more(page)).toBeFocused();

  // From the keyboard: Enter opens it, and a click elsewhere closes it.
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await page.locator('.cm-head-title').click();
  await expect(menu(page)).toBeHidden();
});

test('an open class menu stays open when Class Settings is drawn again', async ({ page }) => {
  await openSettings(page);
  await more(page).click();
  await expect(menu(page)).toBeVisible();
  await page.evaluate(() => DashClassManager.renderClassManager());
  await expect(menu(page)).toBeVisible();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();
});

test('Duplicate Class and Download Class Backup do what they did', async ({ page }) => {
  await openSettings(page);
  await more(page).click();
  await menu(page).getByRole('menuitem', { name: 'Duplicate Class' }).click();
  await expect(page.getByRole('dialog', { name: /Duplicate/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await more(page).click();
  const download = page.waitForEvent('download');
  await menu(page).getByRole('menuitem', { name: 'Download Class Backup' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});

test('the Students bar: a grey search, Import Roster, Add Student, no sentence and no plain count', async ({
  page,
}) => {
  await openSettings(page);
  const search = bar(page).getByRole('textbox', { name: 'Find a Student' });
  await expect(search).toHaveAttribute('placeholder', 'Find a Student');
  const look = await search.evaluate(el => {
    const field = el.parentElement.getBoundingClientRect();
    return {
      w: Math.round(field.width),
      h: Math.round(field.height),
      fill: getComputedStyle(el.parentElement).backgroundColor,
      icon: !!el.parentElement.querySelector('.atb-ico-search'),
    };
  });
  expect(look).toEqual({ w: 240, h: 32, fill: 'rgba(118, 118, 128, 0.12)', icon: true });

  await expect(page.locator('#main')).not.toContainText('Click any field to edit');
  await expect(page.locator('#main')).not.toContainText('Enter or ↓ moves down a column');
  // The plain count is gone; the bar says nothing until there is something to flag.
  await expect(page.locator('#cm-rs-summary')).toHaveText('');
  await expect(page.locator('#cm-rs-summary')).toBeHidden();
  await expect(bar(page)).not.toContainText(/\b\d+ students?\b/);

  const imp = bar(page).getByRole('button', { name: 'Import Roster' });
  const add = bar(page).getByRole('button', { name: 'Add Student' });
  expect(await imp.evaluate(b => getComputedStyle(b).backgroundColor)).toMatch(TINT);
  const addLook = await add.evaluate(b => {
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), fill: getComputedStyle(b).backgroundColor };
  });
  expect(addLook.w).toBe(112);
  expect(addLook.h).toBe(32);
  expect(addLook.fill).toBe('rgb(0, 102, 204)');
  expect(await heights(page, '.cm-roster-bar .tb-action-btn')).toEqual([32, 32]);
});

test('the search filters the roster as it did, and Escape-free: clearing it brings everyone back', async ({ page }) => {
  await openSettings(page);
  const rows = page.locator('.cm-rs-row:not([hidden])');
  const all = await rows.count();
  expect(all).toBeGreaterThan(5);
  const search = bar(page).getByRole('textbox', { name: 'Find a Student' });
  await search.fill('adeyemi');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('[data-col="last"]')).toHaveValue('Adeyemi');
  await search.fill('');
  await expect(rows).toHaveCount(all);
});

test('Import Roster and Add Student open what they opened', async ({ page }) => {
  await openSettings(page);
  await bar(page).getByRole('button', { name: 'Add Student' }).click();
  await expect(page.locator('#cm-add-student-form')).toBeVisible();
  await expect(page.locator('#cm-add-first')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cm-add-student-form')).toBeHidden();
  await expect(page.locator('.cm-roster-add')).toBeFocused();

  await bar(page).getByRole('button', { name: 'Import Roster' }).click();
  await expect(page.locator('[data-action="cmChooseRosterFile"]').first()).toBeVisible();
});

test('a flag stays in the bar: the roster note says who has no parent email once the emails are read', async ({
  page,
}) => {
  await openSettings(page);
  await page.evaluate(() => {
    const s = getStudents('sci8');
    s[0].designations = ['Q'];
    saveStudents('sci8', s);
    DashClassManager.renderClassManager();
  });
  const note = page.locator('#cm-rs-summary');
  await expect(note).toBeVisible();
  await expect(note).toContainText('1 with designations');
  await expect(note).not.toContainText(/\d+ students/);
});

for (const width of [1280, 1440, 1680]) {
  test(`the class header and the Students bar fit at ${width} wide, in both fonts`, async ({ page }) => {
    await openSettings(page, width, 900);
    for (const font of FONTS) {
      await useFont(page, font);
      for (const sel of ['.cm-head', '.cm-roster-bar', '.cm-sidebar-header']) {
        const p = await problems(page, sel);
        expect(p.out, `${sel}, ${font}`).toEqual([]);
        expect(p.page, `${sel}, ${font}`).toBe(0);
      }
      // One row each: the buttons share a line at desktop widths.
      expect(await heights(page, '.cm-head-actions .tb-action-btn, .cm-head-actions .atb-icon-btn')).toEqual([32, 32]);
      expect(await heights(page, '.cm-roster-bar .tb-action-btn, .cm-roster-bar .atb-search')).toEqual([32, 32, 32]);
    }
  });
}

for (const [width, height] of [
  [1024, 768],
  [820, 1180],
  [744, 1133],
]) {
  test(`on an iPad at ${width} × ${height} the controls are 44 tall and the bars wrap cleanly, in both fonts`, async ({
    page,
  }) => {
    await openSettings(page, width, height, { tablet: true });
    for (const font of FONTS) {
      await useFont(page, font);
      for (const sel of ['.cm-head', '.cm-roster-bar', '.cm-sidebar-header']) {
        const p = await problems(page, sel);
        expect(p.out, `${sel}, ${font}`).toEqual([]);
        expect(p.page, `${sel}, ${font}`).toBe(0);
      }
    }
    expect(await heights(page, '.cm-head-actions .tb-action-btn, .cm-head-actions .atb-icon-btn')).toEqual([44, 44]);
    expect(await heights(page, '.cm-roster-bar .tb-action-btn, .cm-roster-bar .atb-search')).toEqual([44, 44, 44]);
    expect(await heights(page, '.cm-sidebar-header .tb-action-btn')).toEqual([44]);
  });
}
