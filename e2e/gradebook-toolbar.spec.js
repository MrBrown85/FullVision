/**
 * The Gradebook's toolbar and filter panel, in the Assignments toolbar's
 * "Three Things" style (teacher/gradebook-toolbar.js; Colin, Nov 25): Search
 * with Filter in its end, Show (All, To Grade, To Return, Questions), a chip
 * for each filter that is on, ⋯ (Print Grades, Export) and + New Assessment;
 * the filter panel (Category, Competencies with folders, Modules) floating over
 * the grid. Demo Mode, Science 8, which has work waiting, drafts to return and
 * a question, so Show has all three options.
 *
 * Layout is asserted in the page's own font and in the wide stand-in for CI's
 * Linux fonts (e2e/wide-font.js): no sideways overflow, one row from 1280, a
 * clean wrap at 1024, and the panel inside a 1280 x 720 window.
 */
import { test, expect } from '@playwright/test';
import { useFont } from './wide-font.js';
import { openToolbarMenu, chipsWhole } from './helpers.js';

// The wide stand-in is a style the page's own CSP would refuse.
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });

async function openDemo(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).length > 0;
  });
  await page.goto('/gradebook');
  await expect(page.locator('.gb-toolbar .atb-show')).toBeVisible();
}

const bar = page => page.locator('.gb-toolbar');
const show = (page, key) => page.locator('.atb-show [data-show="' + key + '"]');
const pressed = page =>
  page
    .locator('.atb-show .seg-btn')
    .evaluateAll(bs => bs.filter(b => b.ariaPressed === 'true').map(b => b.dataset.show));
const filterBtn = page => page.locator('.gb-toolbar .atb-filter-btn');
const panel = page => page.locator('.gbf-panel');
const rowIds = page => page.locator('#gb-data tr[data-sid]').evaluateAll(rs => rs.map(r => r.dataset.sid));

// Every control in the bar that is drawn, as { name, x, y, w, h }.
const boxes = page =>
  page.evaluate(() => {
    const out = [];
    document
      .querySelectorAll(
        '.gb-toolbar select, .gb-toolbar .gb-seg-btn, .gb-toolbar .atb-search, .gb-toolbar .atb-show .seg-btn, .gb-toolbar .atb-chip, .gb-toolbar .atb-end > *, .gb-toolbar .atb-end button',
      )
      .forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        out.push({
          name: el.dataset.show || el.dataset.mode || el.dataset.atb || el.className.split(' ')[0] || el.tagName,
          x: Math.round(r.x * 10) / 10,
          y: Math.round(r.y * 10) / 10,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        });
      });
    return out;
  });

/* The bar's parts: no sideways overflow and nothing past the bar's edges;
   returns the rows they sit in and any two that overlap (a part clipped). */
async function fits(page) {
  return page.evaluate(() => {
    const tb = document.querySelector('.gb-toolbar');
    const t = tb.getBoundingClientRect();
    const parts = [...tb.querySelectorAll(':scope > *, .atb-end > *, .atb-show .seg-btn')]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(p => p.r.width > 0 && p.r.height > 0)
      .filter(p => !p.el.classList.contains('atb-chips'));
    return {
      overflow: tb.scrollWidth - tb.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      outside: parts.filter(p => p.r.left < t.left - 0.5 || p.r.right > t.right + 0.5).map(p => p.el.className),
      rows: new Set(parts.map(p => Math.round(p.r.top + p.r.height / 2))).size,
      overlaps: parts
        .flatMap((a, i) =>
          parts
            .slice(i + 1)
            .filter(
              b =>
                !a.el.contains(b.el) &&
                !b.el.contains(a.el) &&
                a.r.left < b.r.right - 0.5 &&
                b.r.left < a.r.right - 0.5 &&
                a.r.top < b.r.bottom - 0.5 &&
                b.r.top < a.r.bottom - 0.5,
            )
            .map(b => a.el.className + ' / ' + b.el.className),
        )
        .slice(0, 5),
    };
  });
}

// Opens the panel and ticks every row of every column that is drawn (folders open to their competencies).
async function tickEverything(page) {
  await filterBtn(page).click();
  for (const c of await page.locator('.gbf-chev').all()) await c.click();
  const rows = page.locator(
    '.gbf-panel .assess-filter-item[data-catid], .gbf-panel .assess-filter-item[data-moduleid]',
  );
  for (let i = 0; i < (await rows.count()); i++) await rows.nth(i).click();
  const kids = page.locator('.gbf-panel .gbf-kid');
  for (let i = 0; i < (await kids.count()); i++) await kids.nth(i).click();
  await page.keyboard.press('Escape');
}

test.describe('layout', () => {
  for (const font of ['page', 'wide']) {
    for (const width of [1280, 1440, 1680]) {
      test(`no sideways overflow at ${width} wide (${font} font), one row`, async ({ page }) => {
        await openDemo(page, width);
        await useFont(page, font);
        await expect(show(page, 'toreturn')).toBeVisible();
        const f = await fits(page);
        expect(f.overflow).toBeLessThanOrEqual(1);
        expect(f.page).toBeLessThanOrEqual(0);
        expect(f.outside).toEqual([]);
        expect(f.overlaps).toEqual([]);
        expect(f.rows).toBe(1);
        // Every control is 32px, a chip 24px (e2e/toolbar-consistency.spec.js).
        const hs = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '.gb-toolbar .atb-search, .gb-toolbar .atb-search input, .gb-toolbar .atb-filter-btn, .gb-toolbar .atb-show, .gb-toolbar .gb-seg-control, .gb-toolbar select, .gb-toolbar .atb-end button, .gb-toolbar .atb-end a',
            ),
          ]
            .map(el => Math.round(el.getBoundingClientRect().height))
            .filter(h => h > 0),
        );
        expect([...new Set(hs)]).toEqual([32]);
      });
    }
    test(`wraps cleanly at 1024 wide (${font} font), nothing clipped`, async ({ page }) => {
      await openDemo(page, 1024, 768);
      await useFont(page, font);
      const f = await fits(page);
      expect(f.page).toBeLessThanOrEqual(0);
      expect(f.overflow).toBeLessThanOrEqual(1);
      expect(f.outside).toEqual([]);
      expect(f.overlaps).toEqual([]);
      for (const sel of ['[data-atb="more"]', '.gb-toolbar .atb-end a', '.atb-search']) {
        const r = await page.locator(sel).boundingBox();
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(1024);
      }
    });
    test(`with more filters on than fit, every chip on screen shows its full label (${font} font)`, async ({
      page,
    }) => {
      for (const width of [1280, 1440]) {
        await openDemo(page, width);
        await useFont(page, font);
        await tickEverything(page);
        const chips = await chipsWhole(page, '.gb-toolbar .atb-chips');
        expect(chips.length).toBeGreaterThan(8);
        for (const c of chips) if (c.on) expect(c, `${width}: ${c.text}`).toMatchObject({ within: true, full: true });
        // More are on than fit: some are left off whole.
        expect(chips.some(c => !c.on)).toBe(true);
        const f = await fits(page);
        expect(f.rows).toBe(1);
        expect(f.outside).toEqual([]);
        expect(f.overlaps).toEqual([]);
        // The right-hand buttons are where they were.
        const end = await page.locator('.atb-end').boundingBox();
        expect(end.x + end.width).toBeLessThanOrEqual(width);
      }
    });
  }

  test('a chip wider than the room is left off, not cut', async ({ page }) => {
    await openDemo(page, 1280);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      const c = getCategories(cid)[0];
      c.name = 'A Category With A Very Very Very Very Long Name To Fit';
      PageGradebook.render();
    });
    await filterBtn(page).click();
    await page.locator('.gbf-panel [data-catid]').first().click();
    await page.keyboard.press('Escape');
    const [chip] = await chipsWhole(page, '.gb-toolbar .atb-chips');
    expect(chip.on ? chip.within && chip.full : true).toBe(true);
  });

  test('Search is 260 wide when there is room, with Filter inside its right end and the field’s height', async ({
    page,
  }) => {
    await openDemo(page, 1680);
    const search = await page.locator('.gb-toolbar .atb-search').boundingBox();
    expect(search.width).toBe(260);
    expect(search.height).toBe(32);
    const filter = await filterBtn(page).boundingBox();
    expect(filter.height).toBe(32);
    expect(Math.round(filter.x + filter.width)).toBe(Math.round(search.x + search.width));
    await expect(filterBtn(page)).toHaveAccessibleName('Filter');
    await expect(filterBtn(page)).toHaveAttribute('title', 'Filter');
    await expect(filterBtn(page)).toHaveText('');
    // It gives way to 160 before anything wraps.
    await openDemo(page, 1280);
    expect((await page.locator('.gb-toolbar .atb-search').boundingBox()).width).toBeGreaterThanOrEqual(160);
  });

  test('typing shows × just left of Filter, inside the field; it clears the search', async ({ page }) => {
    await openDemo(page);
    const input = page.locator('.gb-search-input');
    await expect(page.locator('.gb-search-clear')).toHaveCount(0);
    const inputX = (await input.boundingBox()).x;
    await input.fill('ma');
    const x = await page.locator('.gb-search-clear').boundingBox();
    const f = await filterBtn(page).boundingBox();
    const s = await page.locator('.gb-toolbar .atb-search').boundingBox();
    expect(x.x + x.width).toBeLessThanOrEqual(f.x + 0.5);
    expect(f.x - (x.x + x.width)).toBeLessThanOrEqual(4);
    expect(x.x).toBeGreaterThan(s.x);
    await expect(page.locator('.gb-search-clear')).toHaveAccessibleName('Clear Search');
    // The search box keeps its place as the × comes.
    expect((await input.boundingBox()).x).toBe(inputX);
    await page.locator('.gb-search-clear').click();
    await expect(input).toHaveValue('');
    await expect(page.locator('.gb-search-clear')).toHaveCount(0);
  });

  test('the old pill, Filters button and strip are gone', async ({ page }) => {
    await openDemo(page);
    await expect(
      page.locator(
        '.gb-work-pill, .gb-pill-part, .gb-filter-trigger, .gb-filter-strip, .gb-filter-chip, .gb-student-filter',
      ),
    ).toHaveCount(0);
    await expect(page.locator('.gb-toolbar [data-action="exportScoresCSV"]:visible')).toHaveCount(0);
    await expect(page.locator('.gb-toolbar [data-action="printGrades"]:visible')).toHaveCount(0);
  });
});

test.describe('Show', () => {
  test('is a standard segmented control: All, To Grade, To Return, Questions, 32px, with badges', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('.atb-show')).toHaveClass(/\bseg\b/);
    await expect(page.locator('.atb-show')).not.toHaveClass(/seg-sm/);
    expect(await page.locator('.atb-show').evaluate(el => el.getBoundingClientRect().height)).toBe(32);
    await expect(page.locator('.atb-show .seg-btn .atb-lab > span')).toHaveText([
      'All',
      'To Grade',
      'To Return',
      'Questions',
    ]);
    await expect(page.locator('.atb-show .atb-badge')).toHaveCount(3);
    await expect(show(page, 'tograde').locator('.atb-badge')).toHaveClass(/atb-badge-blue/);
    await expect(show(page, 'toreturn').locator('.atb-badge')).toHaveClass(/atb-badge-amber/);
    await expect(show(page, 'questions').locator('.atb-badge')).toHaveClass(/atb-badge-blue/);
    for (const k of ['tograde', 'toreturn', 'questions']) {
      await expect(show(page, k)).toHaveAttribute('title', /./);
      expect(Number(await show(page, k).locator('.atb-badge').textContent())).toBeGreaterThan(0);
    }
    expect(await pressed(page)).toEqual(['all']);
  });

  test('one at a time: pressing one lets the others go; a second click, or All, shows everything', async ({ page }) => {
    await openDemo(page);
    const everyone = await rowIds(page);
    await show(page, 'tograde').click();
    expect(await pressed(page)).toEqual(['tograde']);
    const toGrade = await rowIds(page);
    expect(toGrade.length).toBeLessThan(everyone.length);
    await expect(show(page, 'tograde')).toBeFocused();
    // Another turns it off: one is pressed, never two.
    await show(page, 'toreturn').click();
    expect(await pressed(page)).toEqual(['toreturn']);
    const toReturn = await rowIds(page);
    expect(toReturn).not.toEqual(toGrade);
    await show(page, 'questions').click();
    expect(await pressed(page)).toEqual(['questions']);
    // Pressed again lets go.
    await show(page, 'questions').click();
    expect(await pressed(page)).toEqual(['all']);
    expect(await rowIds(page)).toEqual(everyone);
    // All lets go too.
    await show(page, 'tograde').click();
    await show(page, 'all').click();
    expect(await pressed(page)).toEqual(['all']);
    expect(await rowIds(page)).toEqual(everyone);
    // The title of a pressed option says what a click does.
    await show(page, 'tograde').click();
    await expect(show(page, 'tograde')).toHaveAttribute('title', /Click to show everything/);
  });

  test('the counts do not change as options are pressed', async ({ page }) => {
    await openDemo(page);
    const counts = async () =>
      page.locator('.atb-show .atb-badge').evaluateAll(bs => bs.map(b => b.dataset.n + ':' + b.textContent));
    const before = await counts();
    for (const k of ['tograde', 'toreturn', 'questions', 'all']) {
      await show(page, k).click();
      expect(await counts()).toEqual(before);
    }
  });

  test('pressing an option moves and resizes no other control', async ({ page }) => {
    for (const font of ['page', 'wide']) {
      await openDemo(page);
      await useFont(page, font);
      const before = await boxes(page);
      for (const k of ['tograde', 'toreturn', 'questions', 'all']) {
        await show(page, k).click();
        const after = await boxes(page);
        expect(
          after.map(b => b.name),
          `${k} (${font})`,
        ).toEqual(before.map(b => b.name));
        for (let i = 0; i < before.length; i++) {
          expect([after[i].x, after[i].y, after[i].w, after[i].h], `${k}: ${before[i].name} (${font})`).toEqual([
            before[i].x,
            before[i].y,
            before[i].w,
            before[i].h,
          ]);
        }
      }
    }
  });
});

test.describe('⋯ menu', () => {
  test('is a grey 32px button holding Print Grades and Export, as the Assignments ⋯ does', async ({ page }) => {
    await openDemo(page);
    const more = page.locator('[data-atb="more"]');
    await expect(more).toHaveAccessibleName('More');
    expect((await more.boundingBox()).width).toBe(32);
    expect((await more.boundingBox()).height).toBe(32);
    const menu = await openToolbarMenu(page, 'more');
    expect((await menu.getByRole('menuitem').allTextContents()).map(t => t.trim())).toEqual(['Print Grades', 'Export']);
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
  });

  test('Escape closes it and returns the focus; a click outside closes it', async ({ page }) => {
    await openDemo(page);
    const more = page.locator('[data-atb="more"]');
    const menu = page.locator('.atb-more-wrap .assess-menu');
    await more.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await more.click();
    await expect(menu).toBeVisible();
    await page.mouse.click(600, 600);
    await expect(menu).toBeHidden();
  });

  test('Export downloads the scores and closes the menu; Print Grades opens its window', async ({ page }) => {
    await openDemo(page);
    const menu = page.locator('.atb-more-wrap .assess-menu');
    await openToolbarMenu(page, 'more');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      menu.getByRole('menuitem', { name: 'Export' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await expect(menu).toBeHidden();
    await expect(page.locator('[data-atb="more"]')).toBeFocused();
    await openToolbarMenu(page, 'more');
    await menu.getByRole('menuitem', { name: 'Print Grades' }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Print Grades' })).toBeVisible();
  });
});

test.describe('the filter panel', () => {
  test('floats under Search over the grid, in up to three columns, with Clear Filters disabled until a filter is on', async ({
    page,
  }) => {
    await openDemo(page);
    await expect(panel(page)).toHaveCount(0);
    await filterBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(filterBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.gbf-col .assess-filter-head')).toHaveText(['Category', 'Competencies', 'Modules']);
    const grid = await page.locator('#gb-data').boundingBox();
    const p = await panel(page).boundingBox();
    const s = await page.locator('.gb-toolbar .atb-search').boundingBox();
    // Under Search, left edges lined up, floating: the grid is where it was.
    expect(Math.abs(p.x - s.x)).toBeLessThanOrEqual(1);
    expect(p.y).toBeGreaterThan(s.y + s.height);
    expect((await page.locator('#gb-data').boundingBox()).y).toBe(grid.y);
    await expect(page.locator('.gbf-clear')).toBeDisabled();
    // A bold head, rows 34px.
    expect(
      await page
        .locator('.gbf-panel .assess-filter-item[data-catid]')
        .first()
        .evaluate(e => e.offsetHeight),
    ).toBe(34);
    expect(
      await page
        .locator('.gbf-col .assess-filter-head')
        .first()
        .evaluate(e => getComputedStyle(e).fontWeight),
    ).toBe('700');
  });

  test('a column is drawn only when the class has that thing', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      saveModules(cid, []);
      PageGradebook.render();
    });
    await filterBtn(page).click();
    await expect(page.locator('.gbf-col .assess-filter-head')).toHaveText(['Category', 'Competencies']);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      saveCategories(cid, []);
      PageGradebook.render();
    });
    await expect(page.locator('.gbf-col .assess-filter-head')).toHaveText(['Competencies']);
  });

  test('a class with no folders lists its competencies as plain rows', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      const map = getLearningMap(cid);
      map.competencyGroups = [];
      (map.sections || []).forEach(sec => delete sec.groupId);
      PageGradebook.render();
    });
    await filterBtn(page).click();
    await expect(page.locator('.gbf-chev')).toHaveCount(0);
    expect(await page.locator('.gbf-col[aria-label="Competencies"] .assess-filter-item').count()).toBeGreaterThan(3);
  });

  test('a folder’s box ticks every competency in it, shows a dash for some, and opens with its chevron', async ({
    page,
  }) => {
    await openDemo(page);
    await filterBtn(page).click();
    const folder = page.locator('.gbf-panel [data-action="toggleFolderFilter"]').first();
    const gid = await folder.getAttribute('data-grpid');
    const kids = page.locator('.gbf-kids[data-grpid="' + gid + '"] .gbf-kid');
    await expect(kids.first()).toBeHidden();
    await expect(folder).toHaveAttribute('aria-checked', 'false');
    // Ticking the folder ticks them all, which are not drawn until the chevron opens them.
    await folder.click();
    await expect(folder).toHaveAttribute('aria-checked', 'true');
    await page.locator('.gbf-chev[data-grpid="' + gid + '"]').click();
    await expect(kids.first()).toBeVisible();
    const n = await kids.count();
    expect(n).toBeGreaterThan(1);
    for (let i = 0; i < n; i++) await expect(kids.nth(i)).toHaveAttribute('aria-checked', 'true');
    // The kids are indented under it.
    const a = await folder.boundingBox();
    const b = await kids.first().boundingBox();
    expect(b.x).toBe(a.x);
    expect(await kids.first().evaluate(e => parseFloat(getComputedStyle(e).paddingLeft))).toBeGreaterThan(30);
    // One let go: a dash.
    await kids.first().click();
    await expect(folder).toHaveAttribute('aria-checked', 'mixed');
    await expect(folder).toHaveClass(/is-some/);
    // The dash ticks them all again; all ticked, a click lets them all go.
    await folder.click();
    await expect(folder).toHaveAttribute('aria-checked', 'true');
    await folder.click();
    await expect(folder).toHaveAttribute('aria-checked', 'false');
    for (let i = 0; i < n; i++) await expect(kids.nth(i)).toHaveAttribute('aria-checked', 'false');
    // The chevron closes it.
    await page.locator('.gbf-chev[data-grpid="' + gid + '"]').click();
    await expect(kids.first()).toBeHidden();
  });

  test('the filters do what they did: categories, modules and competencies narrow the columns', async ({ page }) => {
    await openDemo(page);
    const cols = () => page.locator('#gb-data tr:first-child td.gb-scores-cell').count();
    const all = await cols();
    await filterBtn(page).click();
    await page.locator('.gbf-panel [data-catid]').first().click();
    const afterCat = await cols();
    expect(afterCat).toBeLessThan(all);
    await page.locator('.gbf-panel [data-moduleid]').first().click();
    expect(await cols()).toBeLessThanOrEqual(afterCat);
    await page.locator('.gbf-clear').click();
    expect(await cols()).toBe(all);
  });

  test('chips: one for each filter, a whole folder as one chip, × removes, and the button is tinted', async ({
    page,
  }) => {
    await openDemo(page);
    await expect(page.locator('.atb-chip')).toHaveCount(0);
    await expect(page.locator('.gb-toolbar .atb-chips')).toHaveCount(0);
    await filterBtn(page).click();
    await page.locator('.gbf-panel [data-catid]').first().click();
    await page.locator('.gbf-panel [data-moduleid]').first().click();
    const folder = page.locator('.gbf-panel [data-action="toggleFolderFilter"]').first();
    const folderName = (await folder.innerText()).trim();
    await folder.click();
    const name = async sel => (await page.locator(sel).first().innerText()).trim();
    const catName = await name('.gbf-panel [data-catid]');
    const modName = await name('.gbf-panel [data-moduleid]');
    await page.keyboard.press('Escape');
    // The folder's competencies are one chip with the folder's name.
    await expect(page.locator('.atb-chip .atb-chip-label')).toHaveText([catName, modName, folderName]);
    await expect(filterBtn(page)).toHaveClass(/has-filters/);
    expect(
      await page
        .locator('.atb-chip')
        .first()
        .evaluate(el => el.getBoundingClientRect().height),
    ).toBe(24);
    // One competency of another folder is its own chip.
    await filterBtn(page).click();
    const second = page.locator('.gbf-panel [data-action="toggleFolderFilter"]').nth(1);
    const gid = await second.getAttribute('data-grpid');
    await page.locator('.gbf-chev[data-grpid="' + gid + '"]').click();
    const kid = page.locator('.gbf-kids[data-grpid="' + gid + '"] .gbf-kid').first();
    const kidName = (await kid.innerText()).trim();
    await kid.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.atb-chip .atb-chip-label')).toHaveText([catName, modName, folderName, kidName]);
    // × on the folder's chip lets all its competencies go.
    await page.locator('.atb-chip', { hasText: folderName }).click();
    await expect(page.locator('.atb-chip')).toHaveCount(3);
    await expect(filterBtn(page)).toBeFocused();
    for (let i = 0; i < 3; i++) await page.locator('.atb-chip').first().click();
    await expect(page.locator('.atb-chip')).toHaveCount(0);
    await expect(filterBtn(page)).not.toHaveClass(/has-filters/);
  });

  test('"Showing N Students" from a dashboard link is a chip too, and × shows everyone', async ({ page }) => {
    await openDemo(page);
    const ids = await page.evaluate(() =>
      getStudents(getActiveCourse())
        .slice(0, 2)
        .map(s => s.id),
    );
    await page.goto(
      '/gradebook?course=' + (await page.evaluate(() => getActiveCourse())) + '&students=' + ids.join(','),
    );
    await expect(page.locator('.atb-chip')).toHaveText('Showing 2 Students');
    expect(await page.locator('.atb-chip').evaluate(el => el.getBoundingClientRect().height)).toBe(24);
    expect(await rowIds(page)).toHaveLength(2);
    await page.locator('.atb-chip').click();
    expect((await rowIds(page)).length).toBeGreaterThan(2);
    await expect(page.locator('.atb-chip')).toHaveCount(0);
  });

  test('ticking keeps the panel open with the keyboard on the same row, and the column where it was scrolled', async ({
    page,
  }) => {
    await openDemo(page, 1280, 720);
    await filterBtn(page).click();
    for (const c of await page.locator('.gbf-chev').all()) await c.click();
    const list = page.locator('.gbf-col[aria-label="Competencies"] .gbf-list');
    expect(await list.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    // About eleven rows tall before it scrolls on its own.
    expect(await list.evaluate(el => el.clientHeight)).toBeLessThanOrEqual(374);
    await list.evaluate(el => (el.scrollTop = el.scrollHeight));
    const top = await list.evaluate(el => el.scrollTop);
    const last = page.locator('.gbf-panel .gbf-kid').last();
    await last.focus();
    await page.keyboard.press('Space');
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('.gbf-panel .gbf-kid').last()).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.gbf-panel .gbf-kid').last()).toBeFocused();
    expect(await list.evaluate(el => el.scrollTop)).toBe(top);
    // A category row too.
    const cat = page.locator('.gbf-panel [data-catid]').first();
    await cat.focus();
    await page.keyboard.press('Enter');
    await expect(cat).toHaveAttribute('aria-checked', 'true');
    await expect(cat).toBeFocused();
  });

  test('Escape closes it and returns the focus to Filter; a click outside closes it; Filter toggles it', async ({
    page,
  }) => {
    await openDemo(page);
    await filterBtn(page).click();
    await page.locator('.gbf-panel [data-catid]').first().focus();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(filterBtn(page)).toBeFocused();
    await expect(filterBtn(page)).toHaveAttribute('aria-expanded', 'false');
    await filterBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(40, 600);
    await expect(panel(page)).toHaveCount(0);
    await filterBtn(page).click();
    await filterBtn(page).click();
    await expect(panel(page)).toHaveCount(0);
    // A click inside it does not close it.
    await filterBtn(page).click();
    await page.locator('.gbf-col .assess-filter-head').first().click();
    await expect(panel(page)).toBeVisible();
  });

  test('arrow keys move through a column’s rows; Right opens a folder and Left closes it', async ({ page }) => {
    await openDemo(page);
    await filterBtn(page).click();
    const cats = page.locator('.gbf-col[aria-label="Category"] .assess-filter-item');
    await cats.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(cats.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(cats.first()).toBeFocused();
    // Up from the first wraps to the last.
    await page.keyboard.press('ArrowUp');
    await expect(cats.last()).toBeFocused();
    const folders = page.locator('.gbf-panel [data-action="toggleFolderFilter"]');
    const gid = await folders.first().getAttribute('data-grpid');
    const kids = page.locator('.gbf-kids[data-grpid="' + gid + '"] .gbf-kid');
    await folders.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(kids.first()).toBeVisible();
    await expect(folders.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(kids.first()).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(kids.first()).toBeHidden();
    await expect(folders.first()).toBeFocused();
    // Down from a closed folder goes to the next folder.
    await page.keyboard.press('ArrowDown');
    await expect(folders.nth(1)).toBeFocused();
  });

  test('never runs off the right or bottom of a 1280 x 720 window, and names are not cut short', async ({ page }) => {
    for (const font of ['page', 'wide']) {
      await openDemo(page, 1280, 720);
      await useFont(page, font);
      await filterBtn(page).click();
      for (const c of await page.locator('.gbf-chev').all()) await c.click();
      const p = await panel(page).boundingBox();
      expect(p.x, font).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width, font).toBeLessThanOrEqual(1280);
      expect(p.y + p.height, font).toBeLessThanOrEqual(720);
      const cut = await page
        .locator('.gbf-name')
        .evaluateAll(ns =>
          ns.filter(n => n.offsetParent && n.scrollWidth > n.clientWidth + 0.5).map(n => n.textContent),
        );
      expect(cut, font).toEqual([]);
    }
  });
});

test.describe('point to preview', () => {
  const opacity = (page, sel) =>
    page
      .locator(sel)
      .first()
      .evaluate(el => Number(getComputedStyle(el).opacity));

  async function open(page, reduce = true) {
    await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => !!getActiveCourse() && getAssessments(getActiveCourse()).length > 0);
    await page.goto('/gradebook');
    await expect(page.locator('.atb-show')).toBeVisible();
  }

  test('the cells an unpressed option would not keep dim, and the names of students with none; a pressed one does not', async ({
    page,
  }) => {
    await open(page, false);
    const marks = {
      tograde: '.gb-to-grade',
      toreturn: '.gb-draft',
      questions: '.gb-question',
    };
    for (const [key, mark] of Object.entries(marks)) {
      const has = key === 'toreturn' ? 'td.gb-scores-cell.gb-draft' : 'td.gb-scores-cell:has(' + mark + ')';
      const without =
        key === 'toreturn' ? 'td.gb-scores-cell:not(.gb-draft)' : 'td.gb-scores-cell:not(:has(' + mark + '))';
      await show(page, key).hover();
      await expect.poll(() => opacity(page, '#gb-data ' + without)).toBeCloseTo(0.3, 1);
      expect(await opacity(page, '#gb-data ' + has)).toBe(1);
      // A student with none has a dimmed name; one with some does not.
      await expect
        .poll(() =>
          opacity(page, '#gb-rowheads .gb-grid-rowhead:not(.gb-grid-rowhead-stats):not([data-has~="' + key + '"])'),
        )
        .toBeCloseTo(0.3, 1);
      expect(await opacity(page, '#gb-rowheads .gb-grid-rowhead[data-has~="' + key + '"]')).toBe(1);
      await page.mouse.move(700, 600);
      await expect.poll(() => opacity(page, '#gb-data ' + without)).toBe(1);
    }
    // Keyboard focus previews too.
    await show(page, 'tograde').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => opacity(page, '#gb-data td.gb-scores-cell:not(:has(.gb-to-grade))')).toBeCloseTo(0.3, 1);
    // Pressed, it is the list, not a preview.
    await show(page, 'tograde').click();
    await expect.poll(() => opacity(page, '#gb-data td.gb-scores-cell')).toBe(1);
    await expect.poll(() => opacity(page, '#gb-rowheads .gb-grid-rowhead')).toBe(1);
  });

  test('is a transition of 150ms after 120ms, and none with reduced motion', async ({ page }) => {
    for (const reduce of [false, true]) {
      await open(page, reduce);
      await show(page, 'toreturn').hover();
      await expect.poll(() => opacity(page, '#gb-data td.gb-scores-cell:not(.gb-draft)')).toBeCloseTo(0.3, 1);
      const t = await page
        .locator('#gb-data td.gb-scores-cell:not(.gb-draft)')
        .first()
        .evaluate(el => {
          const cs = getComputedStyle(el);
          return [cs.transitionDuration, cs.transitionDelay];
        });
      // The app's own reduced-motion rule makes a transition 1e-5s long.
      if (reduce) expect(parseFloat(t[0])).toBeLessThan(0.001);
      else expect(t).toEqual(['0.15s', '0.12s']);
    }
  });

  test('only in the Scores view', async ({ page }) => {
    await open(page);
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await show(page, 'tograde').hover();
    await page.waitForTimeout(300);
    expect(await opacity(page, '#gb-data td.gb-score')).toBe(1);
  });
});
