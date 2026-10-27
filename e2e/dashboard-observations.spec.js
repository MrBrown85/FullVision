import { test, expect } from '@playwright/test';

/* The dashboard's Observations card (docs/DECISIONS.md, "Observations
   (2026-10-18)", item 4) in Demo Mode on Science 8: its place, both tabs,
   flags, the "+" dialog, the week popover and the jump to the
   student page. The demo class has no competency gaps and no linked
   observations, so the tests make them through the data layer and read the
   expected counts from the page. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
}

async function openDashboard(page) {
  await page.goto('/dashboard?course=sci8');
  await expect(page.locator('#dash-obs-card .dash-ob2-row[data-sid]').first()).toBeVisible();
}

const card = page => page.locator('#dash-obs-card');

test.describe('Dashboard Observations card', () => {
  test('the card spans the page under the competencies and never scrolls sideways', async ({ page }) => {
    await enterDemo(page);
    for (const width of [800, 1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await openDashboard(page);
      for (const tab of ['By Week', 'By Competency']) {
        await card(page).getByRole('tab', { name: tab }).click();
        await expect(card(page).getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
        const m = await page.evaluate(() => {
          const g = document.querySelector('.dash-glance').getBoundingClientRect();
          const n = document.querySelector('#dash-na-card').getBoundingClientRect();
          const o = document.querySelector('#dash-obs-card').getBoundingClientRect();
          return {
            left: Math.abs(o.left - g.left),
            right: Math.abs(o.right - g.right),
            below: o.top >= n.bottom,
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
            cardRight: o.right,
          };
        });
        expect(m.scrollW, `sideways scroll at ${width} on ${tab}`).toBeLessThanOrEqual(m.clientW);
        expect(m.cardRight).toBeLessThanOrEqual(m.clientW);
        // As wide as the top bar, below Needs Attention.
        expect(m.left).toBeLessThan(1);
        expect(m.right).toBeLessThan(1);
        expect(m.below, `overlaps at ${width} on ${tab}`).toBe(true);
      }
      await card(page).getByRole('tab', { name: 'By Week' }).click();
    }
  });

  test('remembers the tab after a reload, and arrow keys switch it', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    await expect(card(page).getByRole('tab', { name: 'By Week' })).toHaveAttribute('aria-selected', 'true');
    await card(page).getByRole('tab', { name: 'By Competency' }).click();
    await expect(card(page).locator('.dash-ob2-lv').first()).toBeVisible();
    await page.reload();
    await expect(card(page).getByRole('tab', { name: 'By Competency' })).toHaveAttribute('aria-selected', 'true');
    await card(page).getByRole('tab', { name: 'By Competency' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(card(page).getByRole('tab', { name: 'By Week' })).toHaveAttribute('aria-selected', 'true');
    await expect(card(page).getByRole('tab', { name: 'By Week' })).toBeFocused();
  });

  test('a flag dims the other students and clears on a second click', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const flag = card(page).locator('.dash-ob2-flag').first();
    await expect(flag).toBeVisible();
    const count = Number(await flag.locator('b').textContent());
    const rows = card(page).locator('.dash-ob2-row[data-sid]');
    const total = await rows.count();
    await flag.click();
    await expect(card(page).locator('.dash-ob2-flag').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page).locator('.dash-ob2-flag').first()).toBeFocused();
    await expect(card(page).locator('.dash-ob2-row.is-dim')).toHaveCount(total - count);
    // Dimmed rows stay in place.
    await expect(rows).toHaveCount(total);
    await card(page).locator('.dash-ob2-flag').first().click();
    await expect(card(page).locator('.dash-ob2-row.is-dim')).toHaveCount(0);
    // Switching tabs clears a highlight.
    await card(page).locator('.dash-ob2-flag').first().click();
    await card(page).getByRole('tab', { name: 'By Competency' }).click();
    await expect(card(page).locator('.dash-ob2-row.is-dim')).toHaveCount(0);
  });

  test('a week shows its notes on hover and on focus', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const cell = card(page).locator('.dash-ob2-cell.has').first();
    const sid = await cell.getAttribute('data-sid');
    const name = await page.evaluate(id => displayNameFirst(getStudents('sci8').find(s => s.id === id)), sid);
    await cell.hover();
    const pop = page.locator('#dash-ob2-pop');
    await expect(pop).toBeVisible();
    await expect(pop).toContainText(/Week of .+ observation/);
    await expect(pop).toContainText('Click to open in ' + name + '’s Evidence panel');
    await page.mouse.move(0, 0);
    await expect(pop).toBeHidden();
    await cell.focus();
    await expect(pop).toBeVisible();
    await expect(cell).toHaveAttribute('aria-describedby', 'dash-ob2-pop');
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  });

  test('"+" opens the capture dialog for that student and a save updates the card', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const row = card(page).locator('.dash-ob2-row[data-sid]').nth(2);
    const sid = await row.getAttribute('data-sid');
    const fullName = await page.evaluate(id => displayName(getStudents('sci8').find(s => s.id === id)), sid);
    const before = Number(await row.locator('.dash-ob2-total').textContent());
    await row.hover();
    await row.locator('.dash-ob2-add').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.obsc-chip-student')).toHaveText(new RegExp(fullName.split(' ')[0]));
    await dialog.locator('textarea').fill('Set up the balance without help');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    const after = card(page).locator('.dash-ob2-row[data-sid="' + sid + '"]');
    await expect(after.locator('.dash-ob2-total')).toHaveText(String(before + 1));
    await expect(after.locator('.dash-ob2-add')).toBeFocused();
    await expect(after.locator('.dash-ob2-days')).toHaveText('');
  });

  test('closing the "+" dialog at the concern flag offer puts focus back on the row', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const sid = await page.evaluate(() => {
      const flags = getFlags('sci8') || {};
      return getStudents('sci8').find(s => !flags[s.id]).id;
    });
    const add = () => card(page).locator('.dash-ob2-row[data-sid="' + sid + '"] .dash-ob2-add');
    const dialog = page.getByRole('dialog');
    const saveConcern = async text => {
      await add().focus();
      await add().click();
      await expect(dialog).toBeVisible();
      await dialog.locator('.obsc-chip-type[data-value="concern"]').click();
      await dialog.locator('textarea').fill(text);
      await page.keyboard.press('Enter');
      // The dialog stays open to offer the flag; the card behind it redraws.
      await expect(dialog.locator('[data-part="flag"]')).toContainText('Not Now');
    };
    // "Not Now", then Escape.
    await saveConcern('Did not start the lab');
    await dialog.getByRole('button', { name: 'Not Now' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(add()).toBeFocused();
    // The close button straight from the offer.
    await saveConcern('Left the lab bench untidy');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(add()).toBeFocused();
  });

  // The card spans the page beside the student list (#374): 27 students sit
  // in two columns at every desktop width, with compact week cells on a
  // narrow window.
  test('with the student list open, 27 students sit in two columns, with compact week cells below 1200px', async ({
    page,
  }) => {
    await enterDemo(page);
    for (const [width, compact] of [
      [1150, true],
      [1280, false],
      [1600, false],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await openDashboard(page);
      await page.evaluate(() => PageDashboard.render());
      await expect(card(page).locator('.dash-ob2-block')).toHaveCount(2);
      const m = await page.evaluate(() => DashObservations.lastModel());
      expect(m.cols, `columns at ${width}`).toBe(2);
      expect(m.compact, `compact at ${width}`).toBe(compact);
      const pane = await card(page)
        .locator('.dash-ob2-pane')
        .evaluate(p => p.scrollWidth <= p.clientWidth);
      expect(pane, `grid scrolls sideways at ${width}`).toBe(true);
    }
  });

  test('a busy week keeps its whole "+N" at every width: three marks, or one in a compact cell', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const [few, many] = await page.evaluate(() => {
      const st = getStudents('sci8');
      for (let i = 0; i < 5; i++) addQuickOb('sci8', st[0].id, 'Busy week ' + i, [], 'strength', null);
      for (let i = 0; i < 13; i++) addQuickOb('sci8', st[1].id, 'Busy week ' + i, [], null, null);
      return [st[0].id, st[1].id];
    });
    for (const width of [1150, 1280, 1440, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => PageDashboard.render());
      const measure = sid =>
        card(page)
          .locator('.dash-ob2-cell.has-more[data-sid="' + sid + '"]')
          .last()
          .evaluate(cell => {
            const c = cell.getBoundingClientRect();
            const more = cell.querySelector('.dash-ob2-more');
            const r = more.getBoundingClientRect();
            return {
              fits: cell.scrollWidth <= cell.clientWidth && r.left >= c.left && r.right <= c.right + 0.5,
              label: more.textContent,
              marks: [...cell.querySelectorAll('i')].map(i => i.getBoundingClientRect().width),
            };
          });
      const compact = await page.evaluate(() => DashObservations.lastModel().compact);
      for (const sid of [few, many]) {
        await expect.poll(async () => (await measure(sid)).fits, `"+N" cut at ${width}`).toBe(true);
        const m = await measure(sid);
        expect(m.marks).toHaveLength(compact ? 1 : 3);
        for (const w of m.marks) expect(w, `mark width at ${width}`).toBeGreaterThanOrEqual(5);
      }
      expect((await measure(many)).label).toBe('9+');
    }
  });

  test('a week links to the observation on the student page', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const cell = card(page).locator('.dash-ob2-cell.has').first();
    const href = await cell.getAttribute('data-href');
    const obId = new URL('http://x/' + href.replace('/', '')).searchParams.get('ob');
    expect(obId).toBeTruthy();
    await cell.click();
    await expect(page).toHaveURL(/\/student\?id=.+&ob=/);
    const target = page.locator('#ev-list .obs-card[data-obid="' + obId + '"]');
    await expect(target).toBeFocused();
    await expect(target).toHaveClass(/ev-card-hit/);
  });

  test('By competency shows dashed "none" where a student has no evidence', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    // A new student has no scores on any competency; one observation linked
    // to the first competency makes that one evidence.
    const sections = await page.evaluate(() => {
      const list = getStudents('sci8');
      saveStudents('sci8', list.concat([{ id: 'st-new', firstName: 'Zed', lastName: 'Zulu', designations: [] }]));
      const secs = getSections('sci8');
      addQuickOb('sci8', 'st-new', 'Asked a testable question', [], null, null, null, {
        competencyId: secs[0].tags[0].id,
      });
      PageDashboard.render();
      return secs.length;
    });
    await card(page).getByRole('tab', { name: 'By Competency' }).click();
    const row = card(page).locator('.dash-ob2-row[data-sid="st-new"]');
    await expect(row.locator('.dash-ob2-lv.is-gap')).toHaveCount(sections - 1);
    await expect(row.locator('.dash-ob2-lv.is-gap').first()).toHaveText('none');
    await expect(row.locator('.dash-ob2-lv').first()).toHaveText(/1$/);
    await expect(row.locator('.dash-ob2-gaps')).toHaveText(String(sections - 1));
    const withGaps = await card(page)
      .locator('.dash-ob2-row[data-sid]')
      .evaluateAll(rows => rows.filter(r => r.querySelector('.dash-ob2-lv.is-gap')).length);
    const flag = card(page).locator('.dash-ob2-flag[data-flag="gap"]');
    await expect(flag.locator('b')).toHaveText(String(withGaps));
    await flag.click();
    await expect(row).not.toHaveClass(/is-dim/);
    // The key names the levels; a full competency name is on hover.
    await expect(card(page).locator('.dash-ob2-key')).toContainText('No evidence');
    const head = card(page).locator('.dash-ob2-ch[data-ob2-nav]').first();
    await head.hover();
    await expect(page.locator('#dash-ob2-pop')).toHaveText(await head.getAttribute('aria-label'));
  });
});
