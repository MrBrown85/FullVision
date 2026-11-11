import { test, expect } from '@playwright/test';
import {
  PHONE,
  CHROMEBOOK,
  serve,
  routes,
  school,
  stored,
  fits,
  named,
  contrast,
  signIn,
} from './student-card-fake.js';

/* Card codes are eight characters, shown K7M4-QX2P, and a replaced card
   says so (S3-F3a; Colin, Nov 10). Slips stay six, shown K7M-4QX.

   The function is answered in the test by its own handler and routes over a
   stand-in database (e2e/student-card-fake.js). That database knows cards
   by six characters, as the database does today, so the eight-character
   code is put to it as the sample card's (`codes`). The function on main
   answers a replaced card not_found; card_stopped, as S3-E1 makes the card
   routes answer it, is stood in for with `answer`. */

const CARD = 'K7M4QX2P';
const REPLACED = 'This card has been replaced. Ask your teacher for your new card.';
const stopped = body => (body.code === CARD ? { status: 200, json: { ok: false, error: 'card_stopped' } } : null);

// The code fits its box: nothing of it is scrolled out of sight.
async function codeFits(page) {
  const box = page.locator('#sp-code');
  const over = await box.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}

for (const size of [
  { name: 'a phone', use: PHONE },
  { name: 'a Chromebook', use: CHROMEBOOK },
]) {
  test.describe('an eight-character card on ' + size.name, () => {
    test.use(size.use);

    test('scanned, it opens the student’s page', async ({ page }) => {
      const fn = school();
      const posts = await serve(page, fn, { codes: { [CARD]: 'P3R8WD' } });
      await page.goto('/s/#K7M4-QX2P');
      await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
      await expect(page).toHaveURL(/\/s\/$/);
      await page.getByLabel('Student Number').fill('0123456');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
      expect(posts.slice(0, 3).map(p => [p.body.route, p.body.code])).toEqual([
        ['card', CARD],
        ['verify', CARD],
        ['page', undefined],
      ]);
      await fits(page);
    });

    test('typed with or without its dash, in lower case, it opens; it fits the box', async ({ page }) => {
      const fn = school();
      const posts = await serve(page, fn, { codes: { [CARD]: 'P3R8WD' } });
      // The slip's box, on the page with no code.
      await page.goto('/s/');
      await page.getByLabel('Type the code on your slip').fill('k7m4qx2p');
      await codeFits(page);
      await page.getByRole('button', { name: 'Open' }).click();
      await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
      // The card's box, once the card is put back.
      await page.getByRole('button', { name: 'No, That’s Not Me' }).click();
      await page.getByRole('button', { name: 'Type a Different Code' }).click();
      await page.getByLabel('Card Code').fill('K7M4-QX2P');
      await codeFits(page);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
      expect(posts.map(p => [p.body.route, p.body.code])).toEqual([
        ['card', CARD],
        ['card', CARD],
      ]);
    });

    test('a replaced card says so and signs the last student out', async ({ page }) => {
      const fn = school();
      const posts = await serve(page, fn, { answer: stopped });
      await signIn(page);
      expect(Object.keys((await stored(page)).local)).toEqual(['fv-s-session']);
      posts.length = 0;
      await page.goto('/s/#K7M4-QX2P');
      await expect(page.getByRole('alert')).toHaveText(REPLACED);
      await expect(page).toHaveURL(/\/s\/$/);
      await expect(page.getByLabel('Student Number')).toHaveCount(0);
      await expect.poll(() => routes(posts)).toEqual(['card', 'done']);
      expect((await stored(page)).local).toEqual({});
      expect(fn.state.sessions).toEqual({});
      await fits(page);
      await named(page);
      await contrast(page);
      await page.getByRole('button', { name: 'Type a Different Code' }).click();
      await expect(page.getByLabel('Card Code')).toBeVisible();
    });
  });
}

test.describe('a six-character slip on a phone', () => {
  test.use(PHONE);

  test('still opens as before', async ({ page }) => {
    const fn = school(null, {
      slips: {
        K7M4QX: {
          ok: true,
          token: 'a'.repeat(64),
          student: { first_name: 'Cece' },
          course: { name: 'Science 8', block: 'B' },
          preview: [{ title: 'November Reflection', count: 1 }],
          check: 'identity',
        },
      },
    });
    const posts = await serve(page, fn);
    await page.goto('/s/');
    await page.getByLabel('Type the code on your slip').fill('k7m4qx');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, Start' }).tap();
    await expect(page.getByText('How did it go?')).toBeVisible();
    expect(posts.map(p => p.body.route)).toEqual(['card', 'open', 'verify']);
    expect(posts[1].body.code).toBe('K7M4QX');
  });

  test('a seven-character code is refused at once, and nothing is asked', async ({ page }) => {
    const fn = school();
    const posts = await serve(page, fn);
    await page.goto('/s/');
    await page.getByLabel('Type the code on your slip').fill('K7M4QX2');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('alert')).toContainText("That code didn't work.");
    await expect(page.getByLabel('Type the code on your slip')).toHaveValue('K7M4QX2');
    expect(routes(posts)).toEqual([]);
  });
});
