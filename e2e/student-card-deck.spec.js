import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast, shot } from './student-card-fake.js';

/* The assignment cards and All Assignments (S4-F2), in Demo Mode, against
   the built site with the live site's CSP: the cards swiped on a phone
   ("2 of 6" follows), the list and the card side by side on a Chromebook,
   and All Assignments with its search and filters. Nothing is sent. */

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  return posts;
}

test.describe('on a phone', () => {
  test.use(PHONE);

  test('one card at a time; a swipe moves to the next and the count follows', async ({ page }) => {
    const posts = await demo(page);
    await page.getByRole('button', { name: 'Back 6' }).click();
    const first = page.locator('.sp-piece').first();
    await expect(first.getByRole('heading')).toHaveText('Energy Transfer Investigation');
    await expect(first.getByText(/^Returned /)).toBeVisible();
    await expect(page.locator('.sp-deck-count')).toHaveText('1 of 6');
    // Only one card is in view.
    const inView = await page.evaluate(
      () =>
        [...document.querySelectorAll('.sp-piece')].filter(c => {
          const b = c.getBoundingClientRect();
          return b.left >= -1 && b.right <= window.innerWidth + 1;
        }).length,
    );
    expect(inView).toBe(1);
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'phone-s4f2-back-card');
    // A swipe: the deck scrolls one card over.
    await page.locator('.sp-deck').evaluate(d => d.scrollTo({ left: d.clientWidth, behavior: 'auto' }));
    await expect(page.locator('.sp-deck-count')).toHaveText('2 of 6');
    expect(posts).toEqual([]);
  });

  test('All Assignments: search, filters, and a row opens its card', async ({ page }) => {
    await demo(page);
    await page.getByRole('button', { name: 'All assignments' }).click();
    await expect(page.getByRole('heading', { name: 'All Assignments' })).toBeFocused();
    await page.getByLabel('Search assignments').fill('cell');
    await expect(page.locator('.sp-row-title')).toHaveText(['Cell Structure Quiz', 'Cell Microscope Lab']);
    await expect(page.getByLabel('Search assignments')).toBeFocused();
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'phone-s4f2-all-search');
    await page.getByLabel('Search assignments').fill('');
    await page.getByRole('button', { name: 'To Do', exact: true }).click();
    await expect(page.locator('.sp-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('button', { name: /Cell Microscope Lab/ }).click();
    await expect(page.getByRole('heading', { name: 'Cell Microscope Lab' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Cell Microscope Lab' })).toBeInViewport();
    await expect(page.locator('.sp-deck-count')).toHaveText('3 of 6');
  });
});

test.describe('on a Chromebook', () => {
  test.use(CHROMEBOOK);

  test('the list on the left, the card picked on the right', async ({ page }) => {
    await demo(page);
    await page.getByRole('button', { name: 'Back 6' }).click();
    const side = page.locator('.sp-side');
    await expect(side).toBeVisible();
    await expect(page.locator('.sp-piece:visible')).toHaveCount(1);
    await side.getByRole('button', { name: /Cell Microscope Lab/ }).click();
    const card = page.locator('.sp-piece:visible');
    await expect(card.getByRole('heading')).toHaveText('Cell Microscope Lab');
    await expect(card.locator('.sp-piece-row-name')).toHaveText(['Your Result', 'Method', 'Labelled Drawing']);
    await expect(page.locator('.sp-deck-count')).toBeHidden();
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'chromebook-s4f2-back-split');
  });
});
