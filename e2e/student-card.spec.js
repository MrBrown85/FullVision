import { test, expect } from '@playwright/test';
import { showAll } from './student-card-fake.js';

/* A student card on the student page, /s/#demo-card (docs/plans/
   student-page-build-plan.md, S0-F3), against the built site with the live
   site's CSP: the card's code, Is This You?, then the Assignments list, on
   a phone and on a Chromebook. Demo Mode builds all of it on the device: no
   request goes to the student-submit function, and a grade the teacher has
   not returned is nowhere on the page. */

/* The scripts that work out a grade, as the page asked for them. The page
   fetches them only on a card: ahead, on Is This You?, and runs them once
   the student is in. */
function gradeScripts(page) {
  const asked = [];
  page.on('request', req => {
    const m = /\/shared\/(calc|constants)\.js(\?|$)/.exec(req.url());
    if (m) asked.push(m[1]);
  });
  return asked;
}

const SIZES = [
  { name: 'a phone', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  { name: 'a Chromebook', use: { viewport: { width: 1366, height: 768 } } },
];

for (const size of SIZES) {
  test.describe('student card on ' + size.name, () => {
    test.use(size.use);

    test('card, Is This You?, Assignments, with no request and no draft', async ({ page }) => {
      const wide = size.use.viewport.width >= 900;
      const posts = [];
      const errors = [];
      await page.route('**/functions/v1/**', route => {
        posts.push(route.request().url());
        return route.abort();
      });
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', err => errors.push(String(err)));
      const asked = gradeScripts(page);
      const press = name =>
        wide ? page.getByRole('button', { name }).click() : page.getByRole('button', { name }).tap();
      const fits = async () => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over).toBeLessThanOrEqual(0);
      };

      // Scan or Type Your Card
      await page.goto('/s/#demo-card-both');
      await expect(
        page.getByRole('heading', { name: wide ? 'Type the code on your card' : 'Scan the code on your card' }),
      ).toBeVisible();
      await expect(page).toHaveTitle(/Student Page/);
      await expect(page.getByLabel('Card Code')).toHaveValue('P3R8-WDK4');
      await fits();
      await press('Continue');

      // Is This You? A wrong student number first.
      await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
      await expect(page.locator('.sp-head-title')).toHaveText('Science 8 · Block B');
      await expect(page.getByText('This page is just for you.')).toBeVisible();
      await fits();
      await page.getByLabel('Student Number').fill('999');
      await press('Yes, That’s Me');
      await expect(page.getByRole('alert')).toHaveText(
        "That doesn't match. Check your birthday or student number. 4 tries left.",
      );
      // Then the birthday the demo names.
      await page.getByLabel('Student Number').fill('');
      await page.getByLabel('Month').selectOption('3');
      await page.getByLabel('Day').selectOption('14');
      await page.getByLabel('Year').selectOption(String(new Date().getFullYear() - 13));
      // Is This You? fetched both ahead while the student typed (speed, B1), and ran neither.
      await expect.poll(() => asked.slice().sort()).toEqual(['calc', 'constants']);
      expect(await page.evaluate(() => typeof assessmentCellValue)).toBe('undefined');
      await press('Yes, That’s Me');

      // Assignments: both arrive, once, before the list is drawn.
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeAttached();
      await showAll(page);
      const row = title => page.locator('.sp-row', { hasText: title });
      await expect(row('Energy Transfer Investigation').locator('.sp-row-result')).toHaveText('Extending · 100%');
      await expect(row('Energy Transfer Investigation').locator('.sp-row-sub')).toHaveText(/^Back \S+ \d+$/);
      await expect(row('Cell Microscope Lab').locator('.sp-row-result')).toHaveText('Proficient − · 67%');
      await expect(row('Cell Structure Quiz').locator('.sp-row-result')).toHaveText('8 / 10');
      await expect(row('Lab Safety Contract').locator('.sp-row-result')).toHaveText('Complete');
      await expect(row('Immune System Quick Check').locator('.sp-row-sub')).toHaveText(/^Missing · Due /);
      // A draft never returned: the title and the date, like work not graded.
      await expect(row('Disease Research Poster').locator('.sp-row-sub')).toHaveText(/^Due \S+ \S+ \d+$/);
      await expect(row('Disease Research Poster').locator('.sp-row-result')).toHaveCount(0);
      await expect(row('Science Fair Proposal').locator('.sp-row-result')).toHaveCount(0);
      // A returned grade with a newer draft over it keeps what was returned.
      await expect(row('Ecosystem Connections Essay').locator('.sp-row-result')).toHaveText('Developing · 50%');
      const html = await page.locator('#app').innerHTML();
      expect(html).not.toMatch(/draft/i);
      expect(html).not.toContain('sources are missing');
      expect(html).not.toContain('much clearer');
      expect(html).not.toContain('Emerging');
      expect(html).not.toContain('1.0 · 25%');
      expect(html).not.toContain('3.3 · 83%');
      await fits();

      // Once each: the sign-in ran the copies fetched ahead.
      expect(asked.sort()).toEqual(['calc', 'constants']);
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('student card: the card’s password and the lock', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('five wrong passwords lock the card; nothing is sent', async ({ page }) => {
    const posts = [];
    await page.route('**/functions/v1/**', route => {
      posts.push(route.request().url());
      return route.abort();
    });
    await page.goto('/s/#demo-card-password');
    await page.getByRole('button', { name: 'Continue' }).tap();
    await expect(page.getByText('To make sure it’s you, type the password printed on your card.')).toBeVisible();
    for (let left = 4; left >= 1; left--) {
      await page.getByLabel('Password').fill('0000');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
      await expect(page.getByRole('alert')).toContainText(left === 1 ? '1 try left.' : left + ' tries left.');
    }
    await expect(page.getByRole('alert')).toContainText('One more wrong try locks this card');
    await page.getByLabel('Password').fill('0000');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('alert')).toHaveText(
      'This card is locked after too many wrong tries. Ask your teacher to unlock it.',
    );
    await expect(page.getByLabel('Password')).toHaveCount(0);
    expect(posts).toEqual([]);
  });

  // Since S0-W1 the card is asked first; a code that is no card still goes to open.
  test('a code typed on the slip screen still goes to open, and an unknown one says so', async ({ page }) => {
    const posts = [];
    await page.route('**/functions/v1/student-submit**', async route => {
      const req = route.request();
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
      };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      posts.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'not_found' }),
      });
    });
    await page.goto('/s/');
    await expect(page.getByRole('heading', { name: 'Answer Your Teacher’s Questions' })).toBeVisible();
    await page.getByLabel('Type the code on your slip').fill('P3R-8WD');
    await page.getByRole('button', { name: 'Open' }).tap();
    await expect(page.getByRole('alert')).toContainText(
      "That code didn't work. Check the letters and numbers on your slip.",
    );
    expect(posts).toEqual([
      { route: 'card', code: 'P3R8WD' },
      { route: 'open', code: 'P3R8WD' },
    ]);
  });

  test('a slip page asks for neither calc.js nor constants.js', async ({ page }) => {
    const asked = gradeScripts(page);
    await page.goto('/s/#demo');
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    await page.getByLabel('Student Number').fill('1');
    await page.getByRole('button', { name: 'Yes, Start' }).tap();
    await expect(page.locator('#sp-count')).toBeVisible();
    expect(asked).toEqual([]);
    expect(await page.evaluate(() => typeof window.formatLevel + ' ' + typeof window.Calc)).toBe('undefined undefined');
  });

  test('when calc.js can’t be fetched the list opens without results and says so', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(String(err)));
    await page.route('**/shared/calc.js', route => route.abort());
    await page.goto('/s/#demo-card');
    await page.getByRole('button', { name: 'Continue' }).tap();
    await page.getByLabel('Student Number').fill('1234567');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeAttached();
    await showAll(page);
    await expect(page.getByRole('status')).toHaveText('Your results didn’t load. Check your internet and try again.');
    await expect(page.locator('.sp-row')).toHaveCount(9);
    await expect(page.locator('.sp-row-result')).toHaveCount(0);
    await expect(
      page.locator('.sp-row', { hasText: 'Energy Transfer Investigation' }).locator('.sp-row-sub'),
    ).toHaveText(/^Back \S+ \d+$/);
    await expect(page.locator('.sp-row', { hasText: 'Immune System Quick Check' }).locator('.sp-row-sub')).toHaveText(
      /^Missing · Due /,
    );
    // The connection comes back.
    await page.unroute('**/shared/calc.js');
    await page.getByRole('button', { name: 'Try Again' }).tap();
    await expect(
      page.locator('.sp-row', { hasText: 'Energy Transfer Investigation' }).locator('.sp-row-result'),
    ).toHaveText('Extending');
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
