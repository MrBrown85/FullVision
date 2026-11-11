/**
 * Card codes are eight characters and a replaced card says so (S3-F3a;
 * Colin, Nov 10: card codes become eight characters, shown K7M4-QX2P; slips
 * stay six, shown K7M-4QX; a replaced card tells the student).
 *
 * The page runs against the function's real handler (S3-E1) over a stand-in
 * database (tests/helpers/fake-student-submit.js): the card is eight
 * characters, the database is handed its tag, and a replaced card answers
 * card_stopped.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const KEY = 'fv-s-session';
const REPLACED = 'This card has been replaced. Ask your teacher for your new card.';
const CARD = 'K7M4QX2P';

const routes = page => page.calls.map(c => c.body.route);
const alertText = page => (page.root().querySelector('[role="alert"]') || {}).textContent || '';

/* One device and the function it talks to. `card.stopped = true` makes
   the card a replaced one, as the database would say of it. */
function school() {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY, { code: CARD })] });
  const store = {};
  const dev = { fn, store, card: fn.state.cards[CARD] };
  dev.open = async hash => {
    const page = openStudentPage({ store });
    page.server = body => fn.handle(body);
    await page.start(hash || '');
    return page;
  };
  return dev;
}

async function signIn(dev, hash) {
  const page = await dev.open(hash || '#K7M4-QX2P');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}

describe('a code is six characters or eight', () => {
  const page = openStudentPage();
  const isCode = c => page.run('StudentPage.isCode(StudentPage.cleanCode(' + JSON.stringify(c) + '))');
  const pretty = c => page.run('StudentPage.prettyCode(StudentPage.cleanCode(' + JSON.stringify(c) + '))');

  it.each(['K7M4QX2P', 'K7M4-QX2P', 'k7m4-qx2p', 'k7m4qx2p', ' K7M4 QX2P '])('a card’s %j is a code', c => {
    expect(isCode(c)).toBe(true);
    expect(pretty(c)).toBe('K7M4-QX2P');
  });

  it.each(['K7M4QX', 'K7M-4QX', 'k7m-4qx', 'k7m4qx'])('a slip’s %j is a code, shown as today', c => {
    expect(isCode(c)).toBe(true);
    expect(pretty(c)).toBe('K7M-4QX');
  });

  it.each(['K7M4Q', 'K7M4QX2', 'K7M4QX2PA', 'K7M-4Q', 'K7M4-QX2', 'K7M4-QX2PA', ''])('%j is refused', c => {
    expect(isCode(c)).toBe(false);
  });

  it('only the slip alphabet: O, I, L, S, 0, 1 and 5 are not in it', () => {
    ['K7M4QX2O', 'K7M4QX2I', 'K7M4QX2L', 'K7M4QX2S', 'K7M4QX20', 'K7M4QX21', 'K7M4QX25'].forEach(c =>
      expect(isCode(c), c).toBe(false),
    );
  });

  it('a wrong length is shown as typed, with no dash put in', () => {
    expect(pretty('k7m4q')).toBe('K7M4Q');
    expect(pretty('k7m4qx2')).toBe('K7M4QX2');
    expect(pretty('k7m4qx2pa')).toBe('K7M4QX2PA');
  });

  it('both code boxes take an eight-character code with its dash', () => {
    const demo = openStudentPage();
    return demo.start('#demo-card').then(() => {
      expect(demo.root().querySelector('#sp-code').getAttribute('maxlength')).toBe('9');
      expect(demo.root().querySelector('#sp-code').getAttribute('value')).toBe('P3R8-WDK4');
      const slip = openStudentPage();
      return slip.start('').then(() => {
        expect(slip.root().querySelector('#sp-code').getAttribute('maxlength')).toBe('9');
      });
    });
  });
});

describe('an eight-character card opens the student’s page', () => {
  it('scanned: card, verify and page are asked with the eight characters', async () => {
    const dev = school();
    const page = await signIn(dev, '#k7m4-qx2p');
    expect(routes(page)).toEqual(['card', 'verify', 'page']);
    expect(page.calls[0].body).toEqual({ route: 'card', code: CARD });
    expect(page.calls[1].body).toMatchObject({ route: 'verify', code: CARD });
    expect(page.root().querySelector('.sp-page-title').textContent).toBe('Assignments');
  });

  it('typed on the slip screen and on the card’s screen', async () => {
    const dev = school();
    const page = await dev.open('');
    page.type('#sp-code', 'k7m4 qx2p');
    await page.submit('form[data-form="code"]');
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'card', code: CARD }]);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');

    await page.click('[data-act="card-notme"]');
    await page.click('[data-act="card-restart"]');
    page.calls.length = 0;
    page.type('#sp-code', 'K7M4-QX2P');
    await page.submit('form[data-form="card"]');
    expect(page.calls.map(c => c.body)).toEqual([{ route: 'card', code: CARD }]);
    expect(page.root().querySelector('.sp-big').textContent).toBe('Is this you, Cece?');
  });

  it.each(['K7M4Q', 'K7M4QX2', 'K7M4QX2PA'])('%s typed is refused at once, and nothing is asked', async c => {
    const dev = school();
    const slip = await dev.open('');
    slip.type('#sp-code', c);
    await slip.submit('form[data-form="code"]');
    expect(slip.calls).toEqual([]);
    expect(alertText(slip)).toContain("That code didn't work.");

    // The card's screen, after a card has been put back.
    const card = await dev.open('#K7M4-QX2P');
    await card.click('[data-act="card-notme"]');
    await card.click('[data-act="card-restart"]');
    card.calls.length = 0;
    card.type('#sp-code', c);
    await card.submit('form[data-form="card"]');
    expect(card.calls).toEqual([]);
    expect(alertText(card)).toBe("That code didn't work. Check the letters and numbers on your card.");
  });
});

describe('a replaced card says so', () => {
  it('the line exists once in the student page, and app.js reuses it', () => {
    const files = ['student.js', 'app.js', 'questionnaire.js', 'report.js', 'assignments.js', 'student-data.js'];
    const found = files.filter(f => readFileSync(resolve(__dirname, '..', 's', f), 'utf8').includes(REPLACED));
    expect(found).toEqual(['student.js']);
  });

  it('card answers card_stopped: the line, no check asked, and the code leaves the address', async () => {
    const dev = school();
    dev.card.stopped = true;
    const page = await dev.open('#K7M4-QX2P');
    expect(routes(page)).toEqual(['card']);
    expect(alertText(page)).toBe(REPLACED);
    expect(page.root().querySelector('#sp-ident')).toBeNull();
    expect(page.root().querySelector('.sp-head-title').textContent).toBe('Student Page');
    expect(page.addresses).toEqual(['/s/']);
    await page.click('[data-act="card-restart"]');
    expect(page.root().querySelector('form[data-form="card"]')).toBeTruthy();
  });

  it('a replaced card signs the last student out, as any recognised card does', async () => {
    const dev = school();
    await signIn(dev);
    const last = JSON.parse(dev.store[KEY]).t;
    expect(dev.fn.state.sessions[last]).toBeTruthy();

    dev.card.stopped = true;
    const page = await dev.open('#K7M4-QX2P');
    expect(page.calls.map(c => c.body)).toEqual([
      { route: 'card', code: CARD },
      { route: 'done', session: last },
    ]);
    expect(alertText(page)).toBe(REPLACED);
    expect(dev.store).toEqual({});
    expect(dev.fn.state.sessions).toEqual({});
  });

  it('typed on the card’s screen: the same line', async () => {
    const dev = school();
    dev.card.stopped = true;
    const page = await dev.open('');
    page.type('#sp-code', 'K7M4-QX2P');
    await page.submit('form[data-form="code"]');
    expect(routes(page)).toEqual(['card']);
    expect(alertText(page)).toBe(REPLACED);
  });

  it('verify answers card_stopped (replaced while Is This You? was open): the same line, and nothing kept', async () => {
    const dev = school();
    const page = await dev.open('#K7M4-QX2P');
    dev.card.stopped = true;
    page.type('#sp-ident', '0123456');
    await page.click('[data-act="card-yes"]');
    expect(routes(page)).toEqual(['card', 'verify']);
    expect(alertText(page)).toBe(REPLACED);
    expect(page.root().querySelector('#sp-ident')).toBeNull();
    expect(dev.store).toEqual({});
  });
});

describe('a six-character slip still opens as before', () => {
  it('scanned: card says it is no card, then open, and the box shows K7M-4QX', async () => {
    const dev = school();
    dev.fn.state.slips.K7M4QX = {
      ok: true,
      token: 'a'.repeat(64),
      student: { first_name: 'Cece' },
      course: { name: 'Science 8', block: 'B' },
      preview: [{ title: 'November Reflection', count: 1 }],
      check: 'identity',
    };
    const page = await dev.open('#k7m-4qx');
    expect(page.calls.map(c => c.body)).toEqual([
      { route: 'card', code: 'K7M4QX' },
      { route: 'open', code: 'K7M4QX' },
    ]);
    expect(page.root().querySelector('[data-act="start"]')).toBeTruthy();
    expect(page.T.state().typed).toBe('K7M-4QX');
  });
});
