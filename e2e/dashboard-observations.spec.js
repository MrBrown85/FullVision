import { test, expect } from '@playwright/test';

/* The dashboard's Observations card (docs/DECISIONS.md, "Observations
   (2026-10-18)", item 4) in Demo Mode on Science 8: the top row, both tabs,
   flags, Hide names, the "+" dialog, the week popover and the jump to the
   student page. The demo class has no competency gaps and no linked
   observations, so the tests make them through the data layer and read the
   expected counts from the page. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher\/app\.html/);
}

async function openDashboard(page) {
  await page.goto('/teacher/app.html#/dashboard?course=sci8');
  await expect(page.locator('#dash-obs-card .dash-ob2-row[data-sid]').first()).toBeVisible();
}

const card = page => page.locator('#dash-obs-card');

test.describe('Dashboard Observations card', () => {
  test('the top row cards match in height and the page never scrolls sideways', async ({ page }) => {
    await enterDemo(page);
    for (const width of [1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await openDashboard(page);
      for (const tab of ['By week', 'By competency']) {
        await card(page).getByRole('tab', { name: tab }).click();
        await expect(card(page).getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
        const m = await page.evaluate(() => {
          const d = document.querySelector('.dash-dist-card').getBoundingClientRect();
          const o = document.querySelector('#dash-obs-card').getBoundingClientRect();
          return {
            dist: d.height,
            obs: o.height,
            sameRow: Math.abs(d.top - o.top) < 1,
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
            cardRight: o.right,
          };
        });
        expect(m.scrollW, `sideways scroll at ${width} on ${tab}`).toBeLessThanOrEqual(m.clientW);
        expect(m.cardRight).toBeLessThanOrEqual(m.clientW);
        // Side by side above 1100 px, the same height; stacked below.
        if (width > 1100) {
          expect(m.sameRow).toBe(true);
          expect(Math.abs(m.dist - m.obs)).toBeLessThan(1);
        } else {
          expect(m.sameRow).toBe(false);
        }
      }
      await card(page).getByRole('tab', { name: 'By week' }).click();
    }
  });

  test('remembers the tab after a reload, and arrow keys switch it', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    await expect(card(page).getByRole('tab', { name: 'By week' })).toHaveAttribute('aria-selected', 'true');
    await card(page).getByRole('tab', { name: 'By competency' }).click();
    await expect(card(page).locator('.dash-ob2-lv').first()).toBeVisible();
    await page.reload();
    await expect(card(page).getByRole('tab', { name: 'By competency' })).toHaveAttribute('aria-selected', 'true');
    await card(page).getByRole('tab', { name: 'By competency' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(card(page).getByRole('tab', { name: 'By week' })).toHaveAttribute('aria-selected', 'true');
    await expect(card(page).getByRole('tab', { name: 'By week' })).toBeFocused();
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
    await card(page).getByRole('tab', { name: 'By competency' }).click();
    await expect(card(page).locator('.dash-ob2-row.is-dim')).toHaveCount(0);
  });

  test('Hide names blurs names on the card and the student cards', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const blur = loc => loc.evaluate(el => getComputedStyle(el).filter);
    const btn = card(page).getByRole('button', { name: 'Hide names' });
    await btn.click();
    const shown = card(page).getByRole('button', { name: 'Show names' });
    await expect(shown).toHaveAttribute('aria-pressed', 'true');
    await expect(shown).toBeFocused();
    expect(await blur(card(page).locator('.dash-ob2-name').first())).toMatch(/blur/);
    expect(await blur(page.locator('.dash-card-name').first())).toMatch(/blur/);
    // Grades stay readable.
    expect(await blur(page.locator('.dash-card-badge-num').first())).toBe('none');
    // The week popover stays closed while names are hidden.
    await card(page).locator('.dash-ob2-cell.has').first().hover();
    await expect(page.locator('#dash-ob2-pop')).toBeHidden();
    // Remembered on this device.
    await page.reload();
    await expect(card(page).getByRole('button', { name: 'Show names' })).toBeVisible();
    expect(await blur(page.locator('.dash-card-name').first())).toMatch(/blur/);
    await card(page).getByRole('button', { name: 'Show names' }).click();
    expect(await blur(card(page).locator('.dash-ob2-name').first())).toBe('none');
    expect(await blur(page.locator('.dash-card-name').first())).toBe('none');
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

  test('a week links to the observation on the student page', async ({ page }) => {
    await enterDemo(page);
    await openDashboard(page);
    const cell = card(page).locator('.dash-ob2-cell.has').first();
    const href = await cell.getAttribute('href');
    const obId = new URL('http://x/' + href.replace('#/', '')).searchParams.get('ob');
    expect(obId).toBeTruthy();
    await cell.click();
    await expect(page).toHaveURL(/#\/student\?id=.+&ob=/);
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
    await card(page).getByRole('tab', { name: 'By competency' }).click();
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
