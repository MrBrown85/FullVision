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
import { makeHandler as functionDeployedToday } from './fixtures/student-submit-handler-2026-11-03.ts';
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
// Every piece, as All Assignments lists it (S4-F1: the tab opens on To Do).
const rowSubs = page =>
  (page.showAll(), 0) ||
  Object.fromEntries(
    [...page.root().querySelectorAll('.sp-row')].map(li => [
      li.querySelector('.sp-row-title').textContent,
      (li.querySelector('.sp-row-sub') || {}).textContent || '',
    ]),
  );
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Waits for what a held-up or slow reply leads to, however long a busy machine takes.
const big = page => (page.root().querySelector('.sp-big') || {}).textContent;
async function until(ok, what) {
  const giveUp = Date.now() + 10000;
  while (!ok()) {
    if (Date.now() > giveUp) throw new Error('never happened: ' + what);
    await sleep(5);
  }
}
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
    Object.assign({ code: 'ABCDEFGH', enrollment: OMAR, first: 'Omar', birthday: null, number: '7654321', page }, more),
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
  return { fn, store, tab, open, card: fn.state.cards.P3R8WDK4 };
}

async function signIn(dev, server) {
  const page = await dev.open('#P3R8-WDK4', server);
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
  page.showAll();
  return page;
}

// Every row the page is watching comes on screen and stays there, and the page has told the server.
async function scrollThroughAll(page) {
  page.onScreen(() => true);
  await readFor(page, 700);
}
// The student looks at what is on screen for this long; then whatever is due is sent.
async function readFor(page, ms) {
  page.advance(ms);
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

    const omar = await dev.open('#ABCD-EFGH');
    expect(alertText(omar)).toBe(line);
    // Cece is signed out, on the device and on the server.
    expect(omar.calls.map(c => c.body)).toEqual([
      { route: 'card', code: 'ABCDEFGH' },
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
    await dev.open('#ABCD-EFGH');
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
    const other = await dev.open('#ABCD-EFGH');
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

  it('a scanned card with no internet: one neutral line and Try Again', async () => {
    const dev = school();
    let down = true;
    const page = await dev.open('#P3R8-WDK4', body => (down ? offline() : dev.fn.handle(body)));
    // The card route did not answer, so the slip route was tried too. Neither did.
    expect(routes(page)).toEqual(['card', 'open']);
    neither(page);
    // Still nothing: the same screen.
    await page.click('[data-act="code-retry"]');
    expect(routes(page)).toEqual(['card', 'open', 'card', 'open']);
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
    expect(routes(page)).toEqual(['card', 'open', 'card', 'open']);
  });

  it('while a scanned code is being looked up, the loading screen is neither’s', async () => {
    const dev = school();
    const page = dev.tab(async body => {
      await sleep(20);
      return dev.fn.handle(body);
    });
    page.T.start(page.root(), '#P3R8-WDK4');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('FullVision');
    expect(text(page)).not.toMatch(/Student Questions|Student Page|slip|card/i);
    await page.settle();
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });

  /* When the card route gives no answer the page can use, the slip route
     is still asked: a slip must open whenever the slip route is healthy.
     But "not found" from the slip route then proves nothing about a card,
     so it is never "That code didn't work… new slip." */
  const UNWELL = [
    ['a server error (500)', () => ({ ok: false, error: 'server' })],
    ['a reply that says neither', () => ({ ok: true })],
    ['an error this page has no name for', () => ({ ok: false, error: 'teapot' })],
    ['nothing at all', () => undefined],
    ['no answer (a timeout)', offline],
  ];

  it.each(UNWELL)(
    'card answers %s for a real card: the neutral line, never "That code didn’t work"',
    async (name, says) => {
      const dev = school();
      let broken = true;
      const page = await dev.open('#P3R8-WDK4', body =>
        broken && body.route === 'card' ? says() : dev.fn.handle(body),
      );
      expect(routes(page)).toEqual(['card', 'open']);
      neither(page);
      expect(text(page)).not.toContain("didn't work");
      broken = false;
      await page.click('[data-act="code-retry"]');
      expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
    },
  );

  it.each(UNWELL)('card answers %s and the slip route is healthy: a scanned slip opens', async (name, says) => {
    const dev = school();
    const page = await dev.open('#K7M-4QX', body => (body.route === 'card' ? says() : dev.fn.handle(body)));
    expect(routes(page)).toEqual(['card', 'open']);
    expect(text(page)).toContain('Hi Cece!');
    expect(page.root().querySelector('.sp-head-sub').textContent).toBe('Student Questions');
    // And the student carries on: the check, then the questions.
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="start"]');
    expect(text(page)).toContain('How did it go?');
    expect(routes(page)).toEqual(['card', 'open', 'verify']);
  });

  it.each(UNWELL)(
    'card answers %s and the slip route is healthy: a slip typed on the slip’s screen opens',
    async (name, says) => {
      const dev = school();
      const page = await dev.open('', body => (body.route === 'card' ? says() : dev.fn.handle(body)));
      page.type('#sp-code', 'K7M-4QX');
      await page.submit('form[data-form="code"]');
      expect(routes(page)).toEqual(['card', 'open']);
      expect(text(page)).toContain('Hi Cece!');
    },
  );

  it('the card route is unwell and the slip says it was used, is closed or is not open yet: it is a slip, in the slip’s words', async () => {
    for (const [reply, shows] of [
      [{ ok: false, error: 'used' }, 'This slip has already been used.'],
      [{ ok: false, error: 'closed' }, 'These questions are closed now.'],
      [{ ok: false, error: 'not_open_yet' }, 'These questions are not open yet.'],
    ]) {
      const dev = school({ slips: { K7M4QX: reply } });
      const page = await dev.open('#K7M-4QX', body =>
        body.route === 'card' ? { ok: false, error: 'server' } : dev.fn.handle(body),
      );
      expect(alertText(page), reply.error).toContain(shows);
    }
  });

  it('the card route is unwell and the slip route says too many tries, or busy: said as it is, as neither’s', async () => {
    for (const [error, line] of [
      ['locked', 'Too many tries. Wait 15 minutes and try again.'],
      ['busy', 'FullVision is busy right now. Wait a minute and try again.'],
    ]) {
      const dev = school();
      const page = await dev.open('#P3R8-WDK4', body => ({
        ok: false,
        error: body.route === 'card' ? 'server' : error,
      }));
      expect(alertText(page), error).toBe(line);
      expect(page.root().querySelector('.sp-head-title').textContent).toBe('FullVision');
      expect(text(page)).not.toMatch(/slip|card|Student Questions/i);
      expect(page.root().querySelector('[data-act="code-retry"]')).toBeTruthy();
    }
  });

  it('the card route is unwell and a code is typed on the card’s screen: the neutral line there, not "didn’t work"', async () => {
    const dev = school();
    const first = await signIn(dev);
    await first.click('[data-act="card-done"]');
    await first.click('[data-act="card-restart"]');
    first.server = body => (body.route === 'card' ? { ok: false, error: 'server' } : dev.fn.handle(body));
    first.type('#sp-code', 'P3R8-WDK4');
    await first.submit('form[data-form="card"]');
    expect(alertText(first)).toBe(UNREACHED);
    expect(first.root().querySelector('form[data-form="card"]')).toBeTruthy();
    // A slip typed there still opens.
    first.type('#sp-code', 'K7M-4QX');
    await first.submit('form[data-form="card"]');
    expect(text(first)).toContain('Hi Cece!');
  });

  /* The page released before the function is deployed. This is the
     function's handler as it stood on Nov 3, itself, with a stand-in
     database: it knows no card route. */
  it('against the function as deployed today, a slip opens and is answered, and nothing is counted for the card question', async () => {
    const asked = [];
    const old = functionDeployedToday({
      region: 'ca-central-1',
      ipKey: 'k',
      log: () => {},
      db: {
        open: async code => (asked.push(['open', code]), SLIP),
        verify: async token => (
          asked.push(['verify', token]),
          {
            ok: true,
            parts: [
              {
                id: 'p1',
                kind: 'core_reflection',
                title: 'November Reflection',
                questions: [{ id: 'q1', kind: 'text', prompt: 'How did it go?', options: {}, core_ids: [] }],
              },
            ],
            context: {},
          }
        ),
      },
    });
    const statuses = [];
    const server = async body => {
      const res = await old(
        new Request('https://x.supabase.co/functions/v1/student-submit', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://fullvision.ca',
            'cf-connecting-ip': '203.0.113.7',
          },
          body: JSON.stringify(body),
        }),
      );
      statuses.push(body.route + ' ' + res.status);
      return res.json();
    };
    const dev = school();
    const page = await dev.open('#K7M-4QX', server);
    expect(text(page)).toContain('Hi Cece!');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="start"]');
    expect(text(page)).toContain('How did it go?');
    expect(statuses).toEqual(['card 400', 'open 200', 'verify 200']);
    // The card question never reached the database: nothing to count.
    expect(asked).toEqual([
      ['open', 'K7M4QX'],
      ['verify', 'a'.repeat(64)],
    ]);
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
    const page = await dev.open('#P3R8-WDK4', body => (body.route === 'open' ? offline() : dev.fn.handle(body)));
    expect(routes(page)).toEqual(['card', 'open']);
    neither(page);
  });

  it('the address is locked for cards and the code opens no slip: Too many tries, as neither’s', async () => {
    const dev = school();
    dev.fn.state.addressLocked = true;
    const page = await dev.open('#P3R8-WDK4');
    expect(alertText(page)).toBe('Too many tries. Wait 15 minutes and try again.');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('FullVision');
    expect(text(page)).not.toMatch(/slip|Student Questions/i);
  });
});

describe('a reply for a card or a session that is no longer the current one is dropped', () => {
  it('Cece’s page is on its way when Omar’s code arrives in the same tab: her list is never drawn', async () => {
    const dev = school({ more: [omarCard()] });
    await signIn(dev);
    let releaseCard, releasePage, pageAnswered;
    const slowCard = new Promise(r => (releaseCard = r));
    const slowPage = new Promise(r => (releasePage = r));
    const answered = new Promise(r => (pageAnswered = r));
    const tab = dev.tab(async body => {
      if (body.route === 'card') await slowCard;
      if (body.route !== 'page') return dev.fn.handle(body);
      await slowPage;
      const reply = await dev.fn.handle(body);
      pageAnswered();
      return reply;
    });
    const drawn = [];
    const watch = setInterval(() => drawn.push(text(tab).includes('Energy Transfer Investigation')), 5);
    tab.T.start(tab.root(), ''); // the device is signed in: Cece's page is asked for
    await until(() => routes(tab).includes('page'), 'Cece’s page asked for');
    tab.T.start(tab.root(), '#ABCD-EFGH'); // the address changes to Omar's code
    // Cece's page arrives while Omar's code is still being looked up.
    releasePage();
    await answered;
    // Her page's reply has been handed to the page and handled: only Omar's card is still out.
    await until(() => tab.inFlight() === 1, 'Cece’s page reply handled');
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
    await until(() => routes(tab).filter(r => r === 'page').length >= 2, 'Try Again on its way');
    tab.tap('[data-act="card-restart"]');
    await until(() => tab.root().querySelector('form[data-form="card"]'), 'the code box');
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
    const tab = await dev.open('#P3R8-WDK4', async body => {
      if (body.route === 'verify') await gate;
      return dev.fn.handle(body);
    });
    tab.type('#sp-ident', '0123456');
    tab.tap('[data-act="card-yes"]');
    await until(() => routes(tab).includes('verify'), 'the check on its way');
    tab.tap('[data-act="card-notme"]');
    await until(() => big(tab) === 'Give This Card Back', 'Give This Card Back');
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    release();
    await tab.settle();
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    expect(tab.root().querySelector('.sp-row')).toBeNull();
    // Whatever the server started for that answer, this device holds no token for it.
    expect(dev.store).toEqual({});
  });

  it('the check has passed and the page is on its way, then No, That’s Not Me: that student is signed out, as Done does', async () => {
    const dev = school();
    let release;
    const gate = new Promise(r => (release = r));
    const tab = await dev.open('#P3R8-WDK4', async body => {
      if (body.route === 'page') await gate;
      return dev.fn.handle(body);
    });
    tab.type('#sp-ident', '0123456');
    tab.tap('[data-act="card-yes"]');
    await until(() => Object.keys(dev.store).length > 0, 'the session kept');
    const token = JSON.parse(dev.store[KEY]).t;
    tab.tap('[data-act="card-notme"]');
    await until(() => big(tab) === 'Give This Card Back', 'Give This Card Back');
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    release();
    await tab.settle();
    expect(tab.root().querySelector('.sp-row')).toBeNull();
    // Nothing of hers is left on the device, and the server has ended her session.
    expect(dev.store).toEqual({});
    expect(tab.calls.map(c => c.body)).toContainEqual({ route: 'done', session: token });
    expect(dev.fn.state.sessions).toEqual({});
    // The next person to open the page gets nobody's list.
    const next = await dev.open('');
    expect(next.calls).toEqual([]);
    expect(text(next)).not.toContain('Energy Transfer Investigation');
  });

  it.each([
    ['assessments', 'x'],
    ['rubrics', 7],
  ])('a page whose %s is not a list: the plain message and Try Again, not Checking… for good', async (field, value) => {
    const dev = school();
    const tab = await dev.open('#P3R8-WDK4', async body => {
      const res = await dev.fn.handle(body);
      if (body.route === 'page' && res && res.ok) return Object.assign({}, res, { [field]: value });
      return res;
    });
    tab.type('#sp-ident', '0123456');
    await tab.click('[data-act="card-yes"]');
    await tab.settle();
    expect(alertText(tab)).toBe(UNREACHED);
    expect(tab.root().querySelector('[data-act="page-retry"]')).toBeTruthy();
    expect(text(tab)).not.toContain('Checking');
  });

  it('Try Again on results, then Done: the signed-out screen is not drawn again when the results arrive', async () => {
    const dev = school();
    const page = dev.tab();
    page.net.fail = src => /calc\.js$/.test(src);
    await page.start('#P3R8-WDK4');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('[data-act="grades-retry"]')).toBeTruthy();
    page.net.fail = () => false;
    page.tap('[data-act="grades-retry"]');
    page.tap('[data-act="card-done"]');
    const shown = page.root().firstElementChild;
    await page.settle();
    // The screen Done drew is the one still showing, untouched.
    expect(page.root().firstElementChild).toBe(shown);
    expect(page.root().querySelector('.sp-row')).toBeNull();
  });

  it('another tab signs Omar in: the tab still showing Cece’s list takes it down', async () => {
    const dev = school({ more: [omarCard()] });
    const first = await signIn(dev);
    const omar = await dev.open('#ABCD-EFGH');
    omar.type('#sp-ident', '7654321');
    await omar.click('[data-act="card-yes"]');
    expect(JSON.parse(dev.store[KEY]).e).toBe(OMAR);
    first.fire('storage');
    first.T.checkSession();
    await first.settle();
    expect(first.root().querySelector('.sp-row')).toBeNull();
    // Omar stays signed in: Cece's tab leaves without touching his session.
    expect(JSON.parse(dev.store[KEY]).e).toBe(OMAR);
  });

  it('another code typed under Is This You? while the check is on its way: the new card’s screen is ready to answer', async () => {
    const dev = school({ more: [omarCard()] });
    let release;
    const gate = new Promise(r => (release = r));
    const tab = await dev.open('#P3R8-WDK4', async body => {
      if (body.route === 'verify' && body.code === 'P3R8WDK4') await gate;
      return dev.fn.handle(body);
    });
    tab.type('#sp-ident', '0123456');
    tab.tap('[data-act="card-yes"]');
    await until(() => routes(tab).includes('verify'), 'Cece’s check on its way');
    tab.type('#sp-code', 'ABCD-EFGH');
    tab.send('form[data-form="card"]');
    // Cece's check is still held up.
    await until(() => big(tab) === 'Is this you, Omar?', 'Omar’s card');
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
    await until(() => routes(tab).includes('open'), 'the slip asked for');
    tab.T.start(tab.root(), '#P3R8-WDK4');
    // The slip's reply is still held up.
    await until(() => big(tab) === 'Is this you, Cece?', 'Cece’s card');
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
    release();
    await tab.settle();
    expect(tab.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });
});

describe('a session’s end is checked before the list can be drawn again', () => {
  it('at its end time the page takes itself down, with nobody touching it', async () => {
    // Ten minutes long, so its end comes before the fifteen idle minutes do.
    const dev = school({ lasts: 10 * MIN });
    const page = await signIn(dev);
    page.advance(10 * MIN + 1000);
    page.runTimers(); // the page's own timer, on time; no tick, no event
    await page.settle();
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(dev.store).toEqual({});
  });

  /* A device that slept with the list open: the clock has moved and no
     timer ran, no tab was hidden or shown, and nobody has touched it. The
     page looks at the clock every second while a list is up. */
  it('the clock jumps past the session’s end with no event at all: the next tick takes the list down', async () => {
    const dev = school({ lasts: 3 * 60 * MIN });
    const page = await signIn(dev);
    page.advance(10 * MIN);
    page.fire('pointerdown'); // still in use
    page.runTicks();
    expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
    page.advance(4 * 60 * MIN); // asleep four hours
    page.runTicks();
    await page.settle();
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(text(page)).not.toMatch(/Cece|Energy Transfer/);
    expect(dev.store).toEqual({});
  });

  it('the clock jumps sixteen idle minutes with no event: the next tick signs out as Done does, once', async () => {
    const dev = school();
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    page.advance(14 * MIN);
    page.runTicks();
    expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
    page.advance(2 * MIN);
    page.runTicks();
    page.runTicks();
    await page.settle();
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(page.calls.filter(c => c.body.route === 'done').map(c => c.body)).toEqual([
      { route: 'done', session: token },
    ]);
    expect(dev.store).toEqual({});
  });

  it('the tick stops with the session, and never touches a slip', async () => {
    const dev = school();
    const page = await signIn(dev);
    await page.click('[data-act="card-done"]');
    page.advance(60 * MIN);
    page.runTicks();
    expect(page.root().querySelector('.sp-signed-out')).toBeTruthy();
    expect(page.root().querySelector('.sp-msg')).toBeNull();
    // A slip in a tab that was signed in.
    const tab = await signIn(dev);
    tab.T.start(tab.root(), '#K7M-4QX');
    await tab.settle();
    tab.advance(60 * MIN);
    tab.runTicks();
    expect(text(tab)).toContain('Hi Cece!');
  });

  it('a last-activity time in the future (the clock was set back) does not keep a session alive', async () => {
    const dev = school();
    await signIn(dev);
    const kept = JSON.parse(dev.store[KEY]);
    dev.store[KEY] = JSON.stringify(Object.assign(kept, { a: Date.now() + 5 * 60 * MIN }));
    const page = await dev.open('');
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
    expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
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
    // Ten minutes long, so its end comes before the fifteen idle minutes do.
    const dev = school({ lasts: 10 * MIN });
    await signIn(dev);
    const page = dev.tab();
    page.advance(11 * MIN); // the device is opened again eleven minutes later
    const seen = [];
    page.T.start(page.root(), '');
    seen.push(page.root().querySelectorAll('.sp-row').length);
    await page.settle();
    seen.push(page.root().querySelectorAll('.sp-row').length);
    expect(seen).toEqual([0, 0]);
    expect(page.calls).toEqual([]);
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(dev.store).toEqual({});
  });
});

describe('fifteen minutes with no activity ends the session, as Done does', () => {
  it('fourteen minutes stays; fifteen signs out, tells the server once, and clears the device', async () => {
    const dev = school();
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    page.advance(14 * MIN);
    page.T.checkSession();
    expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
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
      expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
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
    expect(again.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
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
    expect(two.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
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
    expect(two.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
    expect(one.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);

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
    expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
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

  /* A row counts only if it is still on screen, in a visible tab, when
     0.6 s is up. A false "opened" would lose Updated for good. */
  it('a flick: rows that pass through and are gone inside 0.6 s are not sent', async () => {
    const dev = school();
    const page = await signIn(dev);
    // Down the whole list and off the end in under half a second.
    page.onScreen(el => [WORK.energy, WORK.quiz].includes(el.getAttribute('data-unseen')));
    page.advance(150);
    page.onScreen(el => [WORK.lab, WORK.essay].includes(el.getAttribute('data-unseen')));
    page.advance(150);
    page.onScreen(el => [WORK.kmt, WORK.contract].includes(el.getAttribute('data-unseen')));
    page.advance(150);
    page.onScreen(() => false);
    await readFor(page, 2000);
    expect(seenCalls(page)).toEqual([]);
    expect(rowSubs(page)['Lab Safety Contract']).toMatch(/· Updated$/);
    // The list loaded again: every one of them can still be opened, and the mark is still there.
    const next = await dev.open('');
    next.showAll();
    expect(next.root().querySelectorAll('[data-unseen]')).toHaveLength(6);
    expect(rowSubs(next)['Lab Safety Contract']).toMatch(/· Updated$/);
  });

  it('a flick that stops: only the rows it comes to rest on are sent', async () => {
    const dev = school();
    const page = await signIn(dev);
    page.onScreen(el => [WORK.energy, WORK.quiz].includes(el.getAttribute('data-unseen')));
    page.advance(200);
    page.onScreen(el => [WORK.kmt, WORK.contract].includes(el.getAttribute('data-unseen')));
    await readFor(page, 500); // 0.7 s since the top rows came on, 0.5 s since the bottom ones did
    expect(seenCalls(page)).toEqual([]);
    await readFor(page, 200);
    expect(seenCalls(page)).toEqual([[WORK.kmt, WORK.contract]]);
  });

  it('a row read for a second is sent', async () => {
    const dev = school();
    const page = await signIn(dev);
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.quiz);
    await readFor(page, 500);
    expect(seenCalls(page)).toEqual([]);
    await readFor(page, 500);
    expect(seenCalls(page)).toEqual([[WORK.quiz]]);
  });

  it('a row that leaves and comes back starts again, and counts on the later look', async () => {
    const dev = school();
    const page = await signIn(dev);
    const only = id_ => el => el.getAttribute('data-unseen') === id_;
    page.onScreen(only(WORK.quiz));
    page.advance(400);
    page.onScreen(() => false);
    await readFor(page, 1000);
    expect(seenCalls(page)).toEqual([]);
    // Back on screen: 0.4 s earlier does not count toward this look.
    page.onScreen(only(WORK.quiz));
    await readFor(page, 300);
    expect(seenCalls(page)).toEqual([]);
    await readFor(page, 400);
    expect(seenCalls(page)).toEqual([[WORK.quiz]]);
  });

  it('time in a hidden tab does not count: the 0.6 s starts when the tab is shown', async () => {
    const dev = school();
    const page = await signIn(dev);
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.quiz);
    page.advance(300);
    page.hide();
    await readFor(page, 5000);
    expect(seenCalls(page)).toEqual([]);
    page.show();
    await readFor(page, 300);
    expect(seenCalls(page)).toEqual([]);
    await readFor(page, 400);
    expect(seenCalls(page)).toEqual([[WORK.quiz]]);
  });

  it('drawing the list tells the server nothing; a row that comes on screen is told, once', async () => {
    const dev = school();
    const page = await signIn(dev);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work']);
    // The rows that could be opened: returned, with a result drawn, not opened since they came back.
    expect(unseenRows(page)).toEqual([WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]);

    // Only the first two are in view.
    page.onScreen(el => [WORK.energy, WORK.quiz].includes(el.getAttribute('data-unseen')));
    await readFor(page, 700);
    expect(seenCalls(page)).toEqual([[WORK.energy, WORK.quiz]]);
    expect(page.calls[page.calls.length - 1].body).toEqual({
      route: 'seen',
      session: JSON.parse(dev.store[KEY]).t,
      enrollment_id: CECE,
      assessment_ids: [WORK.energy, WORK.quiz],
    });

    // The page scrolls: the same two and two more.
    page.onScreen(el => [WORK.energy, WORK.quiz, WORK.lab, WORK.essay].includes(el.getAttribute('data-unseen')));
    await readFor(page, 700);
    expect(seenCalls(page)).toEqual([
      [WORK.energy, WORK.quiz],
      [WORK.lab, WORK.essay],
    ]);
    // Nothing new on screen: nothing more is sent.
    page.onScreen(el => [WORK.lab].includes(el.getAttribute('data-unseen')));
    await readFor(page, 700);
    expect(seenCalls(page)).toHaveLength(2);
  });

  it('rows on screen are batched into one call a moment later, not one each', async () => {
    const dev = school();
    const page = await signIn(dev);
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.energy);
    page.onScreen(el => [WORK.energy, WORK.quiz].includes(el.getAttribute('data-unseen')));
    page.onScreen(el => [WORK.energy, WORK.quiz, WORK.lab].includes(el.getAttribute('data-unseen')));
    expect(seenCalls(page)).toEqual([]);
    page.advance(900);
    page.runTimers(); // the page's own timer, on time
    await page.settle();
    expect(seenCalls(page)).toEqual([[WORK.energy, WORK.quiz, WORK.lab]]);
  });

  it('a tab loaded in the background sends nothing until it is shown', async () => {
    const dev = school();
    await signIn(dev);
    const page = dev.tab();
    page.hide();
    await page.start('');
    page.showAll();
    expect(page.root().querySelector('.sp-page-title').textContent).toMatch(/^(All )?Assignments$/);
    // The browser reports the rows in view, but nobody is looking.
    page.onScreen(() => true);
    await readFor(page, 2000);
    expect(routes(page)).toEqual(['page', 'work']);
    page.show();
    await readFor(page, 700);
    expect(seenCalls(page)).toEqual([[WORK.energy, WORK.quiz, WORK.lab, WORK.essay, WORK.kmt, WORK.contract]]);
  });

  it('a row that left the screen before the tab was shown is not counted', async () => {
    const dev = school();
    await signIn(dev);
    const page = dev.tab();
    page.hide();
    await page.start('');
    page.showAll();
    page.onScreen(() => true);
    page.onScreen(el => el.getAttribute('data-unseen') === WORK.quiz);
    page.show();
    await readFor(page, 700);
    expect(seenCalls(page)).toEqual([[WORK.quiz]]);
  });

  it('Updated stays on a changed grade never scrolled to, and goes once it has been on screen and the list is loaded again', async () => {
    const dev = school();
    const page = await signIn(dev);
    expect(rowSubs(page)['Lab Safety Contract']).toMatch(/· Updated$/);
    // Everything but the contract, at the bottom, is looked at.
    page.onScreen(el => el.getAttribute('data-unseen') !== WORK.contract);
    await readFor(page, 700);
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
    expect(routes(third)).toEqual(['page', 'work']);
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
    await readFor(page, 700);
    expect(seenCalls(page)).toHaveLength(1);
  });

  it('nothing is watched or sent while the results have not loaded', async () => {
    const dev = school();
    const page = dev.tab();
    page.net.fail = src => /calc\.js$/.test(src);
    await page.start('#P3R8-WDK4');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    page.showAll();
    expect(page.root().querySelector('.sp-no-results')).toBeTruthy();
    expect(unseenRows(page)).toEqual([]);
    await scrollThroughAll(page);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work']);
    page.net.fail = () => false;
    await page.click('[data-act="grades-retry"]');
    page.showAll();
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
    await page.start('#P3R8-WDK4');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    await readFor(page, 2000);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work']);
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
    page.advance(800);
    page.runTimers(); // any timer left behind
    await readFor(page, 2000);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work', 'done']);
    expect(page.observers).toEqual([]);
  });
});

/* A DIBELS benchmark is a reading record, not work a student gets back
   (Colin, Nov 9, ruling 15). Since S0-M4b the server lists the piece with
   no grade, reads no row for it and marks none seen. The page leaves it
   off the Assignments list, as it has since PR 965. */
describe('a DIBELS benchmark on a student’s page', () => {
  const dibels = more =>
    Object.assign(
      {
        id: id(400),
        title: 'Fall Reading Benchmark',
        date: '2026-10-05',
        due_date: null,
        created_at: '2026-10-01T16:00:00+00:00',
        score_mode: 'dibels',
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
  const copy = part =>
    Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, part);

  it.each([
    ['as the server sends it', {}],
    // What the server no longer sends for one; the page does not lean on that.
    [
      'with a grade, a change and a status the server should not have sent',
      {
        status: 'LATE',
        returned_at: '2026-11-03T20:00:00+00:00',
        updated_at: '2026-11-04T20:00:00+00:00',
        grade: copy({ value: 41, comment: 'Words correct per minute' }),
        previous: copy({ value: 38 }),
      },
    ],
  ])('%s: no row, no result, no Updated, and never told to the server as opened', async (name, more) => {
    const page0 = samplePage(TODAY);
    page0.assessments.push(dibels(more));
    const dev = school({ card: { page: page0 } });
    const page = await signIn(dev);
    expect(page.root().querySelectorAll('.sp-row')).toHaveLength(9);
    expect(text(page)).not.toMatch(/Reading Benchmark|41|Words correct/);
    expect(Object.keys(rowSubs(page))).not.toContain('Fall Reading Benchmark');
    const held = page.T.state().page;
    expect(held.assessments.map(a => a.id)).not.toContain(id(400));
    expect(held.grades[id(400)]).toBeUndefined();
    expect(JSON.stringify(held)).not.toMatch(/Benchmark|Words correct/);
    expect(JSON.stringify(page.run('getScores("class")'))).not.toContain(id(400));
    // Every row on screen, and Updated only where it was before.
    await scrollThroughAll(page);
    const seen = page.calls.filter(c => c.body.route === 'seen');
    expect(seen).toHaveLength(1);
    expect(seen[0].body.assessment_ids).not.toContain(id(400));
    expect(
      Object.entries(rowSubs(page))
        .filter(([, sub]) => /Updated/.test(sub))
        .map(([t]) => t),
    ).toEqual(['Lab Safety Contract']);
  });

  it('a class with nothing but a benchmark reads as a class with no assignments yet', async () => {
    const dev = school({ card: { page: Object.assign(samplePage(TODAY), { assessments: [dibels()] }) } });
    const page = await signIn(dev);
    expect(text(page)).toContain('No assignments yet.');
    await scrollThroughAll(page);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'work']);
  });
});

describe('Is This You? says a wrong answer where a screen reader will read it', () => {
  it('the fields point at the message, and are marked wrong', async () => {
    const dev = school();
    const page = await dev.open('#P3R8-WDK4');
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
