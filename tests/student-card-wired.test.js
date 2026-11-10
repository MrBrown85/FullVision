/**
 * A real student card on the student page (S0-W1): s/app.js asks the
 * student-submit edge function for the card, the check, the page, what was
 * opened, and Done.
 *
 * The page runs as a browser loads it (tests/helpers/
 * student-page-context.js) against the function's real handler and routes
 * with a stand-in database (tests/helpers/fake-student-submit.js), so what
 * the page sends is checked by the handler and what it is given has been
 * through the handler's allow-list. Nothing is deployed and nothing real is
 * called.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import {
  CECE,
  CRITERIA,
  OMAR,
  RUBRIC,
  TAGS,
  WORK,
  fakeStudentSubmit,
  id,
  sampleCard,
  samplePage,
} from './helpers/fake-student-submit.js';
import { CARD_ROUTES, cardReply } from '../supabase/functions/student-submit/card-routes.ts';

const TODAY = new Date().toISOString().slice(0, 10);
const KEY = 'fv-s-session';
const SIGNED_OUT = 'You are signed out. Scan or type your card to open your page again.';

const rows = page =>
  [...page.root().querySelectorAll('.sp-row')].map(li => ({
    title: li.querySelector('.sp-row-title').textContent,
    sub: (li.querySelector('.sp-row-sub') || {}).textContent || '',
    result: (li.querySelector('.sp-row-result') || {}).textContent || '',
    dot: li.querySelector('.sp-dot').getAttribute('class'),
  }));
const row = (page, title) => rows(page).find(r => r.title === title);
const routes = page => page.calls.map(c => c.body.route);
const text = page => page.root().textContent;
const alertText = page => (page.root().querySelector('[role="alert"]') || {}).textContent || '';
/* Every row the page is watching comes on screen, and the page tells the
   server at once. A piece counts as opened only once its row has been on
   screen (tests/student-card-session.test.js has that rule's own tests). */
async function scrollThroughAll(page) {
  page.onScreen(() => true);
  page.advance(700); // on screen long enough to count
  await page.T.tellSeen();
  await page.settle();
}

/* One school device and the function it talks to. open() is the page
   opened (or opened again) on that device. */
function school(opts = {}) {
  const fn = fakeStudentSubmit(Object.assign({ cards: [sampleCard(TODAY, opts.card)] }, opts));
  const store = {};
  const open = async (hash, more) => {
    const page = openStudentPage({ store });
    page.server = (more && more.server) || (body => fn.handle(body));
    await page.start(hash || '');
    return page;
  };
  return { fn, store, open, card: fn.state.cards.P3R8WD };
}

// Scan the card and answer Is This You? with the student number.
async function signIn(dev, hash) {
  const page = await dev.open(hash || '#P3R-8WD');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}

describe('a real card: the code, Is This You?, the Assignments list', () => {
  it('asks card, verify and page, then seen once the rows have been on screen, each as the function takes it', async () => {
    const dev = school();
    const page = await dev.open('#p3r-8wd');
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'card', code: 'P3R8WD' }]);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Science 8 · Block B');
    expect(text(page)).toContain('To make sure it’s you, enter your birthday or your student number.');
    expect(text(page)).not.toContain('Demo Mode');

    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    expect(routes(page)).toEqual(['card', 'verify', 'page']);
    await scrollThroughAll(page);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'seen']);
    // The code goes again with what was typed. No token, and no session: this device had none.
    expect(page.calls[1].body).toEqual({
      route: 'verify',
      code: 'P3R8WD',
      birthday: null,
      student_number: '0123456',
      password: null,
    });
    const token = JSON.parse(dev.store[KEY]).t;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(page.calls[2].body).toEqual({ route: 'page', session: token, enrollment_id: CECE });
    // Every request passed the handler's own checks.
    expect(dev.fn.logs.map(l => l.outcome)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(dev.fn.sql.map(q => q.fn)).toEqual(['card', 'verify_card', 'page', 'seen']);
    expect(dev.fn.sql[1].add).toBe(false);

    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Science 8 · Block B');
    expect(page.root().querySelector('.sp-head-sub').textContent).toBe('Student Page');
    expect(rows(page).map(r => r.title)).toEqual([
      'Science Fair Proposal',
      'Disease Research Poster',
      'Immune System Quick Check',
      'Energy Transfer Investigation',
      'Cell Structure Quiz',
      'Cell Microscope Lab',
      'Ecosystem Connections Essay',
      'KMT & States of Matter Lab',
      'Lab Safety Contract',
    ]);
    expect(row(page, 'Energy Transfer Investigation').result).toBe('4.0');
    expect(row(page, 'Energy Transfer Investigation').sub).toMatch(/^Back \S+ \d+ · Extending$/);
    expect(row(page, 'Cell Microscope Lab').result).toBe('2.7');
    expect(row(page, 'Cell Structure Quiz').result).toBe('8 / 10');
    expect(row(page, 'KMT & States of Matter Lab').sub).toMatch(/^Back \S+ \d+ · Proficient · Late$/);
    expect(row(page, 'Lab Safety Contract').result).toBe('Complete');
    expect(row(page, 'Immune System Quick Check')).toMatchObject({ result: '' });
    expect(row(page, 'Immune System Quick Check').sub).toMatch(/^Missing · Due /);
    expect(row(page, 'Disease Research Poster').result).toBe('');
    expect(text(page)).not.toContain('Demo Mode');
    expect(page.fetched).toEqual(['../shared/constants.js', '../shared/calc.js']);
  });

  it('every request goes to the function in Canada with no key, no cookie, and nothing in the address', async () => {
    const dev = school();
    const page = await signIn(dev);
    await scrollThroughAll(page);
    await page.click('[data-act="card-done"]');
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'seen', 'done']);
    page.calls.forEach(c => {
      expect(c.url).toBe('https://x.supabase.co/functions/v1/student-submit?forceFunctionRegion=ca-central-1');
      expect(c.init.method).toBe('POST');
      expect(c.init.credentials).toBe('omit');
      expect(c.init.referrerPolicy).toBe('no-referrer');
      expect(c.init.cache).toBe('no-store');
      expect(c.init.headers).toEqual({ 'Content-Type': 'application/json' });
    });
  });

  it('the birthday is sent as the function reads it', async () => {
    const dev = school();
    const page = await dev.open('#P3R-8WD');
    page.choose('#sp-bm', 5);
    page.choose('#sp-bd', 15);
    page.choose('#sp-by', 2012);
    await page.click('[data-act="card-yes"]');
    expect(page.calls[1].body).toEqual({
      route: 'verify',
      code: 'P3R8WD',
      birthday: '2012-05-15',
      student_number: null,
      password: null,
    });
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it('a card with nothing on file asks for the card’s password and sends it', async () => {
    const dev = school({ card: { birthday: null, number: null, password: '4821' } });
    const page = await dev.open('#P3R-8WD');
    expect(text(page)).toContain('To make sure it’s you, type the password printed on your card.');
    expect(page.root().querySelector('label[for="sp-ident"]').textContent).toBe('Password');
    page.type('#sp-ident', '4821');
    await page.click('[data-act="card-yes"]');
    expect(page.calls[1].body).toEqual({
      route: 'verify',
      code: 'P3R8WD',
      birthday: null,
      student_number: null,
      password: '4821',
    });
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it('a password printed before a birthday was added still works: the box takes either', async () => {
    const dev = school({ card: { password: '4821' } });
    const page = await dev.open('#P3R-8WD');
    expect(text(page)).toContain('enter your birthday or your student number, or the password on your card.');
    expect(page.root().querySelector('label[for="sp-ident"]').textContent).toBe('Student Number or Password');
    page.type('#sp-ident', '4821');
    await page.click('[data-act="card-yes"]');
    expect(page.calls[1].body).toMatchObject({ student_number: '4821', password: '4821', birthday: null });
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it('a code typed on the slip screen opens the card too', async () => {
    const dev = school();
    const page = await dev.open('');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Answer Your Teacher’s Questions');
    page.type('#sp-code', 'p3r 8wd');
    await page.submit('form[data-form="code"]');
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'card', code: 'P3R8WD' }]);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });

  it('No, That’s Not Me gives the card back and opens nothing', async () => {
    const dev = school();
    const page = await dev.open('#P3R-8WD');
    await page.click('[data-act="card-notme"]');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    expect(text(page)).not.toContain('Cece');
    await page.click('[data-act="card-restart"]');
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(page.root().querySelector('#sp-code').getAttribute('value')).toBe('');
    expect(routes(page)).toEqual(['card']);
    expect(dev.store).toEqual({});
  });
});

describe('a slip still opens: the card is asked first, then open', () => {
  const SLIP = {
    ok: true,
    token: 'a'.repeat(64),
    student: { first_name: 'Cece' },
    course: { name: 'Science 8', block: 'B' },
    preview: [{ title: 'November Reflection', count: 1 }],
    check: 'identity',
  };

  it('a slip’s code is put to card, which says it is no card, and then to open', async () => {
    const dev = school({ slips: { K7M4QX: SLIP } });
    const page = await dev.open('#K7M-4QX');
    expect(page.calls.map(c => c.body)).toEqual([
      { route: 'card', code: 'K7M4QX' },
      { route: 'open', code: 'K7M4QX' },
    ]);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Hi Cece!');
    expect(page.root().querySelector('.sp-head-sub').textContent).toBe('Student Questions');
    // A slip's code stays in the address, as it always has; nothing is kept for it.
    expect(page.addresses).toEqual([]);
    expect(dev.store).toEqual({});
  });

  /* The page can be released before the function is deployed with the
     card's routes. The function deployed today answers a route it does not
     know with HTTP 400 and { ok: false, error: 'bad_request' }. */
  it.each([
    ['the function deployed today, which has no card route', () => ({ ok: false, error: 'bad_request' })],
    ['the function with the card’s routes, which says it is no card', () => ({ ok: false, error: 'not_found' })],
  ])('a slip opens against %s', async (name, cardSays) => {
    const dev = school({ slips: { K7M4QX: SLIP } });
    const page = await dev.open('#K7M-4QX', {
      server: body => (body.route === 'card' ? cardSays() : dev.fn.handle(body)),
    });
    expect(routes(page)).toEqual(['card', 'open']);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Hi Cece!');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="start"]');
    expect(page.calls[2].body).toEqual({
      route: 'verify',
      token: 'a'.repeat(64),
      birthday: null,
      student_number: '0123456',
      password: null,
    });
    // The handler sent it to the slip's verify, not the card's.
    expect(dev.fn.sql.map(q => q.fn)).toContain('verify');
    expect(dev.fn.sql.map(q => q.fn)).not.toContain('verify_card');
  });

  it('a code nobody holds, typed on the slip screen, gets the slip’s words', async () => {
    const dev = school();
    const page = await dev.open('');
    page.type('#sp-code', 'ABC-234');
    await page.submit('form[data-form="code"]');
    expect(routes(page)).toEqual(['card', 'open']);
    expect(alertText(page)).toBe(
      "That code didn't work. Check the letters and numbers on your slip. If you have a newer slip, use that one. If not, ask your teacher for a new slip.",
    );
  });

  /* The page does not know yet whether the code is a card's or a slip's, so
     it speaks as neither and does not go on to the slip route (review of PR
     998; tests/student-card-session.test.js has the rest). */
  it('with no internet a scanned code says so once, in words that fit a card and a slip alike', async () => {
    const dev = school();
    const page = await dev.open('#P3R-8WD', {
      server: () => {
        throw new Error('offline');
      },
    });
    expect(routes(page)).toEqual(['card', 'open']);
    expect(alertText(page)).toBe("Couldn't reach FullVision. Check your internet and try again.");
    expect(text(page)).not.toMatch(/slip|answers|Student Questions/i);
    expect(page.root().querySelector('[data-act="code-retry"]').textContent).toBe('Try Again');
  });
});

describe('a card that won’t open says why', () => {
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

  it.each(WHY)('card answers %s: its own line, and no check is asked', async (error, card, line) => {
    const dev = school({ card });
    const page = await dev.open('#P3R-8WD');
    expect(dev.fn.logs.map(l => l.outcome)).toEqual([error]);
    expect(routes(page)).toEqual(['card']);
    expect(alertText(page)).toBe(line);
    expect(page.root().querySelector('#sp-ident')).toBeNull();
    expect(page.root().querySelector('[data-act="page-retry"]')).toBeNull();
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Student Page');
    // The code is out of the address here too.
    expect(page.addresses).toEqual(['/s/']);
    await page.click('[data-act="card-restart"]');
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
  });

  it.each(WHY)(
    'verify answers %s (it changed while Is This You? was open): the same line',
    async (error, card, line) => {
      const dev = school();
      const page = await dev.open('#P3R-8WD');
      Object.assign(dev.card, card);
      page.type('#sp-ident', '0123456');
      await page.click('[data-act="card-yes"]');
      expect(dev.fn.logs.map(l => l.outcome)).toEqual(['ok', error]);
      expect(alertText(page)).toBe(line);
      expect(page.root().querySelector('#sp-ident')).toBeNull();
      expect(dev.store).toEqual({});
    },
  );

  it('a reissued card’s old code is a code that doesn’t work', async () => {
    const dev = school({ card: { stopped: true } });
    const page = await dev.open('');
    page.type('#sp-code', 'P3R-8WD');
    await page.submit('form[data-form="code"]');
    expect(routes(page)).toEqual(['card', 'open']);
    expect(alertText(page)).toContain("That code didn't work.");
  });

  it('too many wrong codes from this address: card says locked, the slip is still tried, then Too many tries', async () => {
    const dev = school({ slips: { K7M4QX: { ok: true, token: 'a'.repeat(64), student: {}, course: {}, parts: [] } } });
    dev.fn.state.addressLocked = true;
    const page = await dev.open('#P3R-8WD');
    expect(routes(page)).toEqual(['card', 'open']);
    expect(alertText(page)).toBe('Too many tries. Wait 15 minutes and try again.');
    // A real slip is not shut out by the card route's lock.
    const slip = await dev.open('#K7M-4QX');
    expect(routes(slip)).toEqual(['card', 'open']);
    expect(slip.root().querySelector('[data-act="start"]')).toBeTruthy();
  });

  it('verify answers locked (the address limit was reached meanwhile): Too many tries, and the check ends', async () => {
    const dev = school();
    const page = await dev.open('#P3R-8WD');
    dev.fn.state.addressLocked = true;
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    expect(alertText(page)).toBe('Too many tries. Wait 15 minutes and try again.');
    expect(page.root().querySelector('#sp-ident')).toBeNull();
  });

  it('wrong answers count down in the card’s words, and the fifth locks the card', async () => {
    const dev = school();
    const page = await dev.open('#P3R-8WD');
    const said = [];
    for (let i = 0; i < 4; i++) {
      page.type('#sp-ident', '999');
      await page.click('[data-act="card-yes"]');
      said.push(alertText(page));
    }
    const wrong = "That doesn't match. Check your birthday or student number.";
    expect(said).toEqual([
      wrong + ' 4 tries left.',
      wrong + ' 3 tries left.',
      wrong + ' 2 tries left.',
      wrong + ' 1 try left. One more wrong try locks this card, and your teacher will need to unlock it.',
    ]);
    page.type('#sp-ident', '999');
    await page.click('[data-act="card-yes"]');
    expect(alertText(page)).toBe('This card is locked after too many wrong tries. Ask your teacher to unlock it.');
    expect(page.root().querySelector('#sp-ident')).toBeNull();
    expect(dev.store).toEqual({});
    // Nothing is remembered on the device about the lock: the server says it each time.
    const again = await dev.open('#P3R-8WD');
    expect(alertText(again)).toBe('This card is locked after too many wrong tries. Ask your teacher to unlock it.');
  });

  it('a wrong card password says so in the card’s words', async () => {
    const dev = school({ card: { birthday: null, number: null, password: '4821' } });
    const page = await dev.open('#P3R-8WD');
    page.type('#sp-ident', '0000');
    await page.click('[data-act="card-yes"]');
    expect(alertText(page)).toBe("That password doesn't match. Check the password on your card. 4 tries left.");
  });

  it('the check can’t be reached: it says so, stays on Is This You?, and a second try works', async () => {
    const dev = school();
    let offline = true;
    const page = await dev.open('#P3R-8WD', {
      server: body => {
        if (offline && body.route === 'verify') throw new Error('offline');
        return dev.fn.handle(body);
      },
    });
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    expect(alertText(page)).toBe("Couldn't reach FullVision. Check your internet and try again.");
    expect(alertText(page)).not.toContain('answers');
    expect(page.root().querySelector('#sp-ident').getAttribute('value')).toBe('0123456');
    expect(page.root().querySelector('[data-act="card-yes"]').hasAttribute('disabled')).toBe(false);
    offline = false;
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it('a code typed on the card’s screen that opens nothing gets the card’s words, and stays there', async () => {
    const dev = school();
    const page = await signIn(dev);
    await page.click('[data-act="card-done"]');
    page.calls.length = 0;
    page.type('#sp-code', 'ABC-234');
    await page.submit('form[data-form="card"]');
    expect(routes(page)).toEqual(['card', 'open']);
    expect(alertText(page)).toBe("That code didn't work. Check the letters and numbers on your card.");
    expect(page.root().querySelector('#sp-code').getAttribute('value')).toBe('ABC-234');
    // Not six letters and numbers: said at once, and nothing is asked.
    page.calls.length = 0;
    page.type('#sp-code', 'HELLO');
    await page.submit('form[data-form="card"]');
    expect(page.calls).toEqual([]);
    expect(alertText(page)).toBe("That code didn't work. Check the letters and numbers on your card.");
    // With no internet.
    page.server = () => {
      throw new Error('offline');
    };
    page.type('#sp-code', 'P3R-8WD');
    await page.submit('form[data-form="card"]');
    expect(alertText(page)).toBe("Couldn't reach FullVision. Check your internet and try again.");
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
  });

  it('a slip typed on the card’s screen opens as a slip', async () => {
    const dev = school({
      slips: {
        K7M4QX: {
          ok: true,
          token: 'a'.repeat(64),
          student: { first_name: 'Cece' },
          course: { name: 'Science 8' },
          parts: [],
        },
      },
    });
    const page = await signIn(dev);
    await page.click('[data-act="card-done"]');
    page.type('#sp-code', 'K7M-4QX');
    await page.submit('form[data-form="card"]');
    expect(page.root().querySelector('[data-act="start"]')).toBeTruthy();
    expect(page.root().querySelector('.sp-head-sub').textContent).toBe('Student Questions');
  });
});

describe('the page won’t open: each refusal has its line', () => {
  const REFUSED = [
    ['card_stopped', { stopped: true }, 'This card has been replaced. Ask your teacher for your new card.'],
    ['card_expired', { expired: true }, "This card's last day has passed. Ask your teacher for a new card."],
    ['closed', { closed: true }, 'The student page is turned off for this class. Ask your teacher.'],
    ['not_found', { withdrawn: true }, "Your page for this class can't be opened any more. Ask your teacher."],
  ];

  it.each(REFUSED)('page answers %s when the device opens the page again', async (error, card, line) => {
    const dev = school();
    await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    Object.assign(dev.card, card);
    const page = await dev.open('');
    expect(dev.fn.logs.slice(-2).map(l => l.outcome)).toEqual([error, 'ok']);
    expect(routes(page)).toEqual(['page', 'done']);
    expect(page.calls[1].body).toEqual({ route: 'done', session: token });
    expect(alertText(page)).toBe(line);
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('[data-act="page-retry"]')).toBeNull();
    // The session can open nothing now: it is gone from the device and the server.
    expect(dev.store).toEqual({});
    expect(dev.fn.state.sessions).toEqual({});
    expect(page.T.state().page).toBeNull();
    expect(page.run('StudentData.page()')).toBeNull();
  });

  it('page answers signed_out (Done on another device, or past midnight there): the card’s first screen says so', async () => {
    const dev = school();
    await signIn(dev);
    dev.fn.state.sessions = {};
    const page = await dev.open('');
    expect(routes(page)).toEqual(['page']);
    const note = page.root().querySelector('.sp-msg');
    expect(note.textContent).toBe(SIGNED_OUT);
    expect(note.getAttribute('role')).toBe('status');
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(dev.store).toEqual({});
  });

  it('the page can’t be reached: it says so with Try Again, keeps the session, and opens when the internet is back', async () => {
    const dev = school();
    await signIn(dev);
    const kept = dev.store[KEY];
    let offline = true;
    const page = await dev.open('', {
      server: body => {
        if (offline) throw new Error('offline');
        return dev.fn.handle(body);
      },
    });
    expect(alertText(page)).toBe("Couldn't reach FullVision. Check your internet and try again.");
    expect(page.root().querySelector('[data-act="page-retry"]').textContent).toBe('Try Again');
    expect(dev.store[KEY]).toBe(kept);
    offline = false;
    await page.click('[data-act="page-retry"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(row(page, 'Cell Structure Quiz').result).toBe('8 / 10');
  });

  it('a database failure on page reads as a call that never arrived', async () => {
    const dev = school();
    await signIn(dev);
    dev.fn.state.down = true;
    const page = await dev.open('');
    expect(alertText(page)).toBe("Couldn't reach FullVision. Check your internet and try again.");
    expect(page.root().querySelector('[data-act="page-retry"]')).toBeTruthy();
    expect(dev.store[KEY]).toBeTruthy();
  });

  it('seen answers signed_out: the list is taken down', async () => {
    const dev = school();
    const page = await dev.open('#P3R-8WD', {
      server: body => (body.route === 'seen' ? { ok: false, error: 'signed_out' } : dev.fn.handle(body)),
    });
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    await scrollThroughAll(page);
    expect(routes(page)).toEqual(['card', 'verify', 'page', 'seen']);
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(dev.store).toEqual({});
  });
});

describe('the session: one token, kept until midnight, Done or fifteen idle minutes', () => {
  it('keeps the token, when it ends, which class it opens and when it was last touched, and nothing else anywhere', async () => {
    const dev = school();
    const page = await signIn(dev);
    expect(Object.keys(dev.store)).toEqual([KEY]);
    const kept = JSON.parse(dev.store[KEY]);
    expect(Object.keys(kept).sort()).toEqual(['a', 'e', 't', 'x']);
    expect(typeof kept.a).toBe('number');
    expect(kept.t).toBe(Object.keys(dev.fn.state.sessions)[0]);
    expect(kept.e).toBe(CECE);
    expect(kept.x).toBe(dev.fn.state.sessions[kept.t].expires);
    // No name, class, code, birthday, student number or grade, in either store.
    const stored = JSON.stringify(dev.store) + JSON.stringify(page.tab);
    for (const secret of ['Cece', 'Science', 'P3R', '0123456', '2012', 'Extending', 'Quiz', '8 / 10']) {
      expect(stored, secret).not.toContain(secret);
    }
    expect(page.tab).toEqual({});
    // Nor in the address: the code left it when the card was recognised.
    expect(page.addresses).toEqual(['/s/']);
    // What was typed to get in is not held once the page is open.
    expect(page.T.state().number).toBe('');
    expect(page.T.state().bday).toEqual({ m: '', d: '', y: '' });
  });

  it('opening the page again on the same device opens the student’s page without the card', async () => {
    const dev = school();
    await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    const page = await dev.open('');
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'page', session: token, enrollment_id: CECE }]);
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(row(page, 'Energy Transfer Investigation').result).toBe('4.0');
    expect(dev.store[KEY]).toBeTruthy();
  });

  it('while it opens, the loading screen is the card’s own', async () => {
    const dev = school();
    await signIn(dev);
    const page = openStudentPage({ store: dev.store });
    page.server = body => dev.fn.handle(body);
    page.T.start(page.root(), '');
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Student Page');
    expect(page.root().querySelector('.sp-row')).toBeNull();
    await page.settle();
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it('Done ends it: the server is told, the token is gone, and nothing of the student is left on the page', async () => {
    const dev = school();
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    expect(page.root().querySelector('[data-act="card-done"]').textContent).toBe('Done');
    await page.click('[data-act="card-done"]');
    expect(page.calls[page.calls.length - 1].body).toEqual({ route: 'done', session: token });
    expect(dev.fn.state.sessions).toEqual({});
    expect(dev.store).toEqual({});
    expect(page.tab).toEqual({});
    // Back at the card's first screen, with no line: the student asked for it.
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(page.root().querySelector('.sp-msg')).toBeNull();
    const html = page.root().innerHTML;
    for (const left of ['Cece', 'Science 8', 'Assignments', 'P3R', 'Extending', 'Quiz', '0123456']) {
      expect(html, left).not.toContain(left);
    }
    const s = page.T.state();
    expect([s.page, s.data, s.code, s.typed, s.number]).toEqual([null, null, '', '', '']);
    expect(page.run('StudentData.page()')).toBeNull();
    expect(page.run('Object.keys(COURSES).length')).toBe(0);
    expect(page.run('JSON.stringify(getScores("class"))')).toBe('{}');
    // The old token opens nothing now, and the device opens the slip screen as a new one would.
    expect(await dev.fn.handle({ route: 'page', session: token, enrollment_id: CECE })).toEqual({
      ok: false,
      error: 'signed_out',
    });
    const next = await dev.open('');
    expect(next.calls).toEqual([]);
    expect(next.root().querySelector('.sp-big').textContent).toBe('Answer Your Teacher’s Questions');
  });

  it('Done works with no internet: the device is signed out at once', async () => {
    const dev = school();
    const page = await signIn(dev);
    page.server = () => {
      throw new Error('offline');
    };
    await page.click('[data-act="card-done"]');
    expect(dev.store).toEqual({});
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
  });

  it('at its midnight an open page is taken down and the token is gone', async () => {
    // Ten minutes long, so its end comes before the fifteen idle minutes do.
    const dev = school({ lasts: 10 * 60 * 1000 });
    const page = await signIn(dev);
    const ends = Date.parse(JSON.parse(dev.store[KEY]).x);
    page.T.checkSession(ends - 1000);
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(dev.store[KEY]).toBeTruthy();
    page.T.checkSession(ends);
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(page.root().querySelector('.sp-msg').getAttribute('role')).toBe('status');
    expect(dev.store).toEqual({});
    expect(page.T.state().page).toBeNull();
    expect(page.run('StudentData.page()')).toBeNull();
    expect(page.root().innerHTML).not.toContain('Cece');
  });

  it('a device opened after midnight asks nothing and says the student is signed out', async () => {
    const dev = school({ lasts: 50 });
    await signIn(dev);
    expect(dev.store[KEY]).toBeTruthy();
    await new Promise(r => setTimeout(r, 80));
    const page = await dev.open('');
    expect(page.calls).toEqual([]);
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(dev.store).toEqual({});
  });

  it('Done in another tab takes this tab’s page down too', async () => {
    const dev = school();
    const first = await signIn(dev);
    const second = await dev.open('');
    expect(second.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    await second.click('[data-act="card-done"]');
    first.T.checkSession();
    expect(first.root().querySelector('.sp-row')).toBeNull();
    expect(first.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
  });

  it('in a private window nothing can be kept: the page still opens, for this tab, and Done still ends it', async () => {
    const dev = school();
    const page = openStudentPage({ noStorage: true });
    page.server = body => dev.fn.handle(body);
    await page.start('#P3R-8WD');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    expect(row(page, 'Cell Structure Quiz').result).toBe('8 / 10');
    // The session's check does not mistake "nothing kept" for "signed out elsewhere".
    page.T.checkSession();
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
    // Its midnight still takes the page down.
    const token = Object.keys(dev.fn.state.sessions)[0];
    page.T.checkSession(Date.parse(dev.fn.state.sessions[token].expires) + 1);
    expect(page.root().querySelector('.sp-row')).toBeNull();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);

    const again = openStudentPage({ noStorage: true });
    again.server = body => dev.fn.handle(body);
    await again.start('#P3R-8WD');
    again.type('#sp-ident', '0123456');
    await again.click('[data-act="card-yes"]');
    await again.click('[data-act="card-done"]');
    expect(again.calls[again.calls.length - 1].body.route).toBe('done');
    expect(again.root().querySelector('form[data-form="card"]')).toBeTruthy();
  });

  it('the server’s times are read whatever their precision', async () => {
    // To the microsecond with an offset, as Postgres writes them inside JSON.
    const dev = school();
    dev.card.page.assessments.forEach(a => {
      if (a.returned_at) a.returned_at = a.returned_at.replace('+00:00', '.482913+00:00');
      if (a.updated_at) a.updated_at = a.updated_at.replace('+00:00', '.482913+00:00');
      if (a.seen_at) a.seen_at = a.seen_at.replace('+00:00', '.482912+00:00');
    });
    const page = await signIn(dev);
    expect(row(page, 'Lab Safety Contract').sub).toMatch(/^Back \S+ \d+ · Updated$/);
    expect(row(page, 'Energy Transfer Investigation').sub).toMatch(/^Back \S+ \d+ · Extending$/);
    // A session's end written that way is kept and read.
    const kept = JSON.parse(dev.store[KEY]);
    dev.store[KEY] = JSON.stringify(Object.assign(kept, { x: '2099-06-30T07:00:00.123456+00:00' }));
    const next = await dev.open('');
    expect(next.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it('what is kept is only ever a token: anything else found there is not used', async () => {
    for (const junk of [
      'not json',
      '{}',
      JSON.stringify({ t: 'short', x: '2099-01-01T00:00:00Z', e: CECE }),
      JSON.stringify({ t: 'a'.repeat(64), x: 'no time', e: CECE }),
      JSON.stringify({ t: 'a'.repeat(64), x: '2099-01-01T00:00:00Z' }),
    ]) {
      const dev = school();
      dev.store[KEY] = junk;
      const page = await dev.open('');
      expect(page.calls, junk).toEqual([]);
      expect(page.root().querySelector('.sp-big').textContent, junk).toBe('Answer Your Teacher’s Questions');
    }
  });
});

describe('a shared device: a card from the start screen starts fresh', () => {
  const omar = () =>
    sampleCard(TODAY, {
      code: 'K7M4QX',
      enrollment: OMAR,
      first: 'Omar',
      number: '7654321',
      birthday: null,
      page: Object.assign(samplePage(TODAY), {
        student: { enrollment_id: OMAR, first_name: 'Omar' },
        assessments: [],
      }),
    });

  it('the last student is signed out as soon as the next card is recognised, before Is This You?', async () => {
    const dev = school();
    dev.fn.state.cards.K7M4QX = omar();
    await signIn(dev);
    const cece = JSON.parse(dev.store[KEY]).t;

    const page = await dev.open('#K7M-4QX');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Omar?');
    expect(page.calls.map(c => c.body)).toEqual([
      { route: 'card', code: 'K7M4QX' },
      { route: 'done', session: cece },
    ]);
    expect(dev.store).toEqual({});
    expect(dev.fn.state.sessions).toEqual({});
    // Omar walks away without answering: the device opens nobody's page.
    const later = await dev.open('');
    expect(later.calls).toEqual([]);
    expect(later.root().querySelector('.sp-big').textContent).toBe('Answer Your Teacher’s Questions');
  });

  it('the check carries the last token too, so the server ends it even if that Done never arrived', async () => {
    const dev = school();
    dev.fn.state.cards.K7M4QX = omar();
    await signIn(dev);
    const cece = JSON.parse(dev.store[KEY]).t;

    const page = await dev.open('#K7M-4QX', {
      server: body => {
        if (body.route === 'done') throw new Error('offline');
        return dev.fn.handle(body);
      },
    });
    expect(Object.keys(dev.fn.state.sessions)).toEqual([cece]);
    page.type('#sp-ident', '7654321');
    await page.click('[data-act="card-yes"]');
    const verify = page.calls.find(c => c.body.route === 'verify').body;
    expect(verify).toMatchObject({ code: 'K7M4QX', student_number: '7654321', session: cece });
    // A new session, never a joined one: verify is the start screen's route.
    expect(dev.fn.sql.find(q => q.fn === 'verify_card' && q.params[0] === 'K7M4QX').add).toBe(false);
    const omarToken = JSON.parse(dev.store[KEY]).t;
    expect(omarToken).not.toBe(cece);
    expect(Object.keys(dev.fn.state.sessions)).toEqual([omarToken]);
    expect(JSON.parse(dev.store[KEY]).e).toBe(OMAR);
    expect(text(page)).toContain('No assignments yet.');
    expect(text(page)).not.toContain('Cece');
    // Cece's token opens nothing.
    expect(await dev.fn.handle({ route: 'page', session: cece, enrollment_id: CECE })).toEqual({
      ok: false,
      error: 'signed_out',
    });
  });

  it('a tab still showing the last student is taken down when another student signs in on the device', async () => {
    const dev = school();
    dev.fn.state.cards.K7M4QX = omar();
    const first = await signIn(dev);
    const second = await dev.open('#K7M-4QX');
    second.type('#sp-ident', '7654321');
    await second.click('[data-act="card-yes"]');
    const omarKept = dev.store[KEY];
    first.T.checkSession();
    expect(first.root().querySelector('.sp-row')).toBeNull();
    expect(first.root().innerHTML).not.toContain('Cece');
    // Omar's session is left as it is.
    expect(dev.store[KEY]).toBe(omarKept);
  });

  it('the page never asks to join a session: add-card is not sent', async () => {
    const dev = school();
    dev.fn.state.cards.K7M4QX = omar();
    await signIn(dev);
    const page = await dev.open('#K7M-4QX');
    page.type('#sp-ident', '7654321');
    await page.click('[data-act="card-yes"]');
    expect(dev.fn.sql.some(q => q.add === true)).toBe(false);
    expect(routes(page)).not.toContain('add-card');
  });
});

describe('what the list shows from a page reply', () => {
  const at = '2026-11-03T20:00:00+00:00';
  const copy = part =>
    Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, part);
  const piece = (n, title, more) =>
    Object.assign(
      {
        id: id(100 + n),
        title,
        date: '2026-10-' + String(n).padStart(2, '0'),
        due_date: null,
        score_mode: 'proficiency',
        max_points: null,
        weight: 1,
        rubric_id: null,
        tag_ids: [TAGS.data],
        status: null,
        returned_at: null,
        updated_at: null,
        seen_at: null,
        grade: null,
        previous: null,
      },
      more,
    );
  const three = copy({ tags: { [TAGS.data]: { value: 3, modifier: 0, comment: null } } });
  const two = copy({ tags: { [TAGS.data]: { value: 2, modifier: 0, comment: null } } });

  async function listOf(assessments, system) {
    const base = samplePage(TODAY, system);
    const dev = school({ card: { page: Object.assign(base, { assessments }) } });
    const page = await signIn(dev);
    return { dev, page };
  }

  it('a returned grade shows; a piece with grade null shows no result, returned or not', async () => {
    const { page } = await listOf([
      piece(1, 'Returned', { returned_at: at, grade: three }),
      piece(2, 'Never Graded'),
      // A draft waits on this one. The server sends it exactly as the piece above.
      piece(3, 'Change Waiting'),
      // Returned, and nothing of the grade is left in use (or it was cleared).
      piece(4, 'Back With Nothing', { returned_at: at, grade: null }),
    ]);
    expect(row(page, 'Returned')).toMatchObject({ result: '3.0', dot: 'sp-dot sp-dot-back' });
    expect(row(page, 'Returned').sub).toMatch(/^Back \S+ \d+ · Proficient$/);
    expect(row(page, 'Never Graded')).toMatchObject({ result: '', dot: 'sp-dot sp-dot-due' });
    expect(row(page, 'Change Waiting')).toEqual({
      ...row(page, 'Never Graded'),
      title: 'Change Waiting',
      sub: 'Oct 3',
    });
    expect(row(page, 'Back With Nothing').result).toBe('');
    expect(row(page, 'Back With Nothing').sub).toMatch(/^Back \S+ \d+$/);
    expect(page.root().querySelectorAll('.sp-row-result')).toHaveLength(1);
    expect(page.root().innerHTML).not.toMatch(/draft/i);
    expect(Object.keys(page.T.state().page.grades)).toEqual([id(101)]);
  });

  it('Missing and Excused show at once with no result, whatever was returned before', async () => {
    const { page } = await listOf([
      piece(1, 'Missing Now', { status: 'NS', returned_at: at, grade: null, due_date: '2026-10-05' }),
      piece(2, 'Excused Now', { status: 'EXC', returned_at: at, grade: null }),
      piece(3, 'Missing Unreturned', { status: 'NS' }),
      piece(4, 'Late And Back', { status: 'LATE', returned_at: at, grade: three }),
    ]);
    expect(row(page, 'Missing Now')).toMatchObject({ result: '', dot: 'sp-dot sp-dot-missing' });
    expect(row(page, 'Missing Now').sub).toMatch(/^Missing · Due /);
    expect(row(page, 'Excused Now')).toMatchObject({ result: '', sub: 'Excused · Oct 2' });
    expect(row(page, 'Missing Unreturned')).toMatchObject({ result: '', sub: 'Missing · Oct 3' });
    expect(row(page, 'Late And Back').result).toBe('3.0');
    expect(row(page, 'Late And Back').sub).toMatch(/· Proficient · Late$/);
    // A Missing or Excused piece is not counted as opened: no result was shown.
    await scrollThroughAll(page);
    const seen = page.calls.find(c => c.body.route === 'seen').body;
    expect(seen.assessment_ids).toEqual([id(104)]);
  });

  it('a grade the database sent under Missing by mistake is stopped twice: by the function and by the page', async () => {
    const dirty = [piece(1, 'Missing Now', { status: 'NS', returned_at: at, grade: three, previous: two })];
    // The function's allow-list passes what the SQL sent (the SQL holds this rule), so the page checks too.
    const { page } = await listOf(dirty);
    expect(row(page, 'Missing Now')).toMatchObject({ result: '', dot: 'sp-dot sp-dot-missing' });
    expect(page.T.state().page.grades).toEqual({});
    expect(page.run('JSON.stringify(getScores("class"))')).toBe(JSON.stringify({ [CECE]: [] }));
  });

  it('a draft the database sent by mistake reaches neither the page’s data nor its HTML', async () => {
    const { dev, page } = await listOf([
      piece(1, 'Never Returned'),
      piece(2, 'Returned', { returned_at: at, grade: two }),
    ]);
    const DRAFT = copy({
      comment: 'DRAFT-ONLY',
      tags: { [TAGS.data]: { value: 4, modifier: 0, comment: 'DRAFT-ONLY' } },
    });
    dev.fn.state.dirty = reply => {
      Object.assign(reply, { is_draft: true, drafts: 1 });
      reply.assessments[0].grade = DRAFT; // no return date: never to be shown
      reply.assessments.forEach(a =>
        Object.assign(a, {
          is_draft: true,
          draft: DRAFT,
          returned_copy: DRAFT,
          working_copy: DRAFT,
          report_note: 'DRAFT-ONLY',
        }),
      );
    };
    const again = await dev.open('');
    expect(row(again, 'Never Returned').result).toBe('');
    expect(row(again, 'Returned').result).toBe('2.0');
    for (const where of [again.root().innerHTML, JSON.stringify(again.T.state().page)]) {
      expect(where).not.toContain('DRAFT-ONLY');
      expect(where).not.toMatch(/draft|working_copy|returned_copy|report_note/i);
      expect(where).not.toContain('4.0');
    }
    expect(page.root().innerHTML).not.toMatch(/draft/i);
  });

  it('Updated follows previous and seen_at', async () => {
    const later = '2026-11-05T20:00:00+00:00';
    const { page } = await listOf([
      // Changed and returned again since the student last opened it.
      piece(1, 'Changed Since', { returned_at: later, updated_at: later, seen_at: at, grade: three, previous: two }),
      // Changed and returned again, and never opened at all.
      piece(2, 'Changed Unseen', { returned_at: later, updated_at: later, grade: three, previous: two }),
      // Opened since the change.
      piece(3, 'Seen Since', { returned_at: at, updated_at: at, seen_at: later, grade: three, previous: two }),
      // Returned once, never changed.
      piece(4, 'Plain', { returned_at: later, grade: three }),
      // Returned again with the grade the student already had: nothing to tell them.
      piece(5, 'Same Again', {
        returned_at: later,
        updated_at: later,
        seen_at: at,
        grade: three,
        previous: copy({ checks: [], criteria: {}, tags: { [TAGS.data]: { comment: null, modifier: 0, value: 3.0 } } }),
      }),
      // Changed, but Missing now: Missing wins and nothing is marked.
      piece(6, 'Changed Then Missing', {
        status: 'NS',
        returned_at: later,
        updated_at: later,
        grade: null,
        previous: null,
      }),
      // Changed where the earlier grade has nothing left in use.
      piece(7, 'Changed From Nothing', {
        returned_at: later,
        updated_at: later,
        seen_at: at,
        grade: three,
        previous: null,
      }),
    ]);
    const updated = title => / · Updated$/.test(row(page, title).sub);
    expect(row(page, 'Changed Since').sub).toMatch(/^Back \S+ \d+ · Proficient · Updated$/);
    expect(updated('Changed Since')).toBe(true);
    expect(updated('Changed Unseen')).toBe(true);
    expect(updated('Seen Since')).toBe(false);
    expect(updated('Plain')).toBe(false);
    expect(updated('Same Again')).toBe(false);
    expect(updated('Changed Then Missing')).toBe(false);
    expect(updated('Changed From Nothing')).toBe(true);
    // The earlier grade is compared, never kept or shown.
    expect(JSON.stringify(page.T.state().page)).not.toContain('"previous"');
    expect(row(page, 'Changed Since').result).toBe('3.0');
    expect(text(page)).not.toContain('Developing');
  });

  it.each([
    ['proficiency', '3.3', '2.5', '3.0'],
    ['letter', '83%', '63%', '75%'],
    ['both', '3.3 · 83%', '2.5 · 63%', '3.0 · 75%'],
  ])('a %s class: every result is calc.js’s own text', async (system, plus, rubric, whole) => {
    const { page } = await listOf(
      [
        piece(1, 'Competency', {
          returned_at: at,
          grade: copy({ tags: { [TAGS.data]: { value: 3, modifier: 1, comment: null } } }),
        }),
        piece(2, 'Rubric', {
          rubric_id: RUBRIC,
          returned_at: at,
          grade: copy({
            criteria: {
              [CRITERIA.method]: { value: 3, modifier: 0, comment: null, beyond: null },
              [CRITERIA.drawing]: { value: 2, modifier: 0, comment: null, beyond: null },
            },
          }),
        }),
        // An Overall level with its + on work linked to no competency.
        piece(3, 'Overall', { tag_ids: [], returned_at: at, grade: copy({ value: 3, modifier: 1 }) }),
        piece(4, 'Points', { score_mode: 'points', max_points: 20, returned_at: at, grade: copy({ value: 17.5 }) }),
        piece(5, 'Zero', { score_mode: 'points', max_points: 5, returned_at: at, grade: copy({ value: 0 }) }),
        piece(6, 'Incomplete', { score_mode: 'complete', returned_at: at, grade: copy({ value: 0 }) }),
        piece(7, 'Whole', { returned_at: at, grade: three }),
        piece(8, 'Reading Benchmark', { score_mode: 'dibels' }),
      ],
      system,
    );
    const format = v => page.run('formatLevel("class", ' + v + ')');
    expect(format(10 / 3)).toBe(plus);
    expect(row(page, 'Competency').result).toBe(plus);
    expect(row(page, 'Rubric').result).toBe(rubric);
    expect(row(page, 'Overall').result).toBe(plus);
    expect(row(page, 'Whole').result).toBe(whole);
    expect(row(page, 'Points').result).toBe('17.5 / 20');
    expect(row(page, 'Zero').result).toBe('0 / 5');
    expect(row(page, 'Incomplete').result).toBe('Incomplete');
    // A DIBELS benchmark is a reading record, not work a student gets back.
    expect(row(page, 'Reading Benchmark')).toBeUndefined();
  });

  it('the class’s own Counts As percents reach calc.js', async () => {
    const base = samplePage(TODAY, 'both');
    base.course.grading_scale = { percents: { 4: 95, 3: 80, 2: 60, 1: 40 } };
    base.assessments = [piece(1, 'Whole', { returned_at: at, grade: three })];
    const dev = school({ card: { page: base } });
    const page = await signIn(dev);
    expect(row(page, 'Whole').result).toBe('3.0 · 80%');
  });
});

describe('two pieces with the same date: the one made later counts later', () => {
  const piece = (n, title, more) =>
    Object.assign(
      {
        id: id(200 + n),
        title,
        date: '2026-10-20',
        due_date: '2026-10-27',
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
  const titles = async assessments => {
    const dev = school({ card: { page: Object.assign(samplePage(TODAY), { assessments }) } });
    return rows(await signIn(dev)).map(r => r.title);
  };

  it('with created_at, the list is newest first within a date too', async () => {
    expect(
      await titles([
        piece(1, 'Made First', { created_at: '2026-10-19T16:00:00.000001+00:00' }),
        piece(2, 'Made Last', { created_at: '2026-10-19T18:30:00+00:00' }),
        piece(3, 'Made Second', { created_at: '2026-10-19T17:00:00+00:00' }),
        piece(4, 'Due Later', { due_date: '2026-10-28', created_at: '2026-10-01T09:00:00+00:00' }),
        piece(5, 'Due Earlier', { due_date: '2026-10-26', created_at: '2026-10-25T09:00:00+00:00' }),
      ]),
    ).toEqual(['Due Later', 'Made Last', 'Made Second', 'Made First', 'Due Earlier']);
  });

  it('two made at the same instant fall to their ids, whatever order they arrive in', async () => {
    const same = '2026-10-19T16:00:00+00:00';
    const a = piece(1, 'Lower Id', { created_at: same });
    const b = piece(2, 'Higher Id', { created_at: same });
    expect(await titles([a, b])).toEqual(['Higher Id', 'Lower Id']);
    expect(await titles([b, a])).toEqual(['Higher Id', 'Lower Id']);
  });

  it('without created_at (the database today), same-date pieces stay in the order sent, as before', async () => {
    const sent = [piece(1, 'Sent First'), piece(2, 'Sent Second'), piece(3, 'Sent Third')];
    expect(await titles(sent)).toEqual(['Sent First', 'Sent Second', 'Sent Third']);
    expect(await titles(sent.slice().reverse())).toEqual(['Sent Third', 'Sent Second', 'Sent First']);
    // The order assignments.js had before this change, for the same pieces.
    const before = list =>
      list
        .slice()
        .sort((x, y) => {
          const a = x.due_date || x.date || '';
          const b = y.due_date || y.date || '';
          return a < b ? 1 : a > b ? -1 : 0;
        })
        .map(a => a.title);
    const mixed = [
      piece(1, 'A', { due_date: '2026-10-26' }),
      piece(2, 'B'),
      piece(3, 'C', { due_date: null }),
      piece(4, 'D'),
      piece(5, 'E', { due_date: '2026-10-28' }),
    ];
    expect(await titles(mixed)).toEqual(before(mixed));
  });

  it('created_at reaches the page through the function, under the name calc.js reads', async () => {
    const dev = school({
      card: {
        page: Object.assign(samplePage(TODAY), {
          assessments: [piece(1, 'One', { created_at: '2026-10-19T16:04:11.482913+00:00' }), piece(2, 'Two')],
        }),
      },
    });
    const page = await signIn(dev);
    expect(page.T.state().page.assessments.map(a => a.created_at)).toEqual(['2026-10-19T16:04:11.482913+00:00', '']);
  });
});

/* Demo Mode and a real card are drawn by the same code from the same shape
   of reply. Demo Mode's reply for the sample class, sent through the
   function's allow-list as a real reply is, must draw the same list. */
describe('Demo Mode and a real card cannot drift', () => {
  // Demo Mode's made-up ids ('demo-quiz') as ids of the real shape, the same one each time.
  function realIds(reply) {
    const known = {};
    let n = 0;
    const swap = v => (known[v] = known[v] || id(900 + ++n));
    const walk = v => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, inner]) => [/^demo-/.test(k) ? swap(k) : k, walk(inner)]));
      }
      return typeof v === 'string' && /^demo-/.test(v) ? swap(v) : v;
    };
    return walk(reply);
  }

  it.each([
    ['#demo-card', 'proficiency'],
    ['#demo-card-letter', 'letter'],
    ['#demo-card-both', 'both'],
  ])('%s: the demo’s reply, sent as a real one, draws the same rows', async (hash, system) => {
    const demo = openStudentPage();
    await demo.start(hash);
    await demo.submit('form[data-form="card"]');
    demo.type('#sp-ident', demo.T.DEMO.number);
    await demo.click('[data-act="card-yes"]');
    expect(demo.calls).toEqual([]);
    const demoRows = rows(demo);
    expect(demoRows).toHaveLength(9);

    // The sample class's reply before anything was opened (the walk above has opened its own).
    const sent = realIds(openStudentPage().T.demoPage(system));
    // The allow-list drops nothing the list reads: only the class id Demo Mode adds.
    const passed = cardReply(CARD_ROUTES.page, sent);
    const dropped = JSON.parse(JSON.stringify(sent));
    delete dropped.course.id;
    expect(passed).toEqual(dropped);

    const dev = school({ card: { page: sent } });
    const real = await signIn(dev);
    expect(rows(real)).toEqual(demoRows);
    // The same marks, in the same places.
    expect(
      rows(real)
        .filter(r => / · Updated$/.test(r.sub))
        .map(r => r.title),
    ).toEqual(['Lab Safety Contract']);
    // And each walked the same steps: card, verify, page, then seen for the rows that came on screen.
    expect(routes(real)).toEqual(['card', 'verify', 'page']);
    await scrollThroughAll(demo);
    await scrollThroughAll(real);
    expect(routes(real)).toEqual(['card', 'verify', 'page', 'seen']);
    expect(demo.calls).toEqual([]);
  });

  it('Demo Mode answers all five routes on the device, in the function’s shapes', async () => {
    const demo = openStudentPage();
    await demo.start('#demo-card');
    await demo.submit('form[data-form="card"]');
    demo.type('#sp-ident', demo.T.DEMO.number);
    await demo.click('[data-act="card-yes"]');
    expect(row(demo, 'Lab Safety Contract').sub).toMatch(/^Back \S+ \d+ · Updated$/);
    // On screen now: the demo's own `seen` records it, as the server would.
    await scrollThroughAll(demo);
    const reply = demo.T.demoPage('proficiency');
    const contract = reply.assessments.find(a => a.id === 'demo-contract');
    expect(Date.parse(contract.seen_at)).toBeGreaterThan(Date.parse(contract.updated_at));
    expect(Object.keys(reply).sort()).toEqual(Object.keys(samplePage(TODAY)).sort());
    expect(Object.keys(contract).sort()).toEqual(Object.keys(samplePage(TODAY).assessments[0]).sort());
    expect(Object.keys(contract.grade).sort()).toEqual([
      'checks',
      'comment',
      'criteria',
      'modifier',
      'tags',
      'v',
      'value',
    ]);
    // Done starts the sample again and keeps nothing.
    await demo.click('[data-act="card-done"]');
    expect(demo.root().querySelector('form[data-form="card"]')).toBeTruthy();
    expect(demo.root().querySelector('#sp-code').getAttribute('value')).toBe('P3R-8WD');
    expect(demo.calls).toEqual([]);
    expect(demo.store).toEqual({});
    expect(demo.tab).toEqual({});
    expect(demo.addresses).toEqual([]);
  });

  it('Demo Mode’s Done leaves a real session on the device alone', async () => {
    const dev = school();
    await signIn(dev);
    const kept = dev.store[KEY];
    const demo = openStudentPage({ store: dev.store });
    await demo.start('#demo-card');
    await demo.submit('form[data-form="card"]');
    demo.type('#sp-ident', demo.T.DEMO.number);
    await demo.click('[data-act="card-yes"]');
    await demo.click('[data-act="card-done"]');
    expect(demo.calls).toEqual([]);
    expect(dev.store[KEY]).toBe(kept);
  });
});

describe('the page sends nothing anywhere else', () => {
  it('the card’s files name no other host, no Sentry and no storage but the session’s', async () => {
    const { readFileSync } = await import('node:fs');
    const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    const html = read('s/index.html');
    expect(html).not.toMatch(/sentry/i);
    expect(html).not.toMatch(/<script[^>]+src="https?:/i);
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    for (const f of ['s/app.js', 's/assignments.js', 's/student-data.js']) {
      const src = read(f);
      // The one thing asked of `navigator` is the browser's lock that keeps Done to one tab.
      expect(src.replace(/navigator\.locks\b/g, ''), f).not.toMatch(
        /Sentry|sendBeacon|navigator\.|document\.cookie|indexedDB|sessionStorage/,
      );
      expect(src, f).not.toMatch(/https?:\/\//);
    }
    // One key in localStorage, written in one place.
    const app = read('s/app.js');
    expect(app.match(/localStorage\.setItem\(/g)).toHaveLength(1);
    expect(app).toContain(
      'localStorage.setItem(SESSION_KEY, JSON.stringify({ t: s.token, x: s.expires, e: s.enrollment, a: s.active }))',
    );
    expect(read('s/assignments.js') + read('s/student-data.js')).not.toMatch(/localStorage/);
    // The address is only ever set to the page's own path.
    expect(app.match(/replaceState\(/g)).toHaveLength(1);
    expect(app).toContain("history.replaceState(null, '', location.pathname)");
    expect(app).not.toMatch(/location\.(href|hash|search)\s*=|location\.assign|window\.open/);
  });

  it('the service worker stores nothing a student is sent', async () => {
    const { readFileSync } = await import('node:fs');
    const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    // The function is on supabase.co and is asked by POST: the worker leaves both alone.
    expect(sw).toMatch(/if \(url\.hostname\.includes\('supabase\.co'\)\) \{\s*return;/);
    expect(sw).toMatch(/if \(event\.request\.method !== 'GET'\) \{\s*return;/);
    // It only ever stores a GET for a file of this site.
    expect(sw).toContain("if (!response || !response.ok || response.type !== 'basic') return;");
  });
});
