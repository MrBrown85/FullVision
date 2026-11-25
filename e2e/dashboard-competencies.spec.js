/**
 * The Competencies tile (what the class's work has covered): one row for each
 * competency assessed in the period with its count and one tick for each
 * student, This Term | Year, the quiet Not Assessed line, and Core. Demo
 * Mode, Science 8. Counts and levels are checked against the data in
 * tests/dash-competencies-pages.test.js; here it is the drawn tile: nothing
 * runs past it, the list scrolls inside it, and the controls work.
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import { FONTS, useFont } from './wide-font.js';
import { mkdirSync } from 'node:fs';

test.beforeEach(({ page }) => demoStudentPageOff(page));

async function openDashboard(page, { w = 1280, h = 800 } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-comp-tile').waitFor();
  await page.locator('#dash-comp-page-curricular .dash-comp-it').first().waitFor({ state: 'attached' });
}

async function goCore(page) {
  await page.locator('#dash-comp-tab-core').click();
  await expect(page.locator('#dash-comp-page-core')).toHaveClass(/is-on/);
  await page.waitForTimeout(300);
}

const box = loc =>
  loc.first().evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });

/* What runs past the tile, sideways or out of the window, and whether the
   list or the page scrolls. */
const fitOf = page =>
  page.evaluate(() => {
    const tile = document.querySelector('.dash-comp-tile').getBoundingClientRect();
    const on = document.querySelector('.dash-comp-page.is-on');
    const list = on.querySelector('.dash-comp-list');
    const past = [...on.querySelectorAll('.dash-comp-sub > *, .dash-comp-it > *, .dash-comp-tick, .dash-comp-fold')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > tile.right + 0.5 || r.left < tile.left - 0.5);
      })
      .map(el => (el.textContent || el.className).trim().slice(0, 30));
    return {
      past,
      listSideways: list.scrollWidth - list.clientWidth,
      pageScrolls: on.scrollHeight > on.clientHeight + 1,
      docSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tileBottom: tile.bottom,
      rowBottom: document.querySelector('.dash-row').getBoundingClientRect().bottom,
    };
  });

for (const [w, h] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`nothing runs past the tile at ${w} x ${h}, in the page font and the wide one`, async ({ page }) => {
    await openDashboard(page, { w, h });
    for (const font of FONTS) {
      await useFont(page, font);
      for (const pg of ['curricular', 'core']) {
        if (pg === 'core') await goCore(page);
        const m = await fitOf(page);
        const at = `${font} font, ${pg}`;
        expect(m.past, at).toEqual([]);
        expect(m.listSideways, at).toBeLessThanOrEqual(0);
        expect(m.pageScrolls, at).toBe(false);
        expect(m.docSideways, at).toBeLessThanOrEqual(0);
        expect(m.tileBottom, at).toBeLessThanOrEqual(m.rowBottom + 0.5);
      }
      await page.locator('#dash-comp-tab-curricular').click();
      await page.waitForTimeout(300);
    }
  });
}

test('rows are one tick for each student, the name and count on one line, the strongest first', async ({ page }) => {
  await openDashboard(page);
  const students = await page.evaluate(() => getStudents('sci8').length);
  const rows = page.locator('#dash-comp-page-curricular .dash-comp-it');
  const n = await rows.count();
  expect(n).toBeGreaterThan(3);
  for (const i of [0, n - 1]) {
    await expect(rows.nth(i).locator('.dash-comp-tick')).toHaveCount(students);
    const m = await rows.nth(i).evaluate(el => {
      const name = el.querySelector('.dash-comp-it-name').getBoundingClientRect();
      const num = el.querySelector('.dash-comp-it-n').getBoundingClientRect();
      const ticks = el.querySelector('.dash-comp-ticks').getBoundingClientRect();
      const levels = [...el.querySelectorAll('.dash-comp-tick')].map(t => Number(t.dataset.compLevel));
      return {
        sameLine: Math.abs(name.top + name.height / 2 - (num.top + num.height / 2)) < 6,
        under: ticks.top >= name.bottom - 0.5,
        levels,
      };
    });
    expect(m.sameLine).toBe(true);
    expect(m.under).toBe(true);
    // Strongest first; no mark (0) last.
    const marked = m.levels.filter(l => l > 0);
    expect(marked).toEqual([...marked].sort((a, b) => b - a));
    expect(m.levels.slice(marked.length).every(l => l === 0)).toBe(true);
  }
});

test('the lists and popups are out of sight at rest', async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator('#dash-comp-pop')).toBeHidden();
  expect(await page.locator('#dash-comp-pop').evaluate(el => getComputedStyle(el).display)).toBe('none');
  for (const pg of ['curricular', 'core']) {
    const quiet = page.locator(`#dash-comp-na-${pg}`);
    if (await quiet.count()) {
      expect(await quiet.evaluate(el => getComputedStyle(el).display)).toBe('none');
    }
  }
});

test('This Term | Year changes what is counted, is kept for the class, and stays on its page', async ({ page }) => {
  await openDashboard(page);
  const sw = page.locator('#dash-comp-page-curricular .dash-comp-span');
  await expect(sw.locator('.seg-btn')).toHaveCount(2);
  await expect(sw.locator('.seg-btn').nth(1)).toHaveText('Year');
  const counts = () =>
    page.locator('#dash-comp-page-curricular .dash-comp-it-n').evaluateAll(els => els.map(e => Number(e.textContent)));
  const term = await counts();
  await sw.locator('.seg-btn').nth(1).click();
  await expect(sw.locator('.seg-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
  const year = await counts();
  expect(year.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(term.reduce((a, b) => a + b, 0));
  expect(await page.evaluate(() => localStorage.getItem('fv-dash-comp-span:sci8'))).toBe('year');
  // Focus stays on the control, and the quiet line says Year.
  await expect(sw.locator('.seg-btn').nth(1)).toBeFocused();
  // Core, then Year there: the tile is still on Core after the redraw.
  await goCore(page);
  await page.locator('#dash-comp-page-core .dash-comp-span .seg-btn').first().click();
  await expect(page.locator('#dash-comp-tab-core')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#dash-comp-page-core')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fv-dash-comp-span:sci8'))).toBe('term');
  // A reload keeps both.
  await page.reload();
  await page.locator('.dash-glance').waitFor();
  await expect(page.locator('#dash-comp-page-core')).toBeVisible();
});

test('a tick opens the students at that level, Escape closes it and focus returns to the tick', async ({ page }) => {
  await openDashboard(page);
  const tick = page.locator('#dash-comp-page-curricular .dash-comp-tick[data-comp-level="3"]').first();
  const label = await tick.getAttribute('aria-label');
  expect(label).toMatch(/, Proficient$/);
  await tick.click();
  const pop = page.locator('#dash-comp-pop');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.dash-mix-pop-head')).toContainText('Proficient');
  await expect(tick).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(tick).toBeFocused();
  // By keyboard too.
  await tick.focus();
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
});

for (const [w, h] of [
  [1280, 800],
  [1280, 720],
  [1024, 768],
]) {
  test(`a tick's list clears the top bar and its x can be pressed, at ${w} x ${h}`, async ({ page }) => {
    await openDashboard(page, { w, h });
    const ticks = page.locator('#dash-comp-page-curricular .dash-comp-tick:not(.is-none)');
    const n = await ticks.count();
    for (const i of [0, n - 1]) {
      await ticks.nth(i).scrollIntoViewIfNeeded();
      await ticks.nth(i).click();
      const pop = page.locator('#dash-comp-pop');
      await expect(pop).toBeVisible();
      const m = await page.evaluate(() => {
        const pop = document.getElementById('dash-comp-pop');
        const r = pop.getBoundingClientRect();
        const x = pop.querySelector('[data-comp-close]');
        const xr = x.getBoundingClientRect();
        const hit = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
        const dock = document.getElementById('dock-mount').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, dockBottom: dock.bottom, xHit: hit === x || x.contains(hit) };
      });
      const label = `tick ${i} at ${w} x ${h}`;
      expect(m.top, label + ' is below the top bar').toBeGreaterThanOrEqual(m.dockBottom + 7.5);
      expect(m.bottom, label + ' is inside the window').toBeLessThanOrEqual(h - 7.5);
      expect(m.xHit, label + ': the x is the element at its own centre').toBe(true);
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
    }
  });
}

test('Tab past the last control of the list, or Shift+Tab before the first, closes it and returns to the tick', async ({
  page,
}) => {
  await openDashboard(page);
  const tick = page.locator('#dash-comp-page-curricular .dash-comp-tick:not(.is-none)').nth(2);
  await tick.click();
  const pop = page.locator('#dash-comp-pop');
  await expect(pop).toBeVisible();
  for (let i = 0; i < 40 && (await pop.isVisible()); i++) await page.keyboard.press('Tab');
  await expect(pop).toBeHidden();
  await expect(tick).toBeFocused();
  await tick.click();
  await expect(pop).toBeVisible();
  for (let i = 0; i < 40 && (await pop.isVisible()); i++) await page.keyboard.press('Shift+Tab');
  await expect(pop).toBeHidden();
  await expect(tick).toBeFocused();
});

test('the list scrolls inside the tile with a fade at its foot only while there is more below', async ({ page }) => {
  await openDashboard(page, { w: 1280, h: 800 });
  const list = page.locator('#dash-comp-page-curricular .dash-comp-list');
  const holder = page.locator('#dash-comp-page-curricular .dash-comp-listbox');
  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(holder).toHaveClass(/has-more/);
  const fade = page.locator('#dash-comp-page-curricular .dash-comp-fade');
  expect(Number(await fade.evaluate(el => getComputedStyle(el).opacity))).toBe(1);
  const before = await page.evaluate(() => window.scrollY);
  await list.hover();
  await page.mouse.wheel(0, 9000);
  await expect.poll(() => list.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)).toBe(true);
  await expect(holder).not.toHaveClass(/has-more/);
  expect(Number(await fade.evaluate(el => getComputedStyle(el).opacity))).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // The quiet line is the last thing in the list, when there is one.
  const quiet = page.locator('#dash-comp-page-curricular .dash-comp-quiet');
  if (await quiet.count()) await expect(quiet).toBeInViewport();
});

test('Not Assessed opens to the names, and a name opens the New Assessment form with it ticked', async ({ page }) => {
  await openDashboard(page);
  // Take one competency out of every assessment, so it has no work in the period.
  const tagId = await page.evaluate(() => {
    const sec = getSections('sci8')[0];
    const tag = sec.tags[0].id;
    saveAssessments(
      'sci8',
      getAssessments('sci8').map(a => Object.assign({}, a, { tagIds: (a.tagIds || []).filter(t => t !== tag) })),
    );
    PageDashboard.render();
    return tag;
  });
  const quiet = page.locator('#dash-comp-page-curricular .dash-comp-quiet');
  await expect(quiet).toContainText(/^\d+ Not Assessed This (Term|Year)$/);
  await expect(quiet).toHaveAttribute('aria-expanded', 'false');
  const names = page.locator('#dash-comp-page-curricular .dash-comp-na-name');
  await expect(names.first()).toBeHidden();
  await quiet.click();
  await expect(quiet).toHaveAttribute('aria-expanded', 'true');
  await expect(names.first()).toBeVisible();
  // The open line survives a redraw.
  await page.evaluate(() => PageDashboard.render());
  await expect(page.locator('#dash-comp-page-curricular .dash-comp-quiet')).toHaveAttribute('aria-expanded', 'true');
  const mine = page.locator(`#dash-comp-page-curricular .dash-comp-na-name[data-comp-new="${tagId}"]`);
  await expect(mine).toBeVisible();
  await mine.click();
  await expect(page).toHaveURL(/\/assignments\?course=sci8&new=1&tags=/);
  await expect(page.locator('#new-assess-form')).toBeVisible();
  await expect(page.locator(`.af-tag-cb[value="${tagId}"]`)).toBeChecked();
  expect(await page.locator('.af-tag-cb:checked').count()).toBe(1);
});

test('Core: names, counts and a plain dark bar; the Not Tagged names are not buttons', async ({ page }) => {
  await openDashboard(page);
  await goCore(page);
  const rows = page.locator('#dash-comp-page-core .dash-comp-it');
  expect(await rows.count()).toBeGreaterThan(0);
  const first = await rows.first().evaluate(el => ({
    bar: el.querySelector('.dash-comp-bar i').getBoundingClientRect().width,
    track: el.querySelector('.dash-comp-bar').getBoundingClientRect().width,
  }));
  // The most tagged fills its track.
  expect(Math.abs(first.bar - first.track)).toBeLessThanOrEqual(1);
  await expect(page.locator('#dash-comp-page-core .dash-comp-tick')).toHaveCount(0);
  await expect(page.locator('#dash-comp-page-core .dash-comp-it-n.is-thin')).toHaveCount(0);
  await expect(page.locator('#dash-comp-page-core .dash-comp-colhead')).toHaveText('Tagged');
  const quiet = page.locator('#dash-comp-page-core .dash-comp-quiet');
  if (await quiet.count()) {
    await expect(quiet).toContainText(/Not Tagged This (Term|Year)$/);
    await quiet.click();
    await expect(page.locator('#dash-comp-page-core .dash-comp-na-name').first()).toBeVisible();
    await expect(page.locator('#dash-comp-page-core button.dash-comp-na-name')).toHaveCount(0);
  }
  const m = await box(page.locator('#dash-comp-page-core .dash-comp-sub-link'));
  expect(m.width).toBeGreaterThan(0);
  await expect(page.locator('#dash-comp-page-core .dash-comp-sub-link')).toHaveText('Assignments →');
});

test('the colour of a count of one is amber and of nothing else', async ({ page }) => {
  await openDashboard(page);
  await page.locator('#dash-comp-page-curricular .dash-comp-span .seg-btn').nth(1).click();
  const m = await page
    .locator('#dash-comp-page-curricular .dash-comp-it-n')
    .evaluateAll(els => els.map(e => ({ n: Number(e.textContent), thin: e.classList.contains('is-thin') })));
  expect(m.length).toBeGreaterThan(0);
  m.forEach(x => expect(x.thin).toBe(x.n === 1));
});

test('screenshots', async ({ page }, info) => {
  const dir = process.env.SHOTS_DIR;
  test.skip(!dir, 'only when SHOTS_DIR is set');
  mkdirSync(dir, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openDashboard(page, { w: 1920, h: 1080 });
    await page.locator('#dash-comp-tab-curricular').click();
    await page.waitForTimeout(300);
    const tile = page.locator('.dash-comp-tile');
    await tile.screenshot({ path: `${dir}/curricular-${scheme}.png` });
    await page.locator('#dash-comp-page-curricular .dash-comp-tick[data-comp-level="3"]').first().click();
    await page.screenshot({ path: `${dir}/curricular-list-${scheme}.png` });
    await page.keyboard.press('Escape');
    await goCore(page);
    await tile.screenshot({ path: `${dir}/core-${scheme}.png` });
  }
});
