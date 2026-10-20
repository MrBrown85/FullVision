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
