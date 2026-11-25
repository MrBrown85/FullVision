/**
 * The Observations feed's bar and filter panel, in the Assignments toolbar's
 * "Three Things" style (teacher/obs-toolbar.js; Colin, Nov 25: "Build it"):
 * Search with Filter in its end, Show (All, Open Concerns with its count), a
 * chip for each filter that is on; the filter panel (Student, Tag, Type with
 * Date, Context with Assessment and Quoted) floating over the feed; a card's
 * type and tags as filters; the point to preview. Demo Mode, Science 8, with
 * the roster open: 25 students, eight open concerns.
 *
 * Layout is asserted in the page's own font and in the wide stand-in for CI's
 * Linux fonts (e2e/wide-font.js): no sideways overflow, one row from 1280, a
 * clean wrap below, and the panel inside a 1280 x 720 window.
 */
import { test, expect } from '@playwright/test';
import { useFont } from './wide-font.js';
import { chipsWhole } from './helpers.js';

// The wide stand-in is a style the page's own CSP would refuse.
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });

async function openDemo(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // Demo Mode seeds its sample class after the page opens.
  await page.waitForFunction(() => getAssessments('sci8').length > 0 && getOpenConcerns('sci8').length > 0);
  await page.goto('/observations?course=sci8');
  await expect(page.locator('.obs-toolbar .atb-show')).toBeVisible();
  await expect(page.locator('.obs-card').first()).toBeVisible();
}

const bar = page => page.locator('.obs-toolbar');
const show = (page, key) => page.locator('.atb-show [data-show="' + key + '"]');
const filterBtn = page => page.locator('.obs-toolbar .atb-filter-btn');
const panel = page => page.locator('.obp-panel');
const row = (page, grp, value) => page.locator('.obp-row[data-grp="' + grp + '"][data-value="' + value + '"]');
const cards = page => page.locator('#obs-feed .obs-card');
const chipLabels = page => page.locator('#obs-chips .atb-chip-label');
const openConcerns = page => page.evaluate(() => getOpenConcerns('sci8').length);

/* The bar's parts: no sideways overflow and nothing past the bar's edges;
   returns the rows they sit in and any two that overlap (a part clipped). */
async function fits(page) {
  return page.evaluate(() => {
    const tb = document.querySelector('.obs-toolbar');
    const t = tb.getBoundingClientRect();
    const parts = [...tb.querySelectorAll(':scope > *, .atb-show .seg-btn')]
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

// Every control of the bar that is drawn, as { name, x, y, w, h }.
const boxes = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.obs-toolbar .atb-search, .obs-toolbar .atb-show .seg-btn, .obs-toolbar .atb-chip')]
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          name: el.dataset.show || el.dataset.kind || 'search',
          x: Math.round(r.x * 10) / 10,
          y: Math.round(r.y * 10) / 10,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        };
      })
      .filter(b => b.w && b.h),
  );

test.describe('layout', () => {
  for (const font of ['page', 'wide']) {
    for (const width of [1280, 1440, 1680]) {
      test(`no sideways overflow at ${width} wide (${font} font), one row`, async ({ page }) => {
        await openDemo(page, width);
        await useFont(page, font);
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
              '.obs-toolbar .atb-search, .obs-toolbar .atb-search input, .obs-toolbar .atb-filter-btn, .obs-toolbar .atb-show',
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
      test(`wraps cleanly at ${width} wide (${font} font), nothing clipped`, async ({ page }) => {
        await openDemo(page, width, height);
        await useFont(page, font);
        const f = await fits(page);
        expect(f.page).toBeLessThanOrEqual(0);
        expect(f.overflow).toBeLessThanOrEqual(1);
        expect(f.outside).toEqual([]);
        expect(f.overlaps).toEqual([]);
        for (const sel of ['.atb-search', '.atb-show']) {
          const r = await page.locator('.obs-toolbar ' + sel).boundingBox();
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(width);
        }
      });
    }
    test(`with more filters on than fit, every chip on screen shows its full label (${font} font)`, async ({
      page,
    }) => {
      for (const width of [1280, 1440]) {
        await openDemo(page, width);
        await useFont(page, font);
        await filterBtn(page).click();
        for (const v of ['Cece Adeyemi', 'Noor Al-Rashid'])
          await page.locator('.obp-students .obp-row', { hasText: v }).click();
        await row(page, 'y', 'concern').click();
        await row(page, 'c', 'independent').click();
        await row(page, 'd', 'week').click();
        await row(page, 'a', 'unlinked').click();
        await row(page, 'q', 'unquoted').click();
        await page.locator('.obp-tags .obp-row').first().click();
        await page.keyboard.press('Escape');
        const chips = await chipsWhole(page, '.obs-toolbar .atb-chips');
        // Two students are one chip.
        expect(chips.length).toBe(7);
        for (const c of chips) if (c.on) expect(c, `${width}: ${c.text}`).toMatchObject({ within: true, full: true });
        const f = await fits(page);
        expect(f.rows).toBe(1);
        expect(f.outside).toEqual([]);
        expect(f.overlaps).toEqual([]);
      }
    });
  }

  test('a chip wider than the room is left off, not cut', async ({ page }) => {
    await openDemo(page, 1280);
    await page.evaluate(() => {
      const st = getStudents('sci8')[0];
      st.firstName = 'Alexandrina Bartholomew Christopher';
      st.lastName = 'Featherstonehaugh-Wolverhampton-Smythe-Montgomery';
      PageObservations.render();
    });
    await filterBtn(page).click();
    await page.locator('.obp-students .obp-row').first().click();
    await page.keyboard.press('Escape');
    const [chip] = await chipsWhole(page, '.obs-toolbar .atb-chips');
    expect(chip.on ? chip.within && chip.full : true).toBe(true);
  });

  test('Search is 280 wide when there is room, with Filter inside its right end and the field’s height', async ({
    page,
  }) => {
    await openDemo(page, 1680);
    const search = await bar(page).locator('.atb-search').boundingBox();
    expect(search.width).toBe(280);
    expect(search.height).toBe(32);
    const filter = await filterBtn(page).boundingBox();
    expect(filter.height).toBe(32);
    expect(filter.x + filter.width).toBeCloseTo(search.x + search.width, 0);
    await expect(filterBtn(page)).toHaveAttribute('aria-label', 'Filter');
    await expect(filterBtn(page)).toHaveAttribute('title', 'Filter');
    // Narrower, it gives way to 160 before anything wraps.
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await bar(page).locator('.atb-search').boundingBox()).width).toBeGreaterThanOrEqual(160);
  });

  test('the count at the right is gone', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('#obs-count')).toHaveCount(0);
    await expect(page.locator('.obs-toolbar-count')).toHaveCount(0);
    await expect(page.locator('.obs-filter-chip')).toHaveCount(0);
  });
});

test.describe('Show', () => {
  test('All and Open Concerns, one at a time; the badge counts the open concerns', async ({ page }) => {
    await openDemo(page);
    const n = await openConcerns(page);
    expect(n).toBeGreaterThan(0);
    await expect(page.locator('.atb-show .seg-btn')).toHaveText(['All', 'Open Concerns' + n]);
    await expect(show(page, 'all')).toHaveAttribute('aria-pressed', 'true');
    await expect(show(page, 'concerns')).toHaveAttribute('aria-pressed', 'false');
    await expect(show(page, 'concerns').locator('.atb-badge')).toHaveText(String(n));
    const total = await cards(page).count();

    await show(page, 'concerns').click();
    await expect(show(page, 'concerns')).toHaveAttribute('aria-pressed', 'true');
    await expect(show(page, 'all')).toHaveAttribute('aria-pressed', 'false');
    await expect(cards(page)).toHaveCount(n);
    await expect(cards(page).locator('.obs-type')).toHaveText(Array(n).fill('Concern'));
    // Pressed again, everything is back.
    await show(page, 'concerns').click();
    await expect(show(page, 'all')).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(total);
    // All lets go of it too.
    await show(page, 'concerns').click();
    await expect(cards(page)).toHaveCount(n);
    await show(page, 'all').click();
    await expect(cards(page)).toHaveCount(total);
    // All, pressed already, does nothing.
    await show(page, 'all').click();
    await expect(show(page, 'all')).toHaveAttribute('aria-pressed', 'true');
    await expect(cards(page)).toHaveCount(total);
  });

  test('pressing an option moves and resizes nothing else', async ({ page }) => {
    await openDemo(page);
    for (const font of ['page', 'wide']) {
      await useFont(page, font);
      const before = await boxes(page);
      await show(page, 'concerns').click();
      const during = await boxes(page);
      await show(page, 'all').click();
      const after = await boxes(page);
      expect(during).toEqual(before);
      expect(after).toEqual(before);
    }
  });

  test('the badge follows a concern closed and opened, and keeps its room at none', async ({ page }) => {
    await openDemo(page);
    const n = await openConcerns(page);
    const badge = show(page, 'concerns').locator('.atb-badge');
    // A new Concern opens one (a click on the roster picks the student for the note).
    await page.locator('#gb-roster-list .student-row', { hasText: 'Hannah Berg' }).click();
    await page.locator('.obsc-chip-type', { hasText: 'Concern' }).click();
    await page.locator('#capture-input').fill('Left the lab without asking');
    await page.keyboard.press('Enter');
    const card = page.locator('.obs-card', { hasText: 'Left the lab without asking' });
    await expect(card).toBeVisible();
    await expect(badge).toHaveText(String(n + 1));
    // A Resolved follow-up closes it.
    await card.getByRole('button', { name: '+ Follow Up' }).click();
    const dialog = page.getByRole('dialog', { name: 'Follow Up' });
    await dialog.getByRole('button', { name: 'Resolved' }).click();
    await page.keyboard.type('Talked it through; back on task.');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(badge).toHaveText(String(n));
    // At none, the badge is not shown and Open Concerns does not move.
    const before = await show(page, 'concerns').boundingBox();
    await page.evaluate(() => {
      getOpenConcerns('sci8').forEach(o => addObservationFollowUp('sci8', o.id, 'resolved', 'Done'));
      document.dispatchEvent(new CustomEvent('fv:follow-ups-changed'));
    });
    await expect(badge).toBeHidden();
    await expect(show(page, 'concerns')).toBeVisible();
    expect(await show(page, 'concerns').boundingBox()).toEqual(before);
  });
});

test.describe('the filter panel', () => {
  test('Filter opens a panel of four columns under Search; Escape closes it and returns to Filter', async ({
    page,
  }) => {
    await openDemo(page);
    await expect(filterBtn(page)).toHaveAttribute('aria-expanded', 'false');
    await filterBtn(page).click();
    await expect(filterBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('.assess-filter-head')).toContainText([
      'Student',
      'Tag',
      'Type',
      'Date',
      'Context',
      'Assessment',
      'Quoted',
    ]);
    const s = await bar(page).locator('.atb-search').boundingBox();
    const p = await panel(page).boundingBox();
    expect(p.x).toBeCloseTo(s.x, 0);
    expect(p.y).toBeGreaterThan(s.y + s.height);
    // Every row is 34px, in a short column and in a list that scrolls alike:
    // not stretched to fill a column, nor squeezed to fit one.
    const heights = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('.obp-panel .assess-filter-item')]
          .filter(el => el.getBoundingClientRect().width > 0 && !el.closest('.gbf-foot'))
          .map(el => Math.round(el.getBoundingClientRect().height)),
      ),
    ]);
    expect(heights).toEqual([34]);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(filterBtn(page)).toBeFocused();
    // A click outside closes it too; a click on Filter again as well.
    await filterBtn(page).click();
    await page.locator('#obs-feed').click({ position: { x: 5, y: 5 } });
    await expect(panel(page)).toHaveCount(0);
    await filterBtn(page).click();
    await filterBtn(page).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('the panel stays inside a 1280 x 720 window, and no name in it is cut short', async ({ page }) => {
    for (const font of ['page', 'wide']) {
      await openDemo(page, 1280, 720);
      await useFont(page, font);
      await filterBtn(page).click();
      await row(page, 'd', 'custom').click();
      const p = await panel(page).boundingBox();
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(1280);
      expect(p.y + p.height).toBeLessThanOrEqual(720);
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll('.obp-panel .gbf-name')]
          .filter(el => el.scrollWidth > el.clientWidth + 0.5)
          .map(el => el.textContent),
      );
      expect(cut).toEqual([]);
    }
  });

  test('Student: a search box over the class, any number ticked, in step with the roster and the feed', async ({
    page,
  }) => {
    await openDemo(page);
    const all = await cards(page).count();
    await filterBtn(page).click();
    const students = panel(page).locator('.obp-students .obp-row');
    expect(await students.count()).toBeGreaterThan(20);
    const find = panel(page).locator('.obp-find[data-find="s"]');
    await find.fill('ethan');
    await expect(students.filter({ visible: true })).toHaveCount(1);
    await students.filter({ visible: true }).click();
    // The panel stays open with its search text; the feed, the chip, the roster follow.
    await expect(panel(page)).toBeVisible();
    await expect(find).toHaveValue('ethan');
    await expect(chipLabels(page)).toHaveText(['Ethan Dubois']);
    await expect(filterBtn(page)).toHaveClass(/has-filters/);
    const feed = await cards(page).count();
    expect(feed).toBeGreaterThan(0);
    expect(feed).toBeLessThan(all);
    await expect(cards(page).locator('.obs-card-student')).toHaveText(Array(feed).fill('Ethan Dubois'));
    await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveCount(1);
    await expect(page.locator('#gb-roster-list .student-row.selected')).toContainText('Ethan Dubois');
    // A second student.
    await find.fill('');
    await panel(page).locator('.obp-students .obp-row', { hasText: 'Sofia Petrov' }).click();
    await expect(chipLabels(page)).toHaveText(['2 students']);
    await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveCount(2);
    // A click on the roster is in the panel too.
    await page.locator('#gb-roster-list .student-row', { hasText: 'Jas Gill' }).click();
    await expect(chipLabels(page)).toHaveText(['Jas Gill']);
    await filterBtn(page).click();
    await expect(panel(page).locator('.obp-students .obp-row[aria-checked="true"]')).toHaveText(['Jas Gill']);
    // The chip's x lets go of the students, and the roster with them.
    await page.locator('#obs-chips .atb-chip').click();
    await expect(chipLabels(page)).toHaveCount(0);
    await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveCount(0);
    await expect(cards(page)).toHaveCount(all);
    await expect(panel(page).locator('.obp-students .obp-row[aria-checked="true"]')).toHaveCount(0);
  });

  test('Tag: a search box over the tags with their sections, any number ticked', async ({ page }) => {
    await openDemo(page);
    await filterBtn(page).click();
    const col = panel(page).locator('.obp-tags');
    await expect(col.locator('[data-section]')).toContainText(['Learning dispositions']);
    await col.locator('.obp-find').fill('resilien');
    await expect(col.locator('.obp-row').filter({ visible: true })).toHaveCount(1);
    // A section with nothing left in it is gone with its rows.
    await expect(col.locator('[data-section]').filter({ visible: true })).toHaveCount(1);
    await col.locator('.obp-row').filter({ visible: true }).click();
    await expect(chipLabels(page)).toHaveText(['Resilience']);
    await col.locator('.obp-find').fill('');
    await col.locator('.obp-row', { hasText: 'Engagement' }).click();
    await expect(chipLabels(page)).toHaveText(['2 tags']);
    await expect(
      cards(page).filter({ has: page.locator('.obs-card-dim', { hasText: /Resilience|Engagement/ }) }),
    ).toHaveCount(await cards(page).count());
    await expect(panel(page)).toBeVisible();
  });

  test('Type, Date, Context, Assessment, Quoted: one at a time, the chosen one again lets go', async ({ page }) => {
    await openDemo(page);
    const all = await cards(page).count();
    await filterBtn(page).click();
    const checked = grp => page.locator('.obp-row[data-grp="' + grp + '"][aria-checked="true"]');
    for (const [grp, a, b, chipA, chipB] of [
      ['y', 'growth', 'strength', 'Growth', 'Strength'],
      ['c', 'independent', 'small-group', 'Independent', 'Small group'],
      ['d', 'week', 'custom', 'This week', 'Custom dates'],
      ['a', 'linked', 'unlinked', 'Linked to an assessment', 'Not linked'],
      ['q', 'quoted', 'unquoted', 'Quoted in a report', 'Not yet quoted'],
    ]) {
      await expect(row(page, grp, a)).toHaveAttribute('role', 'radio');
      await row(page, grp, a).click();
      await expect(checked(grp)).toHaveCount(1);
      await expect(chipLabels(page).filter({ hasText: chipA })).toHaveCount(1);
      await row(page, grp, b).click();
      await expect(checked(grp)).toHaveCount(1);
      await expect(row(page, grp, b)).toHaveAttribute('aria-checked', 'true');
      await expect(chipLabels(page).filter({ hasText: chipB })).toHaveCount(1);
      await expect(chipLabels(page).filter({ hasText: chipA })).toHaveCount(0);
      await row(page, grp, b).click();
      await expect(checked(grp)).toHaveCount(0);
      await expect(chipLabels(page)).toHaveCount(0);
    }
    await expect(cards(page)).toHaveCount(all);
    // They narrow the feed as they always did.
    await row(page, 'y', 'strength').click();
    await expect(cards(page).locator('.obs-type')).toHaveText(Array(await cards(page).count()).fill('Strength'));
    await row(page, 'q', 'quoted').click();
    await expect(page.locator('#obs-feed .obs-card-quoted')).toHaveCount(await cards(page).count());
  });

  test('Custom dates shows From and To; the range is a chip and narrows the feed', async ({ page }) => {
    await openDemo(page);
    await filterBtn(page).click();
    await expect(panel(page).locator('.obp-dates')).toBeHidden();
    await row(page, 'd', 'custom').click();
    await expect(panel(page).locator('.obp-dates')).toBeVisible();
    await expect(page.locator('#filter-date-from')).toBeFocused();
    await expect(chipLabels(page)).toHaveText(['Custom dates']);
    const days = await page.locator('#obs-feed .obs-feed-date-label span:first-child').allTextContents();
    expect(days.length).toBeGreaterThan(1);
    // From the day before the newest.
    const newest = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#obs-feed .obs-card')].length;
      return getAllQuickObs('sci8')
        .map(o => o.date || o.created.slice(0, 10))
        .sort()
        .pop();
    });
    await page.locator('#filter-date-from').fill(newest);
    await expect(chipLabels(page)).toHaveText([/^From /]);
    await expect(page.locator('#obs-feed .obs-feed-date-label')).toHaveCount(1);
    await page.locator('#filter-date-to').fill(newest);
    await expect(chipLabels(page)).toHaveText([/ – /]);
    // The panel is still open, with the dates in it.
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('#filter-date-to')).toHaveValue(newest);
    // Another date choice lets go of the range and hides the inputs.
    await row(page, 'd', 'week').click();
    await expect(panel(page).locator('.obp-dates')).toBeHidden();
    await expect(page.locator('#filter-date-from')).toHaveValue('');
    await expect(chipLabels(page)).toHaveText(['This week']);
  });

  test('ticking keeps the panel open and the keyboard on the same row; the arrow keys move through a column', async ({
    page,
  }) => {
    await openDemo(page);
    await filterBtn(page).click();
    const students = panel(page).locator('.obp-students .obp-row');
    await panel(page).locator('.obp-find[data-find="s"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(students.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(students.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(students.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(students.nth(1)).toBeFocused();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    // Up from the first row wraps to the last.
    await expect(students.last()).toBeFocused();
    // A radio row too.
    await row(page, 'y', 'concern').focus();
    await page.keyboard.press('Space');
    await expect(row(page, 'y', 'concern')).toBeFocused();
    await expect(row(page, 'y', 'concern')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'y', 'note')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'd', 'week')).toBeFocused();
    // A column's list scrolls inside it; the panel keeps its size.
    const before = await panel(page).boundingBox();
    await students.last().scrollIntoViewIfNeeded();
    await students.last().click();
    expect(await panel(page).boundingBox()).toEqual(before);
  });

  test('Clear Filters is on only while a filter is, and lets go of the panel’s filters', async ({ page }) => {
    await openDemo(page);
    const all = await cards(page).count();
    await filterBtn(page).click();
    const clear = panel(page).getByRole('button', { name: 'Clear Filters' });
    await expect(clear).toBeDisabled();
    await row(page, 'y', 'strength').click();
    await panel(page).locator('.obp-students .obp-row').first().click();
    await expect(clear).toBeEnabled();
    await expect(chipLabels(page)).toHaveCount(2);
    await clear.click();
    await expect(clear).toBeDisabled();
    await expect(chipLabels(page)).toHaveCount(0);
    await expect(filterBtn(page)).not.toHaveClass(/has-filters/);
    await expect(cards(page)).toHaveCount(all);
    await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveCount(0);
  });

  test('the search box narrows the feed as before, and Filter goes blue only for the panel’s filters', async ({
    page,
  }) => {
    await openDemo(page);
    const all = await cards(page).count();
    await page.locator('#obs-search-input').fill('lab skills');
    await expect(cards(page)).not.toHaveCount(all);
    await expect(filterBtn(page)).not.toHaveClass(/has-filters/);
    await expect(chipLabels(page)).toHaveCount(0);
    await page.locator('#obs-search-input').fill('');
    await expect(cards(page)).toHaveCount(all);
  });
});

test.describe('chips', () => {
  test('a chip for each filter that is on, labelled as the state, and its x removes it', async ({ page }) => {
    await openDemo(page);
    await filterBtn(page).click();
    await panel(page).locator('.obp-students .obp-row', { hasText: 'Ethan Dubois' }).click();
    await panel(page).locator('.obp-tags .obp-row', { hasText: 'Self-Regulation' }).click();
    await row(page, 'y', 'concern').click();
    await row(page, 'c', 'independent').click();
    await row(page, 'd', 'week').click();
    await row(page, 'a', 'unlinked').click();
    await row(page, 'q', 'unquoted').click();
    await page.keyboard.press('Escape');
    await expect(chipLabels(page)).toHaveText([
      'Ethan Dubois',
      'Self-Regulation & Reflection',
      'Concern',
      'Independent',
      'This week',
      'Not linked',
      'Not yet quoted',
    ]);
    await expect(page.locator('#obs-chips .atb-chip').first()).toHaveAttribute(
      'aria-label',
      'Remove Filter: Ethan Dubois',
    );
    // Each x removes its filter; Filter takes the keyboard.
    await page.locator('#obs-chips .atb-chip[data-kind="type"]').click();
    await expect(filterBtn(page)).toBeFocused();
    await expect(chipLabels(page)).not.toContainText(['Concern']);
    await page.locator('#obs-chips .atb-chip[data-kind="date"]').click();
    await page.locator('#obs-chips .atb-chip[data-kind="students"]').click();
    await page.locator('#obs-chips .atb-chip[data-kind="tags"]').click();
    await expect(chipLabels(page)).toHaveText(['Independent', 'Not linked', 'Not yet quoted']);
    // Open Concerns is in Show, not a chip.
    await show(page, 'concerns').click();
    await expect(chipLabels(page)).toHaveCount(3);
  });
});

test.describe('a card’s type and tags', () => {
  test('the type badge sets the Type filter, again lets go, and neither opens the card', async ({ page }) => {
    await openDemo(page);
    const all = await cards(page).count();
    const badge = cards(page).first().locator('.obs-type');
    const type = (await badge.textContent()).trim();
    await badge.click();
    await expect(page.locator('#obs-focus-backdrop')).toHaveCount(0);
    await expect(chipLabels(page)).toHaveText([type]);
    expect(await cards(page).count()).toBeLessThan(all);
    await expect(cards(page).locator('.obs-type')).toHaveText(Array(await cards(page).count()).fill(type));
    // The same control, where it is still there, keeps the keyboard.
    await expect(cards(page).first().locator('.obs-type')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(chipLabels(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(all);
    await expect(page.locator('#obs-focus-backdrop')).toHaveCount(0);
  });

  test('a tag toggles that tag’s filter, from the keyboard too', async ({ page }) => {
    await openDemo(page);
    const all = await cards(page).count();
    const tag = cards(page).locator('button.obs-card-dim').first();
    const name = (await tag.textContent()).trim();
    await tag.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#obs-focus-backdrop')).toHaveCount(0);
    await expect(chipLabels(page)).toHaveText([name]);
    expect(await cards(page).count()).toBeLessThan(all);
    // Another tag on a card adds to it ("2 tags"); the first again lets go of it.
    await cards(page).first().locator('button.obs-card-dim', { hasText: name }).click();
    await expect(chipLabels(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(all);
  });

  test('other pages’ cards are not buttons', async ({ page }) => {
    await openDemo(page);
    await page.goto('/student?id=st1&course=sci8');
    await page.locator('#stu-tab-evidence').click();
    await expect(page.locator('#ev-panel .obs-card').first()).toBeVisible();
    await expect(page.locator('#ev-panel button.obs-type, #ev-panel button.obs-card-dim')).toHaveCount(0);
  });
});

test.describe('point to preview', () => {
  // The sample class's concerns are old, past the newest 50 the feed draws: two new ones, today's, one closed.
  async function twoConcerns(page) {
    await page.evaluate(() => {
      addQuickOb('sci8', 'st6', 'Still open concern', [], 'concern', null);
      addQuickOb('sci8', 'st7', 'Closed concern', [], 'concern', null);
      const closed = getQuickObs('sci8').st7.find(o => o.text === 'Closed concern');
      addObservationFollowUp('sci8', closed.id, 'resolved', 'Done');
      PageObservations.render();
    });
  }
  const opacity = (page, sel) =>
    page
      .locator(sel)
      .first()
      .evaluate(el => Number(getComputedStyle(el).opacity));
  const notOpen = '#obs-feed .obs-card:not([data-sentiment="concern"])';
  const closed = '#obs-feed .obs-card:has-text("Closed concern")';
  const open = '#obs-feed .obs-card:has-text("Still open concern")';

  test('resting on an unpressed Open Concerns dims the cards that are not open concerns', async ({ page }) => {
    await openDemo(page);
    await twoConcerns(page);
    // The dim is eased, after a short wait.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await opacity(page, notOpen)).toBe(1);
    await show(page, 'concerns').hover();
    await expect.poll(() => opacity(page, notOpen), { timeout: 3000 }).toBeCloseTo(0.35, 1);
    // A concern with a Resolved follow-up is not open, so it dims too; an open one does not.
    await expect.poll(() => opacity(page, closed)).toBeCloseTo(0.35, 1);
    expect(await opacity(page, open)).toBe(1);
    // Keyboard focus does the same.
    await page.mouse.move(5, 5);
    await expect.poll(() => opacity(page, notOpen)).toBe(1);
    await show(page, 'all').focus();
    await page.keyboard.press('Tab');
    await expect(show(page, 'concerns')).toBeFocused();
    await expect.poll(() => opacity(page, notOpen), { timeout: 3000 }).toBeCloseTo(0.35, 1);
    // A pressed Open Concerns has nothing to preview.
    await page.keyboard.press('Enter');
    await expect(show(page, 'concerns')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(open)).toBeVisible();
    await expect.poll(() => opacity(page, open)).toBe(1);
  });

  test('with reduced motion the dim is not eased', async ({ page }) => {
    await openDemo(page);
    const t = await page
      .locator('#obs-feed .obs-card')
      .first()
      .evaluate(el => getComputedStyle(el).transitionProperty);
    expect(t).not.toContain('opacity');
  });
});
