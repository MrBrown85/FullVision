/**
 * The Dashboard's toolbar and Students bar, in the Assignments bar's style
 * (teacher/dash-overview.js; Colin, Nov 25): the page toolbar holds the class
 * picker and Class Settings (a tinted button) and no count label; the
 * Students bar runs Students N, Cards | Grid, Search, Show (All, Flagged with
 * its count badge), a gap and the sort menu. Demo Mode, Science 8.
 *
 * Layout is asserted in the page's own font and in the wide stand-in for CI's
 * Linux fonts (e2e/wide-font.js): one row from 1280, nothing clipped or
 * sideways at 1024 and 820.
 */
import { test, expect } from '@playwright/test';
import { useFont } from './wide-font.js';

// The wide stand-in is a style the page's own CSP would refuse.
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });

async function openDemo(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('.dash-students-head')).toBeVisible();
  await expect(page.locator('.dash-card[data-sid]').first()).toBeVisible();
}

const head = page => page.locator('.dash-students-head');
const show = (page, key) => page.locator('.dash-show [data-show="' + key + '"]');
const sids = page => page.locator('#dash-students .dash-card[data-sid]').evaluateAll(cs => cs.map(c => c.dataset.sid));
const flagBtn = (page, sid) => page.locator('.dash-card[data-sid="' + sid + '"] [data-action="toggleFlag"]');

// Every control in the Students bar that is drawn.
const boxes = page =>
  page.evaluate(() => {
    const out = [];
    document
      .querySelectorAll(
        '.dash-students-head .dash-students-title, .dash-students-head .dash-view-toggle, .dash-students-head .atb-search, .dash-students-head .dash-show, .dash-students-head .dash-sort-select',
      )
      .forEach(el => {
        const r = el.getBoundingClientRect();
        const top = document.querySelector('.dash-students-head').getBoundingClientRect().top;
        const left = document.querySelector('.dash-students-head').getBoundingClientRect().left;
        const name = ['dash-students-title', 'dash-view-toggle', 'atb-search', 'dash-show', 'dash-sort-select'].find(
          c => el.classList.contains(c),
        );
        const hr = document.querySelector('.dash-students-head').getBoundingClientRect().right;
        // The sort is held to the right end, so it is placed from there.
        out.push({ name, x: r.x - left, fr: hr - r.right, y: r.y - top, w: r.width, h: r.height, r: r.right - left });
      });
    return out;
  });

async function flagTwo(page) {
  const ids = await sids(page);
  await flagBtn(page, ids[1]).click();
  await flagBtn(page, ids[3]).click();
  return [ids[1], ids[3]];
}

test('the page toolbar holds the class picker and a tinted Class Settings, no count', async ({ page }) => {
  await openDemo(page);
  const bar = page.locator('.dash-toolbar');
  await expect(bar.locator('.dash-course-select')).toHaveCount(1);
  const btn = bar.locator('[data-action="openClassManager"]');
  await expect(btn).toHaveText('Class Settings');
  const s = await btn.evaluate(el => {
    const cs = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, bg: cs.backgroundColor, border: cs.borderTopWidth };
  });
  expect(s.h).toBe(32);
  expect(s.border).toBe('0px');
  expect(s.bg).not.toBe('rgba(0, 0, 0, 0)');
  await expect(bar.locator('.dash-toolbar-label')).toHaveCount(0);
  await expect(bar).not.toContainText(/\d+ Students?/);
});

test('the Students bar reads left to right: title, Cards | Grid, Search, Show, Sort', async ({ page }) => {
  await openDemo(page);
  const b = await boxes(page);
  expect(b.map(x => x.name)).toEqual([
    'dash-students-title',
    'dash-view-toggle',
    'atb-search',
    'dash-show',
    'dash-sort-select',
  ]);
  for (let i = 1; i < b.length; i++) expect(b[i].x).toBeGreaterThanOrEqual(b[i - 1].r);
  // Search is 240px at this width, the others one control tall.
  expect(Math.round(b[2].w)).toBe(240);
  for (const x of b.slice(1)) expect(Math.round(x.h)).toBe(32);
  // The sort sits at the right end, its width fixed.
  expect(Math.round(b[4].w)).toBe(176);
  await expect(page.locator('.dash-search-input')).toHaveAttribute('placeholder', 'Search students…');
  await expect(page.locator('.dash-show .seg-btn')).toHaveText(['All', 'Flagged']);
  const grey = await page.locator('.dash-sort-select').evaluate(el => getComputedStyle(el).borderTopWidth);
  expect(grey).toBe('0px');
});

for (const font of ['page', 'wide']) {
  for (const [w, h] of [
    [1280, 800],
    [1440, 900],
    [1680, 1000],
  ]) {
    test(`at ${w} x ${h} the Students bar is one row, no sideways scroll, in the ${font} font`, async ({ page }) => {
      await openDemo(page, w, h);
      await useFont(page, font);
      await flagTwo(page);
      const b = await boxes(page);
      const top = Math.round(b[0].y + b[0].h / 2);
      for (const x of b) expect(Math.round(x.y + x.h / 2)).toBe(top);
      const hbox = await head(page).evaluate(el => {
        const r = el.getBoundingClientRect();
        return { l: 0, r: r.width, sw: el.scrollWidth, cw: el.clientWidth };
      });
      for (const x of b) {
        expect(x.x).toBeGreaterThanOrEqual(hbox.l);
        expect(x.r).toBeLessThanOrEqual(hbox.r);
      }
      expect(hbox.sw).toBeLessThanOrEqual(hbox.cw);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  for (const [w, h] of [
    [1024, 768],
    [820, 1180],
  ]) {
    test(`at ${w} x ${h} the Students bar wraps cleanly, in the ${font} font`, async ({ page }) => {
      await openDemo(page, w, h);
      await useFont(page, font);
      await flagTwo(page);
      const b = await boxes(page);
      const hbox = await head(page).evaluate(el => {
        const r = el.getBoundingClientRect();
        return { l: 0, r: r.width, b: r.height, sw: el.scrollWidth, cw: el.clientWidth };
      });
      for (const x of b) {
        expect(x.x).toBeGreaterThanOrEqual(hbox.l);
        expect(x.r).toBeLessThanOrEqual(hbox.r + 0.5);
        expect(x.y + x.h).toBeLessThanOrEqual(hbox.b);
      }
      expect(hbox.sw).toBeLessThanOrEqual(hbox.cw);
      // No two controls overlap.
      for (let i = 0; i < b.length; i++)
        for (let j = i + 1; j < b.length; j++) {
          const sep =
            b[i].r <= b[j].x + 0.5 ||
            b[j].r <= b[i].x + 0.5 ||
            b[i].y + b[i].h <= b[j].y + 0.5 ||
            b[j].y + b[j].h <= b[i].y + 0.5;
          expect(sep, `${b[i].name} and ${b[j].name} overlap`).toBe(true);
        }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

test('Show: All, Flagged, and a second click on Flagged lets go', async ({ page }) => {
  await openDemo(page);
  const everyone = await sids(page);
  const [a, b] = await flagTwo(page);
  await expect(show(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(show(page, 'flagged')).toHaveAttribute('aria-pressed', 'false');
  await show(page, 'flagged').click();
  await expect(show(page, 'flagged')).toHaveAttribute('aria-pressed', 'true');
  expect((await sids(page)).sort()).toEqual([a, b].sort());
  await show(page, 'flagged').click();
  await expect(show(page, 'flagged')).toHaveAttribute('aria-pressed', 'false');
  await expect(show(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  expect(await sids(page)).toEqual(everyone);
  await show(page, 'flagged').click();
  await show(page, 'all').click();
  expect(await sids(page)).toEqual(everyone);
});

test('the Flagged badge follows a card flag on and off, and moves nothing', async ({ page }) => {
  await openDemo(page);
  const badge = page.locator('.dash-show [data-show="flagged"] .atb-badge');
  await expect(badge).toHaveCount(0);
  const before = await boxes(page);
  const ids = await sids(page);
  await flagBtn(page, ids[0]).click();
  await expect(badge).toHaveText('1');
  await expect(show(page, 'flagged')).toHaveAttribute('aria-label', /1 flagged/);
  await flagBtn(page, ids[2]).click();
  await expect(badge).toHaveText('2');
  const after = await boxes(page);
  // The badge arriving resizes and moves no other control.
  expect(
    after.map(x => [x.name, Math.round(x.name === 'dash-sort-select' ? x.fr : x.x), Math.round(x.w), Math.round(x.y)]),
  ).toEqual(
    before.map(x => [x.name, Math.round(x.name === 'dash-sort-select' ? x.fr : x.x), Math.round(x.w), Math.round(x.y)]),
  );
  await flagBtn(page, ids[2]).click();
  await flagBtn(page, ids[0]).click();
  await expect(badge).toHaveCount(0);
  // Pressing an option moves nothing either.
  await flagBtn(page, ids[0]).click();
  const idle = await boxes(page);
  await show(page, 'flagged').click();
  const pressedBoxes = await boxes(page);
  expect(
    pressedBoxes.map(x => [
      x.name,
      Math.round(x.name === 'dash-sort-select' ? x.fr : x.x),
      Math.round(x.w),
      Math.round(x.y),
    ]),
  ).toEqual(
    idle.map(x => [x.name, Math.round(x.name === 'dash-sort-select' ? x.fr : x.x), Math.round(x.w), Math.round(x.y)]),
  );
});

test('point to preview: the cards of students not flagged dim while Flagged is pointed at', async ({ page }) => {
  await openDemo(page);
  const [a] = await flagTwo(page);
  const op = sid => page.locator('.dash-card[data-sid="' + sid + '"]').evaluate(el => getComputedStyle(el).opacity);
  const ids = await sids(page);
  const other = ids.find(s => s !== a && s !== ids[3]);
  expect(await op(other)).toBe('1');
  await show(page, 'flagged').hover();
  await expect.poll(() => op(other)).toBe('0.35');
  expect(await op(a)).toBe('1');
  // Keyboard focus does the same; pressed Flagged does not dim.
  await page.mouse.move(5, 300);
  await expect.poll(() => op(other)).toBe('1');
  await show(page, 'flagged').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => op(other)).toBe('0.35');
  await show(page, 'flagged').click();
  await page.mouse.move(5, 300);
  await show(page, 'flagged').hover();
  expect(await op(a)).toBe('1');
});

test('point to preview dims the Grid rows of students not flagged', async ({ page }) => {
  await openDemo(page);
  await flagTwo(page);
  await page.locator('[data-action="studentView"][data-view="grid"]').click();
  const rows = page.locator('.dash-sg tbody tr');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('.dash-sg tbody tr.is-flagged')).toHaveCount(2);
  await show(page, 'flagged').hover();
  const ops = () =>
    rows.evaluateAll(rs => rs.map(r => [r.classList.contains('is-flagged'), getComputedStyle(r).opacity]));
  await expect.poll(async () => (await ops()).every(([f, o]) => (f ? o === '1' : o === '0.35'))).toBe(true);
});

test('the sort menu still sorts, and keeps every option', async ({ page }) => {
  await openDemo(page);
  const sel = page.locator('.dash-sort-select');
  await expect(sel.locator('option')).toHaveText([
    'Last Name A→Z',
    'Last Name Z→A',
    'First Name A→Z',
    'First Name Z→A',
    'Overall High→Low',
    'Overall Low→High',
    'Flagged First',
  ]);
  const asc = await sids(page);
  await sel.selectOption('last-desc');
  await expect.poll(() => sids(page)).toEqual(asc.slice().reverse());
  // Its width does not follow its text.
  const w1 = await sel.evaluate(el => el.getBoundingClientRect().width);
  await sel.selectOption('overall-asc');
  expect(await sel.evaluate(el => el.getBoundingClientRect().width)).toBe(w1);
});

test('the search still filters the students', async ({ page }) => {
  await openDemo(page);
  const all = await sids(page);
  const first = await page.locator('.dash-card[data-sid] .dash-card-name').first().innerText();
  const q = first.trim().split(/\s+/)[0].slice(0, 3);
  await page.locator('.dash-search-input').fill(q);
  await expect.poll(async () => (await sids(page)).length).toBeLessThan(all.length);
  expect((await sids(page)).length).toBeGreaterThan(0);
  await page.locator('.dash-search-input').fill('');
  await expect.poll(async () => (await sids(page)).length).toBe(all.length);
});

test('Class Settings still opens, and its own toolbar looks as it did', async ({ page }) => {
  await openDemo(page);
  await page.locator('.dash-toolbar [data-action="openClassManager"]').click();
  const cm = page.locator('.dash-toolbar.cm-toolbar');
  await expect(cm).toBeVisible();
  // A breadcrumb and a spacer: no tinted button, no count.
  await expect(cm.locator('.tb-action-btn')).toHaveCount(0);
  await expect(cm.locator('.dash-toolbar-spacer')).toHaveCSS('flex-grow', '1');
  expect(await cm.evaluate(el => Math.round(el.getBoundingClientRect().height))).toBeLessThanOrEqual(53);
});
