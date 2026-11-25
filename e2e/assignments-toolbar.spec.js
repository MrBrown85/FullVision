/**
 * The Assignments toolbar, option C "Three Things" (teacher/assign-toolbar.js;
 * Colin, Nov 25): Search with Filter in its end, Show, a chip for each filter,
 * ⋯ and + New Assessment with its ▾. Demo Mode, Science 8 with its Student
 * Page on, so Show has Submitted, To Grade, To Return and Not In.
 *
 * Layout is asserted in the page's own font and in the wide stand-in for CI's
 * Linux fonts (e2e/wide-font.js): no sideways overflow, one row at 1440 and
 * 1680, and a clean wrap at an iPad's width.
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
  await page.goto('/assignments');
  await expect(page.locator('.atb-show')).toBeVisible();
}

const bar = page => page.locator('.assess-toolbar');
const show = (page, key) => page.locator('.atb-show [data-show="' + key + '"]');
const pressed = page =>
  page
    .locator('.atb-show .seg-btn')
    .evaluateAll(bs => bs.filter(b => b.ariaPressed === 'true').map(b => b.dataset.show));

// Every control in the bar that is drawn, as { name, x, y, w, h, right, bottom }.
const boxes = page =>
  page.evaluate(() => {
    const out = [];
    document
      .querySelectorAll(
        '.assess-toolbar .atb-search, .assess-toolbar .atb-show .seg-btn, .assess-toolbar .atb-chip, .assess-toolbar .atb-end > *, .assess-toolbar .atb-end button, .assess-toolbar .atb-end .atb-new-more',
      )
      .forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        out.push({
          name: el.dataset.show || el.dataset.atb || el.className.split(' ')[0] || el.tagName,
          x: Math.round(r.x * 10) / 10,
          y: Math.round(r.y * 10) / 10,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        });
      });
    return out;
  });

/* The bar's direct parts: no sideways overflow and nothing past the bar's
   edges; returns each part's box to compare rows. */
async function fits(page) {
  return page.evaluate(() => {
    const tb = document.querySelector('.assess-toolbar');
    const t = tb.getBoundingClientRect();
    const parts = [...tb.querySelectorAll(':scope > *, .atb-end > *, .atb-show .seg-btn')]
      .filter(el => !el.classList.contains('assess-course-select') || el.offsetWidth)
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(p => p.r.width > 0 && p.r.height > 0)
      .filter(p => !p.el.classList.contains('atb-show-slot') && !p.el.classList.contains('atb-chips'));
    return {
      overflow: tb.scrollWidth - tb.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      outside: parts.filter(p => p.r.left < t.left - 0.5 || p.r.right > t.right + 0.5).map(p => p.el.className),
      rows: new Set(parts.map(p => Math.round(p.r.top + p.r.height / 2))).size,
      // Two parts that overlap are a part clipped.
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
      height: Math.round(t.height),
    };
  });
}

test.describe('layout', () => {
  for (const font of ['page', 'wide']) {
    for (const width of [1280, 1440, 1680]) {
      test(`no sideways overflow at ${width} wide (${font} font), one row from 1440`, async ({ page }) => {
        await openDemo(page, width);
        await useFont(page, font);
        // To Return is showing.
        await expect(show(page, 'toreturn')).toBeVisible();
        const f = await fits(page);
        expect(f.overflow).toBeLessThanOrEqual(1);
        expect(f.page).toBeLessThanOrEqual(0);
        expect(f.outside).toEqual([]);
        expect(f.overlaps).toEqual([]);
        if (width >= 1440) expect(f.rows).toBe(1);
        // Every control is 32px, a chip 24px (e2e/toolbar-consistency.spec.js).
        const hs = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '.assess-toolbar .atb-search, .assess-toolbar .atb-search input, .assess-toolbar .atb-filter-btn, .assess-toolbar .atb-show, .assess-toolbar .atb-end button',
            ),
          ]
            .map(el => Math.round(el.getBoundingClientRect().height))
            .filter(h => h > 0),
        );
        expect([...new Set(hs)]).toEqual([32]);
      });
    }
    for (const [width, height] of [
      [1024, 768],
      [820, 1180],
    ]) {
      test(`wraps cleanly at ${width} x ${height} (${font} font)`, async ({ page }) => {
        await openDemo(page, width, height);
        await useFont(page, font);
        const f = await fits(page);
        expect(f.page).toBeLessThanOrEqual(0);
        expect(f.overflow).toBeLessThanOrEqual(1);
        expect(f.outside).toEqual([]);
        expect(f.overlaps).toEqual([]);
        // The buttons that must stay: ⋯ and + New Assessment are on screen.
        for (const sel of ['[data-atb="more"]', '[data-action="showNewForm"]', '.atb-search']) {
          const r = await page.locator(sel).boundingBox();
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(width);
        }
      });
    }
    test(`four chips never push the buttons off the row at 1440 (${font} font)`, async ({ page }) => {
      await openDemo(page);
      await useFont(page, font);
      await page.locator('.atb-filter-btn').click();
      const items = page.locator('.assess-filter-menu .assess-filter-item:not(.assess-filter-clear)');
      const n = await items.count();
      for (let i = 0; i < n; i++) await page.locator('.assess-filter-menu .assess-filter-item').nth(i).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.atb-chip')).toHaveCount(n);
      const f = await fits(page);
      expect(f.rows).toBe(1);
      expect(f.outside).toEqual([]);
      expect(f.overlaps).toEqual([]);
      const end = await page.locator('.atb-end').boundingBox();
      const tb = await bar(page).boundingBox();
      expect(end.x + end.width).toBeLessThanOrEqual(tb.x + tb.width);
      // A chip is 24px.
      for (const h of await page.locator('.atb-chip').evaluateAll(cs => cs.map(c => c.getBoundingClientRect().height)))
        expect(h === 0 || h === 24).toBe(true);
    });
    test(`a chip that does not fit is left off whole, never cut mid-word (${font} font)`, async ({ page }) => {
      for (const width of [1280, 1440]) {
        await openDemo(page, width);
        await useFont(page, font);
        await page.locator('.atb-filter-btn').click();
        const items = page.locator('.assess-filter-menu .assess-filter-item:not(.assess-filter-clear)');
        const n = await items.count();
        for (let i = 0; i < n; i++) await page.locator('.assess-filter-menu .assess-filter-item').nth(i).click();
        await page.keyboard.press('Escape');
        const chips = await chipsWhole(page, '.assess-toolbar .atb-chips');
        expect(chips).toHaveLength(n);
        // Every chip on screen shows its full label; the rest are not on the row.
        for (const c of chips) if (c.on) expect(c, `${width}: ${c.text}`).toMatchObject({ within: true, full: true });
        if (width === 1280)
          expect(
            chips.some(c => !c.on),
            'some are left off at 1280',
          ).toBe(true);
      }
    });
  }

  test('Search is 300 wide when there is room, with Filter inside its right end and the field’s height', async ({
    page,
  }) => {
    await openDemo(page, 1680);
    const search = await page.locator('.atb-search').boundingBox();
    expect(search.width).toBe(300);
    expect(search.height).toBe(32);
    const filter = await page.locator('.atb-filter-btn').boundingBox();
    expect(filter.height).toBe(32);
    expect(Math.round(filter.x + filter.width)).toBe(Math.round(search.x + search.width));
    await expect(page.locator('.atb-filter-btn')).toHaveAccessibleName('Filter');
    await expect(page.locator('.atb-filter-btn')).toHaveAttribute('title', 'Filter');
    // No label, no number, and no helper text anywhere on the bar.
    await expect(page.locator('.atb-filter-btn')).toHaveText('');
    await openDemo(page, 1280);
    expect((await page.locator('.atb-search').boundingBox()).width).toBeGreaterThanOrEqual(180);
  });
});

test.describe('Show', () => {
  test('is a standard segmented control: All, Submitted, To Grade, To Return, Not In, 32px', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('.atb-show')).toHaveClass(/\bseg\b/);
    await expect(page.locator('.atb-show')).not.toHaveClass(/seg-sm/);
    expect(await page.locator('.atb-show').evaluate(el => el.getBoundingClientRect().height)).toBe(32);
    await expect(page.locator('.atb-show .seg-btn .atb-lab > span')).toHaveText([
      'All',
      'Submitted',
      'To Grade',
      'To Return',
      'Not In',
    ]);
    // Only To Grade and To Return carry a number, as a badge.
    await expect(page.locator('.atb-show .atb-badge')).toHaveCount(2);
    await expect(show(page, 'tograde').locator('.atb-badge')).toHaveClass(/atb-badge-blue/);
    await expect(show(page, 'toreturn').locator('.atb-badge')).toHaveClass(/atb-badge-amber/);
    await expect(show(page, 'submitted').locator('.atb-badge')).toHaveCount(0);
    await expect(show(page, 'notin').locator('.atb-badge')).toHaveCount(0);
    for (const k of ['submitted', 'tograde', 'toreturn', 'notin'])
      await expect(show(page, k)).toHaveAttribute('title', /./);
    // The old amber pill is gone.
    await expect(page.locator('.assess-to-return-btn, .assess-to-return-slot, .assess-tograde-seg')).toHaveCount(0);
  });

  test('To Return filters like the pill did, shows pressed with All let go, and is not combined', async ({ page }) => {
    await openDemo(page);
    const all = await page.locator('.assess-card').count();
    await show(page, 'toreturn').click();
    expect(await pressed(page)).toEqual(['toreturn']);
    const some = await page.locator('.assess-card').count();
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(all);
    await expect(show(page, 'toreturn')).toBeFocused();
    // Choosing another option lets it go.
    await show(page, 'tograde').click();
    expect(await pressed(page)).toEqual(['tograde']);
    await show(page, 'toreturn').click();
    expect(await pressed(page)).toEqual(['toreturn']);
    // A second click lets go; All clears too.
    await show(page, 'toreturn').click();
    expect(await pressed(page)).toEqual(['all']);
    expect(await page.locator('.assess-card').count()).toBe(all);
    await show(page, 'toreturn').click();
    await show(page, 'all').click();
    expect(await pressed(page)).toEqual(['all']);
    expect(await page.locator('.assess-card').count()).toBe(all);
  });

  test('pressing an option moves and resizes no other control', async ({ page }) => {
    for (const font of ['page', 'wide']) {
      await openDemo(page);
      await useFont(page, font);
      const before = await boxes(page);
      for (const k of ['submitted', 'tograde', 'toreturn', 'notin', 'all']) {
        await show(page, k).click();
        const after = await boxes(page);
        // The same controls, in the same places, at the same sizes (a count may change a badge, never a place).
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

test.describe('menus', () => {
  test('⋯ in the Grade view: Expand All, Bulk Edit, Rubrics; Collapse All once a card is open', async ({ page }) => {
    await openDemo(page);
    const more = page.locator('[data-atb="more"]');
    await expect(more).toHaveAccessibleName('More');
    expect((await more.boundingBox()).width).toBe(32);
    const items = async () =>
      (await (await openToolbarMenu(page, 'more')).getByRole('menuitem').allTextContents()).map(t => t.trim());
    expect(await items()).toEqual(['Expand All', 'Bulk Edit', 'Rubrics']);
    // The separator sits before Rubrics.
    await expect(page.locator('.atb-more-wrap .assess-menu-sep')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.locator('.assess-card .assess-header').first().click();
    expect(await items()).toEqual(['Expand All', 'Collapse All', 'Bulk Edit', 'Rubrics']);
    await page.getByRole('menuitem', { name: 'Expand All' }).click();
    // Choosing an item closes the menu.
    await expect(page.locator('.atb-more-wrap .assess-menu')).toBeHidden();
    expect(await items()).toEqual(['Collapse All', 'Bulk Edit', 'Rubrics']);
  });

  test('⋯ in Bulk Edit holds Rubrics alone; Done Editing goes back to Grade', async ({ page }) => {
    await openDemo(page);
    await (await openToolbarMenu(page, 'more')).getByRole('menuitem', { name: 'Bulk Edit' }).click();
    await expect(page.locator('.alv-page')).toBeVisible();
    const done = page.locator('.atb-end > .tb-action-btn.tb-action-secondary');
    await expect(done).toHaveText('Done Editing');
    expect(await done.evaluate(el => el.getBoundingClientRect().height)).toBe(32);
    const menu = await openToolbarMenu(page, 'more');
    await expect(menu.getByRole('menuitem')).toHaveText(['Rubrics']);
    await page.keyboard.press('Escape');
    await done.click();
    await expect(page.locator('.assess-card').first()).toBeVisible();
    await expect(page.locator('.atb-end > [data-alv-view="cards"]')).toHaveCount(0);
  });

  test('Escape closes a menu and returns the focus to its button; a click outside closes it', async ({ page }) => {
    await openDemo(page);
    for (const which of ['more', 'new']) {
      const button = page.locator('[data-atb="' + which + '"]');
      await button.click();
      const menu = page.locator('.atb-' + which + '-wrap .assess-menu');
      await expect(menu).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      // The arrow keys move through the items, as the page's other menus do.
      const first = menu.getByRole('menuitem').first();
      await expect(first).toBeFocused();
      // With two or more items the arrows move between them, and wrap.
      const count = await menu.getByRole('menuitem').count();
      await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitem').nth(1 % count)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(first).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(button).toBeFocused();
      await button.click();
      await expect(menu).toBeVisible();
      await page
        .locator('.assess-card .assess-title')
        .first()
        .click({ position: { x: 4, y: 4 } });
      await expect(menu).toBeHidden();
      // Closed by a click: a card opened, so close it again for the next round.
      await page.locator('.assess-card.open .assess-header').first().click();
    }
  });

  test('▾ is joined to + New Assessment, holds New Quiz and Add From Another Class, and gives focus back', async ({
    page,
  }) => {
    await openDemo(page);
    const main = page.locator('[data-action="showNewForm"]');
    const more = page.locator('[data-atb="new"]');
    await expect(more).toHaveAccessibleName('More Ways to Add');
    const a = await main.boundingBox();
    const b = await more.boundingBox();
    expect(Math.round((b.x - (a.x + a.width)) * 10) / 10).toBe(1);
    expect(a.height).toBe(32);
    expect(b.height).toBe(32);
    // Shared corners are square.
    expect(await main.evaluate(el => getComputedStyle(el).borderTopRightRadius)).toBe('0px');
    expect(await more.evaluate(el => getComputedStyle(el).borderTopLeftRadius)).toBe('0px');
    const menu = await openToolbarMenu(page, 'new');
    const items = (await menu.getByRole('menuitem').allTextContents()).map(t => t.trim());
    expect(items).toContain('New Quiz');
    // Add From Another Class opens its dialog; Escape there returns to the ▾.
    if (items.includes('Add From Another Class')) {
      await menu.getByRole('menuitem', { name: 'Add From Another Class' }).click();
      await expect(page.getByRole('dialog', { name: 'Add From Another Class' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(more).toBeFocused();
    }
  });

  test('the ▾ is not drawn when its menu has nothing in it', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => {
      setStudentPageSwitch(getActiveCourse(), false);
      PageAssignments.render();
    });
    const menu = await page.locator('.atb-new .assess-menu-item').allTextContents();
    expect(menu.map(t => t.trim())).not.toContain('New Quiz');
    if (!menu.length) await expect(page.locator('[data-atb="new"]')).toHaveCount(0);
  });
});

test.describe('chips', () => {
  test('each filter that is on has a chip, 24px, with an × that removes it; the button is tinted', async ({ page }) => {
    await openDemo(page);
    const filter = page.locator('.atb-filter-btn');
    await expect(page.locator('.atb-chip')).toHaveCount(0);
    await filter.click();
    await page.locator('.assess-filter-menu [data-catid]').first().click();
    await page.locator('.assess-filter-menu [data-action="toggleUngraded"]').click();
    await expect(page.locator('.atb-chip')).toHaveCount(2);
    await expect(filter).toHaveClass(/has-filters/);
    expect(
      await page
        .locator('.atb-chip')
        .first()
        .evaluate(el => el.getBoundingClientRect().height),
    ).toBe(24);
    const name = (await page.locator('.assess-filter-menu [data-catid]').first().innerText()).trim();
    await expect(page.locator('.atb-chip').first()).toHaveText(name);
    await expect(page.locator('.atb-chip').nth(1)).toHaveText('Ungraded Only');
    await page.keyboard.press('Escape');
    await page.locator('.atb-chip').nth(1).click();
    await expect(page.locator('.atb-chip')).toHaveCount(1);
    await page.locator('.atb-chip').first().click();
    await expect(page.locator('.atb-chip')).toHaveCount(0);
    await expect(filter).not.toHaveClass(/has-filters/);
  });
});

test.describe('a card’s category pill', () => {
  test('is a button that filters to its category without opening or closing the card', async ({ page }) => {
    await openDemo(page);
    const card = page.locator('.assess-card').first();
    const pill = card.locator('button.type-badge');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('aria-pressed', 'false');
    const total = await page.locator('.assess-card').count();
    const wasOpen = await card.evaluate(el => el.classList.contains('open'));
    const cat = (await pill.innerText()).trim();
    await pill.click();
    await expect(page.locator('.atb-chip')).toHaveText([cat]);
    expect(await page.locator('.assess-card').count()).toBeLessThan(total);
    const same = page.locator('.assess-card').first();
    expect(await same.evaluate(el => el.classList.contains('open'))).toBe(wasOpen);
    await expect(same.locator('button.type-badge')).toHaveAttribute('aria-pressed', 'true');
    // Clicked again, it takes the filter off.
    await same.locator('button.type-badge').click();
    await expect(page.locator('.atb-chip')).toHaveCount(0);
    await expect(page.locator('.assess-card')).toHaveCount(total);
  });
});

test.describe('point to preview', () => {
  const opacity = (page, sel) =>
    page
      .locator(sel)
      .first()
      .evaluate(el => Number(getComputedStyle(el).opacity));

  test('the cards an unpressed option would not keep dim while it is pointed at; a pressed one does not', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => !!getActiveCourse() && getAssessments(getActiveCourse()).length > 0);
    await page.goto('/assignments');
    await expect(page.locator('.atb-show')).toBeVisible();
    const cards = await page
      .locator('.assess-card')
      .evaluateAll(cs => cs.map(c => ({ id: c.id, has: c.dataset.has || '' })));
    const dimmed = cards.find(c => !c.has.split(' ').includes('tograde'));
    const kept = cards.find(c => c.has.split(' ').includes('tograde'));
    expect(dimmed && kept).toBeTruthy();
    await show(page, 'tograde').hover();
    // After its short delay and fade, the others are at about .4; the ones it keeps are whole.
    await expect.poll(() => opacity(page, '#' + dimmed.id)).toBeCloseTo(0.4, 1);
    expect(await opacity(page, '#' + kept.id)).toBe(1);
    // Moving off puts them back.
    await page.mouse.move(700, 600);
    await expect.poll(() => opacity(page, '#' + dimmed.id)).toBe(1);
    // Keyboard focus previews too.
    await show(page, 'tograde').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => opacity(page, '#' + dimmed.id)).toBeCloseTo(0.4, 1);
    // Pressed, it is the list, not a preview.
    await show(page, 'tograde').click();
    await expect.poll(() => opacity(page, '.assess-card')).toBe(1);
  });

  test('is a transition of 150ms after 120ms, and none with reduced motion', async ({ page }) => {
    for (const reduce of [false, true]) {
      await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/login.html?demo=1');
      await page.waitForURL(/\/dashboard/, { timeout: 15000 });
      await page.waitForFunction(() => !!getActiveCourse() && getAssessments(getActiveCourse()).length > 0);
      await page.goto('/assignments');
      await expect(page.locator('.atb-show')).toBeVisible();
      const dimmed = await page
        .locator('.assess-card')
        .evaluateAll(cs => cs.find(c => !(c.dataset.has || '').split(' ').includes('notin')).id);
      await show(page, 'notin').hover();
      await expect.poll(() => opacity(page, '#' + dimmed)).toBeCloseTo(0.4, 1);
      const t = await page.locator('#' + dimmed).evaluate(el => {
        const cs = getComputedStyle(el);
        return [cs.transitionDuration, cs.transitionDelay];
      });
      // The app's own reduced-motion rule makes a transition 1e-5s long.
      if (reduce) expect(parseFloat(t[0])).toBeLessThan(0.001);
      else expect(t).toEqual(['0.15s', '0.12s']);
    }
  });
});
