import { test, expect } from '@playwright/test';

/* The fourth observation type, Note: neutral, yellow, beside Strength,
   Growth and Concern on every surface (docs/DECISIONS.md, "Observations
   (2026-10-18)", item 13). Demo Mode, Science 8, desktop and phone, light
   and dark. Set NOTE_SHOTS to a folder to save a screenshot of each
   surface. */

const YELLOW = { light: 'rgb(242, 194, 0)', dark: 'rgb(255, 214, 10)' };
const DARK_TEXT = 'rgb(29, 29, 31)';

async function enterDemo(page, { phone = false } = {}) {
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(phone ? /teacher-mobile\// : /teacher\/app\.html/);
}

async function shot(target, name) {
  if (!process.env.NOTE_SHOTS) return;
  // Let sheets and transitions settle; only screenshot runs wait.
  await new Promise(r => setTimeout(r, 500));
  await target.screenshot({ path: process.env.NOTE_SHOTS + '/' + name + '.png' });
}

/* A solid Note block or tab: yellow with dark text. */
async function expectSolidNote(loc, scheme = 'light') {
  await expect(loc).toHaveCSS('background-color', YELLOW[scheme]);
  await expect(loc).toHaveCSS('color', DARK_TEXT);
}

async function storedObs(page, sid) {
  return page.evaluate(id => JSON.parse(localStorage.getItem('gb-quick-obs-sci8') || '{}')[id] || [], sid);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`Note type, desktop, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('the strip adds a Note with its chip or !note; the card shows a yellow block', async ({ page }) => {
      await enterDemo(page);
      await page.goto('/teacher/app.html#/observations?course=sci8');
      const strip = page.locator('#obs-capture');
      await expect(strip.locator('[data-part="who"] .obsc-chip-type')).toHaveText([
        'Strength',
        'Growth',
        'Concern',
        'Note',
      ]);

      const input = page.locator('#capture-input');
      await input.click();
      await input.pressSequentially('@Hannah ');
      await expect(strip.locator('.obsc-chip-student')).toContainText('Hannah');
      await input.pressSequentially('Left early for a dentist appointment');
      await strip.getByRole('button', { name: 'Note' }).click();
      const chip = strip.locator('.obsc-chip-type[data-value="note"]');
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await shot(strip, `desktop-strip-${scheme}`);
      await input.click();
      await page.keyboard.press('Enter');

      const card = page.locator('.obs-card', { hasText: 'Left early for a dentist appointment' });
      await expect(card.locator('.obs-type')).toHaveText('Note');
      await expectSolidNote(card.locator('.obs-type'), scheme);
      await shot(page.locator('#obs-feed'), `desktop-feed-${scheme}`);

      // Shorthand: !note picks the type.
      await input.click();
      await input.pressSequentially('@Sam ');
      await input.pressSequentially('Moved seats this week !note');
      await page.keyboard.press('Enter');
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Enter');
      await expect(
        page.locator('.obs-card', { hasText: 'Moved seats this week' }).first().locator('.obs-type'),
      ).toHaveText('Note');
    });

    test('the editor has a Note tab, and the Type filter shows only Notes', async ({ page }) => {
      await enterDemo(page);
      await page.goto('/teacher/app.html#/observations?course=sci8');
      const card = page.locator('.obs-card', { hasText: 'Ines consistently follows safety procedures' });
      await card.locator('.obs-card-text').click();
      const ed = page.locator('#obs-focus-card');
      await expect(ed.locator('.obs-band-tab')).toHaveText(['Strength', 'Growth', 'Concern', 'Note']);
      await ed.getByRole('button', { name: 'Note' }).click();
      await expectSolidNote(ed.locator('.obs-band-tab.on'), scheme);
      await shot(ed, `desktop-editor-${scheme}`);
      await ed.getByRole('button', { name: 'Save' }).click();
      await expect(card.locator('.obs-type')).toHaveText('Note');

      await page.getByRole('button', { name: 'Type' }).click();
      await page.locator('#filter-type-dropdown [role="option"]', { hasText: 'Note' }).click();
      const types = page.locator('.obs-card .obs-type');
      await expect(types.first()).toHaveText('Note');
      expect(new Set(await types.allTextContents())).toEqual(new Set(['Note']));
      // Two from Demo Mode's sample class are Notes for Cece and Noor, plus Ines.
      expect(await types.count()).toBeGreaterThanOrEqual(3);
      await shot(page.locator('#main, main').first(), `desktop-filter-${scheme}`);
    });

    test('the dashboard draws Notes as yellow marks, lists Note in the key, and never as a strength', async ({
      page,
    }) => {
      await enterDemo(page);
      await page.goto('/teacher/app.html#/dashboard?course=sci8');
      const obsCard = page.locator('#dash-obs-card');
      await expect(obsCard.locator('.dash-ob2-row[data-sid]').first()).toBeVisible();
      await obsCard.getByRole('tab', { name: 'By week' }).click();
      const key = obsCard.locator('.dash-ob2-key');
      await expect(key).toContainText('Strength');
      await expect(key.locator('.dash-ob2-swatch[data-type]')).toHaveCount(5);
      const swatch = key.locator('.dash-ob2-swatch[data-type="note"]');
      await expect(swatch).toHaveCSS('background-color', YELLOW[scheme]);
      await expect(key.locator('span:has(> .dash-ob2-swatch[data-type="note"])')).toHaveText('Note');
      await expect(obsCard.locator('.dash-ob2-cell i[data-type="note"]').first()).toBeVisible();

      // A student whose only observation is a Note has no strength recorded.
      await page.evaluate(() => {
        const all = JSON.parse(localStorage.getItem('gb-quick-obs-sci8') || '{}');
        all.st5 = [
          {
            id: 'qo_note_only',
            text: 'Away on a family trip',
            dims: [],
            sentiment: 'note',
            context: null,
            date: getTodayStr(),
            created: new Date().toISOString(),
          },
        ];
        localStorage.setItem('gb-quick-obs-sci8', JSON.stringify(all));
      });
      await page.reload();
      const row = obsCard.locator('.dash-ob2-row[data-sid="st5"]');
      await expect(row.locator('.dash-ob2-mark')).toBeVisible();
      await expect(row.locator('.dash-ob2-cell i')).toHaveAttribute('data-type', 'note');
      await shot(obsCard, `desktop-dashboard-${scheme}`);
    });

    test("the student page's Evidence panel shows the Note block and the timeline key", async ({ page }) => {
      await enterDemo(page);
      await page.goto('/teacher/app.html#/student?id=st1&course=sci8');
      await page.locator('#stu-tab-evidence').click();
      const panel = page.locator('#ev-panel');
      await expect(panel.locator('.ev-tl-key')).toHaveText([
        'Strength',
        'Growth',
        'Concern',
        'Note',
        'No type',
        'Assessment',
      ]);
      await expect(panel.locator('.ev-tl-mark[data-type="note"]').first()).toBeAttached();
      const block = panel.locator('.obs-card', { hasText: 'borrowing the class microscope' }).locator('.obs-type');
      await expect(block).toHaveText('Note');
      await expectSolidNote(block, scheme);
      await shot(panel, `desktop-evidence-${scheme}`);
    });
  });
}

test('a starter can default to Note, and picking it sets the Note chip', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/teacher/app.html#/observations/starters');
  const section = page.locator('.ms-page');
  await expect(section).toBeVisible();
  // Demo Mode's teacher already has starters.
  await section.getByRole('button', { name: 'Add Starter' }).click();
  await section.locator('#ms-text').fill('Was away for the lab');
  await expect(section.getByLabel('Type').locator('option')).toHaveText([
    'No Type',
    'Strength',
    'Growth',
    'Concern',
    'Note',
  ]);
  await section.getByLabel('Type').selectOption('note');
  await section.getByRole('button', { name: 'Add Starter' }).click();
  const row = section.locator('.ms-row', { hasText: 'Was away for the lab' });
  await expect(row.locator('.obs-pill-type')).toHaveText('Note');
  await shot(section, 'desktop-cm-starter-light');

  await page.goto('/teacher/app.html#/observations?course=sci8');
  const input = page.locator('#capture-input');
  await input.click();
  await input.pressSequentially('@Liam ');
  await input.pressSequentially('/was');
  await expect(page.locator('#capture-suggest .obsc-item').first()).toContainText('Was away for the lab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#obs-capture .obsc-chip-type[data-value="note"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('.obs-card', { hasText: 'Was away for the lab' }).locator('.obs-type')).toHaveText('Note');
});

for (const scheme of ['light', 'dark']) {
  test.describe(`Note type, phone, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('the sheet adds a Note, the card is yellow, and the Note pill filters the feed', async ({ page }) => {
      await enterDemo(page, { phone: true });
      await page.locator('.m-tab-item[data-tab="observe"]').click();
      const avatar = page.locator('.m-quick-avatar').first();
      const sid = await avatar.getAttribute('data-sid');
      await avatar.click();
      await page.getByRole('button', { name: 'Write Your Own…' }).click();
      const sheet = page.locator('#m-obs-edit');
      await expect(sheet.locator('.obs-band-tab')).toHaveText(['Strength', 'Growth', 'Concern', 'Note']);
      await sheet.getByRole('button', { name: 'Note' }).click();
      await expectSolidNote(sheet.locator('.obs-band-tab.on'), scheme);
      await sheet.locator('#m-obs-text').fill('Forgot the permission form again');
      await shot(sheet, `phone-sheet-${scheme}`);
      await sheet.locator('#m-obs-submit').click();
      await expect.poll(async () => (await storedObs(page, sid)).map(o => o.sentiment)).toContain('note');

      const filter = page.locator('.m-filter-pill[data-filter="sentiment:note"]');
      await expect(filter).toHaveText('Note');
      await filter.click();
      const blocks = page.locator('#m-obs-cards .m-obs-card .m-obs-type');
      await expect(blocks.first()).toHaveText('Note');
      expect(new Set(await blocks.allTextContents())).toEqual(new Set(['Note']));
      await expectSolidNote(blocks.first(), scheme);
      await expect(
        page.locator('#m-obs-cards .m-obs-card', { hasText: 'Forgot the permission form again' }),
      ).toBeVisible();
      await shot(page, `phone-feed-${scheme}`);
    });

    test('the class sweep offers Note and saves it', async ({ page }) => {
      await enterDemo(page, { phone: true });
      await page.locator('.m-tab-item[data-tab="observe"]').click();
      await page.getByRole('button', { name: 'Start a sweep' }).click();
      await expect(page.locator('#m-screen-obs-sweep')).toBeVisible();
      await page.locator('.m-sweep-tile[data-state=""]').first().click();
      const types = page.locator('.m-sweep-type');
      await expect(types).toHaveText(['Strength', 'Growth', 'Concern', 'Note']);
      await page.locator('.m-sweep-type[data-val="note"]').click();
      await expect(page.locator('.m-sweep-type.m-selected')).toHaveAttribute('data-val', 'note');
      await page.locator('[data-action="m-sweep-write"]').click();
      await page.locator('#m-sweep-text').fill('Away for the lab today');
      await shot(page, `phone-sweep-${scheme}`);
      await page.locator('#m-sweep-save').click();
      await expect(page.locator('#m-toast')).toContainText('Saved for');
    });
  });
}
