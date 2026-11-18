import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast, shot } from './student-card-fake.js';

/* The Assignments tab (Colin, 2026-11-14), in Demo Mode, against the built
   site with the live site's CSP: Outstanding and Upcoming, the cards one
   under another on a phone, the list and the card side by side on a
   Chromebook, and Log Out asking first. Nothing is sent. */

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'Outstanding 2' })).toBeVisible();
  return posts;
}

test.describe('on a phone', () => {
  test.use(PHONE);

  test('Outstanding: the cards one under another, to scroll; Upcoming: what is due later', async ({ page }) => {
    const posts = await demo(page);
    const cards = page.locator('.sp-deck .sp-piece');
    await expect(cards.locator('.sp-piece-title')).toHaveText(['Immune System Quick Check', 'Disease Research Poster']);
    await expect(page.locator('.sp-deck-count')).toHaveCount(0);
    // Stacked: the second card starts below the first, at the same left edge.
    const [a, b] = await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()));
    expect(b.top).toBeGreaterThanOrEqual(a.bottom - 1);
    expect(Math.abs(b.left - a.left)).toBeLessThan(2);
    // Past its day and not Missing: a grey band, Not Assessed Yet, never red (Colin, 2026-11-17).
    const waiting = cards.nth(1).locator('.sp-band.sp-band-waiting');
    await expect(waiting.locator('.sp-flag')).toHaveText('Not Assessed Yet');
    await expect(waiting.locator('.sp-band-when')).toHaveText(/^Was due \w{3} \d+$/);
    await expect(cards.nth(1)).not.toContainText(/days ago|yesterday/);
    // Missing is the one solid band: white on red.
    const missing = cards.nth(0).locator('.sp-band.sp-band-missing');
    await expect(missing.locator('.sp-flag')).toHaveText('Missing');
    expect(await missing.evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    // The band runs across the top of the card, edge to edge.
    const [band, box] = await Promise.all([
      missing.boundingBox(),
      cards.nth(0).locator('.sp-piece-card').boundingBox(),
    ]);
    expect(Math.abs(band.x - box.x)).toBeLessThan(1);
    expect(Math.abs(band.y - box.y)).toBeLessThan(1);
    expect(Math.abs(band.width - box.width)).toBeLessThan(1);
    // Each status has its icon, and the unit is not in capitals.
    for (const c of [cards.nth(0), cards.nth(1)]) await expect(c.locator('.sp-band svg')).toHaveCount(1);
    expect(
      await cards
        .nth(0)
        .locator('.sp-piece-unit')
        .evaluate(el => getComputedStyle(el).textTransform),
    ).toBe('none');
    // Outstanding and Upcoming are big enough to tap.
    for (const box of await page
      .locator('.sp-segment')
      .evaluateAll(els => els.map(e => e.getBoundingClientRect().height)))
      expect(box).toBeGreaterThanOrEqual(40);
    // No category, What You’re Graded On or Core Competencies on a card.
    await expect(page.locator('.sp-deck')).not.toContainText('Graded On');
    await expect(page.locator('.sp-category-pill, .sp-core')).toHaveCount(0);
    await cards.nth(1).scrollIntoViewIfNeeded();
    await expect(cards.nth(1).locator('.sp-piece-title')).toBeInViewport();
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'phone-assignments-outstanding');

    await page.getByRole('button', { name: 'Upcoming 1' }).click();
    await expect(page.getByRole('button', { name: 'Upcoming 1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.locator('.sp-piece-title')).toHaveText(['Science Fair Proposal']);
    await expect(cards.locator('.sp-band-later .sp-flag')).toHaveText(/^In \d+ Days$/);
    await expect(cards.locator('.sp-band-later .sp-band-when')).toHaveText(/^\w{3}, \w{3} \d+$/);
    await fits(page);
    await contrast(page);
    expect(posts).toEqual([]);
  });

  test('Log Out asks first; Cancel keeps the page', async ({ page }) => {
    const posts = await demo(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Log Out' }).click();
    const sheet = page.getByRole('alertdialog', { name: 'Log Out?' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('You’ll need your card to open your page again.');
    await expect(page.locator('#sp-logout-title')).toBeFocused();
    await named(page);
    await contrast(page);
    await page.waitForTimeout(450); // Log Out? takes a press once it has been up a moment.
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Outstanding 2' })).toBeVisible();
    expect(posts).toEqual([]);
  });
});

test.describe('on a Chromebook', () => {
  test.use(CHROMEBOOK);

  test('the list on the left, the card picked on the right', async ({ page }) => {
    await demo(page);
    const side = page.locator('.sp-side');
    await expect(side).toBeVisible();
    await expect(page.locator('.sp-piece:visible')).toHaveCount(1);
    await side.getByRole('button', { name: /Disease Research Poster/ }).click();
    const card = page.locator('.sp-piece:visible');
    await expect(card.locator('.sp-piece-title')).toHaveText('Disease Research Poster');
    await expect(side.getByRole('button', { name: /Disease Research Poster/ })).toHaveAttribute('aria-pressed', 'true');
    // Work still to do: no result rows, no feedback.
    await expect(card.locator('.sp-piece-row-name, [data-act="feedback"]')).toHaveCount(0);
    await expect(page.locator('.sp-deck-count')).toHaveCount(0);
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'chromebook-assignments-split');
  });
});
