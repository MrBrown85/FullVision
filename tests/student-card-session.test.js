/**
 * The card session's rules on a shared device (S0-W1, after PR 998's
 * review and the owner's two rulings of Nov 10):
 *
 *  - any recognised card signs the last student out, a card that won't
 *    open included; a code that is no card (a slip, a typo) does not;
 *  - the card session never touches a slip's screens;
 *  - before the page knows whether a code is a card or a slip it speaks as
 *    neither;
 *  - a reply that arrives for a card or a session that is no longer the
 *    current one is dropped;
 *  - a session ends at midnight, on Done, and after 15 minutes with no
 *    activity, and a page opened or shown again after that never draws the
 *    list;
 *  - a returned piece counts as opened only once its row has been on
 *    screen in a visible tab.
 *
 * The page runs against the function's real handler with a stand-in
 * database, as in tests/student-card-wired.test.js.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, WORK, fakeStudentSubmit, id, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const KEY = 'fv-s-session';
const SIGNED_OUT = 'You are signed out. Scan or type your card to open your page again.';
const UNREACHED = "Couldn't reach FullVision. Check your internet and try again.";
const MIN = 60 * 1000;

const text = page => page.root().textContent;
const routes = page => page.calls.map(c => c.body.route);
const alertText = page => (page.root().querySelector('[role="alert"]') || {}).textContent || '';
const rowSubs = page =>
  Object.fromEntries(
    [...page.root().querySelectorAll('.sp-row')].map(li => [
      li.querySelector('.sp-row-title').textContent,
      (li.querySelector('.sp-row-sub') || {}).textContent || '',
    ]),
  );
const sleep = ms => new Promise(r => setTimeout(r, ms));
const offline = () => {
  throw new Error('offline');
};

const SLIP = {
  ok: true,
  token: 'a'.repeat(64),
  student: { first_name: 'Cece' },
  course: { name: 'Science 8', block: 'B' },
  preview: [{ title: 'November Reflection', count: 1 }],
  check: 'identity',
  also_password: false,
};

function omarCard(more) {
  const page = samplePage(TODAY);
  page.student = { enrollment_id: OMAR, first_name: 'Omar' };
  return sampleCard(
    TODAY,
    Object.assign({ code: 'ABCDEF', enrollment: OMAR, first: 'Omar', birthday: null, number: '7654321', page }, more),
  );
}

function school(opts = {}) {
  const fn = fakeStudentSubmit(
    Object.assign({ cards: [sampleCard(TODAY, opts.card)].concat(opts.more || []), slips: { K7M4QX: SLIP } }, opts),
  );
  const store = {};
  const tab = server => {
    const page = openStudentPage({ store });
    page.server = server || (body => fn.handle(body));
    return page;
  };
  const open = async (hash, server) => {
    const page = tab(server);
    await page.start(hash || '');
    return page;
  };
  return { fn, store, tab, open, card: fn.state.cards.P3R8WD };
}

async function signIn(dev, server) {
  const page = await dev.open('#P3R-8WD', server);
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  return page;
}

// Every row the page is watching is on screen, and the page has told the server.
async function scrollThroughAll(page) {
  page.onScreen(() => true);
  await page.T.tellSeen();
  await page.settle();
}

describe('any recognised card signs the last student out', () => {
  const WONT_OPEN = [
    ['is locked', { locked: true }, 'This card is locked after too many wrong tries. Ask your teacher to unlock it.'],
    ['is past its last day', { expired: true }, "This card's last day has passed. Ask your teacher for a new card."],
    [
      'is for a class with the page off',
      { closed: true },
      'The student page is turned off for this class. Ask your teacher.',
    ],
    [
      'has nothing on file to check',
      { birthday: null, number: null, password: null },
      'This card needs to be printed again. Ask your teacher for a new card.',
    ],
  ];

  it.each(WONT_OPEN)('Cece is signed in; Omar scans a card that %s', async (name, more, line) => {
    const dev = school({ more: [omarCard(more)] });
    await signIn(dev);
    const cece = JSON.parse(dev.store[KEY]).t;

    const omar = await dev.open('#ABC-DEF');
    expect(alertText(omar)).toBe(line);
    // Cece is signed out, on the device and on the server.
    expect(omar.calls.map(c => c.body)).toEqual([
      { route: 'card', code: 'ABCDEF' },
      { route: 'done', session: cece },
    ]);
    expect(dev.store).toEqual({});
    expect(dev.fn.state.sessions).toEqual({});
    // The next person to open the page gets nobody's list.
    const next = await dev.open('');
    expect(next.calls).toEqual([]);
    expect(text(next)).not.toContain('Energy Transfer Investigation');
    expect(next.root().querySelector('.sp-big').textContent).toBe('Answer Your Teacher’s Questions');
  });

  it('a tab still showing Cece’s list is taken down by it too', async () => {
    const dev = school({ more: [omarCard({ locked: true })] });
    const first = await signIn(dev);
    await dev.open('#ABC-DEF');
    first.fire('storage');
    expect(first.root().querySelector('.sp-row')).toBeNull();
    expect(text(first)).not.toContain('Cece');
  });

  /* Decided: a code that is no card leaves the last student signed in. The
     ruling is about a card. A student who is signed in and then scans their
     own questionnaire slip must not lose their page for it, and a mistyped
     code tells the page nothing about who is holding the device. */
  it.each([
    ['a slip', '#K7M-4QX', 'Hi Cece!'],
    ['a code nobody holds', '#XYZ-234', "That code didn't work."],
  ])('%s scanned on the device leaves Cece signed in', async (name, hash, shows) => {
    const dev = school();
    await signIn(dev);
    const kept = dev.store[KEY];
    const other = await dev.open(hash);
    expect(text(other)).toContain(shows);
    expect(routes(other)).toEqual(['card', 'open']);
    expect(dev.store[KEY]).toBe(kept);
    expect(Object.keys(dev.fn.state.sessions)).toEqual([JSON.parse(kept).t]);
  });

  it('too many wrong codes from this address is not a card either: nobody is signed out', async () => {
    const dev = school();
    await signIn(dev);
    const kept = dev.store[KEY];
    dev.fn.state.addressLocked = true;
    const other = await dev.open('#ABC-DEF');
    expect(alertText(other)).toBe('Too many tries. Wait 15 minutes and try again.');
    expect(dev.store[KEY]).toBe(kept);
  });
});

describe('the card session never touches a slip', () => {
  async function slipInTheSameTab(dev) {
    const tab = await signIn(dev);
    // The slip's code arrives in the same tab: student.js starts again.
    tab.T.start(tab.root(), '#K7M-4QX');
    await tab.settle();
    expect(text(tab)).toContain('Hi Cece!');
    tab.type('#sp-ident', '0123456');
    await tab.click('[data-act="start"]');
    expect(tab.T.state().screen).toBe('part');
    expect(text(tab)).toContain('How did it go?');
    return tab;
  }

  it('Done in another tab leaves the questionnaire where it is', async () => {
    const dev = school();
    const tab = await slipInTheSameTab(dev);
    delete dev.store[KEY];
    tab.fire('storage');
    tab.T.checkSession();
    tab.show();
    await tab.settle();
    expect(tab.T.state().screen).toBe('part');
    expect(text(tab)).toContain('How did it go?');
    expect(text(tab)).not.toContain('signed out');
  });

  it('midnight and fifteen idle minutes leave it too', async () => {
    const dev = school();
    const tab = await slipInTheSameTab(dev);
    const ends = Date.parse(JSON.parse(dev.store[KEY]).x);
    tab.T.checkSession(ends + 1);
    expect(tab.T.state().screen).toBe('part');
    tab.advance(16 * MIN);
    tab.fire('pageshow');
    tab.hide();
    tab.show();
    await tab.settle();
    expect(tab.T.state().screen).toBe('part');
    expect(text(tab)).toContain('How did it go?');
    expect(routes(tab)).not.toContain('done');
  });

  it('a slip typed on the card’s first screen while the device is signed in is left alone as well', async () => {
    const dev = school();
    await signIn(dev);
    let down = true;
    // The page can't be reached, so the card's message screen keeps the session.
    const tab = await dev.open('', body => (down && body.route === 'page' ? offline() : dev.fn.handle(body)));
    expect(tab.root().querySelector('[data-act="page-retry"]')).toBeTruthy();
    down = false;
    await tab.click('[data-act="card-restart"]');
    tab.type('#sp-code', 'K7M-4QX');
    await tab.submit('form[data-form="card"]');
    expect(text(tab)).toContain('Hi Cece!');
    tab.T.checkSession(Date.parse(JSON.parse(dev.store[KEY]).x) + 1);
    expect(text(tab)).toContain('Hi Cece!');
  });
});

describe('before the page knows whether a code is a card or a slip, it speaks as neither', () => {
  function neither(page) {
    expect(alertText(page)).toBe(UNREACHED);
    expect(text(page)).not.toMatch(/slip|card|answers|Student Questions|Student Page/i);
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('FullVision');
    expect(page.root().querySelector('#sp-code')).toBeNull();
    expect(page.root().querySelector('[data-act="code-retry"]').textContent).toBe('Try Again');
  }

  it('a scanned card with no internet: one neutral line and Try Again, and the slip route is not asked', async () => {
    const dev = school();
    let down = true;
    const page = await dev.open('#P3R-8WD', body => (down ? offline() : dev.fn.handle(body)));
    expect(routes(page)).toEqual(['card']);
    neither(page);
    // Still nothing: the same screen.
    await page.click('[data-act="code-retry"]');
    expect(routes(page)).toEqual(['card', 'card']);
    neither(page);
    // The internet is back: the card opens.
    down = false;
    await page.click('[data-act="code-retry"]');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });

  it('a scanned slip with no internet reads the same, and opens on Try Again', async () => {
    const dev = school();
    let down = true;
    const page = await dev.open('#K7M-4QX', body => (down ? offline() : dev.fn.handle(body)));
    neither(page);
    down = false;
    await page.click('[data-act="code-retry"]');
    expect(text(page)).toContain('Hi Cece!');
    expect(routes(page)).toEqual(['card', 'card', 'open']);
  });

  it('while a scanned code is being looked up, the loading screen is neither’s', async () => {
    const dev = school();
    const page = dev.tab(async body => {
      await sleep(20);
      return dev.fn.handle(body);
    });
    page.T.start(page.root(), '#P3R-8WD');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('FullVision');
    expect(text(page)).not.toMatch(/Student Questions|Student Page|slip|card/i);
    await page.settle();
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });

  /* Only a clear "this is no card" sends a code on to the slip route: the
     function's not_found, and the bad_request the function deployed today
     gives a route it does not know. */
  it.each([
    ['a server error (500)', () => ({ ok: false, error: 'server' })],
    ['a reply that says neither', () => ({ ok: true })],
    ['an error this page has no name for', () => ({ ok: false, error: 'teapot' })],
    ['nothing at all', () => undefined],
  ])('card answers %s for a real card: the neutral line, never "That code didn’t work"', async (name, says) => {
    const dev = school();
    let broken = true;
    const page = await dev.open('#P3R-8WD', body => (broken && body.route === 'card' ? says() : dev.fn.handle(body)));
    expect(routes(page)).toEqual(['card']);
    neither(page);
    broken = false;
    await page.click('[data-act="code-retry"]');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });

  it.each([
    ['not_found', () => ({ ok: false, error: 'not_found' })],
    ['the old function’s bad_request', () => ({ ok: false, error: 'bad_request' })],
  ])('card answers %s: the code goes on to the slip route', async (name, says) => {
    const dev = school();
    const page = await dev.open('#K7M-4QX', body => (body.route === 'card' ? says() : dev.fn.handle(body)));
    expect(routes(page)).toEqual(['card', 'open']);
    expect(text(page)).toContain('Hi Cece!');
  });

  it('card says no card, then the slip route can’t be reached: the slip’s own words, as before', async () => {
    const dev = school();
    const page = await dev.open('#K7M-4QX', body => (body.route === 'open' ? offline() : dev.fn.handle(body)));
    expect(alertText(page)).toBe(
      "Couldn't reach FullVision. Check your internet and try again. Your answers are still here.",
    );
  });

  it('the address is locked for cards and the slip route can’t be reached: still neither', async () => {
    const dev = school();
    dev.fn.state.addressLocked = true;
    const page = await dev.open('#P3R-8WD', body => (body.route === 'open' ? offline() : dev.fn.handle(body)));
    expect(routes(page)).toEqual(['card', 'open']);
    neither(page);
  });
});

describe('a reply for a card or a session that is no longer the current one is dropped', () => {
  it('Cece’s page is on its way when Omar’s code arrives in the same tab: her list is never drawn', async () => {
    const dev = school({ more: [omarCard()] });
    await signIn(dev);
    let releaseCard;
    const slowCard = new Promise(r => (releaseCard = r));
    const tab = dev.tab(async body => {
      if (body.route === 'page') await sleep(30);
      if (body.route === 'card') await slowCard;
      return dev.fn.handle(body);
    });
    const drawn = [];
    const watch = setInterval(() => drawn.push(text(tab).includes('Energy Transfer Investigation')), 5);
    tab.T.start(tab.root(), ''); // the device is signed in: Cece's page is asked for
    await tab.tick();
    tab.T.start(tab.root(), '#ABC-DEF'); // the address changes to Omar's code
    await sleep(120);
    expect(text(tab)).not.toContain('Energy Transfer Investigation');
    expect(text(tab)).not.toContain('8 / 10');
    releaseCard();
    await tab.settle();
    clearInterval(watch);
    expect(drawn.some(Boolean)).toBe(false);
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Is this you, Omar?');
  });

  it('Try Again is on its way, then Type a Different Code: the list does not appear under the code box', async () => {
    const dev = school();
    await signIn(dev);
    let down = true;
    let release;
    const gate = new Promise(r => (release = r));
    const tab = await dev.open('', async body => {
      if (body.route === 'page' && down) offline();
      if (body.route === 'page') await gate;
      return dev.fn.handle(body);
    });
    expect(alertText(tab)).toBe(UNREACHED);
    down = false;
    tab.tap('[data-act="page-retry"]');
    await tab.tick();
    tab.tap('[data-act="card-restart"]');
    await tab.tick();
    expect(tab.root().querySelector('form[data-form="card"]')).toBeTruthy();
    release();
    await tab.settle();
    expect(tab.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(tab.root().querySelector('.sp-row')).toBeNull();
  });

  it('the check is on its way, then No, That’s Not Me: the page does not open behind Give This Card Back', async () => {
    const dev = school();
    let release;
    const gate = new Promise(r => (release = r));
    const tab = await dev.open('#P3R-8WD', async body => {
      if (body.route === 'verify') await gate;
      return dev.fn.handle(body);
    });
    tab.type('#sp-ident', '0123456');
    tab.tap('[data-act="card-yes"]');
    await tab.tick();
    tab.tap('[data-act="card-notme"]');
    await tab.tick();
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    release();
    await tab.settle();
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    expect(tab.root().querySelector('.sp-row')).toBeNull();
    // Whatever the server started for that answer, this device holds no token for it.
    expect(dev.store).toEqual({});
  });

  it('another code typed under Is This You? while the check is on its way: the new card’s screen is ready to answer', async () => {
    const dev = school({ more: [omarCard()] });
    let release;
    const gate = new Promise(r => (release = r));
    const tab = await dev.open('#P3R-8WD', async body => {
      if (body.route === 'verify' && body.code === 'P3R8WD') await gate;
      return dev.fn.handle(body);
    });
    tab.type('#sp-ident', '0123456');
    tab.tap('[data-act="card-yes"]');
    await tab.tick();
    tab.type('#sp-code', 'ABC-DEF');
    tab.send('form[data-form="card"]');
    await sleep(80); // Cece's check is still held up
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Is this you, Omar?');
    const yes = tab.root().querySelector('[data-act="card-yes"]');
    expect(yes.textContent).toBe('Yes, That’s Me');
    expect(yes.hasAttribute('disabled')).toBe(false);
    release();
    await tab.settle();
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Is this you, Omar?');
    expect(text(tab)).not.toContain('Energy Transfer Investigation');
  });

  it('a slip’s reply that lands after another code was scanned is dropped too', async () => {
    const dev = school();
    let release;
    const gate = new Promise(r => (release = r));
    const tab = dev.tab(async body => {
      if (body.route === 'open') await gate;
      return dev.fn.handle(body);
    });
    tab.T.start(tab.root(), '#K7M-4QX');
    await sleep(30);
    tab.T.start(tab.root(), '#P3R-8WD');
    await sleep(80); // the slip's reply is still held up
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
    release();
    await tab.settle();
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });
});

describe('a session’s end is checked before the list can be drawn again', () => {
  it('at its end time the page takes itself down, with nobody touching it', async () => {
    const dev = school({ lasts: 150 });
    const page = await signIn(dev);
    await sleep(260);
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(dev.store).toEqual({});
  });

  it('a hidden tab is covered, and uncovered only after the session has been checked', async () => {
    const dev = school();
    const page = await signIn(dev);
    const covered = () => page.ctx.document.documentElement.classList.contains('sp-away');
    expect(covered()).toBe(false);
    page.hide();
    expect(covered()).toBe(true);
    // Nothing uncovers it while it is still hidden.
    page.fire('pageshow');
    page.fire('focus');
    expect(covered()).toBe(true);
    page.show();
    expect(covered()).toBe(false);
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it.each(['pageshow', 'show', 'focus'])(
    'a lid opened after midnight (%s): the list is gone before it is uncovered',
    async how => {
      const dev = school({ lasts: 10 * MIN });
      const page = await signIn(dev);
      // The tab is hidden, or (pageshow) the page is left and kept for Back.
      if (how === 'pageshow') page.fire('pagehide');
      else page.hide();
      page.advance(11 * MIN); // the timer could not run
      // What is on the page at the moment it is uncovered.
      let atUncover = null;
      const html = page.ctx.document.documentElement;
      const remove = html.classList.remove.bind(html.classList);
      html.classList.remove = name => {
        if (name === 'sp-away') atUncover = page.root().querySelectorAll('.sp-row').length;
        return remove(name);
      };
      if (how === 'show') page.show();
      else page.fire(how);
      expect(page.root().querySelector('.sp-row')).toBeNull();
      expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
      if (how === 'focus') page.show();
      expect(atUncover).toBe(0);
      expect(dev.store).toEqual({});
    },
  );

  it('the device opened again after midnight draws nothing of the list and asks nothing', async () => {
    const dev = school({ lasts: 60 });
    await signIn(dev);
    await sleep(90);
    const page = dev.tab();
    const seen = [];
    page.T.start(page.root(), '');
    seen.push(page.root().querySelectorAll('.sp-row').length);
    await page.settle();
    seen.push(page.root().querySelectorAll('.sp-row').length);
    expect(seen).toEqual([0, 0]);
    expect(page.calls).toEqual([]);
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
  });
});

describe('fifteen minutes with no activity ends the session, as Done does', () => {
  it('fourteen minutes stays; fifteen signs out, tells the server once, and clears the device', async () => {
    const dev = school();
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    page.advance(14 * MIN);
    page.T.checkSession();
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(dev.store[KEY]).toBeTruthy();

    page.advance(1 * MIN);
    page.T.checkSession();
    await page.settle();
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(page.root().querySelector('.sp-msg').getAttribute('role')).toBe('status');
    expect(text(page)).not.toContain('Cece');
    expect(dev.store).toEqual({});
    expect(dev.fn.state.sessions).toEqual({});
    // Every way the page can notice says so again; the server is told once.
    page.T.checkSession();
    page.fire('pageshow');
    page.fire('focus');
    page.hide();
    page.show();
    await page.settle();
    expect(page.calls.filter(c => c.body.route === 'done').map(c => c.body)).toEqual([
      { route: 'done', session: token },
    ]);
  });

  it.each(['pointerdown', 'keydown', 'scroll', 'touchstart', 'pointermove', 'wheel'])(
    '%s is activity: the fifteen minutes start again',
    async name => {
      const dev = school();
      const page = await signIn(dev);
      page.advance(10 * MIN);
      page.fire(name);
      page.advance(10 * MIN); // twenty minutes since the sign-in, ten since the activity
      page.T.checkSession();
      expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
      page.advance(5 * MIN);
      page.T.checkSession();
      expect(page.root().querySelector('.sp-row')).toBeNull();
      expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    },
  );

  it('opening the page is not activity, and a touch after the fifteen minutes does not bring it back', async () => {
    const dev = school();
    await signIn(dev);
    // Someone opens the page ten minutes later and touches nothing.
    const again = dev.tab();
    again.advance(10 * MIN);
    await again.start('');
    expect(again.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    again.advance(5 * MIN);
    // The first thing that happens is a touch.
    again.fire('pointerdown');
    await again.settle();
    expect(again.root().querySelector('.sp-row')).toBeNull();
    expect(again.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(dev.store).toEqual({});
  });

  it('the time of the last activity is kept with the session, and nothing else is', async () => {
    const dev = school();
    const page = await signIn(dev);
    const kept = () => JSON.parse(dev.store[KEY]);
    expect(Object.keys(kept()).sort()).toEqual(['a', 'e', 't', 'x']);
    const first = kept().a;
    expect(Math.abs(first - Date.now())).toBeLessThan(5000);
    page.advance(3 * MIN);
    page.fire('keydown');
    expect(kept().a - first).toBeGreaterThanOrEqual(3 * MIN - 1000);
    expect(Object.keys(dev.store)).toEqual([KEY]);
  });

  it.each(['load', 'pageshow', 'show'])(
    'reopened after fifteen idle minutes (%s): the signed-out screen, never the list, and done sent once',
    async how => {
      const dev = school();
      const first = await signIn(dev);
      const token = JSON.parse(dev.store[KEY]).t;
      let page = first;
      if (how === 'load') {
        page = dev.tab();
        page.advance(16 * MIN);
        const frames = [];
        page.T.start(page.root(), '');
        frames.push(page.root().querySelectorAll('.sp-row').length);
        await page.settle();
        frames.push(page.root().querySelectorAll('.sp-row').length);
        expect(frames).toEqual([0, 0]);
        expect(routes(page)).toEqual(['done']);
      } else {
        if (how === 'pageshow') page.fire('pagehide');
        else page.hide();
        page.advance(16 * MIN); // the lid was closed: no timer ran
        let atUncover = null;
        const html = page.ctx.document.documentElement;
        const remove = html.classList.remove.bind(html.classList);
        html.classList.remove = name => {
          if (name === 'sp-away') atUncover = page.root().querySelectorAll('.sp-row').length;
          return remove(name);
        };
        if (how === 'show') page.show();
        else page.fire('pageshow');
        await page.settle();
        expect(atUncover).toBe(0);
        expect(page.calls.filter(c => c.body.route === 'done')).toHaveLength(1);
      }
      expect(page.root().querySelector('.sp-row')).toBeNull();
      expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
      expect(page.calls.filter(c => c.body.route === 'done')[0].body).toEqual({ route: 'done', session: token });
      expect(dev.store).toEqual({});
      expect(dev.fn.state.sessions).toEqual({});
      expect(text(page)).not.toMatch(/Cece|Energy Transfer/);
    },
  );

  it('two tabs: activity in one keeps the other signed in, and when both go idle the server is told once', async () => {
    const dev = school();
    const one = await signIn(dev);
    const two = await dev.open('');
    expect(two.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    const token = JSON.parse(dev.store[KEY]).t;

    // Ten minutes on, the student is working in tab one.
    one.advance(10 * MIN);
    two.advance(10 * MIN);
    one.fire('pointerdown');
    // Ten more: twenty since tab two was last touched, ten since tab one was.
    one.advance(10 * MIN);
    two.advance(10 * MIN);
    two.T.checkSession();
    one.T.checkSession();
    expect(two.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(one.root().querySelector('.sp-page-title').textContent).toBe('Assignments');

    // Five more with nothing in either.
    one.advance(5 * MIN);
    two.advance(5 * MIN);
    two.T.checkSession();
    one.T.checkSession();
    await one.settle();
    await two.settle();
    for (const tab of [one, two]) {
      expect(tab.root().querySelector('.sp-row')).toBeNull();
      expect(tab.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    }
    const done = one.calls.concat(two.calls).filter(c => c.body.route === 'done');
    expect(done.map(c => c.body)).toEqual([{ route: 'done', session: token }]);
    expect(dev.store).toEqual({});
  });

  it('Demo Mode is not timed', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    page.advance(60 * MIN);
    page.T.checkSession();
    page.fire('pointerdown');
    page.hide();
    page.show();
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(page.calls).toEqual([]);
    expect(page.store).toEqual({});
  });

  it('a slip is not timed: an hour on a questionnaire changes nothing', async () => {
    const dev = school();
    const page = await dev.open('#K7M-4QX');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="start"]');
    page.advance(60 * MIN);
    page.fire('pointerdown');
    page.fire('pageshow');
    page.hide();
    page.show();
    expect(page.T.state().screen).toBe('part');
    expect(text(page)).toContain('How did it go?');
    expect(routes(page)).toEqual(['card', 'open', 'verify']);
    expect(dev.store).toEqual({});
  });
});

describe('"opened" means the row was on screen in a visible tab', () => {
  const unseenRows = page =>
    [...page.root().querySelectorAll('[data-unseen]')].map(el => el.getAttribute('data-unseen'));
  const seenCalls = page => page.calls.filter(c => c.body.route === 'seen').map(c => c.body.assessment_ids);

  it('drawing the list tells the server nothing; a row that comes on screen is told, once', async () => {
    const dev = school();
    const page = await signIn(dev);
    expect(routes(page)).toEqual(['card', 'verify', 'page']);
    // The rows that could be opened: returned, with a result drawn, not opened since they came back.
    expect(unseenRows(page)).toEqual([WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]);

    // Only the first two are in view.
    page.onScreen(el => [WORK.energy, WORK.quiz].includes(el.getAttribute('data-unseen')));
    await page.T.tellSeen();
    await page.settle();
    expect(seenCalls(page)).toEqual([[WORK.energy, WORK.quiz]]);
    expect(page.calls[page.calls.length - 1].body).toEqual({
      route: 'seen',
      session: JSON.parse(dev.store[KEY]).t,
      enrollment_id: CECE,
      assessment_ids: [WORK.energy, WORK.quiz],
    });

    // The page scrolls: the same two and two more.
    page.onScreen(el => [WORK.energy, WORK.quiz, WORK.lab, WORK.essay].includes(el.getAttribute('data-unseen')));
    await page.T.tellSeen();
    await page.settle();
    expect(seenCalls(page)).toEqual([
      [WORK.energy, WORK.quiz],
      [WORK.lab, WORK.essay],
    ]);
    // Nothing new on screen: nothing more is sent.
    page.onScreen(el => [WORK.lab].includes(el.getAttribute('data-unseen')));
    await page.T.tellSeen();
    await page.settle();
    expect(seenCalls(page)).toHaveLength(2);
  });

  it('rows on screen are batched into one call a moment later, not one each', async () => {
    const dev = school();
    const page = await signIn(dev);
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.energy);
    page.onScreen(el => [WORK.energy, WORK.quiz].includes(el.getAttribute('data-unseen')));
    page.onScreen(el => [WORK.energy, WORK.quiz, WORK.lab].includes(el.getAttribute('data-unseen')));
    expect(seenCalls(page)).toEqual([]);
    await sleep(900);
    await page.settle();
    expect(seenCalls(page)).toEqual([[WORK.energy, WORK.quiz, WORK.lab]]);
  });

  it('a tab loaded in the background sends nothing until it is shown', async () => {
    const dev = school();
    await signIn(dev);
    const page = dev.tab();
    page.hide();
    await page.start('');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    // The browser reports the rows in view, but nobody is looking.
    page.onScreen(() => true);
    await page.T.tellSeen();
    await page.settle();
    expect(routes(page)).toEqual(['page']);
    page.show();
    await page.T.tellSeen();
    await page.settle();
    expect(seenCalls(page)).toEqual([[WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]]);
  });

  it('a row that left the screen before the tab was shown is not counted', async () => {
    const dev = school();
    await signIn(dev);
    const page = dev.tab();
    page.hide();
    await page.start('');
    page.onScreen(() => true);
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.quiz);
    page.show();
    await page.T.tellSeen();
    await page.settle();
    expect(seenCalls(page)).toEqual([[WORK.quiz]]);
  });

  it('Updated stays on a changed grade never scrolled to, and goes once it has been on screen and the list is loaded again', async () => {
    const dev = school();
    const page = await signIn(dev);
    expect(rowSubs(page)['Lab Safety Contract']).toMatch(/· Updated$/);
    // Everything but the contract, at the bottom, is looked at.
    page.onScreen(el => el.getAttribute('data-unseen') !== WORK.contract);
    await page.T.tellSeen();
    await page.settle();
    const second = await dev.open('');
    expect(rowSubs(second)['Lab Safety Contract']).toMatch(/· Updated$/);
    expect(second.root().querySelectorAll('[data-unseen]')).toHaveLength(1);
    // Now it is scrolled to. The mark stays for this visit…
    await scrollThroughAll(second);
    expect(seenCalls(second)).toEqual([[WORK.contract]]);
    expect(rowSubs(second)['Lab Safety Contract']).toMatch(/· Updated$/);
    // …and is gone the next time the list is loaded.
    const third = await dev.open('');
    expect(rowSubs(third)['Lab Safety Contract']).not.toMatch(/Updated/);
    expect(third.root().querySelectorAll('[data-unseen]')).toHaveLength(0);
    await scrollThroughAll(third);
    expect(routes(third)).toEqual(['page']);
  });

  it('a piece is sent once per session, whatever the answer', async () => {
    const dev = school();
    let down = true;
    const page = await signIn(dev, body => (down && body.route === 'seen' ? offline() : dev.fn.handle(body)));
    await scrollThroughAll(page);
    down = false;
    await scrollThroughAll(page);
    page.hide();
    page.show();
    await page.T.tellSeen();
    await page.settle();
    expect(seenCalls(page)).toHaveLength(1);
  });

  it('nothing is watched or sent while the results have not loaded', async () => {
    const dev = school();
    const page = dev.tab();
    page.net.fail = src => /calc\.js$/.test(src);
    await page.start('#P3R-8WD');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-no-results')).toBeTruthy();
    expect(unseenRows(page)).toEqual([]);
    await scrollThroughAll(page);
    expect(routes(page)).toEqual(['card', 'verify', 'page']);
    page.net.fail = () => false;
    await page.click('[data-act="grades-retry"]');
    expect(unseenRows(page)).toHaveLength(6);
    await scrollThroughAll(page);
    expect(seenCalls(page)).toHaveLength(1);
  });

  it('a row with no result to see is never watched: not graded, a draft, Missing, Excused, a comment alone', async () => {
    const piece = (n, title, more) =>
      Object.assign(
        {
          id: id(300 + n),
          title,
          date: '2026-10-0' + n,
          due_date: null,
          score_mode: 'proficiency',
          max_points: null,
          weight: 1,
          rubric_id: null,
          tag_ids: [],
          status: null,
          returned_at: null,
          updated_at: null,
          seen_at: null,
          grade: null,
          previous: null,
        },
        more,
      );
    const at = '2026-11-03T20:00:00+00:00';
    const copy = part =>
      Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, part);
    const dev = school({
      card: {
        page: Object.assign(samplePage(TODAY), {
          assessments: [
            piece(1, 'Not Graded'),
            piece(2, 'Missing', { status: 'NS', returned_at: at }),
            piece(3, 'Excused', { status: 'EXC', returned_at: at }),
            piece(4, 'Comment Only', { returned_at: at, grade: copy({ comment: 'See me.' }) }),
            piece(5, 'Seen Already', {
              returned_at: at,
              seen_at: '2026-11-04T20:00:00+00:00',
              grade: copy({ value: 3 }),
            }),
            piece(6, 'New', { returned_at: at, grade: copy({ value: 2 }) }),
          ],
        }),
      },
    });
    const page = await signIn(dev);
    expect(unseenRows(page)).toEqual([id(306)]);
    // A row that was never returned carries no mark a returned one does not.
    const li = title => [...page.root().querySelectorAll('.sp-row')].find(el => el.textContent.includes(title));
    expect(li('Not Graded').attributes.length).toBe(li('Seen Already').attributes.length);
    await scrollThroughAll(page);
    expect(seenCalls(page)).toEqual([[id(306)]]);
  });

  it('with no way to tell what is on screen (a very old browser), nothing is sent and the marks stay', async () => {
    const dev = school();
    const page = openStudentPage({ store: dev.store, noObserver: true });
    page.server = body => dev.fn.handle(body);
    await page.start('#P3R-8WD');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    await page.T.tellSeen();
    await page.settle();
    expect(routes(page)).toEqual(['card', 'verify', 'page']);
    expect(rowSubs(page)['Lab Safety Contract']).toMatch(/· Updated$/);
  });

  it('Demo Mode sends nothing: its sample is marked opened on the device', async () => {
    const page = openStudentPage();
    await page.start('#demo-card');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(rowSubs(page)['Lab Safety Contract']).toMatch(/· Updated$/);
    await scrollThroughAll(page);
    expect(page.calls).toEqual([]);
    const contract = page.T.demoPage('proficiency').assessments.find(a => a.id === 'demo-contract');
    expect(Date.parse(contract.seen_at)).toBeGreaterThan(Date.parse(contract.updated_at));
  });

  it('Done stops the watching: a row reported afterwards sends nothing', async () => {
    const dev = school();
    const page = await signIn(dev);
    page.onScreen(() => true);
    await page.click('[data-act="card-done"]');
    await sleep(800);
    await page.T.tellSeen();
    await page.settle();
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'done']);
    expect(page.observers).toEqual([]);
  });
});

describe('Is This You? says a wrong answer where a screen reader will read it', () => {
  it('the fields point at the message, and are marked wrong', async () => {
    const dev = school();
    const page = await dev.open('#P3R-8WD');
    const field = sel => page.root().querySelector(sel);
    expect(field('#sp-ident').hasAttribute('aria-describedby')).toBe(false);
    page.type('#sp-ident', '999');
    await page.click('[data-act="card-yes"]');
    const msg = page.root().querySelector('.sp-msg');
    expect(msg.getAttribute('role')).toBe('alert');
    expect(msg.getAttribute('id')).toBe('sp-check-msg');
    for (const sel of ['#sp-ident', '#sp-bm', '#sp-bd', '#sp-by']) {
      expect(field(sel).getAttribute('aria-describedby'), sel).toBe('sp-check-msg');
      expect(field(sel).getAttribute('aria-invalid'), sel).toBe('true');
    }
  });
});
