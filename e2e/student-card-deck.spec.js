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
    await expect(cards.getByRole('heading')).toHaveText(['Immune System Quick Check', 'Disease Research Poster']);
    await expect(page.locator('.sp-deck-count')).toHaveCount(0);
    // Stacked: the second card starts below the first, at the same left edge.
    const [a, b] = await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()));
    expect(b.top).toBeGreaterThanOrEqual(a.bottom - 1);
    expect(Math.abs(b.left - a.left)).toBeLessThan(2);
    // Past its day: the due pill in red says how long ago.
    await expect(cards.nth(1).locator('.sp-piece-head .sp-flag-overdue')).toHaveText(
      /^Due \w{3}, \w{3} \d+ · (yesterday|\d+ days ago)$/,
    );
    await expect(cards.nth(0).getByText('Missing', { exact: true })).toBeVisible();
    // No category, What You’re Graded On or Core Competencies on a card.
    await expect(page.locator('.sp-deck')).not.toContainText('Graded On');
    await expect(page.locator('.sp-category-pill, .sp-core')).toHaveCount(0);
    await cards.nth(1).scrollIntoViewIfNeeded();
    await expect(cards.nth(1).getByRole('heading')).toBeInViewport();
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'phone-assignments-outstanding');

    await page.getByRole('button', { name: 'Upcoming 1' }).click();
    await expect(page.getByRole('button', { name: 'Upcoming 1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.getByRole('heading')).toHaveText(['Science Fair Proposal']);
    await expect(cards.locator('.sp-piece-head .sp-flag-due')).toHaveText(/^Due \w{3}, \w{3} \d+ · in \d+ days$/);
    await fits(page);
    await contrast(page);
    expect(posts).toEqual([]);
  });

  test('Log Out asks first; Cancel keeps the page', async ({ page }) => {
    const posts = await demo(page);
    await page.getByRole('button', { name: 'Log Out' }).click();
    const sheet = page.getByRole('alertdialog', { name: 'Log Out?' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('You’ll need your card to open your page again.');
    await expect(page.locator('#sp-logout-title')).toBeFocused();
    await named(page);
    await contrast(page);
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log Out' })).toBeFocused();
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
    await expect(card.getByRole('heading')).toHaveText('Disease Research Poster');
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
