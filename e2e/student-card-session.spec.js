import { test, expect } from '@playwright/test';
import { OMAR, id, sampleCard, samplePage } from '../tests/helpers/fake-student-submit.js';
import {
  TODAY,
  KEY,
  PHONE,
  CHROMEBOOK,
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
} from './student-card-fake.js';

/* The card session's rules in a real browser (S0-W1, after PR 998's review
   and the owner's rulings of Nov 10): who is signed out by a scanned card,
   what the page says before it knows whether a code is a card or a slip,
   replies that arrive too late, the session's end (midnight, Done, fifteen
   idle minutes) checked before the list can be seen again, and what counts
   as a piece being opened. tests/student-card-session.test.js has each
   rule's cases; this is the browser's own events, layout and clock.

   The function is answered in the test by its own handler over a stand-in
   database (e2e/student-card-fake.js). Nothing real is called. */

const UNREACHED = "Couldn't reach FullVision. Check your internet and try again.";
const MIN = 60 * 1000;
const SLIP = {
  ok: true,
  token: 'a'.repeat(64),
  student: { first_name: 'Cece' },
  course: { name: 'Science 8', block: 'B' },
  preview: [{ title: 'November Reflection', count: 1 }],
  check: 'identity',
  also_password: false,
};

const omar = more =>
  sampleCard(TODAY, {
    code: 'ABCDEFGH',
    enrollment: OMAR,
    first: 'Omar',
    birthday: null,
    number: '7654321',
    page: { ...samplePage(TODAY), student: { enrollment_id: OMAR, first_name: 'Omar' } },
    ...more,
  });

/* The tab is hidden or shown, as switching tabs or closing a lid does. A
   test cannot hide a real tab, so the page is told it is hidden the way
   the browser tells it: document.visibilityState and its event. */
async function setHidden(page, hidden) {
  await page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/* From now on, every time the browser is about to draw, note whether a row
   of the list could be seen. Read back with `drewTheList`. */
const WATCH_FRAMES = () => {
  window.__drew = [];
  const look = () => {
    const rowEl = document.querySelector('.sp-row');
    const seen = !!rowEl && getComputedStyle(rowEl).visibility !== 'hidden' && rowEl.getClientRects().length > 0;
    window.__drew.push(seen);
  };
  new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  const frame = () => {
    look();
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
};
const drewTheList = page => page.evaluate(() => (window.__drew || []).some(Boolean));

test.describe('a shared Chromebook: who a scanned card signs out', () => {
  test.use(CHROMEBOOK);

  for (const [name, more, line] of [
    ['locked', { locked: true }, 'This card is locked after too many wrong tries. Ask your teacher to unlock it.'],
    ['past its last day', { expired: true }, "This card's last day has passed. Ask your teacher for a new card."],
    [
      'for a class with the page off',
      { closed: true },
      'The student page is turned off for this class. Ask your teacher.',
    ],
    [
      'with nothing on file',
      { birthday: null, number: null, password: null },
      'This card needs to be printed again. Ask your teacher for a new card.',
    ],
  ]) {
    test(`Cece is signed in; Omar’s card is ${name}: he is told why, and she is signed out`, async ({ page }) => {
      const fn = school();
      fn.state.cards.ABCDEFGH = omar(more);
      await serve(page, fn);
      await signIn(page);
      const cece = JSON.parse((await stored(page)).local[KEY]).t;

      const tab = await page.context().newPage();
      const posts = await serve(tab, fn);
      await tab.goto('/s/#ABCD-EFGH');
      await expect(tab.getByRole('alert')).toHaveText(line);
      await expect
        .poll(() => posts.map(p => p.body))
        .toEqual([
          { route: 'card', code: 'ABCDEFGH' },
          { route: 'done', session: cece },
        ]);
      expect((await stored(tab)).local).toEqual({});
      expect(fn.state.sessions).toEqual({});
      // The next person to open the page gets nobody's list.
      await tab.goto('/login.html');
      await tab.goto('/s/');
      await expect(tab.getByRole('heading', { name: 'Answer Your Teacher’s Questions' })).toBeVisible();
      // And Cece's own tab, still open, is taken down.
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.locator('.sp-row')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(/Cece|Extending/);
    });
  }

  test('a slip or a mistyped code is no card: Cece stays signed in', async ({ page }) => {
    const fn = school(null, { slips: { K7M4QX: SLIP } });
    await serve(page, fn);
    await signIn(page);
    const kept = (await stored(page)).local[KEY];
    const tab = await page.context().newPage();
    await serve(tab, fn);
    await tab.goto('/s/#XYZ-234');
    await expect(tab.getByRole('alert')).toContainText("That code didn't work.");
    expect(JSON.parse((await stored(tab)).local[KEY]).t).toBe(JSON.parse(kept).t);
    await tab.goto('/login.html');
    await tab.goto('/s/#K7M-4QX');
    await expect(tab.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    expect(JSON.parse((await stored(tab)).local[KEY]).t).toBe(JSON.parse(kept).t);
  });

  test('a questionnaire opened in the tab that was signed in is not taken down by Done elsewhere', async ({ page }) => {
    const fn = school(null, { slips: { K7M4QX: SLIP } });
    await serve(page, fn);
    await signIn(page);
    await page.evaluate(() => (location.hash = '#K7M-4QX'));
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, Start' }).click();
    await expect(page.getByText('How did it go?')).toBeVisible();
    await page.getByLabel('How did it go?').fill('Half way through my answer');

    // Done in another tab on the device.
    const tab = await page.context().newPage();
    await serve(tab, fn);
    await tab.goto('/s/');
    await tab.getByRole('button', { name: 'Done' }).click();
    await expect(tab.getByLabel('Card Code')).toBeVisible();
    await tab.close();

    await page.bringToFront();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    await expect(page.getByLabel('How did it go?')).toHaveValue('Half way through my answer');
    expect(await page.locator('body').innerText()).not.toContain('signed out');
  });
});

test.describe('before the page knows whether a code is a card or a slip', () => {
  test.use(PHONE);

  test('a scanned code with no internet: one line that fits both, and Try Again', async ({ page }) => {
    const fn = school();
    let down = true;
    const posts = await serve(page, fn, { fail: () => down });
    await page.goto('/s/#P3R8-WDK4');
    await expect(page.getByRole('alert')).toHaveText(UNREACHED);
    await expect(page.locator('.sp-head-title')).toHaveText('FullVision');
    expect(await page.locator('#app').innerText()).not.toMatch(/slip|card|answers|Student Questions|Student Page/i);
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeFocused();
    await expect(page.locator('#sp-code')).toHaveCount(0);
    // The card route did not answer, so the slip route was asked too.
    expect(routes(posts)).toEqual(['card', 'open']);
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, '15-code-not-looked-up');
    down = false;
    await page.getByRole('button', { name: 'Try Again' }).tap();
    await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
    expect(routes(posts)).toEqual(['card', 'open', 'card']);
  });

  test('a server error on a real card is not "That code didn’t work"', async ({ page }) => {
    const fn = school();
    let broken = true;
    const posts = await serve(page, fn, {
      answer: body => (broken && body.route === 'card' ? { status: 500, json: { ok: false, error: 'server' } } : null),
    });
    await page.goto('/s/#P3R8-WDK4');
    await expect(page.getByRole('alert')).toHaveText(UNREACHED);
    expect(await page.locator('#app').innerText()).not.toMatch(/didn't work|slip/i);
    expect(routes(posts)).toEqual(['card', 'open']);
    broken = false;
    await page.getByRole('button', { name: 'Try Again' }).tap();
    await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
  });

  /* A slip opens whenever the slip route is healthy, whatever the card
     route does. This is the function after it is deployed with the card
     route failing. */
  test('the card route answers a server error and the slip route is healthy: a slip opens, scanned and typed', async ({
    page,
  }) => {
    const fn = school(null, { slips: { K7M4QX: SLIP } });
    const posts = await serve(page, fn, {
      answer: body => (body.route === 'card' ? { status: 500, json: { ok: false, error: 'server' } } : null),
    });
    await page.goto('/s/#K7M-4QX');
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, Start' }).tap();
    await expect(page.getByText('How did it go?')).toBeVisible();
    expect(routes(posts)).toEqual(['card', 'open', 'verify']);
    // Typed on the slip's first screen.
    posts.length = 0;
    await page.goto('/login.html');
    await page.goto('/s/');
    await page.getByLabel('Type the code on your slip').fill('K7M-4QX');
    await page.getByRole('button', { name: 'Open' }).tap();
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    expect(routes(posts)).toEqual(['card', 'open']);
  });

  test('the card route times out and the slip route is healthy: a slip still opens', async ({ page }) => {
    const fn = school(null, { slips: { K7M4QX: SLIP } });
    const posts = await serve(page, fn, { fail: body => body.route === 'card' });
    await page.goto('/s/#K7M-4QX');
    await expect(page.getByRole('heading', { name: 'Hi Cece!' })).toBeVisible();
    expect(routes(posts)).toEqual(['card', 'open']);
  });

  test('Is This You? opens with the first field in focus, and a wrong answer is read out from it', async ({ page }) => {
    const fn = school();
    await serve(page, fn);
    await page.goto('/s/#P3R8-WDK4');
    await expect(page.getByLabel('Month')).toBeFocused();
    await page.getByLabel('Student Number').fill('999');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('alert')).toContainText('4 tries left.');
    await expect(page.getByLabel('Student Number')).toBeFocused();
    await expect(page.getByLabel('Student Number')).toHaveAccessibleDescription(
      "That doesn't match. Check your birthday or student number. 4 tries left.",
    );
    await expect(page.getByLabel('Student Number')).toHaveAttribute('aria-invalid', 'true');
    // The old answer is selected: typing the right one replaces it, and does not make "9990123456".
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('999');
    await page.keyboard.type('0000000');
    await expect(page.getByLabel('Student Number')).toHaveValue('0000000');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('alert')).toContainText('3 tries left.');
    // A birthday that is wrong: the focus goes to the first picker.
    await page.getByLabel('Student Number').fill('');
    await page.getByLabel('Month').selectOption('1');
    await page.getByLabel('Day').selectOption('1');
    await page.getByLabel('Year').selectOption('2012');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('alert')).toContainText('2 tries left.');
    await expect(page.getByLabel('Month')).toBeFocused();
    // A picker holds one choice: choosing again replaces it.
    await page.getByLabel('Month').selectOption('5');
    await page.getByLabel('Day').selectOption('15');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
    await named(page);
  });

  test('after a wrong student number, the right one typed straight in opens the page', async ({ page }) => {
    const fn = school();
    await serve(page, fn);
    await page.goto('/s/#P3R8-WDK4');
    await page.getByLabel('Student Number').fill('999');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('4 tries left.');
    await expect(page.getByLabel('Student Number')).toBeFocused();
    await page.keyboard.type('0123456');
    await expect(page.getByLabel('Student Number')).toHaveValue('0123456');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
    // One wrong try was counted, not two.
    expect(fn.logs.map(l => l.outcome)).toEqual(['ok', 'wrong_identity', 'ok', 'ok']);
  });

  test('a card that asks for its password opens with the password box in focus', async ({ page }) => {
    const fn = school({ birthday: null, number: null, password: '4821' });
    await serve(page, fn);
    await page.goto('/s/#P3R8-WDK4');
    await expect(page.getByLabel('Password')).toBeFocused();
    await page.keyboard.type('0000');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('4 tries left.');
    await expect(page.getByLabel('Password')).toBeFocused();
    // The wrong password is selected: the right one replaces it.
    await page.keyboard.type('4821');
    await expect(page.getByLabel('Password')).toHaveValue('4821');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
  });
});

test.describe('a reply that comes too late is dropped', () => {
  test.use(PHONE);

  test('Cece is signed in; Omar’s card arrives in the same tab and its check is slow: her list is never drawn again', async ({
    page,
  }) => {
    const fn = school();
    fn.state.cards.ABCDEFGH = omar();
    await serve(page, fn, { delay: { card: 600, page: 200 } });
    await signIn(page);
    // The device is signed in. Opened again, her page is asked for; before it arrives the address changes.
    await page.reload();
    await page.evaluate(WATCH_FRAMES);
    await page.evaluate(() => (location.hash = '#ABCD-EFGH'));
    await expect(page.getByRole('heading', { name: 'Is this you, Omar?' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await drewTheList(page)).toBe(false);
    await expect(page.getByRole('heading', { name: 'Is this you, Omar?' })).toBeVisible();
    expect((await stored(page)).local).toEqual({});
  });

  test('the list is up when Omar’s code arrives: it comes down at once, not when the answer does', async ({ page }) => {
    const fn = school();
    fn.state.cards.ABCDEFGH = omar();
    await serve(page, fn, { delay: { card: 800 } });
    await signIn(page);
    await page.evaluate(() => (location.hash = '#ABCD-EFGH'));
    await page.evaluate(WATCH_FRAMES);
    await expect(page.locator('.sp-row')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Is this you, Omar?' })).toBeVisible();
    expect(await drewTheList(page)).toBe(false);
  });
});

test.describe('the session’s end is checked before the list can be seen again', () => {
  test.use(CHROMEBOOK);

  test('at its end time the page takes itself down with nobody touching it', async ({ page }) => {
    // Three seconds long stands in for one that ends at midnight.
    const fn = school(null, { lasts: 3000 });
    await serve(page, fn);
    await signIn(page);
    const started = Date.now();
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT, { timeout: 6000 });
    // On its own timer, at the end time: not on a slow sweep.
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(page.locator('.sp-row')).toHaveCount(0);
    expect((await stored(page)).local).toEqual({});
  });

  /* A Chromebook that slept with the list open. The clock is four hours on;
     no timer ran, the tab was never hidden, and nobody touches it. */
  for (const [name, lasts] of [
    ['past its midnight', 2 * 60 * MIN],
    ['past fifteen idle minutes', 12 * 60 * MIN],
  ]) {
    test(`woken four hours later, ${name}, with no event: the list comes down by itself`, async ({ page }) => {
      await page.clock.install();
      const fn = school(null, { lasts });
      const posts = await serve(page, fn);
      await signIn(page);
      await page.mouse.move(600, 500);
      await page.clock.setSystemTime(Date.now() + 4 * 60 * MIN);
      await expect(page.getByRole('status')).toHaveText(SIGNED_OUT, { timeout: 4000 });
      await expect(page.locator('.sp-row')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(/Cece|Extending|8 \/ 10/);
      expect((await stored(page)).local).toEqual({});
      // Idle ends it as Done does; a session past its midnight is already over on the server.
      await page.waitForTimeout(300);
      expect(posts.filter(p => p.body.route === 'done')).toHaveLength(name === 'past its midnight' ? 0 : 1);
    });
  }

  test('a hidden tab is covered; shown again after its midnight, the list is never on screen', async ({ page }) => {
    await page.clock.install();
    const fn = school(null, { lasts: 10 * MIN });
    await serve(page, fn);
    await signIn(page);
    await setHidden(page, true);
    await expect(page.locator('html')).toHaveClass(/sp-away/);
    await expect(page.locator('#app')).toHaveCSS('visibility', 'hidden');
    // The lid is closed for eleven minutes: the clock moves and no timer runs.
    await page.clock.setSystemTime(Date.now() + 11 * MIN);
    await page.evaluate(WATCH_FRAMES);
    await setHidden(page, false);
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    await expect(page.locator('html')).not.toHaveClass(/sp-away/);
    expect(await drewTheList(page)).toBe(false);
    expect((await stored(page)).local).toEqual({});
  });

  test('shown again while the session is live, the list is uncovered as it was', async ({ page }) => {
    const fn = school();
    await serve(page, fn);
    await signIn(page);
    await setHidden(page, true);
    await expect(page.locator('#app')).toHaveCSS('visibility', 'hidden');
    await setHidden(page, false);
    await expect(page.locator('#app')).toHaveCSS('visibility', 'visible');
    await expect(row(page, 'Cell Structure Quiz').locator('.sp-row-result')).toHaveText('8 / 10');
  });
});

test.describe('fifteen minutes with no activity', () => {
  test.use(CHROMEBOOK);

  test('fourteen minutes stays; fifteen signs out as Done does, and the server is told once', async ({ page }) => {
    await page.clock.install();
    const fn = school();
    const posts = await serve(page, fn);
    await signIn(page);
    const token = JSON.parse((await stored(page)).local[KEY]).t;
    await page.clock.fastForward(14 * MIN);
    await expect(row(page, 'Cell Structure Quiz')).toBeVisible();
    expect((await stored(page)).local[KEY]).toBeTruthy();
    await page.clock.fastForward(1 * MIN + 1000);
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    await expect(page.locator('.sp-row')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/Cece|Science 8|Extending/);
    expect((await stored(page)).local).toEqual({});
    // Looked at again in every way: still told once.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(20 * MIN);
    await expect
      .poll(() => posts.filter(p => p.body.route === 'done').map(p => p.body))
      .toEqual([{ route: 'done', session: token }]);
    expect(fn.state.sessions).toEqual({});
    await named(page);
  });

  for (const [name, act] of [
    ['a key', page => page.keyboard.press('Shift')],
    ['the pointer', page => page.mouse.move(300, 300)],
    ['a click', page => page.mouse.click(700, 500)],
    ['a scroll', page => page.mouse.wheel(0, 200)],
  ]) {
    test(`${name} is activity: the fifteen minutes start again`, async ({ page }) => {
      await page.clock.install();
      const fn = school();
      await serve(page, fn);
      await signIn(page);
      const signedInAt = JSON.parse((await stored(page)).local[KEY]).a;
      await page.clock.fastForward(10 * MIN);
      await act(page);
      // The page has noted it, beside the token.
      await expect
        .poll(async () => JSON.parse((await stored(page)).local[KEY]).a - signedInAt)
        .toBeGreaterThan(9 * MIN);
      await page.clock.fastForward(10 * MIN); // twenty since the sign-in, ten since the activity
      await expect(row(page, 'Cell Structure Quiz')).toBeVisible();
      await page.clock.fastForward(5 * MIN + 1000);
      await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    });
  }

  test('a touch on a phone is activity', async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await page.clock.install();
    const fn = school();
    await serve(page, fn);
    await signIn(page);
    await page.clock.fastForward(10 * MIN);
    await page.touchscreen.tap(180, 400);
    await page.clock.fastForward(10 * MIN);
    await expect(row(page, 'Cell Structure Quiz')).toBeVisible();
    await page.clock.fastForward(5 * MIN + 1000);
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    await context.close();
  });

  test('the page opened again after fifteen idle minutes: the signed-out screen, and the list is never drawn', async ({
    page,
  }) => {
    await page.clock.install();
    const fn = school();
    const posts = await serve(page, fn);
    await signIn(page);
    const token = JSON.parse((await stored(page)).local[KEY]).t;
    // The lid is closed for sixteen minutes: no timer runs. Then the page is opened again.
    await page.clock.setSystemTime(Date.now() + 16 * MIN);
    await page.addInitScript(WATCH_FRAMES);
    posts.length = 0;
    await page.reload();
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    await expect(page.getByLabel('Card Code')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await drewTheList(page)).toBe(false);
    // The server is told, as Done tells it, and the page is not asked for.
    await expect.poll(() => posts.map(p => p.body)).toEqual([{ route: 'done', session: token }]);
    expect((await stored(page)).local).toEqual({});
    expect(fn.state.sessions).toEqual({});
  });

  test('a lid opened after fifteen idle minutes: the list is never on screen', async ({ page }) => {
    await page.clock.install();
    const fn = school();
    const posts = await serve(page, fn);
    await signIn(page);
    await setHidden(page, true);
    await page.clock.setSystemTime(Date.now() + 16 * MIN);
    await page.evaluate(WATCH_FRAMES);
    await setHidden(page, false);
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    expect(await drewTheList(page)).toBe(false);
    await expect.poll(() => posts.filter(p => p.body.route === 'done')).toHaveLength(1);
  });

  test('two tabs: working in one keeps the other signed in; idle in both, the server is told once', async ({
    page,
  }) => {
    await page.clock.install();
    const fn = school();
    const posts = await serve(page, fn);
    await signIn(page);
    const token = JSON.parse((await stored(page)).local[KEY]).t;
    const two = await page.context().newPage();
    await two.clock.install();
    const twoPosts = await serve(two, fn);
    await two.goto('/s/');
    await expect(two.getByRole('heading', { name: 'Assignments' })).toBeVisible();

    // Ten minutes on, the student is working in the second tab.
    await page.clock.fastForward(10 * MIN);
    await two.mouse.click(700, 500);
    await expect.poll(async () => JSON.parse((await stored(two)).local[KEY]).a).toBeGreaterThan(Date.now() + 9 * MIN);
    // Ten more: twenty since the first tab was touched.
    await page.clock.fastForward(10 * MIN);
    await expect(row(page, 'Cell Structure Quiz')).toBeVisible();
    await expect(row(two, 'Cell Structure Quiz')).toBeVisible();
    // Five more with nothing in either.
    await page.clock.fastForward(5 * MIN + 1000);
    await expect(page.getByRole('status')).toHaveText(SIGNED_OUT);
    await expect(two.getByRole('status')).toHaveText(SIGNED_OUT);
    await expect
      .poll(() =>
        posts
          .concat(twoPosts)
          .filter(p => p.body.route === 'done')
          .map(p => p.body),
      )
      .toEqual([{ route: 'done', session: token }]);
    expect((await stored(page)).local).toEqual({});
  });
});

test.describe('"opened" means the row was on screen', () => {
  test.use(PHONE);

  /* A class with 39 pieces, every one returned. The one at the bottom of
     the list was changed and returned again since it was last opened. */
  function longPage() {
    const page = samplePage(TODAY);
    const base = page.assessments.find(a => a.title === 'KMT & States of Matter Lab');
    page.assessments = Array.from({ length: 39 }, (_, i) => ({
      ...JSON.parse(JSON.stringify(base)),
      id: id(700 + i),
      title: 'Piece ' + String(i + 1).padStart(2, '0'),
      status: null,
      // Newest first on the list: piece 01 is at the top, piece 39 at the bottom.
      date: new Date(Date.parse(TODAY) - (i + 2) * 864e5).toISOString().slice(0, 10),
      due_date: new Date(Date.parse(TODAY) - (i + 1) * 864e5).toISOString().slice(0, 10),
    }));
    const last = page.assessments[38];
    last.updated_at = last.returned_at;
    last.seen_at = new Date(Date.parse(last.returned_at) - 864e5).toISOString();
    last.previous = {
      ...last.grade,
      tags: Object.fromEntries(Object.keys(last.grade.tags).map(k => [k, { value: 2, modifier: 0, comment: null }])),
    };
    return page;
  }

  // The rows the student can see now: most of the row below the header and above the bottom of the screen.
  const onScreen = page =>
    page.evaluate(() => {
      const top = document.querySelector('.sp-head').getBoundingClientRect().bottom;
      return [...document.querySelectorAll('.sp-row')]
        .filter(el => {
          const b = el.getBoundingClientRect();
          const seen = Math.min(b.bottom, window.innerHeight) - Math.max(b.top, top);
          return seen >= b.height * 0.6;
        })
        .map(el => el.querySelector('.sp-row-title').textContent);
    });
  const sent = (fn, posts) => {
    const titles = Object.fromEntries(fn.state.cards.P3R8WDK4.page.assessments.map(a => [a.id, a.title]));
    return posts.filter(p => p.body.route === 'seen').map(p => p.body.assessment_ids.map(a => titles[a]));
  };

  test('39 rows at 375 px: only the rows on screen are sent, then more as the page scrolls', async ({ page }) => {
    const fn = school({ page: longPage() });
    const posts = await serve(page, fn);
    await signIn(page);
    await expect(page.locator('.sp-row')).toHaveCount(39);
    const first = await onScreen(page);
    expect(first.length).toBeGreaterThan(5);
    expect(first.length).toBeLessThan(20);
    expect(first[0]).toBe('Piece 01');
    await expect.poll(() => sent(fn, posts)).toEqual([first]);
    // Nothing more while the page sits still.
    await page.waitForTimeout(1200);
    expect(sent(fn, posts)).toEqual([first]);
    await fits(page);

    // Scroll one screen down.
    await page.mouse.wheel(0, 600);
    await expect.poll(() => sent(fn, posts).length).toBe(2);
    const second = await onScreen(page);
    const all = sent(fn, posts).flat();
    expect(new Set(all).size).toBe(all.length); // each piece once
    second.forEach(title => expect(all).toContain(title));
    expect(all.length).toBeLessThan(39);
    expect(all).not.toContain('Piece 39');

    // To the bottom.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => sent(fn, posts).flat()).toContain('Piece 39');
    const done = sent(fn, posts).flat();
    expect(new Set(done).size).toBe(done.length);
    // Done stays in reach all the way down.
    await expect(page.getByRole('button', { name: 'Done' })).toBeInViewport();
  });

  test('a flick to the bottom: the rows that flew past are not sent, the ones it rests on are', async ({ page }) => {
    const fn = school({ page: longPage() });
    const posts = await serve(page, fn);
    await signIn(page);
    await expect(page.locator('.sp-row')).toHaveCount(39);
    const top = await onScreen(page);
    await expect.poll(() => sent(fn, posts)).toEqual([top]);
    // The whole list in about half a second.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.mouse.move(180, 400);
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, Math.ceil(height / 25));
      await page.waitForTimeout(16);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const bottom = await onScreen(page);
    expect(bottom).toContain('Piece 39');
    await expect.poll(() => sent(fn, posts).length).toBe(2);
    await page.waitForTimeout(1200);
    const all = sent(fn, posts).flat();
    expect(new Set(all).size).toBe(all.length);
    // Only what was read at the top and what the flick came to rest on.
    all.forEach(title => expect(top.concat(bottom)).toContain(title));
    expect(all).not.toContain('Piece 20');
    expect(all.length).toBeLessThan(30);
    await expect(row(page, 'Piece 39').locator('.sp-row-sub')).toHaveText(/· Updated$/);

    // A row that flew past can still count on a later look: scroll back to it and stay.
    await row(page, 'Piece 20').scrollIntoViewIfNeeded();
    await expect.poll(() => sent(fn, posts).flat()).toContain('Piece 20');
  });

  test('a flick past the changed grade and away again: it is not marked opened, and Updated is still there next time', async ({
    page,
  }) => {
    const fn = school({ page: longPage() });
    const posts = await serve(page, fn);
    await signIn(page);
    await expect.poll(() => sent(fn, posts).length).toBe(1);
    // To the bottom and straight back to the top, inside half a second.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    expect(sent(fn, posts).flat()).not.toContain('Piece 39');
    await page.reload();
    await expect(page.locator('.sp-row')).toHaveCount(39);
    await expect(row(page, 'Piece 39').locator('.sp-row-sub')).toHaveText(/· Updated$/);
  });

  test('Updated stays on a changed grade never scrolled to, and goes once it has been on screen', async ({ page }) => {
    const fn = school({ page: longPage() });
    const posts = await serve(page, fn);
    await signIn(page);
    await expect.poll(() => sent(fn, posts).length).toBe(1);
    await expect(row(page, 'Piece 39').locator('.sp-row-sub')).toHaveText(/· Updated$/);
    // The list is loaded again: still marked, never having been on screen.
    await page.reload();
    await expect(page.locator('.sp-row')).toHaveCount(39);
    await expect(row(page, 'Piece 39').locator('.sp-row-sub')).toHaveText(/· Updated$/);
    // Scrolled to: told to the server; the mark stays for this visit.
    posts.length = 0;
    await row(page, 'Piece 39').scrollIntoViewIfNeeded();
    await expect.poll(() => sent(fn, posts).flat()).toContain('Piece 39');
    await expect(row(page, 'Piece 39').locator('.sp-row-sub')).toHaveText(/· Updated$/);
    // The next time the list is loaded, it is gone.
    await page.reload();
    await expect(page.locator('.sp-row')).toHaveCount(39);
    await expect(row(page, 'Piece 39').locator('.sp-row-sub')).not.toHaveText(/Updated/);
  });

  test('a tab loaded in the background sends nothing until it is shown', async ({ page }) => {
    const fn = school();
    const posts = await serve(page, fn);
    await signIn(page);
    await expect.poll(() => sent(fn, posts).length).toBe(1);
    // A second return, so there is something new to open.
    const contract = fn.state.cards.P3R8WDK4.page.assessments.find(a => a.title === 'Lab Safety Contract');
    fn.state.seen = {};
    contract.seen_at = null;
    // The page is opened in a tab nobody is looking at.
    await page.addInitScript(() => {
      window.__hidden = true;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (window.__hidden ? 'hidden' : 'visible'),
      });
    });
    posts.length = 0;
    await page.reload();
    await expect(page.locator('.sp-row')).toHaveCount(9);
    await expect(page.locator('#app')).toHaveCSS('visibility', 'hidden');
    await page.waitForTimeout(1500);
    expect(routes(posts)).toEqual(['page']);
    // It is switched to.
    await page.evaluate(() => {
      window.__hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('#app')).toHaveCSS('visibility', 'visible');
    await expect.poll(() => sent(fn, posts).length).toBe(1);
    expect(sent(fn, posts)[0]).toContain('Lab Safety Contract');
  });

  test('Demo Mode sends nothing', async ({ page }) => {
    const fn = school();
    const posts = await serve(page, fn);
    await page.goto('/s/#demo-card');
    await page.getByRole('button', { name: 'Continue' }).tap();
    await page.getByLabel('Student Number').fill('1234567');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).tap();
    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
    await page.waitForTimeout(1200);
    expect(routes(posts)).toEqual([]);
  });
});
