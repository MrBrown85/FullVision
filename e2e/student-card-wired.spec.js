import { test, expect } from '@playwright/test';
import { CECE, OMAR, sampleCard, samplePage } from '../tests/helpers/fake-student-submit.js';
import {
  TODAY,
  KEY,
  PHONE,
  CHROMEBOOK,
  CORS,
  SIGNED_OUT,
  serve,
  routes,
  school,
  row,
  stored,
  fits,
  named,
  shot,
  contrast,
  signIn,
  showAll,
} from './student-card-fake.js';

/* A real student card on the student page, /s/#CODE (docs/plans/
   student-page-build-plan.md, S0-W1), against the built site with the live
   site's CSP. The student-submit function is not deployed with the card's
   routes and nothing here calls it: every request to it is answered in the
   test by the function's own handler and routes with a stand-in database
   (tests/helpers/fake-student-submit.js), so the page's requests pass the
   handler's checks and its replies have been through the allow-list.

   The shared pieces are in e2e/student-card-fake.js; the session's rules
   (idle, what counts as opened, races) are in
   e2e/student-card-session.spec.js. */

for (const size of [
  { name: 'a phone', use: PHONE },
  { name: 'a Chromebook', use: CHROMEBOOK },
]) {
  test.describe('a real card on ' + size.name, () => {
    test.use(size.use);

    test('the card, Is This You?, the Assignments list, the page again, and Done', async ({ page }) => {
      const fn = school();
      const posts = await serve(page, fn);
      const errors = [];
      page.on('console', msg => msg.type() === 'error' && errors.push(msg.text()));
      page.on('pageerror', err => errors.push(String(err)));

      // The scanned card.
      await page.goto('/s/#P3R8-WDK4');
      await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
      await expect(page.locator('.sp-head-title')).toHaveText('Science 8 · Block B');
      await expect(page).toHaveTitle(/Student Page/);
      // The code has left the address.
      await expect(page).toHaveURL(/\/s\/$/);
      expect(routes(posts)).toEqual(['card']);
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.name === 'a phone' ? '01-is-this-you' : 'chromebook-01-is-this-you');

      // A wrong answer, then the right one.
      await page.getByLabel('Student Number').fill('999');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
      await expect(page.getByRole('alert')).toHaveText(
        "That doesn't match. Check your birthday or student number. 4 tries left.",
      );
      await named(page);
      if (size.name === 'a phone') await shot(page, '02-wrong-answer');
      await page.getByLabel('Student Number').fill('');
      await page.getByLabel('Month').selectOption('5');
      await page.getByLabel('Day').selectOption('15');
      await page.getByLabel('Year').selectOption('2012');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();

      // The Assignments list: returned results only.
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeAttached();
      await showAll(page);
      await expect(row(page, 'Energy Transfer Investigation').locator('.sp-row-result')).toHaveText('4.0');
      await expect(row(page, 'Energy Transfer Investigation').locator('.sp-row-sub')).toHaveText(
        /^Back \S+ \d+ · Extending$/,
      );
      await expect(row(page, 'Cell Microscope Lab').locator('.sp-row-result')).toHaveText('2.7');
      await expect(row(page, 'Cell Structure Quiz').locator('.sp-row-result')).toHaveText('8 / 10');
      await expect(row(page, 'Lab Safety Contract').locator('.sp-row-result')).toHaveText('Complete');
      await expect(row(page, 'Lab Safety Contract').locator('.sp-row-sub')).toHaveText(/^Back \S+ \d+ · Updated$/);
      await expect(row(page, 'Immune System Quick Check').locator('.sp-row-sub')).toHaveText(/^Missing · Due /);
      await expect(row(page, 'Immune System Quick Check').locator('.sp-row-result')).toHaveCount(0);
      await expect(row(page, 'Disease Research Poster').locator('.sp-row-result')).toHaveCount(0);
      await expect(row(page, 'Ecosystem Connections Essay').locator('.sp-row-result')).toHaveText('2.0');
      expect(await page.locator('#app').innerHTML()).not.toMatch(/draft|Demo Mode/i);
      await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeFocused();
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.name === 'a phone' ? '03-assignments' : 'chromebook-03-assignments');

      await expect.poll(() => routes(posts)).toEqual(['card', 'verify', 'verify', 'page', 'work', 'seen']);
      expect(posts[2].body).toEqual({
        route: 'verify',
        code: 'P3R8WDK4',
        birthday: '2012-05-15',
        student_number: null,
        password: null,
      });
      // Pinned to Canada, with no key and no cookie, and nothing but that in the address.
      for (const p of posts) {
        expect(p.url).toBe('https://e2e-test.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1');
        expect(p.headers.authorization).toBeUndefined();
        expect(p.headers.apikey).toBeUndefined();
        expect(p.headers.cookie).toBeUndefined();
        expect(p.headers.referer).toBeUndefined();
      }
      // The handler took every one of them.
      expect(fn.logs.map(l => l.outcome)).toEqual(['ok', 'wrong_identity', 'ok', 'ok', 'ok', 'ok']);

      // On the device: the session's token, when it ends and the class it opens. Nothing else.
      const kept = await stored(page);
      expect(Object.keys(kept.local)).toEqual([KEY]);
      expect(Object.keys(JSON.parse(kept.local[KEY])).sort()).toEqual(['a', 'e', 't', 'x']);
      expect(JSON.parse(kept.local[KEY]).e).toBe(CECE);
      expect(kept.tab).toEqual({});
      expect(JSON.stringify(kept)).not.toMatch(/Cece|Science|P3R|0123456|2012-05|Extending/);
      expect(await page.context().cookies()).toEqual([]);

      // The student reads down the list: every returned piece has been on screen
      // (the line over the list, What Changed Since You Last Looked, takes some room).
      await page.locator('.sp-row').last().scrollIntoViewIfNeeded();
      await expect
        .poll(() => posts.filter(p => p.body.route === 'seen').flatMap(p => p.body.assessment_ids).length)
        .toBe(6);
      await page.getByRole('button', { name: 'Back', exact: true }).click();

      // The page opened again: the student's page, with no card and no check.
      posts.length = 0;
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeAttached();
      await showAll(page);
      await expect(row(page, 'Cell Structure Quiz').locator('.sp-row-result')).toHaveText('8 / 10');
      // Opened last time: no longer marked, and nothing more to tell the server.
      await expect(row(page, 'Lab Safety Contract').locator('.sp-row-sub')).toHaveText(/^Back \S+ \d+$/);
      await expect.poll(() => routes(posts)).toEqual(['page', 'work']);

      // Done.
      await page.getByRole('button', { name: 'Done' }).click();
      // After Done (the artboard's board): nothing of the student, and Scan a Card.
      await expect(page.getByRole('heading', { name: 'You’re signed out' })).toBeFocused();
      await expect(
        page.getByText(
          size.name === 'a phone' ? 'This phone no longer has your card.' : 'This computer no longer has your card.',
        ),
      ).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(/Cece|Science 8|Assignments|Extending|Quiz/);
      expect((await stored(page)).local).toEqual({});
      await expect.poll(() => routes(posts)).toEqual(['page', 'work', 'done']);
      expect(fn.state.sessions).toEqual({});
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.name === 'a phone' ? '04-after-done' : 'chromebook-04-after-done');
      await page.getByRole('button', { name: 'Scan a Card' }).click();
      await expect(page.getByLabel('Card Code')).toBeVisible();
      await expect(page.getByLabel('Card Code')).toHaveValue('');
      await expect(page.locator('.sp-msg')).toHaveCount(0);

      // The page again after Done is the page of a device nobody has used.
      posts.length = 0;
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Answer Your Teacher’s Questions' })).toBeVisible();
      expect(routes(posts)).toEqual([]);
      expect(await page.locator('body').innerText()).not.toMatch(/Cece|Science 8/);

      expect(posts.elsewhere).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('a real card: the keyboard alone', () => {
  test.use(CHROMEBOOK);

  test('the code, the check, the list and Done, without a mouse', async ({ page }) => {
    const fn = school();
    await serve(page, fn);
    await page.goto('/s/');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Type the code on your slip')).toBeFocused();
    await page.keyboard.type('p3r8-wdk4');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
    // The first field has the focus; then Day, Year and the student number.
    await expect(page.getByLabel('Month')).toBeFocused();
    for (const label of ['Day', 'Year', 'Student Number']) {
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(label)).toBeFocused();
    }
    // A wrong answer: the focus stays in the box, and the message is the box's own.
    await page.keyboard.type('999');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('4 tries left.');
    await expect(page.getByLabel('Student Number')).toBeFocused();
    await expect(page.getByLabel('Student Number')).toHaveAccessibleDescription(/That doesn't match\./);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('0123456');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeFocused();
    // Back up the header: All Assignments, then Done.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'All assignments' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    // The class's name (Your Classes) comes before Done.
    await expect(page.getByRole('button', { name: 'Done' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'You’re signed out' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Scan a Card' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Card Code')).toBeFocused();
    expect((await stored(page)).local).toEqual({});
  });
});

test.describe('a real card: what stops it, and what each one says', () => {
  test.use(PHONE);

  const WHY = [
    ['closed', { closed: true }, 'The student page is turned off for this class. Ask your teacher.'],
    ['card_locked', { locked: true }, 'This card is locked after too many wrong tries. Ask your teacher to unlock it.'],
    ['card_expired', { expired: true }, "This card's last day has passed. Ask your teacher for a new card."],
    [
      'reprint',
      { birthday: null, number: null, password: null },
      'This card needs to be printed again. Ask your teacher for a new card.',
    ],
  ];
  // The four answers on one page: each is a fresh card address and a fresh stand-in function.
  test('a card the school answers closed, locked, expired or needing a reprint says why', async ({ page }) => {
    for (const [error, card, line] of WHY) {
      await page.goto('about:blank');
      const fn = school(card);
      const posts = await serve(page, fn);
      await page.goto('/s/#P3R8-WDK4');
      await expect(page.getByRole('alert'), error).toHaveText(line);
      await expect(page).toHaveURL(/\/s\/$/);
      await expect(page.getByLabel('Student Number')).toHaveCount(0);
      expect(routes(posts), error).toEqual(['card']);
      expect(
        fn.logs.map(l => l.outcome),
        error,
      ).toEqual([error]);
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, '10-' + error.replace('_', '-'));
      await page.getByRole('button', { name: 'Type a Different Code' }).tap();
      await expect(page.getByLabel('Card Code')).toBeVisible();
    }
  });

  test('the card’s password, a wrong one, and the lock after five', async ({ page }) => {
    const fn = school({ birthday: null, number: null, password: '4821' });
    await serve(page, fn);
    await page.goto('/s/#P3R8-WDK4');
    await expect(page.getByText('To make sure it’s you, type the password printed on your card.')).toBeVisible();
    await named(page);
    await shot(page, '05-card-password');
    for (let left = 4; left >= 1; left--) {
      await page.getByLabel('Password').fill('0000');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
      await expect(page.getByRole('alert')).toContainText(left === 1 ? '1 try left.' : left + ' tries left.');
    }
    await expect(page.getByRole('alert')).toHaveText(
      "That password doesn't match. Check the password on your card. 1 try left. One more wrong try locks this card, and your teacher will need to unlock it.",
    );
    await fits(page);
    await shot(page, '06-one-try-left');
    await page.getByLabel('Password').fill('0000');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('alert')).toHaveText(
      'This card is locked after too many wrong tries. Ask your teacher to unlock it.',
    );
    await expect(page.getByLabel('Password')).toHaveCount(0);
    expect((await stored(page)).local).toEqual({});
  });

  test('No, That’s Not Me: Give This Card Back', async ({ page }) => {
    const fn = school();
    const posts = await serve(page, fn);
    await page.goto('/s/#P3R8-WDK4');
    await page.getByRole('button', { name: 'No, That’s Not Me' }).tap();
    await expect(page.getByRole('heading', { name: 'Give This Card Back' })).toBeVisible();
    await named(page);
    await shot(page, '07-give-this-card-back');
    await page.getByRole('button', { name: 'Type a Different Code' }).tap();
    await expect(page.getByLabel('Card Code')).toHaveValue('');
    expect(await page.locator('body').innerText()).not.toContain('Cece');
    expect(routes(posts)).toEqual(['card']);
  });

  test('a code that opens nothing, typed on the card’s screen and on the slip’s', async ({ page }) => {
    const fn = school();
    const posts = await serve(page, fn);
    // On the slip's screen: the slip's words, as before.
    await page.goto('/s/');
    await page.getByLabel('Type the code on your slip').fill('ABC-234');
    await page.getByRole('button', { name: 'Open' }).tap();
    await expect(page.getByRole('alert')).toContainText(
      "That code didn't work. Check the letters and numbers on your slip.",
    );
    expect(posts.map(p => p.body)).toEqual([
      { route: 'card', code: 'ABC234' },
      { route: 'open', code: 'ABC234' },
    ]);
    // On the card's screen (after Done): the card's words.
    await signIn(page);
    await page.getByRole('button', { name: 'Done' }).tap();
    await page.getByRole('button', { name: 'Scan a Card' }).tap();
    await page.getByLabel('Card Code').fill('ABC-234');
    await page.getByRole('button', { name: 'Continue' }).tap();
    await expect(page.getByRole('alert')).toHaveText(
      "That code didn't work. Check the letters and numbers on your card.",
    );
    await expect(page.getByLabel('Card Code')).toHaveValue('ABC-234');
    await named(page);
    await shot(page, '08-code-did-not-work');
  });

  test('too many wrong codes from this address', async ({ page }) => {
    const fn = school();
    fn.state.addressLocked = true;
    const posts = await serve(page, fn);
    await page.goto('/s/#P3R8-WDK4');
    await expect(page.getByRole('alert')).toHaveText('Too many tries. Wait 15 minutes and try again.');
    expect(routes(posts)).toEqual(['card', 'open']);
    await shot(page, '10-too-many-tries');
  });

  test('no internet at the check, then at the page: each says so and can be tried again', async ({ page }) => {
    const fn = school();
    let offline = 'verify';
    await serve(page, fn, { fail: body => body.route === offline });
    await page.goto('/s/#P3R8-WDK4');
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('alert')).toHaveText("Couldn't reach FullVision. Check your internet and try again.");
    await expect(page.getByLabel('Student Number')).toHaveValue('0123456');
    await shot(page, '11-check-not-reached');
    offline = 'page';
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText("Couldn't reach FullVision. Check your internet and try again.");
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, '12-page-not-reached');
    offline = '';
    await page.getByRole('button', { name: 'Try Again' }).tap();
    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeAttached();
    await showAll(page);
  });

  const GONE = [
    ['card_stopped', { stopped: true }, 'This card has been replaced. Ask your teacher for your new card.'],
    ['card_expired', { expired: true }, "This card's last day has passed. Ask your teacher for a new card."],
    ['closed', { closed: true }, 'The student page is turned off for this class. Ask your teacher.'],
    ['not_found', { withdrawn: true }, "Your page for this class can't be opened any more. Ask your teacher."],
  ];
  test('the page answered stopped, expired, closed or not found says why and signs the device out', async ({
    page,
  }) => {
    for (const [error, change, line] of GONE) {
      await page.goto('about:blank');
      const fn = school();
      const posts = await serve(page, fn);
      await signIn(page);
      Object.assign(fn.state.cards.P3R8WDK4, change);
      posts.length = 0;
      await page.reload();
      await expect(page.getByRole('alert'), error).toHaveText(line);
      await expect(page.locator('.sp-row')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
      await expect.poll(() => routes(posts), error).toEqual(['page', 'done']);
      expect((await stored(page)).local, error).toEqual({});
      await named(page);
      await shot(page, '13-page-' + error.replace('_', '-'));
    }
  });

  test('when calc.js can’t be fetched the real list opens without results, and tells the server nothing yet', async ({
    page,
  }) => {
    const fn = school();
    const posts = await serve(page, fn);
    await page.route('**/shared/calc.js', route => route.abort());
    await page.goto('/s/#P3R8-WDK4');
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await showAll(page);
    await expect(page.getByRole('status')).toHaveText('Your results didn’t load. Check your internet and try again.');
    await expect(page.locator('.sp-row')).toHaveCount(9);
    await expect(page.locator('.sp-row-result')).toHaveCount(0);
    await expect.poll(() => routes(posts)).toEqual(['card', 'verify', 'page', 'work']);
    await shot(page, '14-results-did-not-load');
    await page.unroute('**/shared/calc.js');
    await page.getByRole('button', { name: 'Try Again' }).tap();
    await expect(row(page, 'Cell Structure Quiz').locator('.sp-row-result')).toHaveText('8 / 10');
    await expect.poll(() => routes(posts)).toEqual(['card', 'verify', 'page', 'work', 'seen']);
  });
});

test.describe('a real card: a class graded by letter, and by both', () => {
  test.use(PHONE);

  for (const [system, four, quiz] of [
    ['letter', '100%', '8 / 10'],
    ['both', '4.0 · 100%', '8 / 10'],
  ]) {
    test(`a ${system} class reads as its teacher’s gradebook does`, async ({ page }) => {
      const fn = school({ page: samplePage(TODAY, system) });
      await serve(page, fn);
      await signIn(page);
      await expect(row(page, 'Energy Transfer Investigation').locator('.sp-row-result')).toHaveText(four);
      await expect(row(page, 'Cell Structure Quiz').locator('.sp-row-result')).toHaveText(quiz);
      await fits(page);
      await shot(page, '03-assignments-' + system);
    });
  }
});

test.describe('a real card: a shared Chromebook', () => {
  test.use(CHROMEBOOK);

  const omar = () =>
    sampleCard(TODAY, {
      code: 'K7M4QX2P',
      enrollment: OMAR,
      first: 'Omar',
      birthday: null,
      number: '7654321',
      page: { ...samplePage(TODAY), student: { enrollment_id: OMAR, first_name: 'Omar' }, assessments: [] },
    });

  test('the next student’s card signs the last student out before it asks anything', async ({ page }) => {
    const fn = school();
    fn.state.cards.K7M4QX2P = omar();
    const posts = await serve(page, fn);
    await signIn(page);
    const cece = JSON.parse((await stored(page)).local[KEY]).t;

    // Omar types his card's code into the same browser, in a new tab.
    const tab = await page.context().newPage();
    const tabPosts = await serve(tab, fn);
    await tab.goto('/s/#K7M4-QX2P');
    await expect(tab.getByRole('heading', { name: 'Is this you, Omar?' })).toBeVisible();
    await expect
      .poll(() => tabPosts.map(p => p.body))
      .toEqual([
        { route: 'card', code: 'K7M4QX2P' },
        { route: 'done', session: cece },
      ]);
    expect((await stored(tab)).local).toEqual({});
    expect(fn.state.sessions).toEqual({});
    // Cece's tab, still open behind it, is taken down when it is looked at again.
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.sp-row')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    expect(await page.locator('body').innerText()).not.toMatch(/Cece|Science 8/);

    await tab.bringToFront();
    await tab.getByLabel('Student Number').fill('7654321');
    await tab.getByRole('button', { name: 'Yes, That’s Me' }).click();
    await expect(tab.getByText('No assignments yet.')).toBeVisible();
    expect(await tab.locator('body').innerText()).not.toContain('Cece');
    const now = JSON.parse((await stored(tab)).local[KEY]);
    expect(now.e).toBe(OMAR);
    expect(now.t).not.toBe(cece);
    expect(posts.elsewhere.concat(tabPosts.elsewhere)).toEqual([]);
    await shot(tab, 'chromebook-05-no-assignments-yet');
  });

  test('the next card opened in the same tab signs the last student out too', async ({ page }) => {
    const fn = school();
    fn.state.cards.K7M4QX2P = omar();
    const posts = await serve(page, fn);
    await signIn(page);
    const cece = JSON.parse((await stored(page)).local[KEY]).t;
    posts.length = 0;
    // The address changes under the open page, as a scanned link does in a tab that is already there.
    await page.evaluate(() => (location.hash = '#K7M4-QX2P'));
    await expect(page.getByRole('heading', { name: 'Is this you, Omar?' })).toBeVisible();
    await expect(page.locator('.sp-row')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/Cece|Extending/);
    await expect
      .poll(() => posts.map(p => p.body))
      .toEqual([
        { route: 'card', code: 'K7M4QX2P' },
        { route: 'done', session: cece },
      ]);
    await expect(page).toHaveURL(/\/s\/$/);
    expect((await stored(page)).local).toEqual({});
  });

  test('after Done, Back and Forward bring back nothing of the last student', async ({ page }) => {
    const fn = school();
    const posts = await serve(page, fn);
    await page.goto('/login.html');
    await signIn(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'You’re signed out' })).toBeVisible();
    posts.length = 0;
    await page.goBack();
    await page.goForward();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('.sp-row')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/Cece|Science 8|Extending/);
    expect(await page.url()).not.toMatch(/P3R/i);
    expect(routes(posts)).not.toContain('page');
    expect((await stored(page)).local).toEqual({});
  });

  test('a page left open is taken down when Done is pressed in another tab, and when Back returns to it', async ({
    page,
  }) => {
    const fn = school();
    await serve(page, fn);
    await signIn(page);
    // The student goes somewhere else in this tab without pressing Done…
    await page.goto('/login.html');
    // …and presses Done in another.
    const tab = await page.context().newPage();
    await serve(tab, fn);
    await tab.goto('/s/');
    await expect(tab.getByRole('heading', { name: 'Assignments' })).toBeAttached();
    await showAll(tab);
    await tab.getByRole('button', { name: 'Done' }).click();
    await expect(tab.getByRole('heading', { name: 'You’re signed out' })).toBeVisible();
    await tab.close();
    // Back in the first tab: whatever the browser kept of the page, the list is not shown.
    await page.goBack();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('.sp-row')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/Cece|Extending|Cell Structure Quiz/);
  });

  test('at its midnight an open page is taken down, and the device then says the student is signed out', async ({
    page,
  }) => {
    // A session three seconds long stands in for one that ends at midnight.
    const fn = school(null, { lasts: 3000 });
    const posts = await serve(page, fn);
    await signIn(page);
    await expect(row(page, 'Cell Structure Quiz')).toBeVisible();
    await page.waitForTimeout(3200);
    // The page checks every few seconds, and whenever it is looked at again.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.sp-row')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    expect((await stored(page)).local).toEqual({});
    expect(await page.locator('body').innerText()).not.toMatch(/Cece|Science 8/);
    await named(page);
    await contrast(page);
    await shot(page, 'chromebook-06-signed-out');
    posts.length = 0;
    await page.reload();
    expect(routes(posts)).toEqual([]);
    await expect(page.locator('.sp-row')).toHaveCount(0);
  });

  test('a device that kept a token past its midnight opens nothing and asks nothing', async ({ page }) => {
    const fn = school();
    const posts = await serve(page, fn);
    await page.goto('/login.html');
    await page.evaluate(
      ([key, enrollment]) =>
        localStorage.setItem(key, JSON.stringify({ t: 'a'.repeat(64), x: '2026-01-01T08:00:00+00:00', e: enrollment })),
      [KEY, CECE],
    );
    await page.goto('/s/');
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    await expect(page.getByLabel('Card Code')).toBeVisible();
    expect(routes(posts)).toEqual([]);
    expect((await stored(page)).local[KEY]).toBeUndefined();
  });
});

test.describe('a slip is as it was', () => {
  test.use(PHONE);

  const SLIP = {
    ok: true,
    token: 'a'.repeat(64),
    student: { first_name: 'Cece' },
    course: { name: 'Science 8', block: 'B' },
    preview: [{ title: 'November Reflection', count: 1 }],
    check: 'identity',
  };

  test('with the card’s routes deployed: card says it is no card, then open and verify as before', async ({ page }) => {
    const fn = school(null, { slips: { K7M4QX: SLIP } });
    const posts = await serve(page, fn);
    await page.goto('/s/#K7M-4QX');
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    await expect(page).toHaveTitle(/Student Questions/);
    // A slip's code stays in the address until it is used, as before.
    await expect(page).toHaveURL(/\/s\/#K7M-4QX$/);
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, Start' }).tap();
    await expect(page.getByText('How did it go?')).toBeVisible();
    expect(posts.map(p => p.body)).toEqual([
      { route: 'card', code: 'K7M4QX' },
      { route: 'open', code: 'K7M4QX' },
      { route: 'verify', token: 'a'.repeat(64), birthday: null, student_number: '0123456', password: null },
    ]);
    // Six characters is no card's code, so the function answers `card` without asking the database; and it sent
    // the token's verify to the slip's function, not the card's.
    expect(fn.sql.map(q => q.fn)).toEqual(['open', 'verify']);
    expect((await stored(page)).local).toEqual({});
  });

  test('against the function deployed today, which has no card route', async ({ page }) => {
    const fn = school(null, { slips: { K7M4QX: SLIP } });
    const posts = [];
    await page.route('**/functions/v1/student-submit**', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const body = JSON.parse(req.postData() || '{}');
      posts.push(body.route);
      // What the deployed handler answers to a route it does not know.
      const reply = body.route === 'card' ? { status: 400, json: { ok: false, error: 'bad_request' } } : null;
      const { status, json } = reply || (await fn.respond(body));
      return route.fulfill({
        status,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify(json),
      });
    });
    await page.goto('/s/#K7M-4QX');
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, Start' }).tap();
    await expect(page.getByText('How did it go?')).toBeVisible();
    expect(posts).toEqual(['card', 'open', 'verify']);
  });
});
