/**
 * The rest of the student's sign-in screens (S3-F3; the artboard's "After
 * Done", "Switching Classes", "Signing In on a Chromebook", and the locks
 * on "Is This You?").
 *
 * The page runs as a browser loads it (tests/helpers/student-page-context.js)
 * against the student-submit function's real handler and routes over a
 * stand-in database (tests/helpers/fake-student-submit.js), as
 * tests/student-card-wired.test.js does. No test waits on real time: the
 * page's clock is moved (advance) and its timers fired (runTimers).
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, fakeStudentSubmit, id, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const KEY = 'fv-s-session';
const HUM = id(3); // Cece's enrollment in a second class
const LOCKED = 'This card is locked after too many wrong tries. Ask your teacher to unlock it.';
const SIGNED_OUT = 'You are signed out. Scan or type your card to open your page again.';

const routes = page => page.calls.map(c => c.body.route);
const text = page => page.root().textContent;
const alertText = page => (page.root().querySelector('[role="alert"]') || {}).textContent || '';
// Every piece's title, as All Assignments lists them (S4-F1: the tab opens on To Do).
const titles = page => (page.showAll(), [...page.root().querySelectorAll('.sp-row-title')].map(el => el.textContent));
const has = (page, sel) => !!page.root().querySelector(sel);
// Waits, a turn at a time, until `ok()` holds, however long a busy machine takes (never a fixed number of turns).
async function until(ok, what) {
  const giveUp = performance.now() + 4000;
  while (!ok()) {
    if (performance.now() > giveUp) throw new Error('never happened: ' + what);
    await new Promise(r => setImmediate(r));
  }
}
// The class showing: its name and, on the page (S4-F1), its block beside it.
const head = page => {
  const pill = page.root().querySelector('.sp-pill');
  return page.root().querySelector('.sp-head-title').textContent + (pill ? ' · ' + pill.textContent : '');
};

// Cece's card for a second class, Humanities 8, with a page of its own.
function humanitiesCard(more) {
  const page = Object.assign(samplePage(TODAY), {
    student: { enrollment_id: HUM, first_name: 'Cece' },
    course: Object.assign(samplePage(TODAY).course, { name: 'Humanities 8', block: 'A' }),
    assessments: [Object.assign({}, samplePage(TODAY).assessments[0], { id: id(90), title: 'Medieval Europe Map' })],
  });
  return sampleCard(
    TODAY,
    Object.assign({ code: 'K7M4QX2P', enrollment: HUM, course: { name: 'Humanities 8', block: 'A' }, page }, more),
  );
}

function school(opts = {}) {
  const fn = fakeStudentSubmit(Object.assign({ cards: [sampleCard(TODAY), humanitiesCard()] }, opts));
  const store = {};
  const open = async (hash, more) => {
    const page = openStudentPage(Object.assign({ store }, more));
    page.server = body => fn.handle(body);
    await page.start(hash || '');
    return page;
  };
  return { fn, store, open };
}

async function signIn(dev, hash) {
  const page = await dev.open(hash || '#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}

// From the signed-in page: Your Classes, Add Another Card, the code typed.
async function addCard(page, code) {
  await page.click('[data-act="classes-open"]');
  await page.click('.sp-sheet [data-act="card-add"]');
  page.type('#sp-code', code);
  await page.submit('form[data-form="card"]');
}

describe('After Done', () => {
  it('Done shows After Done: the board’s words, nothing of the student, and Scan a Card', async () => {
    const dev = school();
    const page = await signIn(dev);
    await page.click('[data-act="card-done"]');
    expect(page.root().querySelector('.sp-big').textContent).toBe('You’re signed out');
    // A phone and a Chromebook each say what they are; the stylesheet shows one.
    expect(page.root().querySelector('.sp-lead .sp-narrow').textContent).toBe('This phone no longer has your card.');
    expect(page.root().querySelector('.sp-lead .sp-wide').textContent).toBe('This computer no longer has your card.');
    expect(page.root().querySelector('[data-act="card-restart"]').textContent).toBe('Scan a Card');
    for (const left of ['Cece', 'Science 8', 'Assignments', 'P3R8', '0123456']) {
      expect(page.root().innerHTML, left).not.toContain(left);
    }
    expect(dev.store).toEqual({});
    await page.click('[data-act="card-restart"]');
    expect(has(page, 'form[data-form="card"]')).toBe(true);
    expect(page.root().querySelector('.sp-msg')).toBeNull();
  });

  it('only Done shows it: midnight and fifteen idle minutes still say so on the card’s first screen', async () => {
    const dev = school({ lasts: 10 * 60 * 1000 });
    const page = await signIn(dev);
    const ends = Date.parse(JSON.parse(dev.store[KEY]).x);
    page.T.checkSession(ends);
    expect(has(page, '.sp-signed-out')).toBe(false);
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
  });

  it('Demo Mode: Done shows After Done, and Scan a Card starts the sample again with nothing sent', async () => {
    const demo = openStudentPage();
    await demo.start('#demo-card');
    await demo.submit('form[data-form="card"]');
    demo.type('#sp-ident', demo.T.DEMO.number);
    await demo.click('[data-act="card-yes"]');
    await demo.click('[data-act="card-done"]');
    expect(demo.root().querySelector('.sp-big').textContent).toBe('You’re signed out');
    await demo.click('[data-act="card-restart"]');
    expect(demo.root().querySelector('#sp-code').getAttribute('value')).toBe('P3R8-WDK4');
    expect(demo.calls).toEqual([]);
  });
});

describe('Switching Classes: Your Classes', () => {
  it('the class’s name opens Your Classes, which lists the session’s classes with this one ticked', async () => {
    const dev = school();
    const page = await signIn(dev);
    const button = page.root().querySelector('.sp-head-switch');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.textContent).toBe('Science 8Block B');
    await page.click('[data-act="classes-open"]');
    const sheet = page.root().querySelector('.sp-sheet');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.querySelector('.sp-sheet-title').textContent).toBe('Your Classes');
    const classes = [...sheet.querySelectorAll('.sp-class')];
    expect(classes.map(b => b.textContent)).toEqual(['Science 8Block B']);
    expect(classes[0].getAttribute('aria-current')).toBe('true');
    expect(sheet.querySelector('[data-act="card-add"]').textContent).toBe('Add Another Card');
    // Escape closes it; nothing was asked.
    const before = page.calls.length;
    page.fire('keydown', { key: 'Escape', preventDefault() {} });
    expect(has(page, '.sp-sheet')).toBe(false);
    expect(page.calls.length).toBe(before);
  });

  it('Add Another Card: the code is put to card, nobody is signed out, and the check joins this session', async () => {
    const dev = school();
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    page.calls.length = 0;
    await addCard(page, 'K7M4-QX2P');
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'card', code: 'K7M4QX2P' }]);
    // Cece is still signed in: no Done, the token kept.
    expect(JSON.parse(dev.store[KEY]).t).toBe(token);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
    expect(text(page)).toContain('Humanities 8 · Block A');
    expect(has(page, '[data-act="card-back"]')).toBe(true);
    // The phone's "No camera?" box is not offered while adding.
    expect(has(page, 'form[data-form="card"]')).toBe(false);

    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    const add = page.calls.find(c => c.body.route === 'add-card').body;
    expect(add).toEqual({
      route: 'add-card',
      code: 'K7M4QX2P',
      birthday: null,
      student_number: '0123456',
      password: null,
      session: token,
    });
    expect(routes(page)).not.toContain('verify');
    expect(routes(page)).not.toContain('done');
    expect(dev.fn.sql.filter(q => q.fn === 'verify_card').map(q => q.add)).toEqual([false, true]);
    // The same session, now opening Humanities 8.
    expect(Object.keys(dev.fn.state.sessions)).toEqual([token]);
    expect(JSON.parse(dev.store[KEY])).toMatchObject({ t: token, e: HUM });
    expect(page.calls.filter(c => c.body.route === 'page').pop().body).toEqual({
      route: 'page',
      session: token,
      enrollment_id: HUM,
    });
    expect(head(page)).toBe('Humanities 8 · Block A');
    expect(titles(page)).toEqual(['Medieval Europe Map']);
  });

  it('both classes are listed, and choosing one opens it in the same session', async () => {
    const dev = school();
    const page = await signIn(dev);
    const token = JSON.parse(dev.store[KEY]).t;
    await addCard(page, 'K7M4-QX2P');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    await page.click('[data-act="classes-open"]');
    const names = [...page.root().querySelectorAll('.sp-class-name')].map(el => el.textContent);
    expect(names.sort()).toEqual(['Humanities 8', 'Science 8']);
    expect(page.root().querySelector('.sp-class[aria-current="true"] .sp-class-name').textContent).toBe('Humanities 8');
    page.calls.length = 0;
    await page.click('.sp-class[data-enrollment="' + CECE + '"]');
    expect(page.calls.map(c => c.body)).toEqual([
      { route: 'page', session: token, enrollment_id: CECE },
      // What the class takes (s/send.js), once its page is in.
      { route: 'work', session: token, enrollment_id: CECE },
    ]);
    expect(head(page)).toBe('Science 8 · Block B');
    expect(JSON.parse(dev.store[KEY])).toMatchObject({ t: token, e: CECE });
    expect(has(page, '.sp-sheet')).toBe(false);
    // The device opened again opens the class last chosen.
    const again = await dev.open('');
    expect(head(again)).toBe('Science 8 · Block B');
  });

  it('a class not in the list opens nothing', async () => {
    const dev = school();
    const page = await signIn(dev);
    await page.click('[data-act="classes-open"]');
    page.root().querySelector('.sp-class').setAttribute('data-enrollment', OMAR);
    page.calls.length = 0;
    await page.click('.sp-class');
    expect(page.calls).toEqual([]);
    expect(JSON.parse(dev.store[KEY]).e).toBe(CECE);
  });

  it('a class’s page that lands after the student was signed out is not drawn', async () => {
    const dev = school();
    const page = await signIn(dev);
    await addCard(page, 'K7M4-QX2P');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    let release;
    let asked = false;
    const held = new Promise(r => (release = r));
    page.server = async body => {
      if (body.route === 'page' && body.enrollment_id === CECE) {
        asked = true;
        await held;
      }
      return dev.fn.handle(body);
    };
    await page.click('[data-act="classes-open"]');
    page.tap('.sp-class[data-enrollment="' + CECE + '"]');
    await until(() => asked, 'Science 8 asked for');
    // Science 8 is still loading when fifteen idle minutes pass.
    page.advance(16 * 60 * 1000);
    page.runTicks();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    release();
    await page.settle();
    expect(has(page, '.sp-row')).toBe(false);
    expect(page.root().innerHTML).not.toContain('Science 8');
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
  });
});

describe('Switching Classes: what stops Add Another Card', () => {
  it('a card that won’t open says why on the add screen, signs nobody out, and Back to Your Page asks nothing', async () => {
    for (const [field, words] of [
      ['locked', LOCKED],
      ['stopped', 'This card has been replaced. Ask your teacher for your new card.'],
      ['expired', "This card's last day has passed. Ask your teacher for a new card."],
      ['closed', 'The student page is turned off for this class. Ask your teacher.'],
    ]) {
      const dev = school({ cards: [sampleCard(TODAY), humanitiesCard({ [field]: true })] });
      const page = await signIn(dev);
      const token = JSON.parse(dev.store[KEY]).t;
      page.calls.length = 0;
      await addCard(page, 'K7M4-QX2P');
      expect(alertText(page), field).toBe(words);
      expect(routes(page), field).toEqual(['card']);
      expect(JSON.parse(dev.store[KEY]).t, field).toBe(token);
      expect(Object.keys(dev.fn.state.sessions), field).toEqual([token]);
      page.calls.length = 0;
      await page.click('[data-act="card-back"]');
      expect(page.calls, field).toEqual([]);
      expect(head(page), field).toBe('Science 8 · Block B');
      expect(titles(page).length, field).toBeGreaterThan(0);
    }
  });

  it('a slip’s code or a code nobody holds: the card’s words, and the slip route is not asked', async () => {
    const dev = school({ slips: { K7M4QX: { ok: true, token: 'a'.repeat(64), student: {}, course: {}, parts: [] } } });
    const page = await signIn(dev);
    page.calls.length = 0;
    await addCard(page, 'K7M-4QX');
    expect(alertText(page)).toBe("That code didn't work. Check the letters and numbers on your card.");
    expect(routes(page)).toEqual(['card']);
    expect(has(page, 'form[data-form="card"]')).toBe(true);
  });

  it('too many wrong codes from this address: Too many tries, and the student stays signed in', async () => {
    const dev = school();
    const page = await signIn(dev);
    dev.fn.state.addressLocked = true;
    await addCard(page, 'K7M4-QX2P');
    expect(alertText(page)).toBe('Too many tries. Wait 15 minutes and try again.');
    expect(dev.store[KEY]).toBeTruthy();
  });

  it('No, That’s Not Me while adding: Give This Card Back, and the student’s own page is one press away', async () => {
    const dev = school();
    const page = await signIn(dev);
    await addCard(page, 'K7M4-QX2P');
    await page.click('[data-act="card-notme"]');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Give This Card Back');
    expect(has(page, '[data-act="card-restart"]')).toBe(false);
    await page.click('[data-act="card-add"]');
    expect(page.root().querySelector('.sp-big').textContent).toBe('Add Another Card');
    await page.click('[data-act="card-back"]');
    expect(head(page)).toBe('Science 8 · Block B');
    expect(dev.store[KEY]).toBeTruthy();
  });

  it('wrong answers while adding count down, and a lock says so with the way back to the page', async () => {
    const dev = school();
    const page = await signIn(dev);
    await addCard(page, 'K7M4-QX2P');
    for (let i = 0; i < 4; i++) {
      page.type('#sp-ident', '999');
      await page.click('[data-act="card-yes"]');
    }
    expect(alertText(page)).toContain('1 try left.');
    page.type('#sp-ident', '999');
    await page.click('[data-act="card-yes"]');
    expect(alertText(page)).toBe(LOCKED);
    expect(has(page, '[data-act="card-back"]')).toBe(true);
    expect(has(page, '[data-act="card-restart"]')).toBe(false);
    await page.click('[data-act="card-back"]');
    expect(head(page)).toBe('Science 8 · Block B');
  });

  it('a card’s answer that lands after the student was signed out is dropped', async () => {
    const dev = school();
    const page = await signIn(dev);
    let release;
    let asked = false;
    const held = new Promise(r => (release = r));
    page.server = async body => {
      if (body.route === 'card') {
        asked = true;
        await held;
      }
      return dev.fn.handle(body);
    };
    await page.click('[data-act="classes-open"]');
    await page.click('.sp-sheet [data-act="card-add"]');
    page.type('#sp-code', 'K7M4-QX2P');
    page.send('form[data-form="card"]');
    await until(() => asked, 'the code on its way');
    page.advance(16 * 60 * 1000);
    page.runTicks();
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    release();
    await page.settle();
    expect(text(page)).not.toContain('Is this you');
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
  });

  it('the session ended on the server meanwhile: add-card starts a new one, and its token is kept', async () => {
    const dev = school();
    const page = await signIn(dev);
    const old = JSON.parse(dev.store[KEY]).t;
    delete dev.fn.state.sessions[old];
    await addCard(page, 'K7M4-QX2P');
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    const kept = JSON.parse(dev.store[KEY]);
    expect(kept.t).not.toBe(old);
    expect(kept.t).toMatch(/^[0-9a-f]{64}$/);
    expect(kept.e).toBe(HUM);
    expect(head(page)).toBe('Humanities 8 · Block A');
  });

  it('fifteen idle minutes on the add screen sign the student out, as on the page', async () => {
    const dev = school();
    const page = await signIn(dev);
    await page.click('[data-act="classes-open"]');
    await page.click('.sp-sheet [data-act="card-add"]');
    page.advance(16 * 60 * 1000);
    page.runTicks();
    expect(dev.store).toEqual({});
    expect(page.root().querySelector('.sp-msg').textContent).toBe(SIGNED_OUT);
    expect(page.T.adding()).toBeNull();
  });
});

describe('the locks are the server’s, and the page says what it answers', () => {
  it('fifteen in seven days: the tries left are the server’s count, and a lock can come before five in a row', async () => {
    const dev = school();
    let wrong = 0;
    const page = await dev.open('#P3R8-WDK4', {});
    page.server = body => {
      if (body.route !== 'verify') return dev.fn.handle(body);
      wrong += 1;
      // Thirteen this week already: two more lock it.
      return wrong === 1 ? { ok: false, error: 'wrong_identity', tries_left: 1 } : { ok: false, error: 'card_locked' };
    };
    page.type('#sp-ident', '999');
    await page.click('[data-act="card-yes"]');
    expect(alertText(page)).toBe(
      "That doesn't match. Check your birthday or student number. 1 try left. One more wrong try locks this card, and your teacher will need to unlock it.",
    );
    page.type('#sp-ident', '998');
    await page.click('[data-act="card-yes"]');
    expect(alertText(page)).toBe(LOCKED);
    expect(has(page, '#sp-ident')).toBe(false);
    expect(dev.store).toEqual({});
  });
});

describe('Is This You? on a Chromebook', () => {
  it('one card holds the class, the student, the check and both buttons; the phone’s code box is phone-only', async () => {
    const dev = school();
    const page = await dev.open('#P3R8-WDK4');
    const box = page.root().querySelector('.sp-check-box');
    expect(box.querySelector('.sp-check-class').textContent).toBe('Science 8 · Block B');
    expect(box.querySelector('.sp-check-class').className).toContain('sp-wide-block');
    expect(box.querySelector('.sp-hello-who .sp-big').textContent).toBe('Is this you, Cece?');
    expect(box.querySelector('[data-act="card-yes"]')).toBeTruthy();
    expect(box.querySelector('[data-act="card-notme"]')).toBeTruthy();
    expect(page.root().querySelector('form[data-form="card"]').closest('.sp-narrow-block')).toBeTruthy();
    expect(page.root().querySelector('.sp-head').closest('.sp-narrow-block')).toBeTruthy();
  });
});

describe('Scan the Code With the Camera (a Chromebook)', () => {
  /* A camera and a QR reader standing in for the browser's. `reads` is what
     each look at the picture finds, in turn; past its end, nothing. */
  function camera(page, opts = {}) {
    const cam = { asked: [], stopped: 0, reads: opts.reads || [], looks: 0, release: null };
    const stream = { getTracks: () => [{ stop: () => (cam.stopped += 1) }] };
    page.ctx.navigator = {
      mediaDevices: {
        getUserMedia: constraints => {
          cam.asked.push(constraints);
          if (opts.refuse) return Promise.reject(new Error('NotAllowedError'));
          if (opts.hold) return new Promise(r => (cam.release = () => r(stream)));
          return Promise.resolve(stream);
        },
      },
    };
    page.ctx.BarcodeDetector = class {
      constructor(o) {
        cam.formats = o.formats;
      }
      detect() {
        const found = cam.reads[cam.looks] || [];
        cam.looks += 1;
        return Promise.resolve(found);
      }
    };
    cam.stream = stream;
    return cam;
  }
  // The page's next look at the picture, as if its time had come.
  async function look(page) {
    page.advance(page.T.SCAN_EVERY_MS);
    page.runTimers();
    await page.settle();
  }

  it('a browser with no QR reader, or no camera, is not offered it', async () => {
    const none = openStudentPage();
    await none.start('#demo-card');
    expect(has(none, '[data-act="card-camera"]')).toBe(false);
    const noCamera = openStudentPage();
    noCamera.ctx.BarcodeDetector = class {};
    await noCamera.start('#demo-card');
    expect(has(noCamera, '[data-act="card-camera"]')).toBe(false);
    const both = openStudentPage();
    camera(both);
    await both.start('#demo-card');
    expect(has(both, '[data-act="card-camera"]')).toBe(true);
  });

  it('offered on a Chromebook only; it opens the camera, reads the card’s address, turns the camera off and opens the card', async () => {
    const dev = school();
    const page = openStudentPage({ store: dev.store });
    page.server = body => dev.fn.handle(body);
    const cam = camera(page, { reads: [[], [{ rawValue: 'https://fullvision.ca/s/#P3R8WDK4' }]] });
    // The card's first screen, as a device with no session shows it after Done.
    await page.start('#P3R8-WDK4');
    await page.click('[data-act="card-notme"]');
    await page.click('[data-act="card-restart"]');
    const button = page.root().querySelector('[data-act="card-camera"]');
    expect(button.textContent).toBe('Scan the Code With the Camera');
    expect(button.className).toContain('sp-wide-block');
    page.calls.length = 0;
    await page.click('[data-act="card-camera"]');
    expect(cam.asked).toEqual([{ video: { facingMode: 'user' }, audio: false }]);
    expect(cam.formats).toEqual(['qr_code']);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Scan the code on your card');
    expect(page.root().querySelector('.sp-scan-video').srcObject).toBe(cam.stream);
    await look(page);
    expect(page.calls).toEqual([]);
    await look(page);
    expect(cam.stopped).toBe(1);
    expect(page.T.camera()).toBeNull();
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'card', code: 'P3R8WDK4' }]);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });

  it('Type the Code Instead turns the camera off, and a look still on its way does nothing when it lands', async () => {
    const dev = school();
    const page = await dev.open('#P3R8-WDK4');
    const cam = camera(page);
    // The reader takes its time over this look.
    let release;
    page.ctx.BarcodeDetector.prototype.detect = () => new Promise(r => (release = () => r([{ rawValue: 'P3R8WDK4' }])));
    await page.click('[data-act="card-notme"]');
    await page.click('[data-act="card-restart"]');
    await page.click('[data-act="card-camera"]');
    await look(page);
    expect(typeof release).toBe('function');
    page.calls.length = 0;
    await page.click('[data-act="card-type"]');
    expect(cam.stopped).toBe(1);
    expect(has(page, 'form[data-form="card"]')).toBe(true);
    release();
    await page.settle();
    expect(page.calls).toEqual([]);
    expect(has(page, 'form[data-form="card"]')).toBe(true);
  });

  it('a camera that opens after Type the Code Instead is turned straight off and draws nothing', async () => {
    const dev = school();
    const page = await dev.open('#P3R8-WDK4');
    const cam = camera(page, { hold: true });
    await page.click('[data-act="card-notme"]');
    await page.click('[data-act="card-restart"]');
    await page.click('[data-act="card-camera"]');
    await page.click('[data-act="card-type"]');
    cam.release();
    await page.settle();
    expect(cam.stopped).toBe(1);
    expect(has(page, '.sp-scan-video')).toBe(false);
    expect(has(page, 'form[data-form="card"]')).toBe(true);
  });

  it('a camera refused or missing: back to the code box, saying so', async () => {
    const dev = school();
    const page = await dev.open('#P3R8-WDK4');
    camera(page, { refuse: true });
    await page.click('[data-act="card-notme"]');
    await page.click('[data-act="card-restart"]');
    await page.click('[data-act="card-camera"]');
    expect(alertText(page)).toBe('The camera didn’t open. Type the code on your card instead.');
    expect(has(page, 'form[data-form="card"]')).toBe(true);
  });

  it('the tab hidden turns the camera off', async () => {
    const dev = school();
    const page = await dev.open('#P3R8-WDK4');
    const cam = camera(page);
    await page.click('[data-act="card-notme"]');
    await page.click('[data-act="card-restart"]');
    await page.click('[data-act="card-camera"]');
    page.hide();
    expect(cam.stopped).toBe(1);
    expect(page.T.camera()).toBeNull();
    expect(has(page, 'form[data-form="card"]')).toBe(true);
  });

  it('what the camera reads: a card’s or a slip’s address, or a code alone; anything else is nothing', () => {
    const page = openStudentPage();
    const read = v => page.T.codeFrom(v);
    expect(read('https://fullvision.ca/s/#P3R8WDK4')).toBe('P3R8WDK4');
    expect(read('https://fullvision.ca/s/#K7M-4QX')).toBe('K7M4QX');
    expect(read('p3r8-wdk4')).toBe('P3R8WDK4');
    expect(read('https://example.com/')).toBe('');
    expect(read('')).toBe('');
    expect(read(undefined)).toBe('');
  });

  it('Demo Mode: the camera’s code opens the sample card, and nothing is sent', async () => {
    const demo = openStudentPage();
    const cam = camera(demo, { reads: [[{ rawValue: 'https://fullvision.ca/s/#P3R8WDK4' }]] });
    await demo.start('#demo-card');
    await demo.click('[data-act="card-camera"]');
    await look(demo);
    expect(cam.stopped).toBe(1);
    expect(demo.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
    expect(demo.calls).toEqual([]);
  });
});

describe('Demo Mode: Switching Classes on the device', () => {
  it('Add Another Card adds the second sample class, and the two switch, with nothing sent', async () => {
    const demo = openStudentPage();
    await demo.start('#demo-card');
    await demo.submit('form[data-form="card"]');
    demo.type('#sp-ident', demo.T.DEMO.number);
    await demo.click('[data-act="card-yes"]');
    expect(head(demo)).toBe('Science 8 · Block B');
    await demo.click('[data-act="classes-open"]');
    await demo.click('.sp-sheet [data-act="card-add"]');
    expect(text(demo)).toContain('This is Demo Mode. Any code adds a second sample class.');
    demo.type('#sp-code', 'ABCD-EFGH');
    await demo.submit('form[data-form="card"]');
    expect(text(demo)).toContain('Humanities 8 · Block A');
    demo.type('#sp-ident', demo.T.DEMO.number);
    await demo.click('[data-act="card-yes"]');
    expect(head(demo)).toBe('Humanities 8 · Block A');
    expect(titles(demo)).toContain('Medieval Europe Map');
    // The draft in the second class is nowhere.
    expect(demo.root().innerHTML).not.toContain('one more piece of evidence');
    await demo.click('[data-act="classes-open"]');
    expect([...demo.root().querySelectorAll('.sp-class-name')].map(el => el.textContent)).toEqual([
      'Science 8',
      'Humanities 8',
    ]);
    await demo.click('.sp-class[data-enrollment="demo-cece"]');
    expect(head(demo)).toBe('Science 8 · Block B');
    expect(demo.calls).toEqual([]);
    expect(demo.store).toEqual({});
  });
});
