import { test, expect } from '@playwright/test';

/* The observation card redesign (docs/DECISIONS.md, "Observation cards,
   2026-10-19"), in Demo Mode on desktop and phone. */

async function enterDemo(page, { phone = false } = {}) {
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(phone ? /teacher-mobile\// : /teacher\/app\.html/);
}

test.describe('Observation cards, desktop', () => {
  test('a type block leads each card and names line up', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/teacher/app.html#/observations');
    const cards = page.locator('.obs-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().locator('.obs-type')).toHaveText(/^(Strength|Growth|Concern)$/);
    const xs = await page
      .locator('.obs-card-student')
      .evaluateAll(els => els.slice(0, 6).map(e => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
    await expect(page.locator('.obs-pill')).toHaveCount(0);
  });
});

test.describe('Observation cards, phone', () => {
  test('cards carry no buttons; tapping one opens its sheet', async ({ page }) => {
    await enterDemo(page, { phone: true });
    await page.locator('.m-tab-item[data-tab="observe"]').click();
    const card = page.locator('#m-obs-cards .m-obs-card').first();
    await expect(card).toBeVisible();
    await expect(page.locator('.m-obs-edit-btn, .m-obs-delete-btn')).toHaveCount(0);
    await expect(card.locator('.m-obs-chev')).toBeVisible();
    await expect(card.locator('.m-obs-time')).toHaveText(/^\d{1,2}:\d{2}\s?[ap]\.m\.$/);
    await expect(page.locator('.m-obs-date-group').first()).toHaveText(
      /^(Today|Yesterday|\w{3}, \w{3} \d{1,2}(, \d{4})?)$/,
    );

    await card.locator('.m-obs-text').click();
    await expect(page.locator('.m-sheet.m-sheet-visible #m-obs-text')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Observation' })).toBeVisible();
  });

  test('Delete Observation in the sheet hides the card with Undo', async ({ page }) => {
    await enterDemo(page, { phone: true });
    await page.locator('.m-tab-item[data-tab="observe"]').click();
    const card = page.locator('#m-obs-cards .m-obs-card').first();
    const obId = await card.getAttribute('data-obid');
    await card.locator('.m-obs-text').click();
    await page.getByRole('button', { name: 'Delete Observation' }).click();
    await expect(page.locator('#m-obs-cards .m-obs-card[data-obid="' + obId + '"]')).toHaveCount(0);
    await expect(page.getByText('Observation deleted')).toBeVisible();
  });
});

test.describe('Observation cards, phone swipe', () => {
  test.use({ hasTouch: true });
  test('swiping a card left deletes it with Undo', async ({ page }) => {
    await enterDemo(page, { phone: true });
    await page.locator('.m-tab-item[data-tab="observe"]').click();
    const card = page.locator('#m-obs-cards .m-obs-card').first();
    await expect(card).toBeVisible();
    const obId = await card.getAttribute('data-obid');
    await card.evaluate(el => {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const at = x => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      const fire = (type, x) =>
        el.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [at(x)],
            changedTouches: [at(x)],
          }),
        );
      fire('touchstart', r.right - 20);
      for (let x = r.right - 40; x > r.left - 40; x -= 30) fire('touchmove', x);
      fire('touchend', r.left - 40);
    });
    await expect(page.locator('#m-obs-cards .m-obs-card[data-obid="' + obId + '"]')).toHaveCount(0);
    await expect(page.getByText('Observation deleted')).toBeVisible();
  });
});

test.describe('Observation editor (D3), desktop', () => {
  async function openFirst(page) {
    await enterDemo(page);
    await page.goto('/teacher/app.html#/observations');
    const card = page.locator('.obs-card').first();
    await expect(card).toBeVisible();
    const obId = await card.getAttribute('data-obid');
    await card.click();
    const ed = page.locator('#obs-focus-card');
    await expect(ed).toBeVisible();
    return { ed, obId };
  }

  test('type tabs: the chosen one is filled; clicking it again clears it', async ({ page }) => {
    const { ed } = await openFirst(page);
    const tabs = ed.locator('.obs-band-tab');
    await expect(tabs).toHaveText(['Strength', 'Growth', 'Concern']);
    await ed.getByRole('button', { name: 'Concern' }).click();
    await expect(ed.locator('.obs-band-tab.on')).toHaveText('Concern');
    await expect(ed.getByRole('button', { name: 'Concern' })).toHaveAttribute('aria-pressed', 'true');
    await ed.getByRole('button', { name: 'Concern' }).click();
    await expect(ed.locator('.obs-band-tab.on')).toHaveCount(0);
    await expect(ed.locator('.obs-focus-close, [aria-label="Close"]')).toHaveCount(0);
  });

  test('the context menu lists five contexts with None last, and Save writes it', async ({ page }) => {
    const { ed, obId } = await openFirst(page);
    const btn = ed.locator('.obs-menu-btn');
    await btn.click();
    const items = ed.locator('.obs-menu .obs-menu-item');
    await expect(items).toHaveText(['Whole class', 'Small group', 'Independent', 'Presentation', 'Discussion', 'None']);
    await items.filter({ hasText: 'Discussion' }).click();
    await expect(btn).toHaveText(/Discussion/);
    await btn.click();
    await ed.locator('.obs-menu-item', { hasText: 'None' }).click();
    await expect(btn).toHaveText(/\+ Context/);
    await expect(btn).toHaveClass(/empty/);
    await btn.click();
    await ed.locator('.obs-menu-item', { hasText: 'Small group' }).click();
    await ed.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#obs-focus-card')).toHaveCount(0);
    await expect(page.locator('.obs-card[data-obid="' + obId + '"] .obs-card-context')).toHaveText('Small group');
  });

  test('Cancel and Esc leave the note as it was; Enter saves', async ({ page }) => {
    const { ed, obId } = await openFirst(page);
    const card = page.locator('.obs-card[data-obid="' + obId + '"]');
    const before = await card.locator('.obs-card-text').textContent();
    await ed.locator('#focus-textarea').fill('A changed note');
    await ed.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#obs-focus-card')).toHaveCount(0);
    await expect(card.locator('.obs-card-text')).toHaveText(before);

    await card.click();
    await page.locator('#focus-textarea').fill('Another change');
    await page.keyboard.press('Escape');
    await expect(page.locator('#obs-focus-card')).toHaveCount(0);
    await expect(card.locator('.obs-card-text')).toHaveText(before);

    await card.click();
    await page.locator('#focus-textarea').fill('Saved with Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#obs-focus-card')).toHaveCount(0);
    await expect(card.locator('.obs-card-text')).toHaveText('Saved with Enter');
  });

  test('a quoted note warns that changes show in the report', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/teacher/app.html#/observations');
    const quoted = page.locator('.obs-card', { has: page.locator('.obs-card-quoted') }).first();
    await quoted.click();
    await expect(page.locator('#obs-focus-card .obs-notice')).toHaveText(
      /^Quoted in Reports? [\d, and]+\. Changes here show in th(at|ose) reports?\.$/,
    );
  });

  test('Delete in the editor removes the note with Undo', async ({ page }) => {
    const { ed, obId } = await openFirst(page);
    await ed.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#obs-focus-card')).toHaveCount(0);
    await expect(page.locator('.obs-card[data-obid="' + obId + '"]')).toHaveCount(0);
    await expect(page.getByText('Observation deleted')).toBeVisible();
  });
});

test.describe('Observation editor (D3), phone', () => {
  test('Context row opens a picker with None last; tags are chips', async ({ page }) => {
    await enterDemo(page, { phone: true });
    await page.locator('.m-tab-item[data-tab="observe"]').click();
    const card = page.locator('#m-obs-cards .m-obs-card').first();
    const obId = await card.getAttribute('data-obid');
    await card.locator('.m-obs-text').click();
    const sheet = page.locator('#m-obs-edit');
    await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Save' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Concern' }).click();
    await expect(sheet.locator('.obs-band-tab.on')).toHaveText('Concern');

    await sheet.locator('#m-obs-ctx-row').click();
    const rows = sheet.locator('.m-pick-row');
    await expect(rows.locator('span:first-child')).toHaveText([
      'Whole class',
      'Small group',
      'Independent',
      'Presentation',
      'Discussion',
      'None',
    ]);
    await rows.filter({ hasText: 'None' }).click();
    await expect(sheet.locator('#m-obs-ctx-row')).toContainText('None');
    await sheet.locator('#m-obs-ctx-row').click();
    await sheet.locator('.m-pick-row', { hasText: 'Discussion' }).click();
    await expect(sheet.locator('#m-obs-ctx-row')).toContainText('Discussion');

    await sheet.getByRole('button', { name: '+ Add Tag' }).click();
    await sheet.locator('.m-pick-row', { hasText: 'Collaboration' }).click();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet.locator('.m-edit-tags .obs-tag-chip', { hasText: 'Collaboration' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Save' }).click();
    const saved = page.locator('#m-obs-cards .m-obs-card[data-obid="' + obId + '"]');
    await expect(saved.locator('.m-obs-type')).toHaveText('Concern');
    await expect(saved.locator('.m-obs-context')).toHaveText('Discussion');
    await expect(saved.locator('.m-obs-tag-chip', { hasText: 'Collaboration' })).toBeVisible();
  });
});
